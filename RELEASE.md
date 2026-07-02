# Releasing InkedMark

CI (`ci.yml`) gates every push: lint → typecheck → test → build. Releases and
the website deploy are automated; a few steps are inherently manual.

## Cut a release (automated)

1. Ensure `main` is green and the working tree is clean.
2. Add a `## [x.y.z] - YYYY-MM-DD` section to `CHANGELOG.md` — `release.yml`
   extracts it as the GitHub Release notes (falls back to a generic line if
   the section is missing).
3. Bump the version (updates `manifest.json` + `versions.json` via
   `version-bump.mjs`):
   ```bash
   npm version patch   # or minor / major
   ```
   This tags the commit as `x.y.z` — **no `v` prefix** (enforced by `.npmrc`'s
   `tag-version-prefix=""`; Obsidian requires the tag to match
   `manifest.json`'s version exactly).
4. Push the commit and the tag:
   ```bash
   git push && git push --tags
   ```
5. `release.yml` builds and creates a GitHub Release with `main.js`,
   `manifest.json`, and `styles.css` attached — the three Obsidian artifacts —
   using the matching `CHANGELOG.md` section as the notes.

> `minAppVersion` lives in `manifest.json`; bump it there if you start using a
> newer Obsidian API before releasing.

## Website (automated)

`pages.yml` deploys `docs/` to GitHub Pages on any push to `main` that touches
`docs/`. One-time setup:

- Repo **Settings → Pages → Source: GitHub Actions**.
- DNS for `inkedmark.com` → GitHub Pages (the `CNAME` file is already in `docs/`).

## Manual steps (not automatable)

- **Demo GIFs / screenshots.** Record on a real iPad (pen + search), drop them in
  `docs/assets/` (referenced by `docs/index.html` as `demo.gif`) and in the
  README. The site hides the demo `<img>` until the asset exists.
- **On-device QA.** Run `QA.md` on device before a public release; check the
  open [GitHub issues](https://github.com/pcrausaz/obsidian-inkedmark/issues).
- **Community Plugins submission.** Open a PR against
  [`obsidianmd/obsidian-releases`](https://github.com/obsidianmd/obsidian-releases)
  adding InkedMark to `community-plugins.json` (id `inkedmark`). Requires the
  repo to have a release with the three artifacts and a root `manifest.json`.
- **BRAT beta.** Testers add `pcrausaz/obsidian-inkedmark` in the BRAT plugin; no
  action needed beyond having a GitHub release.
