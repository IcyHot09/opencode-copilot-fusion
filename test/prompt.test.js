import test from "node:test"
import assert from "node:assert/strict"
import { extractPromptFromBody } from "../dist/prompt.js"

test("responses API body: last user text wins", () => {
  const body = {
    model: "gpt-6-luna",
    input: [
      { role: "user", content: [{ type: "input_text", text: "first task" }] },
      { role: "assistant", content: [{ type: "output_text", text: "answer" }] },
      { role: "user", content: [{ type: "input_text", text: "second task" }] },
    ],
  }
  assert.deepEqual(extractPromptFromBody(body), { text: "second task", image: false })
})

test("responses API body with image detection", () => {
  const body = {
    input: [
      { role: "user", content: [{ type: "input_text", text: "what is this?" }, { type: "input_image", image_url: "data:image/png;base64,zzz" }] },
    ],
  }
  assert.deepEqual(extractPromptFromBody(body), { text: "what is this?", image: true })
})

test("responses API with bare string input", () => {
  assert.deepEqual(extractPromptFromBody({ input: "hello" }), { text: "hello", image: false })
})

test("input_image-only user message yields empty text with image=true", () => {
  const body = { input: [{ role: "user", content: [{ type: "input_image", image_url: "data:x" }] }] }
  assert.deepEqual(extractPromptFromBody(body), { text: "", image: true })
})

test("chat completions body: last user text wins", () => {
  const body = {
    model: "gpt-6-luna",
    messages: [
      { role: "user", content: "first" },
      { role: "assistant", content: "ok" },
      { role: "user", content: [{ type: "text", text: "second" }, { type: "image_url", image_url: { url: "data:..." } }] },
    ],
  }
  assert.deepEqual(extractPromptFromBody(body), { text: "second", image: true })
})

test("non-user roles are skipped", () => {
  const body = { messages: [{ role: "system", content: "nope" }] }
  assert.equal(extractPromptFromBody(body), null)
})

test("empty / missing bodies", () => {
  assert.equal(extractPromptFromBody(undefined), null)
  assert.equal(extractPromptFromBody({}), null)
  assert.equal(extractPromptFromBody({ input: [] }), null)
})

test("multi-part text is concatenated", () => {
  const body = { messages: [{ role: "user", content: [{ type: "text", text: "fix" }, { type: "text", text: "the bug" }] }] }
  assert.deepEqual(extractPromptFromBody(body), { text: "fix the bug", image: false })
})

test("nested { text: { value } } parts are tolerated", () => {
  const body = { messages: [{ role: "user", content: [{ type: "text", text: { value: "nested part" } }] }] }
  assert.deepEqual(extractPromptFromBody(body), { text: "nested part", image: false })
})
