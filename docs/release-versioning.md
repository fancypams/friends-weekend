# Release + Versioning

Use Semantic Versioning (`MAJOR.MINOR.PATCH`) in `package.json`.

## Bump Rules
- `MAJOR`: breaking behavior/contract changes
- `MINOR`: backward-compatible feature additions
- `PATCH`: backward-compatible fixes, maintenance, or docs updates

## Release Criteria
1. Bump `package.json` version before release.
2. Ensure footer build metadata reflects the release (`vX.Y.Z (sha)`).
3. Keep release commit/PR summary focused on user impact.
4. Create an annotated git tag for each production release.
5. Never move or recreate an existing published tag.

## Release Checklist
```bash
# 1) Use pinned toolchain
nvm use
npm install

# 2) Bump version without auto-tagging
npm version patch --no-git-tag-version   # or: minor / major

# 3) Commit the release bump
git add package.json package-lock.json
git commit -m "chore(release): bump to vX.Y.Z"

# 4) Validate production build
npm run build

# 5) Create an annotated release tag from package.json version
npm run release:tag -- "Release vX.Y.Z"

# 6) Push commit + tag
git push
git push origin vX.Y.Z
```
