# Recipe: First-Run Setup

**This is the entry-point recipe. Every other recipe's pre-conditions block says "run `first-run-setup` first" — so Claude runs Section 1 of this recipe at the start of every skill invocation.** The work is idempotent: if the repo is already bound and the keys are already in place, Section 1 is a silent no-op and control returns to the caller. If any piece is missing, Section 2 / 3 / 4 handles recovery.

Referenced decisions: **D06** (keys in per-project `.env.local`), **D07** (four env vars; private keys never enter client code), **D08** (new vs existing Frigade user paths), **D13** (committed `.frigade/project.json` marker + binding check on every invocation), **D17** (`.frigade/skill.log` diagnostic log), **D21** (`.gitignore` hygiene), **D27** (verify key↔workspace via `GET /v1/apiKeys`, not `/v1/me`), **D28** (403 is "bad key", 401 is ownership).

Companion refs: `reference/rest-endpoints.md` (`/v1/apiKeys` contract), `reference/errors.md` (403/401 handling).

---

## Flow at a glance

```
┌─────────────────────────────────────────────────────────────────┐
│ Every skill invocation: run Section 1 (binding-state check)     │
│                                                                 │
│   marker present?   keys present?    resolution                 │
│   ──────────────    ─────────────    ──────────                 │
│      yes               yes (match)   → proceed silently         │
│      yes               yes (diff)    → Section 3 (mismatch)     │
│      yes               no            → Section 4 (rehydrate)    │
│      no                yes           → confirm + Section 2 fast │
│      no                no            → Section 2 (full onboard) │
└─────────────────────────────────────────────────────────────────┘

After Section 1 resolves, every API call: run Section 5
(pick dev vs prod key pair based on target env).
```

Claude: read sections in order, stop as soon as the current state is satisfied, then yield back to the caller. Do not execute later sections when an earlier section has already resolved the state.

---

## Section 1 — Idempotent state check (run every invocation)

**Run this before any API call, every time the skill is invoked, including the second and third commands within a single conversation.** The check is cheap (one file read, one env peek, at most one `curl`) and it catches cross-repo drift that would otherwise silently operate on the wrong workspace.

### Step 1.1 — Read the marker

Check whether `.frigade/project.json` exists in the current working directory.

- If yes → parse it; extract `workspaceId` (dev), `prodWorkspaceId`, `defaultEnvironment`.
- If no → set `marker = null`.

### Step 1.2 — Read the keys from `.env.local`

Check whether `.env.local` exists in the current working directory. If it does, look for:

- `NEXT_PUBLIC_FRIGADE_API_KEY` — dev public
- `FRIGADE_API_KEY_SECRET` — dev private
- `NEXT_PUBLIC_FRIGADE_API_KEY_PROD` — prod public (optional)
- `FRIGADE_API_KEY_SECRET_PROD` — prod private (optional)

Record which ones are present. Do NOT echo any private key value back to the user.

### Step 1.3 — Decide the state

| Marker | Keys | Next action |
|---|---|---|
| present | present, match marker | **proceed silently** (skip Section 2-4; go to caller via Section 5) |
| present | present, mismatch | **Section 3** |
| present | absent | **Section 4** |
| absent | present | prompt "Bind this repo to the workspace these keys target?", then **Section 2 fast path** (skip onboarding steps 1-6, verify keys and write marker only) |
| absent | absent | **Section 2** (full onboarding) |

### Step 1.4 — Verifying "match marker" (for the first row)

"Match marker" means: the `FRIGADE_API_KEY_SECRET` in `.env.local` belongs to the `workspaceId` in `.frigade/project.json`. Confirm by calling `GET /v1/apiKeys` with the secret key and checking that the matching key record's `organizationId` equals the marker's `workspaceId`:

```bash
curl -sS "https://api3.frigade.com/v1/apiKeys" \
  -H "Authorization: Bearer $FRIGADE_API_KEY_SECRET"
```

Interpretation:
- **200** with `data: [...]` containing a key whose `key` field equals `FRIGADE_API_KEY_SECRET` and whose `organizationId` equals `marker.workspaceId` → match. Proceed silently.
- **200** but `organizationId` does not equal `marker.workspaceId` → go to **Section 3**.
- **403 Forbidden** → the key is invalid or revoked (per **D28**). Report to user: "Your dev private key (`FRIGADE_API_KEY_SECRET`) was rejected by Frigade (403). Re-check it at https://app.frigade.com/settings/api and re-run, or choose to rebind." Halt.
- **401 Unauthorized** → narrower ownership error (per **D28**); surface the message verbatim and halt.
- **Network error / 5xx** → halt with "couldn't reach Frigade to verify key binding; try again."

**Important:** Compare key identity by matching `apiKey.key` to the secret you have (from `.env.local`). Do not rely on pattern-guessing. The `key` field in the `/v1/apiKeys` response is the full secret value (see `reference/rest-endpoints.md` — treat the response body with care, do not log it wholesale).

### Step 1.5 — Proceed silently

If the match holds, return to the caller immediately. Do NOT print "setup OK" — silent success is the goal. The skill log (`.frigade/skill.log`) is the right place for a timestamped `binding_verified` entry if logging is enabled; that entry must redact the `Authorization` header and replace the raw key with `<REDACTED>` (per **Hard rules** below).

---

## Section 2 — Full first-run onboarding

For the "marker absent / keys absent" case. Also reused partially for the "marker absent / keys present" confirm-and-write-marker fast path (skip to 2.7 in that case).

### Step 2.1 — Orientation

Print this (or a close variant — keep to ~3-4 lines):

> This is the Frigade Engage skill. It'll help you build and manage Frigade flows (announcements, tours, checklists, etc.) from the terminal. To get started I need your Frigade API keys for this project; they'll be written to `.env.local` (gitignored) and the workspace binding will be saved to `.frigade/project.json` (safe to commit).

### Step 2.2 — Existing vs new Frigade account (per D08)

Ask:

> Do you already have a Frigade account? (y/n)

- **Yes** → continue to 2.3.
- **No** → print `https://app.frigade.com/signup`; say "Sign up there, create your workspace, then come back and re-run this skill — I'll pick up from here." Halt for this invocation.

### Step 2.3 — Collect dev keys

Say (one prompt at a time, let the user paste each):

> Go to https://app.frigade.com/settings/api (dev environment). Paste your **DEV PUBLIC key** (starts with `api_public_`):

Wait for input. Store in a transient variable (e.g. `$DEV_PUBLIC`) — do NOT print it back.

> Paste your **DEV PRIVATE key** (starts with `api_private_`):

Wait for input. Store as `$DEV_PRIVATE`. Confirm acceptance without echoing:

> Dev private key accepted (starts with `api_priv...`, length ok).

(Show only the first 9 characters at most, then `...`.)

### Step 2.4 — Offer prod keys (optional)

Ask:

> Would you also like to add PROD keys now? (y/n) You can always add them later; they're required for any promote-to-prod or prod-targeted operation.

- **Yes** → ask for prod public, then prod private (same mask-on-accept pattern); store as `$PROD_PUBLIC` and `$PROD_PRIVATE`.
- **No** → leave prod keys unset for now. Section 5 will resume onboarding for prod keys when the user first targets a prod op.

### Step 2.5 — `.gitignore` hygiene (D21)

Check `.gitignore` in the repo root:

- **Doesn't exist** → create it with these entries (minimum):
  ```
  .env.local
  .env.*.local
  .frigade/skill.log
  ```
- **Exists but doesn't cover `.env.local`** → ask:
  > Your `.gitignore` doesn't exclude `.env.local`. Add it? (y/n)
  - **Yes** → append `.env.local`, `.env.*.local`, and `.frigade/skill.log` (if missing).
  - **No** → halt: "Refusing to write private keys to `.env.local` while it's not gitignored. Add it manually and re-run."
- **Exists but doesn't cover `.frigade/skill.log`** → append it silently (no prompt — the log is not key material, but leaking it is still undesirable).

### Step 2.6 — Write keys to `.env.local` (D06, D07)

- If `.env.local` doesn't exist, create it.
- If it exists, **append** the Frigade block; do NOT overwrite existing variables from other integrations.

Block to write:

```
# Frigade Engage (managed by frigade-engage skill — do not commit)
NEXT_PUBLIC_FRIGADE_API_KEY=<DEV_PUBLIC value>
FRIGADE_API_KEY_SECRET=<DEV_PRIVATE value>
```

If prod keys were provided in 2.4, append (in the same block):

```
# Optional: prod env vars
NEXT_PUBLIC_FRIGADE_API_KEY_PROD=<PROD_PUBLIC value>
FRIGADE_API_KEY_SECRET_PROD=<PROD_PRIVATE value>
```

If a Frigade block already exists (e.g. partial prior run), update the matching lines in place rather than duplicating.

After writing, confirm to the user:

> Wrote dev keys to `.env.local` (gitignored).

### Step 2.7 — Verify keys via `GET /v1/apiKeys` (D27)

For the dev private key, run:

```bash
curl -sS -w "\n---HTTP_STATUS:%{http_code}---\n" \
  "https://api3.frigade.com/v1/apiKeys" \
  -H "Authorization: Bearer $DEV_PRIVATE"
```

(Use a Bash heredoc or env export so the raw key does not appear in tool-call argument text visible to the user — see **Hard rules**.)

Interpretation:

- **200** with a `data` array → find the entry whose `key` equals `$DEV_PRIVATE`. Read its `organizationId` — that's the dev workspace ID. Record it as `$DEV_WORKSPACE_ID`.
- **200** but no matching entry → halt: "The key I verified doesn't appear in the org's key list; re-paste your key." Re-prompt.
- **403** → per **D28**, bad/wrong-scope key. Halt: "Your dev private key was rejected (403). Double-check it at https://app.frigade.com/settings/api and re-run."
- **401** → per **D28**, ownership/scope edge case. Surface the server message verbatim and halt.
- **Network / 5xx** → "Couldn't reach Frigade; try again later." Halt.

If prod keys were provided in 2.4, repeat the call with `$PROD_PRIVATE` and record `$PROD_WORKSPACE_ID`. **Expect a different `organizationId`** than the dev one — prod env is a sibling org per **D23/D26**. If for some reason they match, surface the oddity but don't block: Frigade may have added unified-env support; note it and continue.

### Step 2.8 — Derive a display name (best effort)

The `/v1/apiKeys` response does not include a human workspace name (see `reference/rest-endpoints.md`). Ask:

> What would you like to call this workspace? (optional — press Enter to use "Unknown")

Store as `$WORKSPACE_NAME` (default: `"Unknown"`). Keep it short; it's only for display.

### Step 2.9 — Write the marker file (D13)

Create `.frigade/` directory if it doesn't exist. Write `.frigade/project.json`:

```json
{
  "workspaceId": "<DEV_WORKSPACE_ID>",
  "workspaceName": "<WORKSPACE_NAME>",
  "defaultEnvironment": "dev",
  "prodWorkspaceId": "<PROD_WORKSPACE_ID or null>",
  "boundAt": "<ISO 8601 timestamp, e.g. 2026-04-17T19:15:23.000Z>",
  "skillVersion": "0.0.1"
}
```

Notes on the schema:
- `workspaceId` is the dev org's `organizationId` from the `/v1/apiKeys` response — the string shape depends on Frigade's internal IDs; don't enforce a `ws_` prefix if the real value doesn't have one.
- `workspaceName` is user-supplied or `"Unknown"`; it's informational, not trusted.
- `defaultEnvironment` is always `"dev"` at onboarding; `prod` is a per-operation override (Section 5).
- `prodWorkspaceId` is `null` until the user adds prod keys (either here or via a later Section-5 resumption).
- `boundAt` is an ISO 8601 timestamp to help debug cross-repo drift.
- `skillVersion` tracks this skill's semver for forward-compat; bump when the schema changes.
- **Additional fields** (e.g. cached workspace feature flags, theme defaults) are out of scope for v1 — extend during dogfood if a real need appears.

### Step 2.10 — Ensure skill log is gitignored (D17)

Already handled in 2.5, but double-check: confirm `.gitignore` contains `.frigade/skill.log`. If it doesn't (e.g. pre-existing `.gitignore` was edited between steps), append it silently.

### Step 2.11 — Report success

Print (substituting real values):

> Bound to workspace **<WORKSPACE_NAME>** (`<DEV_WORKSPACE_ID>`). Dev keys in `.env.local`; marker at `.frigade/project.json` (safe to commit). Ready for Frigade operations.

Return to caller.

---

## Section 3 — Binding mismatch resolution

Triggered when `.frigade/project.json` is present but the `FRIGADE_API_KEY_SECRET` in `.env.local` points to a different `organizationId` than `marker.workspaceId`.

### Step 3.1 — Print the comparison

> Binding mismatch detected.
>
> Marker (`.frigade/project.json`) says: workspace **<marker.workspaceName>** (`<marker.workspaceId>`)
> `.env.local` key points to: workspace `<actual organizationId>`
>
> These don't match. Frigade operations from this repo would target the wrong workspace. How do you want to proceed?
>
> (1) **Use marker workspace** — paste keys that match `<marker.workspaceId>`; I'll overwrite the keys in `.env.local`.
> (2) **Rebind this repo** — keep the current keys; rewrite `.frigade/project.json` to point at `<actual organizationId>`. Collaborators on this repo will see the change on their next pull.
> (3) **Abort** — make no changes and stop.

### Step 3.2 — Handle the response

- **Response `1` (use marker workspace):**
  - Prompt the user for the dev private key that belongs to `marker.workspaceId`.
  - Verify via `GET /v1/apiKeys` as in Section 2.7; require `organizationId == marker.workspaceId`. If mismatch, re-prompt or abort on second failure.
  - Once verified, also prompt for the dev public key (since they go together).
  - Overwrite the Frigade block in `.env.local` with the new pair (preserve other env vars).
  - Report: "Keys updated. Repo still bound to workspace **<marker.workspaceName>**."
- **Response `2` (rebind repo):**
  - Re-verify the current `FRIGADE_API_KEY_SECRET` via `GET /v1/apiKeys`. Record the new `organizationId` and (optional) prompt for a new workspace name.
  - Rewrite `.frigade/project.json` with the new `workspaceId` / `workspaceName` / fresh `boundAt`. Preserve `prodWorkspaceId` if the prod keys still verify against the same prod org; otherwise null it and warn.
  - Report: "Rebound repo to workspace **<new name>** (`<new id>`). **You'll want to `git add .frigade/project.json && git commit`** so collaborators stay in sync. Warning: collaborators on this branch will see their binding shift on next pull."
- **Response `3` or anything else (abort):**
  - Report: "No changes made. Resolve the mismatch manually and re-run." Halt.

### Step 3.3 — Prod-key mismatch variant

If the mismatch is on the *prod* side only (dev matches marker, prod key points to a different `prodWorkspaceId`), scope the prompt to prod: "Your prod private key points to a different workspace than the marker's `prodWorkspaceId`. (1) re-paste prod keys for marker workspace (2) rebind prod field (3) abort."

---

## Section 4 — Marker present, no keys in `.env.local`

The repo was bound previously (marker exists) but someone cleared `.env.local`, or this is a fresh clone.

### Step 4.1 — Report what the marker says

> This repo is bound to workspace **<marker.workspaceName>** (`<marker.workspaceId>`) per `.frigade/project.json`, but no Frigade keys are currently in `.env.local`.

### Step 4.2 — Prompt for the key

> Paste your **dev private key** for this workspace (starts with `api_private_`):

Store as `$DEV_PRIVATE`. Also prompt:

> Paste your **dev public key** (starts with `api_public_`):

Store as `$DEV_PUBLIC`.

### Step 4.3 — Verify the key matches the marker

Call `GET /v1/apiKeys` with `$DEV_PRIVATE`. Expected: the matching `apiKey.organizationId` equals `marker.workspaceId`.

- **Match** → continue to 4.4.
- **Mismatch** → this is actually a Section 3 case in disguise; print a compact mismatch message and jump to Section 3.1 (the marker workspace is known; the pasted key just doesn't match).
- **403 / 401 / network error** → same handling as Section 2.7.

### Step 4.4 — Write `.env.local` and resume

- `.gitignore` check — rerun Section 2.5.
- Write the Frigade block into `.env.local` (same format as 2.6). Only dev keys for now; offer prod as a follow-up:
  > Also add PROD keys? (y/n) — can do later.
- If the marker already has `prodWorkspaceId` set and the user says yes, verify the pasted prod key's `organizationId` equals `marker.prodWorkspaceId` (enforce); otherwise jump to Section 3's prod-mismatch variant.

Report:

> Rehydrated `.env.local` for workspace **<marker.workspaceName>**. Ready for Frigade operations.

---

## Section 5 — Environment selection at call time

**Every recipe that makes an authenticated call runs this step.** It picks which private key to pass as `Authorization: Bearer ...`.

### Step 5.1 — Determine target environment

- Default target is `dev`.
- Target is `prod` when any of the following is true:
  - The user explicitly says "in prod", "production", "promote", "live", etc. in the triggering prompt.
  - The recipe's own contract specifies `prod` (e.g. `recipes/promote-to-prod.md` per **D26**).
  - The previous turn already resolved to prod and the user hasn't switched back.

If ambiguous, ask once: "Target dev or prod for this operation?" — default dev.

### Step 5.2 — Pick the key pair

| Target env | Secret used | Public used |
|---|---|---|
| dev | `FRIGADE_API_KEY_SECRET` | `NEXT_PUBLIC_FRIGADE_API_KEY` |
| prod | `FRIGADE_API_KEY_SECRET_PROD` | `NEXT_PUBLIC_FRIGADE_API_KEY_PROD` |

### Step 5.3 — Prod keys missing? Resume onboarding for prod only

If target is `prod` but `FRIGADE_API_KEY_SECRET_PROD` is absent from `.env.local`:

> To run this in prod I need your prod keys. Add them now? (y/n)

- **Yes** → prompt for prod public and prod private (same mask-on-accept pattern as 2.3). Verify via `GET /v1/apiKeys` (expect a different `organizationId` than dev). Append to `.env.local`. Update `.frigade/project.json`'s `prodWorkspaceId` field. Resume the operation.
- **No** → halt the current operation with "Prod keys required; no changes made." Return to caller without running anything else.

### Step 5.4 — Prod confirmation wrapper (D09)

Picking the prod key pair is necessary but not sufficient to run a dangerous prod op — the recipe executing the op is still responsible for emitting the canonical confirmation prompt before side effects (see `reference/operations.md`). This recipe only sets up the auth; the `dangerous` gate lives in the op-specific recipe.

---

## Section 6 — "What's my setup?" report

Triggered when the user asks "what's my Frigade setup", "what workspace am I bound to", "show me the binding", or similar. Claude runs Section 1 first (to refresh state), then prints:

```
Workspace:       <marker.workspaceName> (<marker.workspaceId>)
Default env:     dev
Prod keys:       present  (or: missing — add via `add prod keys`)
Prod workspace:  <marker.prodWorkspaceId or "—">
Marker file:     .frigade/project.json (committed)
Key storage:     .env.local (gitignored)
Bound at:        <marker.boundAt>
Skill log:       .frigade/skill.log (gitignored)
Skill version:   <marker.skillVersion>
```

No private keys in the output. "present" / "missing" only.

---

## Hard rules — key handling (read these every time)

These rules apply across all sections. Violating them is a skill bug.

1. **Never echo a private key back to the user.** When confirming a key was accepted, say "dev private key accepted (starts with `api_priv...`, length ok)" — never the full value. Mask at 9 characters or fewer.
2. **Never pass a private key as a visible tool-call argument.** Do not write the raw key into any `Read`/`Write`/`Edit` arg that the user sees in the transcript. Only use the key via Bash `curl -H "Authorization: Bearer $VAR"` where `$VAR` is an already-exported shell variable sourced from `.env.local`.
3. **Never write a private key to any file except `.env.local`.** Not `.frigade/project.json`. Not `.frigade/skill.log`. Not a scratch `.txt` for "debugging". Not a commit message. Not stdout. If you catch yourself about to — stop.
4. **Never commit `.env.local` or `.frigade/skill.log`.** Section 2.5 ensures `.gitignore` covers them. If the user somehow stages them (`git add .env.local` accidentally), warn them before any `git commit` and unstage.
5. **Redact the skill log.** When appending to `.frigade/skill.log`, strip any `Authorization` headers from logged requests and replace raw key values in URLs/payloads with `<REDACTED>`. Response bodies from `/v1/apiKeys` must have the `key` field redacted before logging — the response contains the full secret (per `reference/rest-endpoints.md`).
6. **Source keys from the environment, not from prompt arguments.** When invoking `curl`, prefer `-H "Authorization: Bearer $FRIGADE_API_KEY_SECRET"` (shell interpolation) over pasting the raw value. Confirm `.env.local` is loaded into the shell (e.g. `set -a; source .env.local; set +a`) before the call.

---

## Done

If Section 1 resolved silently, or Sections 2/3/4 completed successfully, the repo is ready for the calling recipe. Return control to the caller.
