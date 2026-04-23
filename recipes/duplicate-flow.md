# recipes/duplicate-flow.md — STUB

**Status:** Phase-1 target. v1 dogfood uses pattern-match off `promote-to-prod.md` + `reference/operations.md` + `reference/rest-endpoints.md`.

## Intent
User asks to duplicate an existing flow — either to iterate on a variant (A/B style), make a copy under a new slug, or create a new draft version of the same flow. Typical phrasing: "duplicate `welcome-to-my-product` so I can experiment with a new copy", "clone the tour to a new slug", "make a new version of my checklist so I can edit without affecting the live one".

## Pattern
Follows the same shape as `promote-to-prod.md` for multi-call orchestration, but single-env (stays in dev or stays in prod). Two distinct "duplicate" meanings, each with its own endpoint:
- **Variant A — new flow with a new slug** (logical copy). Fetch source with `GET /v1/flows/<slug>`; `POST /v1/flows/` with a new `slug`, copying `name`, `type`, `data`, `targetingLogic`, `codeSnippet`. Pattern from `promote-to-prod.md` §4.1 CREATE-path but against the same env.
- **Variant B — new draft version of same slug** (versioning copy). `POST /v1/flows/<numericFlowId>/versions` — returns a new `DRAFT` row with incremented version, same slug. Pattern from `promote-to-prod.md` §4.2b "Create new draft" variant.
Ask the user which they mean if the prompt is ambiguous. "Copy to a new slug" → Variant A. "New draft version" / "new draft to edit" → Variant B.

## API op
See `reference/operations.md` §"Flow operations".
- Variant A (new slug): `createFlow` → `POST /v1/flows/` (see `rest-endpoints.md` §"POST /v1/flows/").
- Variant B (new version): `createFlowVersion (duplicate / new draft)` → `POST /v1/flows/:id/versions` (see `rest-endpoints.md` §"POST /v1/flows/:id/versions").
- Auth: `Authorization: Bearer $FRIGADE_API_KEY_SECRET` (or `_PROD` for prod).

## Confirmation
Safety tag: **safe** in dev, **dangerous** in prod (both variants — same row as `createFlow` / `createFlowVersion` in `operations.md`). Canonical prod prompt: `"About to create flow '<new-slug>' in prod. This affects live flow state. Confirm? (y/n)"` (Variant A) or the generic `"About to <verb> <target> in <env>. Confirm? (y/n)"` for Variant B (new draft version in prod).

## Pre-conditions
- `first-run-setup.md` Section 1 state-check passed.
- Dev private key available (or prod for prod ops).
- Source flow exists (verify with `GET /v1/flows/<slug>` before proceeding — 404 → halt with "source flow not found").

## Minimal flow

**Variant A — new flow, new slug:**

1. Ask or infer which variant the user wants.
2. `GET /v1/flows/<source-slug>` with dev key → capture `name`, `type`, `data`, `targetingLogic`, `codeSnippet`, `description`.
3. Derive new `slug` (user-supplied or append `-copy`, `-copy-2`, etc. after collision check). Collision-check with another `GET /v1/flows/<new-slug>`.
4. Confirmation if env is prod.
5. `POST /v1/flows/` with the new slug + copied body. Default `active: false` (let the user activate when ready).
6. Report new slug + dashboard URL; log `duplicate-flow:variant-a:success`.

**Variant B — new draft version:**

1. `GET /v1/flows/<source-slug>` → capture numeric `id`.
2. Confirmation if env is prod.
3. `POST /v1/flows/<id>/versions` with body `{}` — returns new draft row.
4. Report: new draft exists at the same slug, different numeric id; the live version is unchanged.
5. If the user also wants to edit and publish, hand off to `update-yaml.md` then `publish-flow.md`. Log `duplicate-flow:variant-b:success`.

## Example invocation

User: "Duplicate `welcome-to-my-product` so I can try a different copy — name it `welcome-to-my-product-v2`."

Claude's actions (abbreviated):
- Interpret as Variant A (new slug). Confirm: `welcome-to-my-product-v2` is free via `GET`.
- `GET /v1/flows/welcome-to-my-product` → body.
- `POST /v1/flows/` with slug `welcome-to-my-product-v2`, same type/data/name, `active: false`.
- Report new dashboard URL.

## TODO (Phase 1)
- Write the fully-authored version.
- Clarify variant-disambiguation prompt wording when user says "duplicate" without specifics.
- Mount-site handoff: Variant A creates a new flow that's not yet mounted in the host codebase — surface a "NEXT" pointer to the appropriate `create-<type>.md` recipe's Step 7 (mount phase), or offer to mount under a new React component automatically.
- Handle "duplicate and flip active" (e.g. "duplicate and activate the copy") — chain through `publish-flow.md`.
