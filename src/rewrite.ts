/**
 * Rewrite an outgoing inference request after /auto routing.
 *
 * Opencode builds the request from the anchor model (fusion's `modelID` is
 * the anchor's wire id), which means the *unmodified* request is always a
 * valid call to the anchor — our fallback path simply leaves it alone.
 * When Fusion routes, we swap `model` to the picked id and attach
 * `Copilot-Session-Token` (this is what bills Fusion, with the paid-plan
 * 30% discount through 2026-11-30).
 */

export interface RewriteOptions {
  /** model id chosen by /auto */
  readonly modelId: string
  /** Copilot session token from /auto */
  readonly sessionToken: string
  /** drop `temperature` (routed models 400 on it) — default true */
  readonly stripTemperature?: boolean
}

export type RewriteResult =
  | { readonly ok: true; readonly request: Request; readonly modelId: string }
  | { readonly ok: false; readonly reason: string }

/** Reads + swaps the JSON body. Returns the rewritten Request. */
export async function rewriteRequest(original: Request, options: RewriteOptions): Promise<RewriteResult> {
  let body: unknown
  try {
    body = await original.clone().json()
  } catch {
    return { ok: false, reason: "request body was not JSON" }
  }
  if (typeof body !== "object" || body === null) {
    return { ok: false, reason: "request body was not a JSON object" }
  }
  const next: Record<string, unknown> = { ...(body as Record<string, unknown>), model: options.modelId }
  if (options.stripTemperature !== false) delete next.temperature

  const headers = new Headers(original.headers)
  headers.delete("content-length")
  headers.set("Copilot-Session-Token", options.sessionToken)

  return {
    ok: true,
    modelId: options.modelId,
    request: new Request(original.url, {
      method: original.method,
      headers,
      body: JSON.stringify(next),
      signal: original.signal,
    }),
  }
}
