# opencode-copilot-fusion

[![ci](https://github.com/IcyHot09/opencode-copilot-fusion/actions/workflows/ci.yml/badge.svg)](https://github.com/IcyHot09/opencode-copilot-fusion/actions/workflows/ci.yml)
[![release](https://img.shields.io/github/v/release/IcyHot09/opencode-copilot-fusion.svg)](https://github.com/IcyHot09/opencode-copilot-fusion/releases/latest)

Use GitHub Copilot Fusion in opencode. The plugin routes each turn to Fusion's model router. The unmodified request is always a valid call to one model. If routing fails, the turn runs as if the plugin were not installed.

> [!IMPORTANT]
> This plugin is unofficial. It uses Copilot's undocumented, private routing endpoints (`POST /auto`, `GET /meta`). They can change or stop working without notice. GitHub does not endorse this plugin. Use it at your own risk. Respect your organization's Copilot policies.

## What you get

| Variant | Fusion tier | `/auto` tier | `reasoningEffort` | Plans |
|---|---|---|---|---|
| `github-copilot/fusion#standard` | Fusion Standard | `balance` | `low` | all plans |
| `github-copilot/fusion#high` | Fusion High | `hydrafusion` | `high` | Pro+ / Max / Business / Enterprise |
| `github-copilot/fusion#max` | Fusion Max | `hydrafusion-max` | `xhigh` | Pro+ / Max / Business / Enterprise |

If Fusion High is available but `hydrafusion` is not, the `high` variant uses classic Auto `intelligence`. Fusion Max has no fallback. The plugin reads `GET /meta` at startup and keeps only the variants your account can run. A variant the account cannot run shows a one-shot warning and runs on the anchor model.

## How it works

1. Opencode connects to Copilot with your stored credential. The plugin never asks you for a separate token.
2. On the first turn of a session, the plugin calls `POST {copilot-host}/auto`. It sends the last user prompt, `has_image`, and the tier for the selected variant. The reply is one picked model and a 24-hour `session_token`.
3. The inference request goes to the picked model with the header `Copilot-Session-Token`.
4. The plugin reuses the pick for the rest of the session (sticky). It re-routes only after compaction, on token near-expiry, on variant switch, or on an image prompt when the pick lacks vision.
5. If `/auto` fails or returns no usable model, the turn runs on the anchor model without the session token. The user still gets an answer.

Fusion's execution patterns (single model, cascade, critique, and parallel model calls) run on GitHub's servers per prompt. The client cannot force or inspect them; the tier selects how much orchestration is allowed.

## Parity with Copilot CLI

What matches the CLI:

- Sticky session anchor with re-evaluation on compaction (the CLI re-anchors for long-context sessions), on token near-expiry, on variant switch, and on an image prompt without vision.
- The 24-hour session token, refreshed before expiry. Billing per underlying model, with the paid-plan 30% discount applied server-side through 2026-11-30.
- Cascade, critique, and parallel-model orchestration are server-side. They work unchanged for every routed turn; no client support is needed.
- Tool calls, images, system prompts, and streams pass through untouched; the rewrite swaps the body's `model` field, deletes `temperature` by default, and sets the session token header.

What differs from the CLI:

- The CLI shows which models ran a turn. opencode does not surface that data yet. With `FUSION_DEBUG=1`, the plugin logs the pick, `hydra_scores` and `discounted_costs` if the server sends them, and the names of any Fusion-related response headers — but a full per-turn model list is not guaranteed to exist.
- The CLI pins the primary model for the session; so does this plugin. If you want Fusion re-evaluated on every prompt, set `"route": "prompt"` in the options. Expect a routing call per prompt and no prompt-cache warmth between turns.
- The CLI can use WebSocket transport to GitHub's backends; opencode uses HTTP. Streaming looks the same from your side.
- Claude picks need an Anthropic-native anchor (`anchorModel` set to a Claude model). Otherwise a Claude pick on a GPT anchor falls back to the anchor, and the plugin logs it.

## Requirements

- Opencode v2. Developed against v2.2.5. Opencode v1 is not supported.
- GitHub Copilot connected in opencode (`opencode auth login`, or `/connect` in the TUI). Use the account that has the Copilot seat.
- Plan support for the tiers you want. Standard: all plans. High and Max: Pro+, Max, Business, Enterprise. The 30% launch discount: paid plans only.
- Organization policy. Business and Enterprise owners can restrict the models available for Fusion. If your owner disabled them, `/meta` reports the tiers disabled.

## Install

Add this to your `opencode.json`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["git+https://github.com/IcyHot09/opencode-copilot-fusion.git#v0.2.3"],
  "model": "github-copilot/fusion",
}
```

Or install the release tarball:

```sh
mkdir -p ~/.config/opencode/plugins/opencode-copilot-fusion
curl -L -o fusion.tgz https://github.com/IcyHot09/opencode-copilot-fusion/releases/download/v0.2.3/opencode-copilot-fusion-0.2.3.tgz
tar -xzf fusion.tgz -C ~/.config/opencode/plugins/opencode-copilot-fusion --strip-components=1
```

opencode discovers plugins in `~/.config/opencode/plugins/` at startup. Restart opencode if the model does not appear. Windows ships `tar`, so the same commands work in PowerShell.

Or use a local folder. Run `npm install && npm run build` in that folder first:

```jsonc
"plugins": ["./path/to/opencode-copilot-fusion"],
```

See [PUBLISHING.md](./PUBLISHING.md) for how releases are published.

### Options

```jsonc
{ "package": "opencode-copilot-fusion",
  "options": {
    "anchorModel": "gpt-6-luna",   // model your requests are built against
    "route": "conversation",        // "conversation" (default) or "prompt"
    "stripTemperature": true,       // drop temperature when a routed model may reject it
    "timeoutMs": 5000,
    "skewMs": 300000,               // re-route within 5 min of token expiry
    "debug": false                  // or set FUSION_DEBUG=1
  } }
```

The anchor keeps your prompts servable. Fusion can pick a model on another wire (for example `/v1/messages` versus `/responses`). The plugin falls back to the anchor for that turn, prints a one-shot warning, and logs the reason with `FUSION_DEBUG=1`. To serve Claude picks over Anthropic's `/v1/messages`, set `anchorModel` to a Claude model your account has. If the plugin cannot verify the picked model's wire (no endpoints advertised anywhere), it proceeds anyway; a cross-wire pick then fails with the provider's error.

## Usage

- TUI: model picker, then **Copilot Fusion**, then the variant dialog (standard / high / max).
- CLI: `opencode run -m 'github-copilot/fusion#high' "review this diff"`.
- Default with no variant: `standard`.

Titles are never routed. Compaction drops the pinned pick, so the next turn re-anchors.

## Billing

- Copilot Fusion bills each underlying model it uses. There is no Fusion surcharge.
- High and Max can call more than one model per prompt. They can use your credits faster than a plain model pick.
- The 30% discount runs on paid plans through 2026-11-30. GitHub applies it server-side for Fusion usage. This plugin sends no discount flag.
- After 2026-11-30, standard rates apply. Usage costs roughly 43% more for the same work.
- Verify the discount in your GitHub Copilot usage dashboard after your first sessions. If you see full price, report it to GitHub support.

## Troubleshooting

- **HTTP 404 from the router**: your account or organization cannot use Fusion right now. Ask your organization owner to enable the Fusion models, or use `standard`, if your plan includes it.
- **Everything falls back to the anchor**: run with `FUSION_DEBUG=1` and read the log. The usual causes: Copilot is not connected, the organization disabled the tiers, or the account has no Fusion access.
- **`Copilot Fusion tier 'max' is not enabled for this account`** appears in the logs once; the turn runs on the anchor model. Your seat cannot run Fusion Max. Use `standard` or `high`.
- **HTTP 401 or 403**: your Copilot token expired or you revoked it. Run `opencode auth login` again. The plugin re-reads the credential on the next request.
- **Routed model rejects the request**: keep `stripTemperature` at `true` (the default). If a pick still fails, report it with the `FUSION_DEBUG=1` output.

## Development

```sh
npm install
npm test          # build + unit tests with a mocked /auto and /meta
npm run build     # tsc -> dist/
```

## License

MIT. See [LICENSE](./LICENSE).
