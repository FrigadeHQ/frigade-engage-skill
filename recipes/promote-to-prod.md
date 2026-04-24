# Recipe: Promote to Prod

**Cross-environment flow promotion recipe.** Given one or more flows that exist in the dev workspace, copy their content into the sibling prod workspace — creating the prod flow on first promotion, updating it on subsequent promotions, and matching the dev flow's active status. Per **D26**, this is a client-orchestrated **multi-call sequence** — the Frigade API has no single `POST /v1/flows/:slug/promote` endpoint. The dashboard's `frigade-web/src/components/dialogs/dialog-copy-flow-to-prod.tsx` is the canonical implementation; this recipe reproduces its call pattern with private API keys.

Because this recipe crosses environments, partial failures can leave hybrid state — a prod flow that exists without the dev side knowing about the pair, for example. The recipe is explicit about which failure modes are recoverable and how.

Referenced decisions: **D09** (two-tier safety — prod writes are `dangerous`), **D13** (committed workspace marker), **D16** (preserve upstream state on partial failure; no silent destructive recovery), **D17** (log every cross-env step to `.frigade/skill.log`), **D23** (each private key is environment-bound), **D26** (dev→prod promotion is a client-orchestrated multi-call; canonical dashboard source is `dialog-copy-flow-to-prod.tsx`), **D28** (403 = bad key, 401 = ownership).

Companion refs:
- `recipes/first-run-setup.md` — pre-condition state check (Section 1), prod-key onboarding (Section 5.3).
- `reference/rest-endpoints.md` — `GET /v1/flows/:id`, `POST /v1/flows/`, `PUT /v1/flows/:numericFlowId`, `POST /v1/flows/:id/versions`, `PUT /v1/flows/:id/activate`, `DELETE /v1/flows/:numericFlowId` contracts.
- `reference/operations.md` — `promoteFlow` safety row (`n/a` in dev, `dangerous` in prod); canonical confirmation prompt template "Dev → prod promotion (D26)".
- `reference/errors.md` — §"Composite operation failures" and §"Partial failure rules" (D16); §401/403/404/409/5xx handling.
- `frigade-web/src/components/dialogs/dialog-copy-flow-to-prod.tsx` — canonical client orchestration. Two paths: **Overwrite existing** (`PUT /v1/flows/<prod-id>` with dev's content) and **Create new draft** (`POST /v1/flows/<prod-active-id>/versions` → `PUT /v1/flows/<new-draft-id>`). This recipe defaults to **Overwrite** — see Step 4 for the rationale.
- `frigade-web/src/components/buttons/dropdown-flow-actions.tsx` — `copyToProdFromScratch` path, the canonical first-time-copy call (`POST /v1/flows` with `active: false`).

---

## Pre-conditions

1. **`first-run-setup.md` Section 1 passed.** `.frigade/project.json` marker present; `.env.local` keys verify against the marker's `workspaceId`. If not, invoke `first-run-setup.md` first — it returns silently on success. Don't proceed until that returns.
2. **Dev AND prod private keys both available.** This recipe needs both in the shell (`set -a; source .env.local; set +a`):
   - `FRIGADE_API_KEY_SECRET` — dev private key (verified against `marker.workspaceId`).
   - `FRIGADE_API_KEY_SECRET_PROD` — prod private key (verified against `marker.prodWorkspaceId`).

   If `FRIGADE_API_KEY_SECRET_PROD` is absent, halt with:
   > Prod keys aren't set up for this repo. Run `first-run-setup.md` to add them (Section 5.3 will resume prod-key onboarding), then re-try the promotion.

   Don't proceed. Never use the dev key against the prod base URL or vice versa — each key is organization-bound per **D23** and will 401/403 if mismatched.

3. **Source flow(s) exist in dev.** The recipe verifies this per-flow in Step 1. If the user asks to promote a slug that doesn't exist in dev, halt with a list of nearest matches (see `errors.md` §404).

4. **Never paste private keys into tool-call arguments.** All curls interpolate `$FRIGADE_API_KEY_SECRET` / `$FRIGADE_API_KEY_SECRET_PROD` from the shell. The raw key values must not appear in the transcript, the skill log, or any emitted file.

If any pre-condition fails, halt with a clear pointer and do not issue any API calls. Log a `promote-to-prod:precondition-failed` event per **D17**.

---

## Step 1 — Gather inputs

Parse the triggering prompt. This recipe handles single-flow, batch, and "promote everything with pending changes" phrasings.

### 1.1 — Parse intent

| Prompt shape | Interpretation |
|---|---|
| "Promote `welcome-to-my-product` to prod." / "Push the welcome flow to prod." | Single flow. Slug is explicit. |
| "Promote `welcome-to-my-product` and `welcome-tour` to prod." | Batch. Comma/`and` separated slugs. |
| "Sync all my dev changes to prod." / "Promote all unpublished changes." | **Ambiguous** — needs a list to choose from. Go to Step 1.2 for the "all" path. |
| "Promote everything." | Same as above — offer a list; don't guess. |

Normalize: kebab-case slugs, strip trailing punctuation.

### 1.2 — Expand "all unpublished changes"

For the "all" phrasing, list dev flows whose latest-draft `modifiedAt` is more recent than the paired prod flow's `modifiedAt` (or whose pairing is absent). Implementation:

```bash
# Dev-side list (note the trailing slash per rest-endpoints.md §"GET /v1/flows/")
curl -sS -w "\n---HTTP_STATUS:%{http_code}---\n" \
  "https://api3.frigade.com/v1/flows" \
  -H "Authorization: Bearer $FRIGADE_API_KEY_SECRET"
```

Parse `data[]` and build the candidate list:

- For each dev flow, read `internalData.productionDraftFlowId` and `internalData.productionActiveFlowId` (see `rest-endpoints.md` §Types — these are the two pairing fields backend-app populates when a prod sibling exists; they come from `InternalFlowData`).
- **No pair set** (`productionDraftFlowId == null && productionActiveFlowId == null`) → candidate (first-time copy).
- **Pair set** → `GET /v1/flows/<prod-id>` with **prod** key; compare `modifiedAt`. If dev's `modifiedAt > prod's modifiedAt`, candidate (update).
- **Pair set, dev older than prod** → skip silently (prod already has newer content).

Present the candidate list:

```
Found <n> flow(s) with dev changes not yet in prod:

  1. welcome-to-my-product   (new in prod)        — dev modified 2026-04-16
  2. welcome-tour            (existing in prod)   — dev modified 2026-04-17, prod modified 2026-04-14
  3. checkout-banner         (new in prod)        — dev modified 2026-04-17

Which would you like to promote? (comma-separated numbers, or "all")
```

Wait for the user's selection. On empty list, report "Nothing to promote — all dev flows match prod." and halt cleanly.

Do NOT auto-promote without a user selection, even for the "all" path. The user should see what they're about to push.

### 1.3 — Per-flow dev fetch

For each selected slug, fetch the dev flow with **full internalData** (per `rest-endpoints.md` §"GET /v1/flows/:id"):

```bash
curl -sS -w "\n---HTTP_STATUS:%{http_code}---\n" \
  "https://api3.frigade.com/v1/flows/<slug>" \
  -H "Authorization: Bearer $FRIGADE_API_KEY_SECRET"
```

Record the following from each response:

- `id` — numeric dev flow id.
- `slug` — server-authoritative slug (prefer this over the prompt-supplied slug in case they differ).
- `name`, `description`, `type`, `triggerType`, `data`, `codeSnippet`, `targetingLogic` — everything we'll copy to prod.
- `active` — dev's active status; Step 4 will match this on the prod side.
- `internalData.productionDraftFlowId` — numeric id of prod's draft sibling (if any).
- `internalData.productionActiveFlowId` — numeric id of prod's active sibling (if any).

Interpretation (per `errors.md`):

| Status | Action |
|---|---|
| `200` | Record fields as above. Proceed. |
| `404` | Halt for this flow. Offer nearest-match list from `GET /v1/flows/?limit=500` (per `errors.md` §404). Do not batch-abort — the other selected flows are still candidates. |
| `401` | Ownership/cross-env mismatch per **D28**. Halt the whole recipe and explain. |
| `403` | Bad/revoked dev key per **D28**. Halt; route user to `first-run-setup.md` Section 2.7 verification. |
| `5xx` / network | Retry once after 1s; if still failing, halt. |

### 1.4 — Classify CREATE vs UPDATE per flow

For each source flow, determine the promotion path using the internalData pairing fields (the exact field names the dashboard reads in `dialog-copy-flow-to-prod.tsx:38-41`):

| Pair state | Path | Prod target id |
|---|---|---|
| `productionDraftFlowId != null` | **UPDATE (draft)** — prod has a draft; overwrite it. | `productionDraftFlowId` |
| `productionDraftFlowId == null && productionActiveFlowId != null` | **UPDATE (active)** — prod only has an active version; overwrite it. (The dashboard's "Overwrite existing" button does this. The "Create new draft" button takes the other branch — see Step 4 design note.) | `productionActiveFlowId` |
| both null | **CREATE** — first-time promotion. No prod sibling yet. | n/a |

Record the classification for each flow. Log a `promote-to-prod:classified` event per flow with slug, path (`CREATE` / `UPDATE-draft` / `UPDATE-active`), and target id.

### 1.5 — Handle "prod has the slug but no pair recorded" (rare gotcha)

The pairing fields (`productionDraftFlowId` / `productionActiveFlowId`) are populated server-side when the backend can match sibling flows across orgs by slug (see `rest-endpoints.md` §"GET /v1/flows/:id" and the `InternalFlowData` type). In rare cases — e.g. someone manually created a prod flow with the same slug via a different path, or pairing got out of sync — the dev flow classifies as CREATE but a prod flow with that slug already exists.

The CREATE-path POST (Step 4) will then fail with a synthetic 409 (400 "already exists" message, per `errors.md` §409). Pre-check to avoid this:

```bash
curl -sS -w "\n---HTTP_STATUS:%{http_code}---\n" \
  "https://api3.frigade.com/v1/flows/<slug>" \
  -H "Authorization: Bearer $FRIGADE_API_KEY_SECRET_PROD"
```

- `404` → confirmed CREATE. Proceed.
- `200` → the slug exists in prod but isn't recorded as a pair. Halt for this flow and surface:
  > Flow `<slug>` exists in prod but isn't linked to the dev flow. This is an unusual state — it usually means someone created the prod flow manually outside the normal dev→prod flow. I don't want to silently overwrite that. Options:
  > 1. Treat it as an UPDATE and overwrite prod's `<slug>` with dev's content (I'll re-verify and ask again at the batch confirmation).
  > 2. Skip this flow; you can investigate manually at `https://app.frigade.com/flows/<slug>` (prod).
  > 3. Abort the whole batch.

  Wait for the user's choice. On `1`, reclassify as UPDATE against the prod flow's id (look it up in the `200` response). On `2`, drop from the batch. On `3`, halt.

---

## Step 2 — Batch confirmation (D09)

Emit a **single consolidated confirmation prompt** covering the whole batch, per **D09** batch-confirmation rules (`operations.md` §"Batch confirmations — one prompt per operation-target batch"). Do NOT per-flow confirm — one prompt for the whole list keeps friction low while still making the side effects explicit.

### 2.1 — Confirmation template

Compose the prompt. Use the canonical "Dev → prod promotion (D26)" shape from `operations.md`, extended to name each flow's path:

```
About to promote flows to production:

  - welcome-to-my-product (new in prod)         — will CREATE prod flow
  - welcome-tour          (existing in prod)    — will UPDATE prod flow and overwrite existing content
  - checkout-banner       (existing in prod)    — will UPDATE prod flow and overwrite existing content

Sequence per flow:
  - CREATE path: POST /v1/flows (prod key) → (optionally) PUT /v1/flows/<new-id>/activate if dev is active.
  - UPDATE path: PUT /v1/flows/<prod-id> (prod key) → (optionally) PUT /v1/flows/<prod-id>/activate if dev is active and prod isn't.

This updates live prod flows and will be visible to users immediately.
Confirm? (y/n)
```

### 2.2 — Handle the response

- **`y` / `yes`** → proceed to Step 3.
- **Anything else** (including `n`, empty, `maybe`) → abort with no partial state. Print:
  > No changes made. Nothing was sent to prod.

  Log a `promote-to-prod:aborted-by-user` event. Return to the caller.

Per **D09** there is no "remember yes for this session" shortcut — every batch gets a fresh explicit confirmation.

### 2.3 — Note on no partial confirmation

If the user only wants to promote a subset, they need to re-run the recipe with the narrower list (Step 1). Do not parse `y except <slug>` or similar — keep the prompt binary.

---

## Step 3 — Promotion order

Promotion runs one flow at a time, in this order:

1. **CREATE-path flows first**, then **UPDATE-path flows**.
2. Within each group, alphabetical by slug (deterministic for logs).

**Why creates before updates:** an UPDATE on an existing prod flow can inadvertently depend on a newly-created sibling — e.g. if flow A's content references flow B via a targeting rule, and B is being promoted for the first time in the same batch, B needs to exist in prod before A's content lands. Creating first minimizes this class of cross-flow reference failures. Most flows don't actually have such dependencies, so this is a belt-and-suspenders ordering rule.

Within a single flow's promotion, the sequence is:

- **CREATE path:**
  1. `POST /v1/flows/` with prod key — body carries slug, name, type, data, codeSnippet, targetingLogic, description, `active: false`. See Step 4 CREATE for details.
  2. `PUT /v1/flows/<new-prod-id>/activate` with prod key — **only if** dev's `active == true`.

- **UPDATE path:**
  1. `PUT /v1/flows/<prod-target-id>` with prod key — body carries name, data, codeSnippet, targetingLogic, description (and `active` only if we're matching dev's active status). See Step 4 UPDATE for details.
  2. `PUT /v1/flows/<prod-target-id>/activate` with prod key — **only if** dev's `active == true` AND the prod target is currently a draft (i.e. the UPDATE was against `productionDraftFlowId`, not `productionActiveFlowId`).

**The dev flow's `internalData` does NOT need a manual PATCH** to record the prod pairing — the backend populates `productionDraftFlowId` / `productionActiveFlowId` on the dev side automatically, keyed by the shared slug across orgs (see `rest-endpoints.md` §"GET /v1/flows/:id" — the `InternalFlowData` fields are server-derived, not client-set). Re-fetching the dev flow after the promotion will show the updated pairing. This is why the dashboard's `dialog-copy-flow-to-prod.tsx` doesn't do a separate "update dev internalData" call — the backend does it implicitly.

(If a future backend change introduces a dedicated "record pair" endpoint, revise this step; for now the multi-call sequence is strictly: [prod-side write] → [optionally prod-side activate]. No dev-side write happens in this recipe.)

---

## Step 4 — Apply the promotion per flow

For each source flow (in the Step-3 order), apply the relevant path.

### 4.1 — CREATE path

First-time copy. Canonical dashboard source: `frigade-web/src/components/buttons/dropdown-flow-actions.tsx:49-90` (`copyToProdFromScratch`).

**Call 1 — create prod flow** (per `rest-endpoints.md` §"POST /v1/flows/"):

```bash
# Build the body with jq to avoid shell-quoting bugs around multi-line YAML
BODY=$(jq -n \
  --arg slug "$SLUG" \
  --arg name "$NAME" \
  --arg description "$DESCRIPTION" \
  --arg type "$TYPE" \
  --arg data "$DATA" \
  --arg codeSnippet "$CODE_SNIPPET" \
  --arg targetingLogic "$TARGETING_LOGIC" \
  '{slug: $slug, name: $name, description: $description, type: $type, data: $data, codeSnippet: $codeSnippet, targetingLogic: $targetingLogic, active: false}')

curl -sS -X POST "https://api3.frigade.com/v1/flows" \
  -H "Authorization: Bearer $FRIGADE_API_KEY_SECRET_PROD" \
  -H "Content-Type: application/json" \
  -d "$BODY" \
  -w "\n---HTTP_STATUS:%{http_code}---\n"
```

Notes:
- **Body matches the dashboard's `createFlow(...)` signature in `frigade-web/src/data/api/flows.ts:143-166`** — the dashboard passes `active: false` on first-time copy (so the user can review the prod flow before it goes live, then either this recipe or the user activates it).
- `targetingLogic` may be `null` / empty string — preserve dev's value as-is; don't force a default.
- **Do NOT pass `internalData`, `id`, `version`, `status`, `createdAt`, `modifiedAt`** — those are server-managed. `rest-endpoints.md` §"POST /v1/flows/" only accepts the `CreateFlowDto` fields listed there.

Response handling (per `errors.md`):

| Status | Action |
|---|---|
| `201` (or `200`) | Extract the new prod flow's numeric `id`. Record as `$NEW_PROD_ID`. Proceed to Call 2 (activate) or skip it per Step 4.3. |
| `400` "already exists" | Synthetic 409 — Step 1.5 should have caught this, but if it slipped through, treat as an orphan-pair situation (Step 5.1). |
| `400` array message | DTO validation. Parse each entry; attempt one auto-correction (common: a `type` value that ended up as a lowercase string, or `data` passed as an object instead of a string). Show the diff and retry once. |
| `401` | Ownership/cross-env — the prod key somehow doesn't belong to the expected prod workspace. Halt. |
| `403` | Bad/revoked prod key per **D28**. Halt; route user to re-verify `FRIGADE_API_KEY_SECRET_PROD`. |
| `429` | MAU cap (prod org). Halt; no retry per **D29**. |
| `5xx` / network | Retry once after 1s. On second failure, halt with timestamp. |

Log the `promote-to-prod:create-prod-flow-ok` event (or `...:create-prod-flow-failed`) with dev slug, dev `modifiedAt` SHA (stable input hash — see 4.4), response status, new prod id on success. Redact the Authorization header.

**Call 2 — activate prod flow** (conditional):

Skip this call if dev's `active == false`. If dev was active:

```bash
curl -sS -X PUT "https://api3.frigade.com/v1/flows/$NEW_PROD_ID/activate" \
  -H "Authorization: Bearer $FRIGADE_API_KEY_SECRET_PROD" \
  -H "Content-Type: application/json" \
  -d '{"archiveBehavior":"EXIT_EXISTING_USERS"}' \
  -w "\n---HTTP_STATUS:%{http_code}---\n"
```

Default `archiveBehavior`: `EXIT_EXISTING_USERS` (safest — users who have already seen the flow won't be re-targeted). Per `rest-endpoints.md` §"PUT /v1/flows/:id/activate", the other values are `RESTART_EXISTING_USERS` and `RESTART_ALL_USERS` — offer them only if the user explicitly asks ("restart all users for this announcement").

Response handling:

| Status | Action |
|---|---|
| `200` | Prod flow is now active. Proceed to Step 4.5 (per-flow verify). |
| `500` with body `{message: "...no draft..."}` | Rare — the activate endpoint expects a draft. On CREATE, the flow is a draft by default, so this shouldn't fire; if it does, investigate by re-fetching the flow. |
| `401` / `403` | Same as Call 1. |
| `5xx` / network | Retry once; on second failure, record an `activation-failed` partial state (flow created but not activated — see Step 5.2). |

### 4.2 — UPDATE path

Canonical dashboard source: `frigade-web/src/components/dialogs/dialog-copy-flow-to-prod.tsx:93-127` (`handleCopyOverwrite`).

The dashboard offers two buttons — "Overwrite existing" and "Create new draft". This recipe defaults to **Overwrite existing** because it's idempotent (two back-to-back promotions produce the same prod state) and doesn't leave dangling drafts. If the user explicitly asks for "create a new draft version" behavior (rare in skill usage), surface that as an option before confirming — see Step 4.2b for the variant.

**Call 1 — update prod flow** (per `rest-endpoints.md` §"PUT /v1/flows/:numericFlowId"):

`$PROD_TARGET_ID` is the prod sibling's numeric id — either `productionDraftFlowId` if set, else `productionActiveFlowId` (both values are recorded in Step 1.3).

```bash
BODY=$(jq -n \
  --arg name "$NAME" \
  --arg description "$DESCRIPTION" \
  --arg data "$DATA" \
  --arg codeSnippet "$CODE_SNIPPET" \
  --arg targetingLogic "$TARGETING_LOGIC" \
  '{name: $name, description: $description, data: $data, codeSnippet: $codeSnippet, targetingLogic: $targetingLogic}')

curl -sS -X PUT "https://api3.frigade.com/v1/flows/$PROD_TARGET_ID" \
  -H "Authorization: Bearer $FRIGADE_API_KEY_SECRET_PROD" \
  -H "Content-Type: application/json" \
  -d "$BODY" \
  -w "\n---HTTP_STATUS:%{http_code}---\n"
```

Notes:
- **Body matches `updateFlow(...)` in `frigade-web/src/data/api/flows.ts:226-243`** — the dashboard passes name, data, description, targetingLogic, type, triggerType, active. This recipe omits `type` and `triggerType` to keep the PUT narrow (those should not change during a content promotion; if they did change in dev, re-fetch the prod flow and surface a mismatch warning before proceeding). `active` is handled by the separate activate call in Call 2 (for clarity; the `updateFlow` DTO accepts it too but mixing content and activation in one PUT is harder to debug on failure).
- The PUT is against the **prod target id** (numeric), not the dev id. Passing a slug to this endpoint returns `null` → 404 per `rest-endpoints.md` §"PUT /v1/flows/:numericFlowId" — always use the numeric id.
- Every PUT creates an audit row in `changelogs` (per `rest-endpoints.md` note) — the dashboard Changelog view will show the promotion.

Response handling:

| Status | Action |
|---|---|
| `200` | Prod flow updated. Proceed to Call 2 (activate) or skip it per Step 4.3. |
| `400` array message | DTO validation — same handling as the CREATE path's 400-array. |
| `401` / `403` | Key-scope issues. Halt. |
| `404` | The `$PROD_TARGET_ID` doesn't exist in prod. This means the pairing info in dev was stale (prod flow was deleted out-of-band). Halt for this flow and offer: "The prod flow I expected to update (`<id>`) doesn't exist. Re-classify as CREATE and promote from scratch? (y/n)" On `y`, fall through to Step 4.1. |
| `429` | MAU cap; halt. |
| `5xx` / network | Retry once; on second failure, halt. |

Log a `promote-to-prod:update-prod-flow-ok` (or `...-failed`) event with dev slug, prod target id, path variant (`UPDATE-draft` or `UPDATE-active`), response status.

**Call 2 — activate prod flow** (conditional):

The activation rule depends on the path variant:

| Variant | Dev active? | Prod target is draft or active? | Action |
|---|---|---|---|
| UPDATE-draft | `true` | `draft` | Call `PUT /v1/flows/<prod-target-id>/activate` — this publishes the (now-overwritten) draft. |
| UPDATE-draft | `false` | `draft` | Skip. The draft stays a draft. |
| UPDATE-active | `true` | `active` | Skip. The live version was overwritten in place; it's still active. |
| UPDATE-active | `false` | `active` | Call `PUT /v1/flows/<prod-target-id>` with `{ active: false }` to deactivate (see `operations.md` §"deactivateFlow"). This is the "dev was deactivated, propagate to prod" path. |

The skip cases are the common ones. The first row (publish an updated prod draft) and the fourth (deactivate a live prod flow) are the rare ones — both are per-op `dangerous` in prod (see `operations.md`). Since the batch confirmation in Step 2 covered the whole promotion as a single `dangerous` action, do NOT re-prompt per sub-op; the top-level confirmation authorized the side effects.

```bash
# Activate (UPDATE-draft + dev was active)
curl -sS -X PUT "https://api3.frigade.com/v1/flows/$PROD_TARGET_ID/activate" \
  -H "Authorization: Bearer $FRIGADE_API_KEY_SECRET_PROD" \
  -H "Content-Type: application/json" \
  -d '{"archiveBehavior":"EXIT_EXISTING_USERS"}' \
  -w "\n---HTTP_STATUS:%{http_code}---\n"
```

```bash
# Deactivate (UPDATE-active + dev was deactivated)
curl -sS -X PUT "https://api3.frigade.com/v1/flows/$PROD_TARGET_ID" \
  -H "Authorization: Bearer $FRIGADE_API_KEY_SECRET_PROD" \
  -H "Content-Type: application/json" \
  -d '{"active":false}' \
  -w "\n---HTTP_STATUS:%{http_code}---\n"
```

Log the activation (or skip) decision per flow: `promote-to-prod:activation-decision` with slug, path variant, dev active, prod pre-call status, action taken.

### 4.2b — "Create new draft" variant (rare)

If the user explicitly prefers the dashboard's "Create new draft" behavior — which leaves the currently-live prod flow untouched and adds a new prod draft that the user must manually activate in the dashboard — the sequence is:

1. `POST /v1/flows/<productionActiveFlowId>/versions` with prod key, body `{}` → returns the new draft `Flow` row (`status=DRAFT`, version incremented, same slug).
2. `PUT /v1/flows/<new-draft-id>` with prod key — update with dev's content (same body shape as Call 1 above).

No activation call. The user reviews the new draft in the prod dashboard and publishes when ready.

This variant is not the default because it decouples "push content" from "make it live" — which is good for careful rollouts but confusing when the user says "promote to prod" and expects the change to be visible. Only invoke this variant when the user's prompt includes phrasing like "promote as draft", "create a new prod draft", or "don't activate yet". Otherwise stick with Step 4.2's Overwrite path.

### 4.3 — Skipping activation

Skip the activation call (Step 4.1 Call 2 / Step 4.2 Call 2) when any of the following is true:

- Dev's `active == false` AND prod target is already at the desired active state (see Step 4.2 table — only the UPDATE-active + dev-false case requires an explicit deactivate).
- Dev's `active == true` AND the UPDATE-active path — the overwrite already left prod active.

Log an `activation-skipped` event with the reason (`dev-inactive`, `prod-already-active`, `no-op`).

### 4.4 — Stable dev input SHA (for logs)

For every promotion, record a short SHA of the dev flow's input payload:

```bash
SHA=$(printf '%s' "$NAME$DATA$TARGETING_LOGIC$CODE_SNIPPET$DESCRIPTION" | shasum -a 256 | cut -c1-8)
```

This is a fingerprint of what the dev flow looked like at promote time — useful when the user asks "what state did I promote last Tuesday?" against the skill log. Redact the raw `$DATA` / `$CODE_SNIPPET` values from the log entry itself (they can be multi-megabyte YAML); only the SHA goes in.

### 4.5 — Per-flow verify (inline)

After both calls complete for a flow, re-fetch the prod sibling and assert content parity:

```bash
curl -sS "https://api3.frigade.com/v1/flows/$PROD_TARGET_ID_OR_NEW_ID" \
  -H "Authorization: Bearer $FRIGADE_API_KEY_SECRET_PROD" \
  -w "\n---HTTP_STATUS:%{http_code}---\n"
```

Assertions (all on the response body):
- `data` string equals dev's `data`. (Server may normalize JSON → YAML, so do the comparison after normalization if possible; otherwise accept a lossless round-trip.)
- `name` equals dev's `name`.
- `active` matches the expected state (per Step 4.2 table).
- `status` is `ACTIVE` if dev was active, `DRAFT` otherwise (unless UPDATE-active + dev-active, in which case it's `ACTIVE`).

On any assertion failure, log a `promote-to-prod:verify-mismatch` event and surface a warning in Step 6's report — do NOT auto-remediate (the user decides whether to re-run). The promotion may still be "successful" if only a non-critical field differs.

---

## Step 5 — Partial-failure handling (D16)

Per **D16** and `errors.md` §"Composite operation failures": preserve upstream state on failure. Do NOT auto-delete prod flows. Report what happened; offer recovery; let the user decide.

Two categories of partial failure matter here:

### 5.1 — Cross-env orphan state (within a single flow's promotion)

The canonical bad state: Step 4.1 Call 1 (`POST /v1/flows` prod) **succeeded** — a new prod flow exists with some numeric id — but a later step in the same flow's promotion sequence failed (e.g. Step 4.1 Call 2 activate returned 5xx after two retries). In this case:

- **Prod state:** a new flow exists with `active: false` (draft), with dev's content.
- **Dev state:** the dev flow's `internalData.productionDraftFlowId` or `productionActiveFlowId` — populated server-side — now references the new prod flow on the next dev fetch. (If, for some reason, the backend hasn't propagated the pairing yet, a subsequent re-run of this recipe will either re-find it via Step 1.5 or issue a duplicate POST and fail with 400-already-exists — which is recoverable.)

Report this with specifics, per `errors.md` §"Reporting partial failures":

```
Completed for welcome-to-my-product:
✅ Created prod flow: welcome-to-my-product (id: <new-prod-id>) — https://app.frigade.com/flows/welcome-to-my-product?env=prod

Failed at step 4.1 Call 2 for welcome-to-my-product (of <total> flows in batch):
❌ Could not activate prod flow (PUT /v1/flows/<new-prod-id>/activate).
   Reason: <specific — e.g. "prod API returned 500 twice in a row; no detail echoed. Check backend-app logs / Sentry with timestamp <ISO>.">
   Rolled back: nothing — the prod flow was created successfully before activation failed.
   Preserved (not rolled back): the prod flow exists at id <new-prod-id>; it's in DRAFT status.

Upstream state preserved:
- Prod flow welcome-to-my-product exists (id: <new-prod-id>, status: DRAFT). Dev flow is unchanged.

Recovery options:
  1. Retry activation only — I'll re-issue PUT /v1/flows/<new-prod-id>/activate. Idempotent: if the flow is already active, this will succeed. (preferred)
  2. Leave as draft — the content is in prod but users won't see it. Open the prod dashboard (link above) to activate manually when ready.
  3. Delete the created prod flow and re-run this promotion from scratch — I'll call DELETE /v1/flows/<new-prod-id> after the canonical confirmation, then retry the whole sequence. (dangerous — per operations.md Flow delete row; requires explicit y/yes before the DELETE fires)
  4. Leave things as they are — the prod flow exists but isn't active. You can re-run the recipe later; it'll take the UPDATE path next time.

Which would you like? (1/2/3/4)
```

All four options are always offered. Option (1) is the preferred recovery — it's idempotent and doesn't require destructive ops. Option (3) is the destructive recovery; it emits the canonical "Flow delete" confirmation from `operations.md` before running the DELETE, per **D16** rule 4.

Do NOT continue to the next flow in the batch without user input on this flow. The batch continues after the user resolves this one (or explicitly says "skip this flow and continue the batch").

### 5.2 — Batch partial (across flows)

If 2 of 3 flows promote successfully and the 3rd fails, report each flow's outcome separately. Do NOT roll back the first two — they're already live in prod; rolling back would be a destructive recovery requiring its own confirmations.

Batch-partial report template:

```
Batch promotion result: <n-success> of <n-total> flows promoted.

Promoted successfully:
✅ welcome-to-my-product — CREATE path → prod id <new-id-1>, active. https://app.frigade.com/flows/welcome-to-my-product?env=prod
✅ welcome-tour          — UPDATE path → prod id <id-2>, active. https://app.frigade.com/flows/welcome-tour?env=prod

Failed:
❌ checkout-banner       — UPDATE path failed at step 4.2 Call 1 (PUT /v1/flows/<id-3>).
   Reason: <specific>.
   Prod state: unchanged (the failing PUT did not persist a partial write per rest-endpoints.md §"PUT /v1/flows/:numericFlowId").
   Dev state: unchanged.

Recovery options for the failed flow:
  1. Retry checkout-banner only — I'll re-run Step 4.2 for just that flow.
  2. Leave the 2 successful flows promoted; skip checkout-banner. You can retry later.
  3. Roll back the 2 successful flows — I'd need to UPDATE them back to their pre-batch state, which requires re-fetching the pre-batch prod content from the changelogs (not trivial; available via the GraphQL changelog query with dashboard-session auth — skill may not be able to reliably do this). Usually not worth it.

Which would you like? (1/2/3)
```

Option (3) is listed but explicitly flagged as "usually not worth it" — changelog-based rollback requires surface the skill can't cleanly reach with an API key alone (see `graphql-schema.md` §changelog — which is dashboard-auth scoped). In most cases the user picks (1) or (2).

### 5.3 — Composite failure rules (recap)

Per `errors.md` §"Partial failure rules" / **D16**:

1. **Cross-env atomicity is NOT provided** — the recipe explicitly tells the user when state diverges. See 5.1.
2. **Upstream Frigade state is preserved.** Never silently DELETE a created prod flow as recovery. Destructive recovery is always an explicit, confirmed choice (Option 3 in 5.1, emits the canonical "Flow delete" confirmation).
3. **Idempotency on re-run.** A second invocation with the same slug list:
   - Re-classifies each flow (Step 1.4). CREATE flows whose prod sibling now exists will reclassify to UPDATE. This is the "re-run after partial" recovery path — the recipe "heals" itself.
   - Re-verifies Step 1.5 for any remaining CREATE flows.
4. **Never run destructive ops as silent recovery** (as (2)).
5. **Log every cross-env step** to `.frigade/skill.log` per **D17**, with the `Authorization` header redacted. Required fields per entry: `timestamp`, `op` (e.g. `promote-to-prod:step-4.1-call-1`), `flowSlug`, `path` (`CREATE` / `UPDATE-draft` / `UPDATE-active`), `devId`, `prodId` (if known), `devSha` (4.4), `response.status`, `response.body` (minus the data YAML — too big; include a SHA of the response body's `data` field instead), `recovery` (what action was taken on failure).

---

## Step 6 — Verify and report

After all promotions complete (successfully or with documented partial failures), do a final verify pass and emit the success report.

### 6.1 — Final verify (per successful flow)

Already done inline per-flow in Step 4.5. Gather the results.

### 6.2 — Success report template

For a fully-successful batch:

```
✅ Promoted <n> flows to production:
   - welcome-to-my-product: https://app.frigade.com/flows/welcome-to-my-product?env=prod
   - welcome-tour:          https://app.frigade.com/flows/welcome-tour?env=prod
   - checkout-banner:       https://app.frigade.com/flows/checkout-banner?env=prod

Verify in the prod dashboard. If anything looks wrong, you can:
 - Re-promote after fixing in dev (safe; same recipe — it'll take the UPDATE path next time).
 - Roll back a specific flow: ask me to deactivate <slug> in prod.
```

### 6.3 — URL format note

The prod dashboard URL format is `https://app.frigade.com/flows/<slug>?env=prod` — Frigade's UI uses the `env` query param to switch between dev and prod views of the same workspace account (the dashboard session holds both org bindings via Clerk). If the actual Frigade UI uses a different routing scheme (e.g. `/prod/flows/<slug>` path prefix) at build-time, verify once against the live dashboard and update this recipe. The `?env=prod` form is the safer default — it degrades to a regular flow page if the query param is unrecognized.

### 6.4 — Report with verify warnings

If Step 4.5's verify found a field mismatch (e.g. `targetingLogic` got normalized by the server differently than expected), include a warning block:

```
✅ Promoted <n> flows to production (with <m> verification warnings):
   - welcome-to-my-product: https://app.frigade.com/flows/welcome-to-my-product?env=prod
   - welcome-tour:          https://app.frigade.com/flows/welcome-tour?env=prod [verify warning — see below]

Verification warnings:
  - welcome-tour: post-promote `targetingLogic` differs from dev's. Dev has `user.property('isAdmin') == true`;
    prod has `user.property("isAdmin") == true` (quotes normalized). Functionally equivalent; no action needed
    unless you spot a concrete behavior difference in the dashboard.
```

Most warnings are benign normalization. Surface them anyway so the user can sanity-check.

### 6.5 — Log the success

Append a `promote-to-prod:success` event per flow to `.frigade/skill.log` (per **D17**) with: slug, path, devId, prodId, devSha, `active` final state, prod URL, Authorization redacted.

If the batch was partial, the per-flow failure events from Step 5 already went in the log; append a final `promote-to-prod:batch-complete` summary event with counts (total, successful, failed) and the list of failed slugs.

---

## Worked example — Eric's dogfood loop, promotion step

Continuing from the dogfood worked examples in `recipes/create-announcement.md` and `recipes/create-tour.md`:

**Prior state:**
- `welcome-to-my-product` (ANNOUNCEMENT) exists in dev, active, mounted, linked to the tour.
- `welcome-tour` (TOUR) exists in dev, active, mounted.
- Neither flow has a prod sibling yet (first-time promotion for both).
- `.env.local` has both dev and prod keys; `.frigade/project.json` has `workspaceId` and `prodWorkspaceId`.

**User's prompt:**

> "Promote both flows to prod."

**Claude's actions:**

1. **Pre-conditions.** Section 1 of `first-run-setup.md` passes silently. Both `$FRIGADE_API_KEY_SECRET` and `$FRIGADE_API_KEY_SECRET_PROD` are in the shell. Proceed.

2. **Step 1 — parse intent.** Prompt names two slugs explicitly: `welcome-to-my-product` and `welcome-tour`. Batch of two. No "all" expansion needed.

3. **Step 1.3 — fetch each dev flow:**
   ```bash
   curl -sS "https://api3.frigade.com/v1/flows/welcome-to-my-product" \
     -H "Authorization: Bearer $FRIGADE_API_KEY_SECRET"
   # → 200, active: true, internalData.productionDraftFlowId: null, productionActiveFlowId: null

   curl -sS "https://api3.frigade.com/v1/flows/welcome-tour" \
     -H "Authorization: Bearer $FRIGADE_API_KEY_SECRET"
   # → 200, active: true, internalData.productionDraftFlowId: null, productionActiveFlowId: null
   ```

4. **Step 1.4 — classify.** Both flows: **CREATE path** (no pairs set).

5. **Step 1.5 — slug collision pre-check in prod:**
   ```bash
   curl -sS "https://api3.frigade.com/v1/flows/welcome-to-my-product" \
     -H "Authorization: Bearer $FRIGADE_API_KEY_SECRET_PROD"
   # → 404 (slug is free in prod)

   curl -sS "https://api3.frigade.com/v1/flows/welcome-tour" \
     -H "Authorization: Bearer $FRIGADE_API_KEY_SECRET_PROD"
   # → 404 (slug is free in prod)
   ```

6. **Step 2 — confirmation prompt:**
   ```
   About to promote flows to production:

     - welcome-to-my-product (new in prod) — will CREATE prod flow
     - welcome-tour          (new in prod) — will CREATE prod flow

   Sequence per flow:
     - CREATE path: POST /v1/flows (prod key) → PUT /v1/flows/<new-id>/activate (both dev flows are active).

   This updates live prod flows and will be visible to users immediately.
   Confirm? (y/n)
   ```
   User: `y`.

7. **Step 3 — order.** Both are CREATE; alphabetical: `welcome-to-my-product`, then `welcome-tour`.

8. **Step 4.1 for `welcome-to-my-product`:**
   - Call 1 — `POST /v1/flows/` with prod key, body containing slug, name, type=ANNOUNCEMENT, data (the YAML), codeSnippet (empty), targetingLogic (empty), active: false. → 201, new prod id `555001`.
   - Call 2 — `PUT /v1/flows/555001/activate` with prod key, `archiveBehavior: "EXIT_EXISTING_USERS"`. → 200.
   - Step 4.5 verify — `GET /v1/flows/555001` (prod key); `data` matches dev, `active: true`, `status: ACTIVE`. OK.
   - Log `promote-to-prod:success` for this flow.

9. **Step 4.1 for `welcome-tour`:**
   - Call 1 — `POST /v1/flows/` with prod key, body containing slug, name, type=TOUR, data (the YAML), codeSnippet, targetingLogic, active: false. → 201, new prod id `555002`.
   - Call 2 — `PUT /v1/flows/555002/activate` with prod key. → 200.
   - Step 4.5 verify — all OK.
   - Log `promote-to-prod:success` for this flow.

10. **Step 6 report:**
    ```
    ✅ Promoted 2 flows to production:
       - welcome-to-my-product: https://app.frigade.com/flows/welcome-to-my-product?env=prod
       - welcome-tour:          https://app.frigade.com/flows/welcome-tour?env=prod

    Verify in the prod dashboard. If anything looks wrong, you can:
     - Re-promote after fixing in dev (safe; same recipe — it'll take the UPDATE path next time).
     - Roll back a specific flow: ask me to deactivate <slug> in prod.
    ```

11. **Log** `promote-to-prod:batch-complete` with counts `{ total: 2, successful: 2, failed: 0 }`.

Eric now opens the prod dashboard, confirms both flows render correctly for his prod users, and the dogfood cross-env story closes. The second time he promotes these same flows after dev edits, Step 1.4 will classify them as UPDATE (Overwrite existing) — idempotent, no drama.

---

## Gotchas uncovered

Notes surfaced during recipe authoring that aren't obvious from the surface API alone. Capture here so future versions of this recipe don't re-learn them.

- **Slug uniqueness is per-organization, not globally unique across envs.** The same slug can exist in both the dev org and the prod org — that's exactly how the pairing works. Do not try to "make the slug unique across envs" — it's intentional that they match.
- **Pairing fields (`productionDraftFlowId` / `productionActiveFlowId`) are server-derived, not client-set.** The skill does not write them. The backend populates them on dev flow reads when a sibling prod flow exists with the same slug (see `rest-endpoints.md` §"GET /v1/flows/:id" §Types). A fresh promotion won't see the pairing update until the next dev GET — this is why Step 5.3 mentions "the recipe heals itself" on re-run.
- **`PATCH` is not supported on any endpoint** — use `PUT /v1/flows/:numericFlowId` for partials. Per `rest-endpoints.md` conventions, the CORS policy allows GET/POST/PUT/DELETE/OPTIONS only. Omitted fields in a PUT body are treated as "no change".
- **Dashboard's `updateFlow` passes `active` in the PUT body** (see `frigade-web/src/data/api/flows.ts:226-243`); this recipe deliberately keeps content and activation as separate calls (Step 4.2's Call 1 omits `active`; Call 2 handles it via the dedicated `/activate` endpoint). Two advantages: clearer log lines on failure, and the `/activate` endpoint runs archival side effects that a bare `PUT` doesn't.
- **`POST /v1/flows/:id/versions` returns a new `DRAFT` row with a freshly-assigned numeric id** (see `rest-endpoints.md` §"POST /v1/flows/:id/versions"). The new id replaces the old one in every subsequent call for that version. This is relevant if the "Create new draft" variant (4.2b) is invoked — record the new id immediately.
- **`type` and `triggerType` changes across envs are rare but possible.** If a dev flow's `type` changed (e.g. someone accidentally repurposed an ANNOUNCEMENT into a TOUR), a PUT that doesn't include `type` will leave prod's `type` unchanged — leading to a dev/prod shape mismatch. Step 4.2's verify (Step 4.5) will flag this; surface the warning in the report. If it's a real change, re-promote with `type` in the PUT body.
- **Version numbers are not promoted.** Each environment's flow has its own version counter. A dev flow at `version: 5` promoting into prod may create a prod flow at `version: 1` (CREATE) or increment prod's own counter (UPDATE). Do not try to align versions across envs — it will break the server's bookkeeping.
- **Activation with no draft throws 500** per `rest-endpoints.md` §"PUT /v1/flows/:id/activate" ("If no draft exists for the flow id you pass, the service throws"). This is why Step 4.2's activation call runs against `productionDraftFlowId` only (not `productionActiveFlowId`) — the active row has no draft to publish. The UPDATE-active + dev-active case relies on the in-place PUT leaving the flow active; no separate activate is needed or possible.
- **Cross-env partial state is the highest-risk failure mode.** A POST-then-activate pair where only the POST succeeds leaves an orphan draft in prod. The recipe's Step 5.1 explicitly surfaces this as a named state with four recovery options, three of which are non-destructive (preferred).
- **`403` on the prod side mid-sequence after `200` on the dev side** usually means the prod key is invalid/revoked; don't auto-retry with the dev key (that would cross-env-leak a write). Halt per **D28**.
- **`401` on the prod-side PUT against an id that came from dev's `internalData`** means the pairing points at a prod flow the prod key can't reach (e.g. the prod flow was moved to a different org, or the pairing info is stale by months). Step 4.2's 401 path halts and surfaces the cross-env mismatch — do not retry.
- **Dashboard shows two buttons ("Overwrite existing" vs "Create new draft"); this recipe defaults to Overwrite.** That's the simpler and more idempotent path. The "Create new draft" variant (Step 4.2b) exists for careful rollouts but shouldn't be the default — users who want it will ask.
