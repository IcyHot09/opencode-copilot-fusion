import test from "node:test"
import assert from "node:assert/strict"
import { LruMap } from "../dist/cache.js"

test("get promotes the entry; eviction removes the coldest, not the oldest", () => {
  const map = new LruMap(2)
  map.set("a", 1)
  map.set("b", 2)
  map.set("c", 3) // evicts a
  assert.equal(map.has("a"), false)
  map.set("a", 10) // re-add a
  map.set("b", 20) // touch b -> promote
  map.get("b")
  map.set("d", 4) // evicts c (coldest), not b
  assert.equal(map.has("b"), true)
  assert.equal(map.has("c"), false)
  assert.equal(map.has("d"), true)
})

test("set over an existing key re-inserts at the tail", () => {
  const map = new LruMap(2)
  map.set("a", 1)
  map.set("b", 2)
  map.set("a", 11) // re-insert a; a is now hottest
  map.set("c", 3) // must evict b, not a
  assert.equal(map.has("a"), true)
  assert.equal(map.get("a"), 11)
  assert.equal(map.has("b"), false)
})

test("max size is honoured", () => {
  const map = new LruMap(3)
  for (let i = 0; i < 10; i++) map.set(`k${i}`, i)
  assert.equal(map.size, 3)
})
