import test from "node:test"
import assert from "node:assert/strict"
import { wireOfAnchor } from "../dist/wire.js"
import { parseFusionOptions, DEFAULT_FUSION_OPTIONS } from "../dist/options.js"

test("anthropic-packaged anchor routes over /v1/messages", () => {
  assert.equal(wireOfAnchor({ package: "@opencode/ai/providers/anthropic", modelID: "claude-opus-5.5" }), "messages")
})

test("explicit endpoint settings are honoured", () => {
  assert.equal(wireOfAnchor({ package: "aisdk:@ai-sdk/github-copilot", settings: { endpoint: "responses" } }), "responses")
  assert.equal(wireOfAnchor({ package: "aisdk:@ai-sdk/github-copilot", settings: { endpoint: "chat" } }), "chat")
})

test("upstream heuristic: modern gpt -> responses, gpt-5-mini -> chat", () => {
  assert.equal(wireOfAnchor({ modelID: "gpt-6-luna" }), "responses")
  assert.equal(wireOfAnchor({ modelID: "gpt-5.4" }), "responses")
  assert.equal(wireOfAnchor({ modelID: "gpt-5-mini" }), "chat")
  assert.equal(wireOfAnchor({ modelID: "mai-code-1.1-flash" }), "responses")
  assert.equal(wireOfAnchor({ modelID: "grok-4" }), "responses")
  assert.equal(wireOfAnchor({ modelID: "claude-opus-5.5" }), "chat")
})

test("options parse with defaults and tolerance", () => {
  assert.deepEqual(parseFusionOptions(undefined), DEFAULT_FUSION_OPTIONS)
  assert.deepEqual(parseFusionOptions("junk"), DEFAULT_FUSION_OPTIONS)
  const custom = parseFusionOptions({ anchorModel: "mai-code-1.1-flash", route: "prompt", stripTemperature: false, timeoutMs: 9000, skewMs: 60000, debug: true })
  assert.equal(custom.anchorModel, "mai-code-1.1-flash")
  assert.equal(custom.route, "prompt")
  assert.equal(custom.stripTemperature, false)
  assert.equal(custom.timeoutMs, 9000)
  assert.equal(custom.skewMs, 60000)
  assert.equal(custom.debug, true)
  // out-of-range values fall back
  assert.equal(parseFusionOptions({ timeoutMs: 999999 }).timeoutMs, DEFAULT_FUSION_OPTIONS.timeoutMs)
  assert.equal(parseFusionOptions({ route: "everywhere" }).route, "conversation")
})
