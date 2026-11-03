import test from "node:test"
import assert from "node:assert/strict"
import { FusionRouter } from "../dist/router.js"

const CREDENTIALS = { baseURL: "https://api.business.githubcopilot.com", token: "gho_test" }
const BASE_REQ = {
  baseURL: CREDENTIALS.baseURL,
  token: CREDENTIALS.token,
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

test("routes once per conversation (sticky) and bills subsequent turns with the session token", async () => {
  const { calls, fetchImpl } = mockFetch([["/auto", () => jsonResponse(autoResponse())]])
  const router = new FusionRouter({ fetchImpl })

  const first = await router.route(BASE_REQ)
  assert.equal(first.ok, true)
  assert.equal(first.entry.modelId, "gpt-6-luna")
  assert.equal(calls.length, 1)

  const second = await router.route(BASE_REQ)
  assert.equal(second.ok, true)
  assert.equal(calls.length, 1, "second turn reuses the pinned route")

  // /auto body carries the knobs VS Code sends
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

test("/auto failure with no prior route reports ok:false", async () => {
  const { fetchImpl } = mockFetch([["/auto", () => new Response("boom", { status: 503 })]])
  const router = new FusionRouter({ fetchImpl })
  const result = await router.route(BASE_REQ)
  assert.equal(result.ok, false)
  assert.match(result.reason, /HTTP 503/)
})

test("cross-wire pick is rejected (responses wire vs chat-only model)", async () => {
  const { fetchImpl } = mockFetch([
    ["/auto", () => jsonResponse(autoResponse({ selected_model: { id: "claude-opus-5.5", supported_endpoints: ["/v1/messages"] } }))],
  ])
  const router = new FusionRouter({ fetchImpl })
  const result = await router.route(BASE_REQ) // wire: responses
  assert.equal(result.ok, false)
  assert.match(result.reason, /does not serve \/responses/)
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

test("image prompt against a non-vision pinned model forces re-route", async () => {
  const { calls, fetchImpl } = mockFetch([
    ["/auto", () => jsonResponse(autoResponse({
      selected_model: { id: "gpt-6-luna", supported_endpoints: ["/responses"], capabilities: { input: ["text"] } },
    }))],
  ])
  const router = new FusionRouter({ fetchImpl })
  const first = await router.route(BASE_REQ)
  assert.equal(first.ok, true)
  const withImage = await router.route({ ...BASE_REQ, image: true })
  assert.equal(withImage.ok, true)
  assert.equal(calls.length, 2, "non-vision pinned model must not serve an image prompt")
})

test("invalidateSession drops all routes for that session only", async () => {
  const { calls, fetchImpl } = mockFetch([["/auto", () => jsonResponse(autoResponse())]])
  const router = new FusionRouter({ fetchImpl })
  await router.route(BASE_REQ)
  await router.route({ ...BASE_REQ, sessionID: "ses_other" })
  router.invalidateSession("ses_test1")
  await router.route(BASE_REQ) // must re-route
  await router.route({ ...BASE_REQ, sessionID: "ses_other" }) // still pinned
  assert.equal(calls.length, 3)
})

test("/meta parsing is exposed via getMeta and cached", async () => {
  const { calls, fetchImpl } = mockFetch([
    ["/meta", () => jsonResponse({ auto: { tiers: [{ id: "hydrafusion", type: "fusion", status: { enabled: true } }] } })],
  ])
  const router = new FusionRouter({ fetchImpl })
  const meta = await router.getMeta(CREDENTIALS.baseURL, CREDENTIALS.token)
  assert.equal(meta.fusionOffered, true)
  await router.getMeta(CREDENTIALS.baseURL, CREDENTIALS.token)
  assert.equal(calls.filter((c) => c.url.includes("/meta")).length, 1)
})
