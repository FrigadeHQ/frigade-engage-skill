# recipes/version-management.md — STUB

**Status:** Phase-1 target. v1 dogfood uses pattern-match off `duplicate-flow.md` (stub, Variant B handles new-draft creation) + `publish-flow.md` (stub, handles activate) + `reference/operations.md` + `reference/rest-endpoints.md`.

## Intent
User asks about flow version history or wants to restore a prior version. Typical phrasing: "what versions of the welcome announcement exist?", "roll back to the previous version of the tour", "show me version 2 of my checklist", "I messed up the YAML — revert". Read-mostly, but the "restore" path runs writes (equivalent to: fetch old version's YAML → PUT it back into the active flow, or create a new version from the old content).

## Pattern
Two distinct jobs folded into one stub:
- **List versions** (read-only) — `GET /v1/flows/<slug>/versions` returns the full history per `rest-endpoints.md` §"GET /v1/flows/:id/versions". Pattern is the same as `list-flows.md` but scoped to one slug.
- **Restore a prior version** (write) — no dedicated "rollback" endpoint. The operation is a multi-call orchestration similar to `promote-to-prod.md` §4.2 (UPDATE path): fetch the target historical version's `data`, then `PUT /v1/flows/<current-active-id>` with that `data` to overwrite the live version with the old content. OR create a new draft version from the old content via `POST /v1/flows/<id>/versions` + `PUT` of the old `data`, then `PUT /v1/flows/<new-draft-id>/activate` to publish. Offer both paths when the user says "rollback".

## API op
See `reference/operations.md` §"Flow operations".
- List versions: `listFlowVersions` → `GET /v1/flows/:slug/versions` (see `rest-endpoints.md` §"GET /v1/flows/:id/versions"). Safe in both envs.
- Restore (overwrite-path): `updateFlow` → `PUT /v1/flows/:numericFlowId`. Safe dev / dangerous prod.
- Restore (new-draft-path): `createFlowVersion` + `updateFlow` + `activateFlow`. Same safety tags.
- Auth: `Authorization: Bearer $FRIGADE_API_KEY_SECRET` (or `_PROD` for prod).

## Confirmation
Safety tag:
- List versions: **safe** in both envs. No confirmation.
- Restore (either path): **safe** in dev, **dangerous** in prod. Canonical prompt: `"About to update flow '<slug>' in prod. This affects live flow state. Confirm? (y/n)"` (per `operations.md` §"Flow create / update in prod").

## Pre-conditions
- `first-run-setup.md` Section 1 state-check passed.
- Private key for target env available.
- Source flow exists.

## Minimal flow

**List versions:**

1. Parse `slug`, `environment`.
2. `GET /v1/flows/<slug>/versions`. Returns `{ data: Flow[], offset: 0, limit: 100 }` ordered by `createdAt desc` (newest first).
3. Format: one row per version with version number, status, active, createdAt, modifiedAt, numeric id.

**Restore (overwrite-path — replaces current active content with target version's content):**

1. Parse `slug`, `target-version` (number or "previous" = current - 1).
2. `GET /v1/flows/<slug>/versions` → find the target version and the current-active version. Capture their numeric ids; capture target's `data` string.
3. Prod confirmation if env is prod.
4. `PUT /v1/flows/<current-active-id>` with body `{"data": "<target version's data>"}` — overwrite in place.
5. Verify round-trip; report.

**Restore (new-draft-path — creates a new draft from the old content, publishes it):**

1. Steps 1–2 same as overwrite-path.
2. Prod confirmation.
3. `POST /v1/flows/<current-active-id>/versions` → new draft id.
4. `PUT /v1/flows/<new-draft-id>` with `{"data": "<target version's data>"}`.
5. `PUT /v1/flows/<new-draft-id>/activate` with `{"archiveBehavior": "EXIT_EXISTING_USERS"}`.
6. Verify and report.

Default path when user says "rollback": **overwrite-path** (simpler, idempotent, no dangling draft). Offer the new-draft-path only when user asks for "a draft of the old version" / "a version I can review before making live".

## Example invocation

User: "What versions of `welcome-to-my-product` exist?"

Claude's actions (abbreviated):
- `GET /v1/flows/welcome-to-my-product/versions` → `data: [{id, version, status, createdAt, modifiedAt}, ...]`.
- Format as:
  ```
  3 version(s) of welcome-to-my-product:
    - v3  ACTIVE    id: 12347  created 2026-04-17
    - v2  ARCHIVED  id: 12346  created 2026-04-16
    - v1  ARCHIVED  id: 12345  created 2026-04-15
  ```

## Example response shape

Per `rest-endpoints.md` §"GET /v1/flows/:id/versions" — paginated `Flow[]`, `createdAt desc`. Each entry has `id`, `slug`, `version`, `status` (`ACTIVE` / `ARCHIVED` / `DRAFT`), `active`, `modifiedAt`, `createdAt` and the full `data` YAML.

## TODO (Phase 1)
- Write the fully-authored version — may end up as two separate recipes (`list-versions.md` + `restore-version.md`) if the restore flow grows complex.
- Diff display between versions: when the user says "what changed between v2 and v3?", run YAML diff client-side and render a compact patch.
- Handle mid-restore partial failures per `reference/errors.md` §"Partial failure rules" — new-draft-path is multi-call and can half-complete.
- Document the version-number-is-per-env gotcha from `promote-to-prod.md` §"Gotchas uncovered" ("Version numbers are not promoted").
