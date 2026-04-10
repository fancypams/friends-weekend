#!/usr/bin/env bash
set -euo pipefail

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Refusing to tag: working tree is not clean."
  echo "Commit or stash changes first."
  exit 1
fi

version="$(node -e "console.log(JSON.parse(require('fs').readFileSync('package.json','utf8')).version)")"
tag="v${version}"
message="${1:-Release ${tag}}"

if git rev-parse -q --verify "refs/tags/${tag}" >/dev/null; then
  echo "Refusing to tag: ${tag} already exists."
  exit 1
fi

git tag -a "${tag}" -m "${message}"
echo "Created annotated tag ${tag} at $(git rev-parse --short HEAD)"
echo "Push it with: git push origin ${tag}"
