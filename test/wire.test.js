import test from "node:test"
import assert from "node:assert/strict"
import { wireOfAnchor } from "../dist/wire.js"

test("anthropic-packaged anchor routes over /v1/messages", () => {
  assert.equal(wireOfAnchor({ package: "@opencode/ai/providers/anthropic", modelID: "claude-opus-5.5" }), "messages")
  assert.equal(wireOfAnchor({ package: "@ai-sdk/anthropic", modelID: "claude-sonnet-5.5" }), "messages")
})

test("explicit endpoint settings are honoured", () => {
  assert.equal(wireOfAnchor({ package: "aisdk:@ai-sdk/github-copilot", settings: { endpoint: "responses" } }), "responses")
  assert.equal(wireOfAnchor({ package: "aisdk:@ai-sdk/github-copilot", settings: { endpoint: "chat" } }), "chat")
  assert.equal(wireOfAnchor({ package: "aisdk:@ai-sdk/github-copilot", settings: { endpoint: "messages" } }), "messages")
})

test("heuristic: modern gpt -> responses, gpt-5-mini -> chat", () => {
  assert.equal(wireOfAnchor({ modelID: "gpt-6-luna" }), "responses")
  assert.equal(wireOfAnchor({ modelID: "gpt-5.4" }), "responses")
  assert.equal(wireOfAnchor({ modelID: "gpt-5-mini" }), "chat")
  assert.equal(wireOfAnchor({ modelID: "mai-code-1.1-flash" }), "responses")
  assert.equal(wireOfAnchor({ modelID: "grok-4" }), "responses")
})

test("unknown model goes to chat", () => {
  assert.equal(wireOfAnchor({ modelID: "claude-opus-5.5" }), "chat")
  assert.equal(wireOfAnchor({}), "chat")
})
