import test from "node:test"
import assert from "node:assert/strict"
import { rewriteRequest } from "../dist/rewrite.js"

function makeRequest(body, headers = {}) {
  return new Request("https://api.business.githubcopilot.com/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", "content-length": "999", ...headers },
    body: JSON.stringify(body),
  })
}

test("model swap + session token injection, temperature dropped", async () => {
  const original = makeRequest({ model: "gpt-6-luna", messages: [{ role: "user", content: "hi" }], temperature: 0.7, stream: true })
  const result = await rewriteRequest(original, { modelId: "claude-opus-5.5", sessionToken: "tok-123", stripTemperature: true })
  assert.equal(result.ok, true)
  const body = await result.request.json()
  assert.equal(body.model, "claude-opus-5.5")
  assert.equal(body.temperature, undefined)
  assert.equal(body.stream, true)
  assert.equal(body.messages[0].content, "hi")
  assert.equal(result.request.headers.get("Copilot-Session-Token"), "tok-123")
  assert.equal(result.request.headers.get("content-length"), null)
  assert.equal(result.request.method, "POST")
})

test("temperature kept when stripTemperature is false", async () => {
  const original = makeRequest({ model: "gpt-6-luna", temperature: 0.2 })
  const result = await rewriteRequest(original, { modelId: "x", sessionToken: "t", stripTemperature: false })
  assert.equal((await result.request.json()).temperature, 0.2)
})

test("headers are preserved apart from content-length", async () => {
  const original = makeRequest({ model: "a" }, { "Editor-Version": "vscode/1.98.0", "user-agent": "kept" })
  const result = await rewriteRequest(original, { modelId: "b", sessionToken: "tok" })
  assert.equal(result.request.headers.get("user-agent"), "kept")
  assert.equal(result.request.headers.get("Editor-Version"), "vscode/1.98.0")
})

test("non-JSON body fails cleanly", async () => {
  const original = new Request("https://api.githubcopilot.com/chat/completions", { method: "POST", body: "not-json" })
  const result = await rewriteRequest(original, { modelId: "x", sessionToken: "t" })
  assert.equal(result.ok, false)
})
