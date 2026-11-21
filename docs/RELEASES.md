# Releases

ZeroVer (`0.x`): the API is stabilizing; minor bumps may break, patch bumps don't. Releases are cut
manually with the flow below (proven in the sibling repos), **not** `changelogen --release` (its
auto-tag once tagged a pre-bump commit in the flags repo). `changelogen` only previews the
changelog.

## The flow

```sh
export NODE_OPTIONS=            # a stale preload breaks husky under node

# 1. Preview the changelog since the last tag (the first release: --from the first commit)
bunx changelogen --from vPREV --to HEAD

# 2. Bump + record
npm pkg set version=X.Y.Z      # and VERSION in src/version.ts (the CLI, /config and /healthcheck report it)
#    prepend the CHANGELOG.md entry ("## vX.Y.Z") from the preview
bun run format                  # ALWAYS before committing, even docs-only
git add -A && git commit -m "chore(release): vX.Y.Z"

# 3. Tag and push: main FIRST, tag second
git tag -a vX.Y.Z -m "vX.Y.Z"
git push origin main
git push origin vX.Y.Z

# 4. Verify the tag dereferences to the release commit
git ls-remote origin 'refs/tags/vX.Y.Z^{}'

# 5. Watch the Release workflow (build → publint → npm publish --provenance → GitHub Release)
gh run watch

# 6. Confirm
npm view @xtandard/links version
```

The tag push triggers two workflows:

- **`release.yml`**: installs, builds (library, Elysia 2 types, UI, React embed), runs `publint`,
  publishes to npm with provenance, and turns the tag into a GitHub Release whose notes are the
  tag's `CHANGELOG.md` section (keep the heading exactly `## vX.Y.Z`).
- **`docker.yml`**: builds `apps/standalone/Dockerfile` and pushes
  `ghcr.io/xantiagoma/xtandard-links:vX.Y.Z` (pushes to `main` publish `latest` and `sha-…`), then
  smoke-tests `/healthcheck`, the panel and the OpenAPI document.

The docs site (`pages.yml`) rebuilds on every push to `main` that touches the docs, `src/` or the
changelog.

## npm trusted publishing

Publishing uses npm **trusted publishing** (OIDC) for this repository + `release.yml`: there is no
token to store or rotate, and `.npmrc` keeps `provenance=true`. Set the trust up once (npm >= 11.10,
logged in as a package owner):

```sh
npx npm@latest trust github @xtandard/links --repo xantiagoma/xtandard-links --file release.yml --allow-publish
```

The workflow needs `id-token: write` (already set) and npm >= 11.5.1 on the runner (it uses Node 24).

**Publish failed for a tag?** Re-run it without cutting a new version:
`gh workflow run release.yml -f tag=vX.Y.Z`.

## One-time repository setup

- Upload `docs/assets/social.png` as the GitHub social preview (Settings → General → Social
  preview) and set Pages' source to "GitHub Actions" ([Brand](BRAND.md)).
- The docs site renders `CHANGELOG.md` as its Changelog page (and the README's "Project status"
  section next to it), so every release entry shows up there on the next Pages deploy.

## Conventional commits

Scopes: `core`, `redirect`, `resolver`, `rules`, `clicks`, `analytics`, `conversions`, `deeplinks`,
`storage`, `server`, `auth`, `ui`, `react`, `cli`, `qr`, `import`, `bridges`, `examples`, `docs`,
`site`, `ci`. The changelog is generated from these: write them for the reader.
