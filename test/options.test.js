import test from "node:test"
import assert from "node:assert/strict"
import { parseFusionOptions, DEFAULT_FUSION_OPTIONS } from "../dist/options.js"

test("defaults and tolerance for garbage", () => {
  assert.deepEqual(parseFusionOptions(undefined), DEFAULT_FUSION_OPTIONS)
  assert.deepEqual(parseFusionOptions("junk"), DEFAULT_FUSION_OPTIONS)
  assert.deepEqual(parseFusionOptions(null), DEFAULT_FUSION_OPTIONS)
})

test("custom options parsed", () => {
  const custom = parseFusionOptions({
    anchorModel: "mai-code-1.1-flash",
    route: "prompt",
    stripTemperature: false,
    timeoutMs: 9000,
    skewMs: 60000,
    debug: true,
  })
  assert.equal(custom.anchorModel, "mai-code-1.1-flash")
  assert.equal(custom.route, "prompt")
  assert.equal(custom.stripTemperature, false)
  assert.equal(custom.timeoutMs, 9000)
  assert.equal(custom.skewMs, 60000)
  assert.equal(custom.debug, true)
})

test("out-of-range values fall back", () => {
  assert.equal(parseFusionOptions({ timeoutMs: 999999 }).timeoutMs, DEFAULT_FUSION_OPTIONS.timeoutMs)
  assert.equal(parseFusionOptions({ route: "everywhere" }).route, "conversation")
  assert.equal(parseFusionOptions({ skewMs: -1 }).skewMs, DEFAULT_FUSION_OPTIONS.skewMs)
})
