/** Tiny insertion-ordered LRU map (no dependencies). */
export class LruMap<K, V> extends Map<K, V> {
  constructor(private readonly maxSize = 256) {
    super()
  }
  override set(key: K, value: V): this {
    if (this.has(key)) this.delete(key)
    super.set(key, value)
    while (this.size > this.maxSize) {
      const oldest = this.keys().next().value
      if (oldest === undefined) break
      this.delete(oldest)
    }
    return this
  }
}
