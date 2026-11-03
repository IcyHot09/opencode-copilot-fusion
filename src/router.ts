/**
 * Client for Copilot's `/auto` routing endpoint (Auto V2) plus `/meta`
 * discovery — the same calls first-party clients make for Auto/Fusion.
 *
 * `POST {baseURL}/auto` with `{ prompt, has_image?, tier, multi_turn? }`
 * returns `{ session_token, expires_at (unix seconds, 24h, no refresh flow),
 * selected_model }`. The inference request then carries
 * `Copilot-Session-Token`; billing (including the 30% Fusion promo, through
 * 2026-11-30 on paid plans) is applied server-side — clients never send a
 * discount flag. 404 means the account/plan is gated off; 503 is transient.
 * The endpoint is undocumented and private; tolerate anything.
 */
import { createHash } from "node:crypto"
import { LruMap } from "./cache.js"
import { COPILOT_API_VERSION, parseFusionMeta, type FusionMetaTiers } from "./tiers.js"
import type { FetchLike } from "./creds.js"

export type Wire = "responses" | "chat" | "messages"

export interface RouteEntry {
  readonly modelId: string
  readonly sessionToken: string
  readonly expiresAtMs: number
  /** vision support of the picked model: null = unknown, true/false otherwise */
  readonly vision: boolean | null
  turns: number
}

export interface RouteRequest {
  readonly baseURL: string
  readonly token: string
  readonly sessionID: string
  readonly variant: string
  readonly wire: Wire
  readonly tier: string
  readonly text: string
  readonly image: boolean
  /** "conversation" (default, sticky) or "prompt" (route per prompt) */
  readonly route: "conversation" | "prompt"
}

export type RouteResult =
  | { readonly ok: true; readonly entry: RouteEntry }
  | { readonly ok: false; readonly reason: string }

const FIVE_MINUTES_MS = 5 * 60_000
const ONE_HOUR_MS = 60 * 60_000
const META_TTL_MS = 60_000

function hashPrompt(text: string): string {
  try {
    return createHash("sha256").update(text).digest("hex")
  } catch {
    // Fallback (non-cryptographic) — only used to key a local cache.
    let hash = 0x811c9dc5
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i)
      hash = Math.imul(hash, 0x01000193)
    }
    return (hash >>> 0).toString(16)
  }
}

export function wirePath(wire: Wire): string {
  switch (wire) {
    case "responses":
      return "/responses"
    case "chat":
      return "/chat/completions"
    case "messages":
      return "/v1/messages"
  }
}

function endpointsInclude(endpoints: unknown, wire: Wire): boolean | null {
  if (!Array.isArray(endpoints)) return null
  const list = endpoints.filter((e): e is string => typeof e === "string")
  if (list.length === 0) return null
  const path = wirePath(wire)
  if (list.includes(path)) return true
  if (wire === "messages" && list.some((e) => e.endsWith("/messages"))) return true
  return false
}

export class FusionRouter {
  private readonly cache = new LruMap<string, RouteEntry>(256)
  private metaCache: { value: FusionMetaTiers | undefined; at: number } | undefined
  private catalogCache: { value: Map<string, string[] | null>; at: number } | undefined

  constructor(
    private readonly options: {
      readonly fetchImpl?: FetchLike
      readonly timeoutMs?: number
      readonly skewMs?: number
      readonly now?: () => number
      readonly log?: (...args: string[]) => void
    } = {},
  ) {}

  private get fetchImpl(): FetchLike {
    return this.options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init))
  }

  private get now(): number {
    return this.options.now?.() ?? Date.now()
  }

  private get timeoutMs(): number {
    return this.options.timeoutMs ?? 5_000
  }

  private get skewMs(): number {
    return this.options.skewMs ?? FIVE_MINUTES_MS
  }

  private log(...args: string[]): void {
    this.options.log?.(...args)
  }

  private static key(sessionID: string, variant: string, route: "conversation" | "prompt", text: string): string {
    return route === "prompt"
      ? `${sessionID} ${variant} ${hashPrompt(text)}`
      : `${sessionID} ${variant}`
  }

  /** Drop every cached route for a session (used after compaction). */
  invalidateSession(sessionID: string): void {
    const prefix = `${sessionID} `
    for (const key of [...this.cache.keys()]) {
      if (key.startsWith(prefix)) this.cache.delete(key)
    }
  }

  /** Seconds until expiry, or <= 0 if missing/expired. */
  private static isFresh(entry: RouteEntry, now: number, skewMs: number): boolean {
    return entry.expiresAtMs - now > skewMs
  }

  /**
   * Route a prompt. Non-throwing: failures are reported as
   * `{ ok: false, reason }` so callers can degrade to the anchor model.
   */
  async route(request: RouteRequest): Promise<RouteResult> {
    const { baseURL, token, sessionID, variant, tier, text, image, route } = request
    const key = FusionRouter.key(sessionID, variant, route, text)
    const cached = this.cache.get(key)
    if (cached && FusionRouter.isFresh(cached, this.now, this.skewMs)) {
      if (!image || cached.vision !== false) {
        cached.turns += 1
        return { ok: true, entry: cached }
      }
      this.log(`fusion: re-routing ${key} - image prompt vs pinned model without vision support`)
      this.cache.delete(key)
    }

    const previousTurns = cached?.turns ?? 0
    const payload: Record<string, unknown> = {
      prompt: text.trim() === "" ? "Continue." : text,
      tier,
      multi_turn: { routing_intent: "anchor", turns_since_anchor: previousTurns },
    }
    if (image) payload.has_image = true

    let response: Response
    try {
      response = await this.fetchImpl(`${baseURL}/auto`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "X-GitHub-Api-Version": COPILOT_API_VERSION,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (error) {
      return this.previousOrFail(key, cached, `request failed: ${describeError(error)}`)
    }
    if (!response.ok) {
      const detail = await safeText(response)
      return this.previousOrFail(
        key,
        cached,
        `HTTP ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`,
      )
    }

    let data: unknown
    try {
      data = await response.json()
    } catch {
      return this.previousOrFail(key, cached, "response was not JSON")
    }

    const parsed = parseAutoResponse(data)
    if (!parsed) return this.previousOrFail(key, cached, "response missing session_token or selected_model.id")

    // Cross-wire guard: if Fusion picked a model that cannot serve the
    // anchor's wire, don't send the request into a 400 — fall back to anchor.
    const allowed = await this.supportsWire(baseURL, token, parsed.modelId, request.wire, parsed.endpoints)
    if (allowed === false) {
      return this.previousOrFail(
        key,
        cached,
        `selected model ${parsed.modelId} does not serve ${wirePath(request.wire)}`,
      )
    }

    const entry: RouteEntry = {
      modelId: parsed.modelId,
      sessionToken: parsed.sessionToken,
      expiresAtMs: parsed.expiresAtMs,
      vision: parsed.vision,
      turns: previousTurns + 1,
    }
    this.cache.set(key, entry)
    return { ok: true, entry }
  }

  /** Reuse the previous route while it is still valid; otherwise fail. */
  private previousOrFail(key: string, cached: RouteEntry | undefined, reason: string): RouteResult {
    if (cached && FusionRouter.isFresh(cached, this.now, this.skewMs)) {
      this.log(`fusion: /auto unavailable (${reason}); reusing previous route to ${cached.modelId}`)
      return { ok: true, entry: cached }
    }
    this.log(`fusion: route unavailable (${reason})`)
    return { ok: false, reason }
  }

  /** true / false / null when unknown */
  private async supportsWire(
    baseURL: string,
    token: string,
    modelId: string,
    wire: Wire,
    endpointsFromAuto: unknown,
  ): Promise<boolean | null> {
    const direct = endpointsInclude(endpointsFromAuto, wire)
    if (direct !== null) return direct
    const catalog = await this.getCatalog(baseURL, token)
    return endpointsInclude(catalog.get(modelId) ?? null, wire)
  }

  /** GET /meta (cached briefly). Undefined on any failure — never throws. */
  async getMeta(baseURL: string, token: string): Promise<FusionMetaTiers | undefined> {
    if (this.metaCache && this.now - this.metaCache.at < META_TTL_MS) return this.metaCache.value
    const value = await this.safeJson(`${baseURL}/meta`, token).then(parseFusionMeta)
    this.metaCache = { value, at: this.now }
    return value
  }

  /** GET /models (cached an hour). Empty map on any failure — never throws. */
  private async getCatalog(baseURL: string, token: string): Promise<Map<string, string[] | null>> {
    if (this.catalogCache && this.now - this.catalogCache.at < ONE_HOUR_MS) return this.catalogCache.value
    const value = new Map<string, string[] | null>()
    const payload = await this.safeJson(`${baseURL}/models`, token)
    const data = (payload as { data?: unknown } | undefined)?.data
    if (Array.isArray(data)) {
      for (const raw of data) {
        if (typeof raw !== "object" || raw === null) continue
        const item = raw as { id?: unknown; supported_endpoints?: unknown }
        if (typeof item.id !== "string") continue
        const endpoints = Array.isArray(item.supported_endpoints)
          ? item.supported_endpoints.filter((e): e is string => typeof e === "string")
          : null
        value.set(item.id, endpoints)
      }
    }
    this.catalogCache = { value, at: this.now }
    return value
  }

  private async safeJson(url: string, token: string): Promise<unknown> {
    try {
      const response = await this.fetchImpl(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": COPILOT_API_VERSION,
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      })
      if (!response.ok) return undefined
      return await response.json()
    } catch {
      return undefined
    }
  }
}

interface ParsedAuto {
  readonly modelId: string
  readonly sessionToken: string
  readonly expiresAtMs: number
  readonly endpoints: unknown
  readonly vision: boolean | null
}

function parseAutoResponse(data: unknown): ParsedAuto | undefined {
  if (typeof data !== "object" || data === null) return undefined
  const record = data as Record<string, unknown>
  const sessionToken = typeof record.session_token === "string" ? record.session_token : undefined
  const selected = (record.selected_model ?? {}) as Record<string, unknown>
  const modelId = typeof selected.id === "string" ? selected.id : undefined
  if (!sessionToken || !modelId) return undefined
  // expires_at is unix seconds; fall back to 24h from now like the client does.
  const expiresSec = typeof record.expires_at === "number" && Number.isFinite(record.expires_at)
    ? record.expires_at
    : Math.floor(Date.now() / 1000) + 24 * 3600
  const input = (selected.capabilities as { input?: unknown } | undefined)?.input
  const vision = Array.isArray(input)
    ? input.some((part) => part === "image") || input.includes("image_url")
    : null
  return {
    modelId,
    sessionToken,
    expiresAtMs: expiresSec * 1000,
    endpoints: selected.supported_endpoints,
    vision,
  }
}

async function safeText(response: Response): Promise<string | undefined> {
  try {
    return await response.text()
  } catch {
    return undefined
  }
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
