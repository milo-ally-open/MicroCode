# CI and release operations

This guide describes the GitHub Actions workflows in `.github/workflows/` and the manual recovery path for a failed or unsuitable CLI release.

## Pull request checks

`.github/workflows/ci.yml` runs for pull requests and pushes to `main`. The verification job installs the exact dependency lock with Bun 1.3.14, then runs:

```sh
bunx tsc --noEmit
bun test ./tests
bun run scripts/validate-runtime-spec.ts
```

After verification passes, native Linux x64, Windows x64, and macOS arm64 runners run `bun run build --no-install` and execute the resulting binary with `--version`. The build job does not install the binary into a runner user's PATH.

Third-party GitHub Actions are pinned to full commit SHAs. The workflows use the repository's lockfile and do not receive model credentials.

## Creating a release

1. Merge a commit whose `package.json` version is the intended release version. Keep `package.json` and `bun.lock` consistent.
2. Create an immutable annotated tag using the `vMAJOR.MINOR.PATCH` form, for example `v0.2.0`, pointing at that commit.
3. Push the tag. The release workflow checks that the tag equals the package version before building.
4. Wait for all six native release builds: Linux x64/arm64, Windows x64/arm64, and macOS x64/arm64. Each packaged executable must start and print its version. The workflow computes a SHA-256 file next to each archive.
5. The publish job requires six archives and six checksum files, verifies every checksum, then creates a GitHub Release with generated notes and all assets.

`workflow_dispatch` can build a tag that already exists but has no GitHub Release. It checks out that tag, so the tag must point at the intended source and its package version must match. The workflow does not replace assets on an existing release; publish fails if that release already exists. Fix the source and publish a new version/tag rather than moving a published tag.

## Failed builds and rollback

- A failed matrix build prevents the publish job from running, so a partial set of platform artifacts is not published. Read the failed job log, fix the source, merge it, and push a new version tag.
- If a release artifact is unsuitable, stop distributing that release and direct users to the previous known-good tag's release assets. Verify the downloaded archive's adjacent `.sha256` file before installation.
- Reinstall the previous version using its platform installer (`install.sh` or `install.cmd`). Session and config rollback is safe only while the release preserves their existing formats; do not delete or rewrite user data as part of binary rollback.
- This workflow does not move tags, edit an existing release, or automatically downgrade installed clients.

The first published build should also be installed in a clean user environment and checked with `microcode --version` and a basic startup/exit cycle. A release build proves packaging and startup, not live Codex authentication or remote inference.
