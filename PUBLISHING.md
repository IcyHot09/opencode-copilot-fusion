# Releasing

The release workflow publishes a tarball with every `v*` tag. The workflow builds, tests, packs, and uploads the tarball to the GitHub release.

## Release flow

1. `npm version patch` (or `minor` / `major`). This updates `package.json`, commits, and creates the tag.
2. `git push --follow-tags`
3. The `release` workflow runs. It packs `opencode-copilot-fusion-<version>.tgz` and uploads it to the GitHub release for the tag.

You can also create the release by hand from **Actions → release → Run workflow**.

## Install from the tarball

```sh
mkdir -p ~/.config/opencode/plugins/opencode-copilot-fusion
curl -L -o fusion.tgz https://github.com/IcyHot09/opencode-copilot-fusion/releases/download/v0.2.0/opencode-copilot-fusion-0.2.0.tgz
tar -xzf fusion.tgz -C ~/.config/opencode/plugins/opencode-copilot-fusion --strip-components=1
```

opencode discovers plugins in `~/.config/opencode/plugins/` at startup. Restart opencode if the model does not appear.

Windows uses the same commands in PowerShell (`tar` ships with Windows 10+).

## If you later want npm

Keep the tarball flow. If you want npm later, add `publishConfig` and an `"repository"` field (already present), publish the first version by hand with `npm publish`, then enable a trusted publisher on npmjs.com for workflow `release.yml`. Trusted publishing needs npm CLI 11.5.1+ and Node 22.14+, and auto-generates provenance for public packages.
