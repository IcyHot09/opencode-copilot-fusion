import test from "node:test"
import assert from "node:assert/strict"
import { FusionRouter, credsKey } from "../dist/router.js"

const CK = credsKey("gho_test", "https://api.business.githubcopilot.com")
const BASE_REQ = {
  baseURL: "https://api.business.githubcopilot.com",
  token: "gho_test",
  credsKey: CK,
  sessionID: "ses_test1",
  variant: "high",
  wire: "responses",
  tier: "hydrafusion",
  text: "write a retry-backoff function",
  image: false,
  route: "conversation",
}
const FUTURE = Math.floor(Date.now() / 1000) + 86400

function autoResponse(overrides = {}) {
  return {
    session_token: "session-token-1",
    expires_at: FUTURE,
    selected_model: { id: "gpt-6-luna", supported_endpoints: ["/responses"], capabilities: { input: ["text", "image"] } },
    ...overrides,
  }
}

function mockFetch(handlers) {
  const calls = []
  const fetchImpl = async (input, init) => {
    const url = String(input)
    calls.push({ url, init })
    for (const [pattern, handler] of handlers) {
      if (url.includes(pattern)) return handler({ url, init })
    }
    throw new Error(`no mock for ${url}`)
  }
  return { calls, fetchImpl }
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

test("sticky: one /auto call per conversation; later turns reuse the pinned route", async () => {
  const { calls, fetchImpl } = mockFetch([["/auto", () => jsonResponse(autoResponse())]])
  const router = new FusionRouter({ fetchImpl })

  const first = await router.route(BASE_REQ)
  assert.equal(first.ok, true)
  assert.equal(first.entry.modelId, "gpt-6-luna")
  assert.equal(calls.length, 1)

  const second = await router.route(BASE_REQ)
  assert.equal(second.ok, true)
  assert.equal(calls.length, 1, "second turn reuses the pinned route")

  const body = JSON.parse(String(calls[0].init.body))
  assert.equal(body.tier, "hydrafusion")
  assert.equal(body.prompt, BASE_REQ.text)
  assert.equal(body.multi_turn.routing_intent, "anchor")
  assert.equal(calls[0].init.headers.Authorization, "Bearer gho_test")
  assert.equal(calls[0].init.headers["Copilot-Integration-Id"], undefined)
})

test("different variant routes separately", async () => {
  const { calls, fetchImpl } = mockFetch([["/auto", () => jsonResponse(autoResponse())]])
  const router = new FusionRouter({ fetchImpl })
  await router.route(BASE_REQ)
  await router.route({ ...BASE_REQ, variant: "max", tier: "hydrafusion-max" })
  assert.equal(calls.length, 2)
})

test("different credential routes separately (re-auth invalidates pins)", async () => {
  const { calls, fetchImpl } = mockFetch([["/auto", () => jsonResponse(autoResponse())]])
  const router = new FusionRouter({ fetchImpl })
  await router.route(BASE_REQ)
  await router.route({ ...BASE_REQ, token: "gho_other", credsKey: credsKey("gho_other", BASE_REQ.baseURL) })
  assert.equal(calls.length, 2)
})

test("concurrent turns share one /auto call (single-flight)", async () => {
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const { calls, fetchImpl } = mockFetch([["/auto", async () => { await gate; return jsonResponse(autoResponse()) }]])
  const router = new FusionRouter({ fetchImpl })
  const p1 = router.route(BASE_REQ)
  const p2 = router.route(BASE_REQ)
  release()
  const [r1, r2] = await Promise.all([p1, p2])
  assert.equal(r1.ok, true)
  assert.equal(r2.ok, true)
  assert.equal(calls.length, 1, "concurrent cold-cache turns must share the route request")
  assert.equal(r1.entry.modelId, r2.entry.modelId)
})

test("prompt mode re-routes per unique prompt but caches repeats", async () => {
  const { calls, fetchImpl } = mockFetch([["/auto", () => jsonResponse(autoResponse())]])
  const router = new FusionRouter({ fetchImpl })
  await router.route({ ...BASE_REQ, route: "prompt", text: "one" })
  await router.route({ ...BASE_REQ, route: "prompt", text: "two" })
  await router.route({ ...BASE_REQ, route: "prompt", text: "two" })
  assert.equal(calls.length, 2)
})

test("near-expiry token triggers re-route", async () => {
  const soon = Math.floor(Date.now() / 1000) + 120 // within the 5 minute skew
  const { calls, fetchImpl } = mockFetch([
    ["/auto", () => jsonResponse(autoResponse({ expires_at: soon }))],
  ])
  const router = new FusionRouter({ fetchImpl, skewMs: 5 * 60_000 })
  await router.route(BASE_REQ)
  await router.route(BASE_REQ)
  assert.equal(calls.length, 2)
})

test("bad expires_at is clamped; missing expires_at gets 24h default", async () => {
  const huge = Math.floor(Date.now() / 1000) + 365 * 86400
  const { fetchImpl } = mockFetch([
    ["/auto", () => jsonResponse(autoResponse({ expires_at: huge }))],
  ])
  const router = new FusionRouter({ fetchImpl })
  const result = await router.route(BASE_REQ)
  assert.equal(result.ok, true)
  assert.ok(result.entry.expiresAtMs < Date.now() + 26 * 3600 * 1000, "25h clamp applies")

  const { fetchImpl: fetchImpl2 } = mockFetch([
    ["/auto", () => jsonResponse({ session_token: "tok", expires_at: undefined, selected_model: { id: "gpt-6-luna", supported_endpoints: ["/responses"] } })],
  ])
  const router2 = new FusionRouter({ fetchImpl: fetchImpl2 })
  const result2 = await router2.route(BASE_REQ)
  assert.equal(result2.ok, true)
  assert.ok(result2.entry.expiresAtMs > Date.now() + 23 * 3600 * 1000)
})

test("empty model id or token is rejected", async () => {
  const { fetchImpl } = mockFetch([
    ["/auto", () => jsonResponse({ session_token: "  ", expires_at: FUTURE, selected_model: { id: "gpt-6-luna" } })],
  ])
  const router = new FusionRouter({ fetchImpl })
  const result = await router.route(BASE_REQ)
  assert.equal(result.ok, false)
})

test("/auto failure reuses last good route when still valid", async () => {
  let fail = false
  const { fetchImpl } = mockFetch([
    ["/auto", () => (fail ? new Response("boom", { status: 503 }) : jsonResponse(autoResponse()))],
  ])
  const router = new FusionRouter({ fetchImpl })
  const first = await router.route(BASE_REQ)
  assert.equal(first.ok, true)
  fail = true
  const second = await router.route(BASE_REQ)
  assert.equal(second.ok, true, "previous route is reused while it is fresh")
})

test("/auto failure with no prior route reports ok:false without leaking the body", async () => {
  const { fetchImpl } = mockFetch([["/auto", () => new Response("internal error: your prompt was invalid: blah blah blah", { status: 503 })]])
  const router = new FusionRouter({ fetchImpl })
  const result = await router.route(BASE_REQ)
  assert.equal(result.ok, false)
  assert.match(result.reason, /HTTP 503/)
  assert.doesNotMatch(result.reason, /blah blah blah/)
})

test("cross-wire pick is rejected (responses wire vs messages-only model)", async () => {
  const { fetchImpl } = mockFetch([
    ["/auto", () => jsonResponse(autoResponse({ selected_model: { id: "claude-opus-5.5", supported_endpoints: ["/v1/messages"] } }))],
  ])
  const router = new FusionRouter({ fetchImpl })
  const result = await router.route(BASE_REQ) // wire: responses
  assert.equal(result.ok, false)
  assert.match(result.reason, /does not serve/)
})

test("wire check falls back to /models catalog when /auto omits endpoints", async () => {
  const { fetchImpl, calls } = mockFetch([
    ["/auto", () => jsonResponse({ session_token: "tok", expires_at: FUTURE, selected_model: { id: "mai-code-1.1-flash" } })],
    ["/models", () => jsonResponse({ data: [{ id: "mai-code-1.1-flash", supported_endpoints: ["/chat/completions"] }] })],
  ])
  const router = new FusionRouter({ fetchImpl })
  const result = await router.route(BASE_REQ) // wire: responses
  assert.equal(result.ok, false)
  assert.ok(calls.some((c) => c.url.includes("/models")))
})

test("wire check passes when catalog serves the wire", async () => {
  const { fetchImpl } = mockFetch([
    ["/auto", () => jsonResponse({ session_token: "tok", expires_at: FUTURE, selected_model: { id: "mai-code-1.1-flash" } })],
    ["/models", () => jsonResponse({ data: [{ id: "mai-code-1.1-flash", supported_endpoints: ["/responses"] }] })],
  ])
  const router = new FusionRouter({ fetchImpl })
  const result = await router.route(BASE_REQ)
  assert.equal(result.ok, true)
})

test("messages wire accepts /v1/messages", async () => {
  const { fetchImpl } = mockFetch([
    ["/auto", () => jsonResponse({ session_token: "tok", expires_at: FUTURE, selected_model: { id: "claude-opus-5.5", supported_endpoints: ["/v1/messages"] } })],
  ])
  const router = new FusionRouter({ fetchImpl })
  const result = await router.route({ ...BASE_REQ, wire: "messages" })
  assert.equal(result.ok, true)
})

test("image prompt with non-vision pinned model re-routes; fresh non-vision pick is rejected", async () => {
  const { calls, fetchImpl } = mockFetch([
    ["/auto", () => jsonResponse(autoResponse({
      selected_model: { id: "gpt-6-luna", supported_endpoints: ["/responses"], capabilities: { input: ["text"] } },
    }))],
  ])
  const router = new FusionRouter({ fetchImpl })
  const textOnly = await router.route(BASE_REQ)
  assert.equal(textOnly.ok, true)
  // cached pin: text-only pick lacks vision; image prompt must trigger a fresh route
  const withImage = await router.route({ ...BASE_REQ, image: true })
  assert.equal(withImage.ok, false, "fresh non-vision pick must be refused for an image prompt")
  assert.match(withImage.reason, /vision/)
  assert.equal(calls.length, 2)
})

test("image prompt with unknown vision support reuses the pinned route", async () => {
  const { calls, fetchImpl } = mockFetch([
    ["/auto", () => jsonResponse(autoResponse({
      selected_model: { id: "gpt-6-luna", supported_endpoints: ["/responses"] },
    }))],
  ])
  const router = new FusionRouter({ fetchImpl })
  assert.equal((await router.route(BASE_REQ)).ok, true)
  assert.equal((await router.route({ ...BASE_REQ, image: true })).ok, true)
  assert.equal(calls.length, 1, "unknown vision keeps the pin")
})

test("invalidateSession drops routes for the session and respects credential scope", async () => {
  const { calls, fetchImpl } = mockFetch([["/auto", () => jsonResponse(autoResponse())]])
  const router = new FusionRouter({ fetchImpl })
  await router.route(BASE_REQ)
  await router.route({ ...BASE_REQ, sessionID: "ses_other" })
  router.invalidateSession("ses_test1", CK)
  await router.route(BASE_REQ) // must re-route
  await router.route({ ...BASE_REQ, sessionID: "ses_other" }) // still pinned
  assert.equal(calls.length, 3)
})

test("invalidateSession without credential sweeps every matching session", async () => {
  const { calls, fetchImpl } = mockFetch([["/auto", () => jsonResponse(autoResponse())]])
  const router = new FusionRouter({ fetchImpl })
  await router.route(BASE_REQ)
  await router.route({ ...BASE_REQ, token: "gho_other", credsKey: credsKey("gho_other", BASE_REQ.baseURL) })
  router.invalidateSession("ses_test1", "")
  await router.route(BASE_REQ)
  assert.equal(calls.length, 3)
})

test("/meta parsing is exposed via getMeta and cached per host", async () => {
  const { calls, fetchImpl } = mockFetch([
    ["/meta", () => jsonResponse({ auto: { tiers: [{ id: "hydrafusion", type: "fusion", status: { enabled: true } }] } })],
  ])
  const router = new FusionRouter({ fetchImpl })
  const meta = await router.getMeta(BASE_REQ.baseURL, BASE_REQ.token)
  assert.equal(meta.fusionOffered, true)
  await router.getMeta(BASE_REQ.baseURL, BASE_REQ.token)
  assert.equal(calls.filter((c) => c.url.includes("/meta")).length, 1)
})

test("meta cache is keyed by host", async () => {
  const { calls, fetchImpl } = mockFetch([
    ["/meta", ({ url }) => jsonResponse({ auto: { tiers: [{ id: "hydrafusion", type: "fusion", status: { enabled: url.includes("business") } }] } })],
  ])
  const router = new FusionRouter({ fetchImpl })
  const a = await router.getMeta("https://api.business.githubcopilot.com", "t")
  const b = await router.getMeta("https://api.githubcopilot.com", "t")
  assert.notEqual(a.fusionOffered === b.fusionOffered, true)
  assert.equal(calls.filter((c) => c.url.includes("/meta")).length, 2)
})
