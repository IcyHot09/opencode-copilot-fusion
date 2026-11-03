# opencode-copilot-fusion

Use **GitHub Copilot Fusion** in [opencode](https://opencode.ai) — Fusion's multi-model routing,
anchored per conversation, with the **Fusion tier chosen through opencode's reasoning-effort variants**
(`github-copilot/fusion#standard|high|max`). It reuses the GitHub Copilot credential you already
connected in opencode — no extra tokens, no separate login.

> [!IMPORTANT]
> This is an **unofficial** plugin. It uses Copilot's **undocumented, private** routing endpoints
> (`POST /auto`, `GET /meta`). They can change or break without notice. It is not affiliated with or
> endorsed by GitHub. Use at your own risk, and respect your organization's Copilot policies.

## What you get

| opencode model | Fusion tier | `/auto` wire tier | `reasoningEffort` | Available on |
|---|---|---|---|---|
| `github-copilot/fusion#standard` | Fusion Standard | `balance` | `low` | all plans (Fusion Standard), all paid plans also 30% off |
| `github-copilot/fusion#high` | Fusion High | `hydrafusion` (falls back to classic Auto `intelligence` when HydraFusion isn't offered) | `high` | Pro+ / Max / **Business** / Enterprise |
| `github-copilot/fusion#max` | Fusion Max | `hydrafusion-max` (no fallback) | `xhigh` | Pro+ / Max / **Business** / Enterprise |

Availability is probed from `GET /meta` at startup and per request — tiers your account can't run are
refused with a clear message instead of silently misrouting. Variants that can't work are not
registered at all (or fall back as noted).

## How it works

1. **Routing (like Copilot CLI)**: the first primary turn calls `POST {copilot-host}/auto` with the
   last user prompt and `{- tier, has_image?, multi_turn}`. The reply is a one-off model pick plus a
   24-hour `session_token`. Subsequent turns reuse the pick while the token is fresh (re-routed ~5 min
   before expiry) — your prompt cache stays warm and routing stays cheap.
2. **Sticky re-eval** happens on: compaction, token near-expiry, variant/tier switch, an image prompt
   when the pinned pick has no vision support, or `/auto` failure (reuses the last good route).
3. **Billing**: the inference request goes to the picked model with `Copilot-Session-Token`. You pay
   per underlying model at standard rate; **there is no Fusion surcharge**. Through **2026-11-30**,
   **paid** plans get a **30% discount on model costs for Fusion** — applied server-side; nothing in
   this plugin sends a discount flag. After 2026-11-30, standard rates apply (usage gets ~43% more
   expensive). Confirm the discount in your GitHub Copilot usage dashboard.
4. **Safe fallback**: opencode builds requests against the *anchor* model (`modelID` = the anchor's
   wire id). If `/auto` fails, refuses, or picks a wire the anchor can't carry, the turn proceeds on
   the anchor exactly as if the plugin were absent (a warning is logged). **A broken router never
   breaks your turn.**
5. **No impersonation**: the plugin sends no `Copilot-Integration-Id` / `Editor-*` headers — it rides
   opencode's own Copilot OAuth with the same headers opencode already uses, plus `Copilot-Session-Token`.

## Requirements

- **opencode v2.2.5+** (v2 plugin API; this plugin targets 2.2.5). v1 is not supported.
- **GitHub Copilot connected in opencode**: `opencode auth login` → GitHub Copilot (or `/connect` in the
  TUI). Use the account whose seat has Copilot (e.g. your Copilot Business seat).
- **Plan**: Fusion Standard on all plans; **High/Max require Pro+, Max, Business, or Enterprise**. The
  30% launch discount requires a **paid** plan.
- **Org policy** (Business/Enterprise): an admin can restrict which models are available for Fusion
  (Copilot org/enterprise settings → models available for Copilot Fusion / managed settings
  `fusionTier`). If your org disabled it, `/meta` will report the tiers disabled and the plugin will
  refuse High/Max (or degrade High to classic Auto).

## Install

Add to your `opencode.json` (or `opencode.jsonc`):

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["opencode-copilot-fusion"],          // once published to npm, or:
  // "plugins": ["git+https://github.com/<you>/opencode-copilot-fusion.git#v0.1.0"],
  // "plugins": ["./path/to/opencode-copilot-fusion"],  // local folder (must contain dist/ or be built)
  "model": "github-copilot/fusion",
}
```

From a git checkout: `git clone … && cd opencode-copilot-fusion && npm install && npm run build`, then
point `plugins` at the folder. (`dist/` is built automatically on `npm pack`/install via `prepack`.)

### Options

```jsonc
{
  "plugins": [
    { "package": "opencode-copilot-fusion",
      "options": {
        "anchorModel": "gpt-6-luna",     // wire id your requests are built against; default: best enabled GPT (or any enabled model)
        "route": "conversation",          // "conversation" (sticky, default) | "prompt" (re-route every prompt)
        "stripTemperature": true,         // drop temperature on routed requests (some routed models 400 on it)
        "timeoutMs": 5000,                // /auto timeout
        "skewMs": 300000,                 // re-route within 5 min of session-token expiry
        "debug": false                    // or env FUSION_DEBUG=1
      } }
  ]
}
```

**Anchors and cross-wire picks.** A Fusion turn can be routed to any model your plan allows. If it
picks a model whose wire doesn't match the anchor's (e.g. anchor `gpt-6-luna` → `/responses`, pick
needs `/v1/messages`), the plugin falls back to the anchor for that turn and logs it. To route Fusion
turns over Anthropic's native `/v1/messages` format, set `anchorModel` to a Claude model you actually
have (e.g. `claude-sonnet-5.5`); then Claude picks are served natively and GPT picks fall back.

## Usage

- TUI: model picker → **Copilot Fusion** → variant dialog (**standard / high / max**)
- CLI: `opencode run -m 'github-copilot/fusion#high' "review this diff"`
- Default (no variant): `standard`

`reasoningEffort` is also set on the variant (`low`/`high`/`xhigh`), so the picked upstream model
receives a matching effort — tier selection and reasoning effort move together, as in the first-party
clients.

Titles are **not** routed (deterministic, cheap); compaction invalidates the pinned route so the next
turn re-anchors — both match CLI behaviour.

## Billing notes (read before 2026-11-30 ends)

- Fusion bills the underlying models it uses — High/Max can invoke **more than one model per prompt**
  (cascade/critique), so they can burn credits faster than a plain pick. Business seats share a pooled
  allowance (≈1,900 credits/user/month).
- The 30% discount applies on **paid** plans through **2026-11-30**, needs Fusion usage (any tier), and
  is server-side. Whether GitHub credits it for opencode traffic is confirmed only by your usage
  dashboard — **check after your first sessions**. If you see full price, complain to GitHub, not this
  plugin.
- No client-side discount flag exists. Anyone claiming otherwise is guessing.

## Troubleshooting

- **`/auto` HTTP 404** → your account/org can't use Fusion right now (plan or org policy). Standard may
  still work via Classic Auto; High/Max won't until enabled.
- **Everything answers with the anchor, nothing routed** → run with `FUSION_DEBUG=1` and read the log;
  usually means Copilot isn't connected (`opencode auth login`), `/meta` shows tiers disabled, or the
  anchor catalog sync is failing. Restart opencode after connecting.
- **`tier 'max' is not enabled for this account`** → your seat lacks Fusion Max (needs Pro+/Max/
  Business/Enterprise and org allow-list). Use `standard` or `high`.
- **401/403 from /auto** → Copilot token expired or revoked; `opencode auth login` again (the plugin
  re-resolves the credential automatically on the next request).
- **Routed model 400s** → ensure `stripTemperature: true` (default). If a pick keeps failing, report it
  with `FUSION_DEBUG=1` output.

## Development

```sh
npm install
npm test          # build + unit/integration-ish tests with a mocked /auto + /meta
npm run build     # tsc → dist/
```

No runtime dependencies beyond `@opencode/plugin`. CI runs typecheck, build and tests on every push.

## Credits & license

- Wire protocol observed from the Copilot extension in `microsoft/vscode` (e.g. `autoV2Fetcher.ts`,
  `autoModeTiers.ts`, `copilotManagedModelConfiguration.ts`) and `github/copilot-cli` issues
  (#5290, #5298). Facts, not code, were used.
- Design informed by `klconsultancy/opencode-copilot-auto` (MIT — only living `POST /auto`
  implementation; sticky sessions, `/meta` discovery) and `OpeOginni/opencode-copilot-auto`
  (variants-as-tiers UX). **No code from those projects is vendored**; this is a clean reimplementation.
- `m0wer/opencode-github-copilot-auto-model` documents Auto V1, whose endpoints VS Code deleted in
  August 2026 — it is not a usable reference anymore.
- `OMGDemoPlayground/opencode-copilot-fusion` was reviewed and rejected as a dependency (requires a
  hand-made token file, impersonates `copilot-developer-cli`, static tier only, unverifiable author).

MIT © opencode-copilot-fusion contributors. See [LICENSE](./LICENSE).
