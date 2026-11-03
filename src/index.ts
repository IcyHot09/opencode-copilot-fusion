/**
 * opencode-copilot-fusion
 *
 * Registers a `github-copilot/fusion` model that reproduces GitHub Copilot
 * Fusion behaviour as seen in first-party clients (VS Code, Copilot CLI):
 *
 *   1. The request hits Copilot's router first:  POST {baseURL}/auto
 *      with the last user prompt, `has_image`, and the Fusion tier —
 *      Standard -> `balance`, High -> `hydrafusion` (falls back to classic
 *      Auto `intelligence`), Max -> `hydrafusion-max`.
 *   2. /auto replies with a one-off model pick and a 24h `session_token`.
 *      The inference request is rewritten to the picked model and sent with
 *      `Copilot-Session-Token` — this is what bills Fusion, including the
 *      30% launch discount on paid plans (through 2026-11-30), applied
 *      server-side.
 *   3. Routing is sticky per conversation ("route like the CLI"): the first
 *      primary turn anchors the model; re-route happens on compaction,
 *      token nearing expiry (5 min skew), a variant switch, or an image
 *      prompt when the pinned pick has no vision support.
 *
 * Auth reuses opencode's stored GitHub Copilot credential — no extra token.
 * The unmodified request is always a valid call to the anchor model, so any
 * failure path simply degrades to the anchor instead of breaking the turn.
 */
import { Model, Plugin } from "@opencode/plugin"
import { resolveCopilotCredentials, type CopilotCredentials } from "./creds.js"
import { FusionRouter, type Wire } from "./router.js"
import { extractPromptFromBody } from "./prompt.js"
import { FUSION_TIERS, normalizeVariant, resolveWireTier, type TierAvailability } from "./tiers.js"
import { wireOfAnchor } from "./wire.js"
import { rewriteRequest } from "./rewrite.js"
import { parseFusionOptions, type FusionOptions } from "./options.js"

const PROVIDER_ID = "github-copilot"
const MODEL_ID = "fusion"
const PREFERRED_ANCHORS = ["gpt-6-luna", "gpt-6.1-sol", "gpt-6-terra", "gpt-6-astra", "gpt-6-sol", "gpt-5.4", "gpt-5.3-codex"]

export default Plugin.define({
  id: "opencode-copilot-fusion",
  async setup(ctx) {
    const options = parseFusionOptions(ctx.options)
    const debug = (...args: unknown[]) => {
      if (options.debug) console.error("[copilot-fusion]", ...args)
    }
    const warn = (...args: unknown[]) => console.error("[copilot-fusion] warn:", ...args)

    const router = new FusionRouter({ timeoutMs: options.timeoutMs, skewMs: options.skewMs, log: debug })
    const state: {
      anchorWire?: Wire
      anchorModelId?: string
      metaById?: TierAvailability["byId"]
      creds?: { value: CopilotCredentials | undefined; at: number }
      warnedMissingCreds?: boolean
    } = {}

    const getCreds = async (): Promise<CopilotCredentials | undefined> => {
      const cached = state.creds
      if (cached && Date.now() - cached.at < 30_000) return cached.value
      const value = await resolveCopilotCredentials(ctx.integration)
      state.creds = { value, at: Date.now() }
      return value
    }

    /** Lazy /meta resolution (setup-time fetch may not have run yet). */
    const getMetaById = async (): Promise<TierAvailability["byId"]> => {
      if (state.metaById) return state.metaById
      const creds = await getCreds()
      if (!creds) return undefined
      const meta = await router.getMeta(creds.baseURL, creds.token)
      state.metaById = meta?.byId
      return state.metaById
    }

    // ---- 1) Discover fusion tier availability (never fatal) ----
    const credsAtSetup = await getCreds()
    if (credsAtSetup) {
      const meta = await router.getMeta(credsAtSetup.baseURL, credsAtSetup.token)
      state.metaById = meta?.byId
      if (meta && !meta.fusionOffered) {
        warn(
          "no enabled Fusion (type:fusion) tiers reported by /meta — this account/org " +
            "may not have Copilot Fusion enabled (check your plan and org policy). " +
            "Standard will route via classic Auto if hydrafusion is unavailable.",
        )
      }
    } else {
      debug("github-copilot is not connected yet; connect it (/connect) to enable Fusion routing")
    }

    // Which variants to expose — mirrors the CLI's managed fusionTier mapping:
    // high falls back to classic Auto `intelligence`; max has no fallback.
    const metaById = state.metaById
    const hasFusionTier = (id: string) => metaById?.[id] === true
    const hasClassic = (id: string) => metaById?.[id] === true
    const fusionUnknown = !metaById
    const variantSpecs = FUSION_TIERS.filter((spec) => {
      if (spec.variant === "standard") return true
      if (spec.variant === "max") return fusionUnknown || hasFusionTier("hydrafusion-max")
      // high
      if (fusionUnknown) return true
      if (hasFusionTier("hydrafusion")) return true
      if (!hasFusionTier("hydrafusion") && hasClassic("intelligence")) {
        warn("Fusion High (hydrafusion) not offered on this account — variant 'high' will route via classic Auto tier 'intelligence' (no Fusion discount).")
        return true
      }
      return false
    })
    const effortSetting = (effort: "low" | "high" | "xhigh") => ({
      reasoningEffort: effort,
      reasoningSummary: "auto",
      include: ["reasoning.encrypted_content"],
    })

    // ---- 2) Register github-copilot/fusion (inherits anchor metadata) ----
    await ctx.model.transform((editor) => {
      const provider = PROVIDER_ID
      // Resolve anchor: explicit option, then preferred GPT anchors, then any enabled GPT, then anything.
      let anchor = options.anchorModel ? editor.get(provider, options.anchorModel) : undefined
      if (options.anchorModel && !anchor) {
        warn(`anchorModel '${options.anchorModel}' not found/enabled in provider '${provider}' — falling back to defaults`)
      }
      if (!anchor) {
        for (const candidate of PREFERRED_ANCHORS) {
          const found = editor.get(provider, candidate)
          if (found && found.enabled !== false) {
            anchor = found
            break
          }
        }
      }
      if (!anchor) {
        const list = editor.list(provider).filter((model) => model.enabled !== false)
        anchor = list.find((model) => /^gpt-/.test(model.id)) ?? list[0]
      }
      if (!anchor) {
        warn("no enabled models found in provider 'github-copilot' — is Copilot connected? skipping fusion registration")
        return
      }
      state.anchorWire = wireOfAnchor(anchor)
      state.anchorModelId = anchor.modelID
      debug(`fusion anchor: ${anchor.id} (modelID=${anchor.modelID}, package=${anchor.package}, wire=${state.anchorWire})`)

      editor.update(provider, MODEL_ID, (model) => {
        const cloned = structuredClone(anchor)
        Object.assign(model, cloned, {
          id: MODEL_ID,
          providerID: provider,
          modelID: anchor.modelID, // unmodified requests stay valid anchor calls
          name: "Copilot Fusion",
          family: "github-copilot-fusion",
          enabled: true,
          variants: variantSpecs.map((spec) => ({
            id: Model.VariantID.make(spec.variant),
            settings: effortSetting(spec.effort),
          })),
        })
      })
    })

    // ---- 3) Drop cached routes after compaction (CLI re-anchors too) ----
    await ctx.session.hook(
      "compaction",
      (event) => {
        router.invalidateSession(event.sessionID)
        debug(`compaction: invalidated fusion routes for session ${event.sessionID}`)
      },
      { providerID: PROVIDER_ID },
    )

    // ---- 4) Surface any server headers that reveal fusion orchestration (debug only) ----
    if (options.debug) {
      await ctx.session.hook(
        "http.response",
        (event) => {
          if (event.model.id !== MODEL_ID || event.model.providerID !== PROVIDER_ID) return
          event.response.headers.forEach((value, name) => {
            if (/copilot|fusion|hydra|^x-github|model/i.test(name)) {
              debug(`fusion response header ${name}: ${value}`)
            }
          })
        },
        { providerID: PROVIDER_ID },
      )
    }

    // ---- 5) Route + rewrite on the wire ----
    await ctx.session.hook(
      "http.request",
      async (event) => {
        if (event.model.id !== MODEL_ID || event.model.providerID !== PROVIDER_ID) return
        // Utility calls (titles) stay deterministic and cheap.
        if (event.kind === "title") return

        const creds = await getCreds()
        if (!creds) {
          if (!state.warnedMissingCreds) {
            warn("github-copilot is not connected — routing disabled (requests will use the anchor model). Connect it and restart.")
            state.warnedMissingCreds = true
          }
          return
        }

        const cloned = await event.request.clone().json().catch(() => undefined)
        if (typeof cloned !== "object" || cloned === null) {
          debug("fusion: request body was not JSON — leaving request unchanged")
          return
        }
        const prompt = extractPromptFromBody(cloned)
        if (!prompt) {
          debug("fusion: no user prompt found in request body — leaving request unchanged")
          return
        }
        const variant = normalizeVariant((event.model as { readonly variant?: unknown }).variant)

        const metaByIdLazy = state.metaById ?? (await getMetaById())
        const resolved = resolveWireTier(variant, metaByIdLazy)
        if (!resolved) {
          throw new Error(
            `Copilot Fusion tier '${variant}' is not enabled for this account. ` +
              `Use a different variant (e.g. 'standard') or ask your org admin to enable Fusion.`,
          )
        }

        const result = await router.route({
          baseURL: creds.baseURL,
          token: creds.token,
          sessionID: event.sessionID,
          variant,
          wire: state.anchorWire ?? "chat",
          tier: resolved.wire,
          text: prompt.text,
          image: prompt.image,
          route: options.route,
        })
        if (!result.ok) {
          if (/HTTP (401|403)/.test(result.reason)) state.creds = undefined
          debug(`fusion: falling back to anchor (${result.reason})`)
          return // unmodified request = valid anchor call
        }
        const entry = result.entry
        const rewritten = await rewriteRequest(event.request, {
          modelId: entry.modelId,
          sessionToken: entry.sessionToken,
          stripTemperature: options.stripTemperature,
        })
        if (!rewritten.ok) {
          debug(`fusion: could not rewrite request (${rewritten.reason}) — falling back to anchor`)
          return
        }
        event.request = rewritten.request
        debug(`fusion: ${variant} -> ${entry.modelId}${resolved.degraded ? " (degraded: classic Auto tier)" : ""}`)
      },
      { providerID: PROVIDER_ID },
    )
  },
})
