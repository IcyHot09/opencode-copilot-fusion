import test from "node:test"
import assert from "node:assert/strict"
import {
  resolveWireTier,
  parseFusionMeta,
  normalizeVariant,
  FUSION_TIERS,
} from "../dist/tiers.js"

test("normalizeVariant defaults to standard and is strict", () => {
  assert.equal(normalizeVariant("high"), "high")
  assert.equal(normalizeVariant("max"), "max")
  assert.equal(normalizeVariant("standard"), "standard")
  assert.equal(normalizeVariant("xhigh"), "standard") // not a fusion variant
  assert.equal(normalizeVariant(undefined), "standard")
  assert.equal(normalizeVariant(42), "standard")
})

test("unknown meta passes canonical wire tiers through", () => {
  assert.deepEqual(resolveWireTier("standard", undefined), { wire: "balance", degraded: false })
  assert.deepEqual(resolveWireTier("high", undefined), { wire: "hydrafusion", degraded: false })
  assert.deepEqual(resolveWireTier("max", undefined), { wire: "hydrafusion-max", degraded: false })
})

test("enabled fusion tiers are used as-is", () => {
  const byId = { balance: true, hydrafusion: true, "hydrafusion-max": true, intelligence: true }
  assert.equal(resolveWireTier("high", byId)?.wire, "hydrafusion")
  assert.equal(resolveWireTier("max", byId)?.wire, "hydrafusion-max")
})

test("high degrades to intelligence when hydrafusion is unavailable (managed fusionTier mapping)", () => {
  const byId = { balance: true, hydrafusion: false, intelligence: true, efficiency: true }
  assert.deepEqual(resolveWireTier("high", byId), { wire: "intelligence", degraded: true })
})

test("high is unavailable when neither hydrafusion nor intelligence is offered", () => {
  const byId = { hydrafusion: false, intelligence: false }
  assert.equal(resolveWireTier("high", byId), null)
})

test("max has no fallback — unknown-disabled means unavailable", () => {
  assert.equal(resolveWireTier("max", { "hydrafusion-max": false }), null)
  const byId = { "hydrafusion-max": false }
  assert.equal(resolveWireTier("max", byId), null)
})

test("tiers absent from meta still route (server is the judge)", () => {
  assert.equal(resolveWireTier("max", { balance: true })?.wire, "hydrafusion-max")
  assert.equal(resolveWireTier("high", {})?.wire, "hydrafusion")
})

test("parseFusionMeta reads enabled flags and fusion presence", () => {
  const meta = parseFusionMeta({
    models: { data: [] },
    auto: {
      default_tier: "balance",
      tiers: [
        { id: "balance", type: "auto", status: { enabled: true } },
        { id: "intelligence", type: "auto", status: { enabled: true } },
        { id: "hydrafusion", type: "fusion", status: { enabled: true } },
        { id: "hydrafusion-max", type: "fusion", status: { enabled: false, message: "Not eligible" } },
      ],
    },
  })
  assert.ok(meta)
  assert.equal(meta.byId["hydrafusion"], true)
  assert.equal(meta.byId["hydrafusion-max"], false)
  assert.equal(meta.fusionOffered, true)

  const noFusion = parseFusionMeta({ auto: { tiers: [{ id: "intelligence", type: "auto", status: { enabled: true } }] } })
  assert.equal(noFusion?.fusionOffered, false)

  assert.equal(parseFusionMeta(garbageSafe()), undefined)
  assert.equal(parseFusionMeta({ auto: {} }), undefined)
})

function garbageSafe() {
  return "<html>500</html>"
}

test("tier spec effort mapping matches the plan", () => {
  const byVariant = Object.fromEntries(FUSION_TIERS.map((t) => [t.variant, t]))
  assert.equal(byVariant.standard.wire, "balance")
  assert.equal(byVariant.high.wire, "hydrafusion")
  assert.equal(byVariant.high.fallbackWire, "intelligence")
  assert.equal(byVariant.max.wire, "hydrafusion-max")
  assert.equal(byVariant.max.fallbackWire, undefined)
})
