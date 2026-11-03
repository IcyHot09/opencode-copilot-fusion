/**
 * Derive an anchor model's wire (request format) from its package /
 * `settings.endpoint`, mirroring how the built-in Copilot provider exposes it.
 * Pure — the heuristic is the same one upstream opencode uses for Copilot
 * models (gpt >= 5 and not gpt-5-mini, mai-*, grok-* -> responses).
 */
import type { Wire } from "./router.js"

export function wireOfAnchor(anchor: { package?: string; settings?: Record<string, unknown>; modelID?: string }): Wire {
  const pkg = typeof anchor.package === "string" ? anchor.package : ""
  if (pkg.includes("providers/anthropic") || pkg.includes("@ai-sdk/anthropic")) return "messages"
  const endpoint = anchor.settings?.endpoint
  if (endpoint === "responses" || endpoint === "chat" || endpoint === "messages") {
    return endpoint === "messages" ? "messages" : endpoint
  }
  const id = typeof anchor.modelID === "string" ? anchor.modelID : ""
  if (/^(mai-|grok-)/.test(id)) return "responses"
  const gpt = /^gpt-(\d+)/.exec(id)
  if (gpt && Number(gpt[1]) >= 5 && !id.startsWith("gpt-5-mini")) return "responses"
  return "chat"
}
