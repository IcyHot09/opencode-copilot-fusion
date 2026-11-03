# Releasing

The release workflow publishes a tarball with every `v*` tag. The workflow builds, tests, packs, and uploads the tarball to the GitHub release.

## Release flow

1. Update the install pins in `README.md` and in this file to the new version (`X.Y.Z` and `vX.Y.Z` occurrences).
2. `npm version patch` (or `minor` / `major`). This updates `package.json`, commits, and creates the tag.
3. `git push --follow-tags`
4. The `release` workflow verifies that the tag matches `package.json`, then builds, tests, packs, and uploads the tarball to the GitHub release for the tag.

You can also create the release by hand from **Actions → release → Run workflow**; pass the existing tag when asked.

## Install from the tarball

```sh
mkdir -p ~/.config/opencode/plugins/opencode-copilot-fusion
curl -L -o fusion.tgz https://github.com/IcyHot09/opencode-copilot-fusion/releases/download/v0.2.2/opencode-copilot-fusion-0.2.2.tgz
tar -xzf fusion.tgz -C ~/.config/opencode/plugins/opencode-copilot-fusion --strip-components=1
```

opencode discovers plugins in `~/.config/opencode/plugins/` at startup. Restart opencode if the model does not appear.

Windows uses the same commands in PowerShell (`tar` ships with Windows 10+).

## If you later want npm

Keep the tarball flow. If you want npm later, add `publishConfig` and an `"repository"` field (already present), publish the first version by hand with `npm publish`, then enable a trusted publisher on npmjs.com for workflow `release.yml`. Trusted publishing needs npm CLI 11.5.1+ and Node 22.14+, and auto-generates provenance for public packages.
