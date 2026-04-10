# AGENTS.md

## Purpose
This file defines how AI coding agents should operate in this repository. Prioritize: `correctness > simplicity > speed`. Make focused, minimal changes that match existing project patterns.

## Environment
- Runtime: Node `22.12.0` (see `.nvmrc`)
- Package manager: `npm`
- Framework/build: Vue 3 + Vite

Use these commands:

```bash
nvm use
npm install
npm run dev
npm run build
npm run preview
```

## Repo Map
- `src/`: application code (Vue components, app logic, routing)
- `public/`: static assets served as-is
- `index.html`: Vite app entry HTML
- `vite.config.js`: Vite configuration

When adding code, prefer existing directories and naming patterns over creating new top-level structure.

## Coding Rules
- Preserve existing Vue 3 patterns and coding style.
- Keep components and functions small and cohesive.
- Prefer explicit, readable code over clever abstractions.
- Do not introduce new dependencies unless explicitly requested.
- Avoid broad refactors unless explicitly requested.

## Workflow Rules
Before editing:
- Read related files to understand local conventions.
- Confirm assumptions from current code, not memory.

After editing:
- Run `npm run build`.
- If relevant, run any additional command needed to validate behavior.
- Summarize what changed and why.

## Git Safety
- Never run destructive git commands unless explicitly requested.
  - Examples: `git reset --hard`, `git checkout -- <file>`.
- Do not revert unrelated local changes.
- Do not amend commits unless explicitly requested.

## Commit Message Convention
Use this format:

```text
<type>(<optional-scope>): <short imperative summary>
```

Rules:
- Use lowercase `type`.
- Keep summary concise (target <= 72 characters).
- Use imperative mood (example: "add map marker popup").
- No trailing period in the summary.
- Use scope when it adds clarity (example: `router`, `map`, `build`, `deps`).

Allowed types:
- `feat`: new user-facing behavior
- `fix`: bug fix
- `refactor`: internal code change without behavior change
- `docs`: documentation-only change
- `style`: formatting or non-functional style changes
- `test`: tests added or updated
- `build`: tooling/build/dependency changes
- `chore`: maintenance work not covered above

Examples:
- `feat(map): add meetup location popup details`
- `fix(router): prevent redirect loop on home route`
- `build(deps): upgrade vite to 8.0.3`
- `docs(agents): clarify escalation rules`

## PR Title Convention
Use this format for pull request titles:

```text
<type>(<optional-scope>): <short imperative summary>
```

Rules:
- Match the primary change in the PR (not every commit).
- Use the same allowed `type` values as commit messages.
- Keep title concise and specific (target <= 72 characters).
- Use scope for area clarity when helpful (`ui`, `router`, `build`, `docs`).
- No ticket prefix unless the user/repo explicitly requires one.

Examples:
- `feat(ui): add itinerary overview cards`
- `fix(map): handle missing coordinates gracefully`
- `refactor(router): simplify route guards`
- `docs(readme): add local run troubleshooting`

## Branching Convention
- Use short-lived branches from the default branch.
- Branch names should follow: `<type>/<short-kebab-summary>`.
- Recommended `type` values: `feat`, `fix`, `refactor`, `docs`, `chore`.
- Examples:
- `feat/add-itinerary-cards`
- `fix/map-missing-coordinates`
- `docs/update-local-dev-setup`

## Versioning Criteria
Use Semantic Versioning (`MAJOR.MINOR.PATCH`) in `package.json`.

- Bump `MAJOR` for intentionally breaking behavior/contracts.
- Bump `MINOR` for backward-compatible features.
- Bump `PATCH` for backward-compatible bug fixes, maintenance, or docs-only changes.

Agent requirements when a release is requested:
1. Propose the target bump level with a one-line rationale.
2. Update `package.json` version in the same change set.
3. Ensure build metadata footer (`vX.Y.Z (sha)`) will reflect the release commit.
4. Create an annotated `vX.Y.Z` tag after the release commit is finalized.
5. Do not retag or move existing published release tags.

## Quality Gates
Minimum validation before marking work complete:
- Always run `npm run build` and confirm success.
- For UI changes, verify the app in `npm run dev` on desktop and mobile width.
- For routing changes, verify navigation for affected routes.
- For data/state changes, verify loading/error/empty states still behave correctly.
- If tests exist for touched behavior, run them and report results.

## Definition Of Done
Work is done only when all are true:
- Requested behavior is implemented and verified locally.
- `npm run build` passes.
- No known regressions in touched flows.
- Accessibility basics remain intact (semantic structure, labels, meaningful `alt` text).
- Change summary includes files changed, commands run, and any residual risks.

## PR Body Convention
Use this structure in pull request descriptions:
- `## Summary` what changed and why.
- `## Problem` user-facing or technical issue being addressed.
- `## Approach` key implementation decisions and tradeoffs.
- `## Validation` commands run and manual checks performed.
- `## Risks` edge cases, follow-ups, or known limitations.
- `## Screenshots` before/after visuals for UI changes (if applicable).

## Dependency And Security Policy
- Do not upgrade or add dependencies unless explicitly requested.
- If a dependency change is required, keep scope minimal and document impact.
- Prefer patch/minor updates over major updates unless user-approved.
- Run `npm audit` only when dependency/security work is requested.
- Never commit secrets, tokens, or credentials.
- If a potential secret is found, stop and notify the user immediately.

## Frontend Guardrails
- Preserve responsive behavior on mobile and desktop.
- Avoid visual regressions in spacing, typography, and layout.
- Maintain basic accessibility:
  - semantic HTML where possible
  - form labels for controls
  - `alt` text for meaningful images

## Agent Response Format
When reporting work, include:
1. What changed (short summary).
2. Files modified.
3. Commands run and pass/fail result.
4. Risks, assumptions, or follow-up actions.

## Escalation Rules
Ask the user before:
- dependency upgrades
- config/tooling changes
- data model or API shape changes
- large refactors across multiple modules

## Out of Scope (Unless Explicitly Requested)
- Deployment or infrastructure changes
- Secrets management changes
- CI/CD redesign
