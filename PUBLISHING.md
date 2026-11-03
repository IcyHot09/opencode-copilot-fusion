# Publishing

The release pipeline publishes the package to npm when a `v*` tag is pushed. The pipeline builds, tests, publishes with provenance, and creates the GitHub release.

## One-time setup

1. Create an npm account on [npmjs.com](https://www.npmjs.com).
2. Enable two-factor authentication on your npm account. npm requires 2FA for publishing.
3. Publish the first version by hand, because the package must exist before you can link a trusted publisher:
   ```sh
   npm login                  # once
   npm publish --access public
   ```
4. On npmjs.com, open your package settings and go to **Trusted Publishing**. Choose **GitHub Actions** and enter:
   - **Organization or user**: `IcyHot09`
   - **Repository**: `opencode-copilot-fusion`
   - **Workflow filename**: `release.yml`
   - **Environment**: leave blank
   - **Allowed actions**: enable **Allow npm publish** (optionally also **Allow npm dist-tag**)
5. Save the configuration. The configuration expires if the first publish through it does not succeed within 2 days.

You can now publish releases from CI without any npm credential stored in GitHub.

## Release flow

1. `npm version patch` (or `minor` / `major`). This updates `package.json`, commits, and creates the tag.
2. `git push --follow-tags`
3. The `release` workflow builds, tests, publishes, and creates the GitHub release.

You can also publish a tag by hand: go to **Actions → release → Run workflow**.

## Fallback

`npm publish --access public` from your machine still works. It asks for your 2FA one-time code.

## Notes

- npm versions are immutable. You cannot replace a published version.
- Unpublish within 72 hours, and only if the package has few downloads. Deprecate instead when you can.
- Provenance is generated automatically for public repositories and public packages published by the trusted publisher.
- `package.json` `repository.url` must stay exactly `git+https://github.com/IcyHot09/opencode-copilot-fusion.git`. The trusted publisher matches it byte for byte.
