# Recipe: Reset User

**Clear a user's flow completion state so they see one or more flows again from scratch.** Dogfood use case: Eric dismissed the welcome announcement while testing and wants to see it again without creating a new user. Can target a single flow (`"reset me on the welcome announcement"`) or every flow in the workspace (`"reset me across all flows"`).

Companion refs:
- `recipes/first-run-setup.md` — pre-condition state check (Section 1).
- `reference/rest-endpoints.md` §"DELETE /v1/userFlowStates/:flowSlug/:userSlug" — the single-flow reset endpoint (private key). §"GET /v1/users?userId=..." — resolves `userId` → the Frigade-generated `user_...` slug that the reset endpoint requires. §"GET /v1/flows/" — lists all flows for the `all`-mode loop.
- `reference/operations.md` — `resetUserFlowState` row (**dangerous in both envs**) and the **User reset (single flow)** + **User reset (all flows, batch)** canonical confirmation templates.
- `reference/errors.md` §404 (UFS row already absent — still returns 200 empty body, treat as success), §401/403 (auth / ownership), §5xx (retry once, then halt).

---

## Endpoint reality check

`rest-endpoints.md` documents exactly one reset endpoint:

> `DELETE /v1/userFlowStates/:flowSlug/:userSlug` — reset a user's state in a flow (private).

**There is no bulk "reset all flows for this user" REST endpoint.** The `all` mode in this recipe is implemented as a loop of single-flow DELETEs, one per slug returned by `GET /v1/flows/`. If a future Frigade build adds a bulk endpoint (e.g. `DELETE /v1/users/:userId/userFlowStates`), update this recipe to use it and fall back to the loop only on `404` / `405`. For now: loop.

One more endpoint subtlety — the reset endpoint takes a **`userSlug`** (the Frigade-generated `user_...` string), not the app-supplied `userId` / `foreignId`. Step 2 resolves `userId → userSlug` via `GET /v1/users?userId=<userId>` before any DELETE runs.

---

## Pre-conditions

1. **`first-run-setup.md` Section 1 passed.** `.frigade/project.json` marker present; `.env.local` keys verify against the marker's `workspaceId`. If not, invoke `first-run-setup.md` first — it returns silently on success. Don't proceed until that returns.
2. **Private key for the target environment is exported into the shell** that runs the `curl`s below. For dev: `FRIGADE_API_KEY_SECRET`. For prod: `FRIGADE_API_KEY_SECRET_PROD`. Typical preamble: `set -a; source .env.local; set +a`. Never paste the raw key into a tool-call argument; always interpolate `$FRIGADE_API_KEY_SECRET` / `$FRIGADE_API_KEY_SECRET_PROD` from the shell.
3. **`userId` is known.** Either the user supplied it in the prompt ("reset user `eric-dogfood-test`"), or the context from a previous turn in this conversation contains it (e.g. the same `userId` used for `create-announcement` / `create-tour` dogfood tests). If the skill has no `userId` at hand, ask once: "Which `userId` should I reset? (same app-supplied ID you pass to `<Frigade.Provider userId=...>`)"

If any pre-condition fails, halt with a clear pointer at the prerequisite and do not issue any DELETEs. Log a `reset-user:precondition-failed` event to `.frigade/skill.log`.

---

## Step 1 — Gather inputs

Parse the triggering prompt. Fill these inputs, asking only for what's missing:

| Input | Type | Required | How to resolve |
|---|---|---|---|
| `userId` | `string` | **yes** | Extract from the prompt (`"reset user eric-dogfood-test"`, `"reset me"` where Eric's dogfood userId is known from prior context). If absent and no conversational anchor, ask: "Which `userId` should I reset?" |
| `flowSlug` | `string \| "all"` | **yes** | `all` for every flow in the workspace; otherwise a single flow slug like `welcome-to-my-product`. Default to single-flow mode when the prompt names a specific flow; default to `all` when the prompt says "all flows" / "everything" / "reset the user". When ambiguous (e.g. `"reset me so I can see it again"` with two flows in play), ask: "Reset across all flows or just one? (slug or `all`)" |
| `environment` | `"dev" \| "prod"` | no | Default `dev`. If the user said "in prod", "production", or "live", set `prod`. The key binding carries the actual env — just pick the right private-key env var in Step 3. |

### 1.1 — Typical prompt shapes

| Prompt | `userId` | `flowSlug` | `environment` |
|---|---|---|---|
| "Reset me so I can see the announcement again." | Eric's dogfood `userId` (from prior context) | ask — likely the announcement the user was just working on, or `all` | dev |
| "Reset user eric-dogfood-test for flow welcome-to-my-product." | `eric-dogfood-test` | `welcome-to-my-product` | dev |
| "Reset eric-dogfood-test across all flows." | `eric-dogfood-test` | `all` | dev |
| "Reset user-abc-123 in prod." | `user-abc-123` | ask — the prompt is ambiguous; `all` if the user explicitly confirms | prod |

### 1.2 — Log the inputs

Append to `.frigade/skill.log` a `reset-user:start` event with: `userId`, `flowSlug` (or `"all"`), `environment`. Do NOT log the private key or the `Authorization` header value (per `errors.md` §Logging).

---

## Step 2 — Resolve `userId` → `userSlug`

The reset endpoint takes the Frigade-generated `user_...` slug, not the app-supplied `userId`. Resolve with one `GET`:

```bash
curl -sS -w "\n---HTTP_STATUS:%{http_code}---\n" \
  "https://api3.frigade.com/v1/users?userId=<userId>" \
  -H "Authorization: Bearer $FRIGADE_API_KEY_SECRET"
```

(Use `$FRIGADE_API_KEY_SECRET_PROD` instead if `environment == "prod"`.)

Interpretation:

| Status | Action |
|---|---|
| `200` with `slug: "user_..."` | Record the slug. Proceed to Step 3. |
| `404` | Halt. Tell user: "No user with `userId=<userId>` exists in `<env>`. Nothing to reset." Log a `reset-user:user-not-found` event. |
| `401` | Ownership/cross-env mismatch (possibly the `userId` belongs to the other environment's org). Halt; surface message. |
| `403` | Bad/revoked key. Halt; route to `first-run-setup.md` Section 2.7. |
| `5xx` / network | Retry once after 1s. If still failing, halt with timestamp in the log. |

Record the `userSlug` (e.g. `user_xyz789`) for use in the DELETE URLs.

---

## Step 3 — Confirmation (dangerous in BOTH envs)

`resetUserFlowState` is **dangerous regardless of environment** per `operations.md` (it destroys the user's progress data). Always confirm — even in dev. No silent escalation, no "remember yes for session" shortcut.

### 3.1 — Single-flow mode

Canonical confirmation prompt (per `operations.md` §"User reset (single flow)"):

```
About to reset user '<userId>' for flow '<flowSlug>' in <env>.
This clears their completion state so they'll see the flow again.
Confirm? (y/n)
```

### 3.2 — All-flows mode

Before prompting, run the flow-listing call so the confirmation can report a concrete count:

```bash
curl -sS -w "\n---HTTP_STATUS:%{http_code}---\n" \
  "https://api3.frigade.com/v1/flows" \
  -H "Authorization: Bearer $FRIGADE_API_KEY_SECRET"
```

Parse `data[]` from the `PaginatedResult<Flow>` response (see `rest-endpoints.md` §"GET /v1/flows/"). Collect every `slug` — do NOT filter on `active`, since a reset against an archived-but-present flow slug still returns `200` and is useful when the user wants a clean slate. Count them.

Canonical confirmation prompt (per `operations.md` §"User reset (all flows, batch)"):

```
About to reset user '<userId>' across ALL <count> flow(s) in <env>:
  <slug1>, <slug2>, <slug3>, ..., <slugN>
This clears all their completion state on every listed flow.
Confirm? (y/n)
```

If `count == 0`, halt with: "No flows in this workspace. Nothing to reset." Log a `reset-user:no-flows` event.

### 3.3 — Prod wrapper

When `environment == "prod"`, keep the same template (don't re-prompt twice) but use the actual `env` token `prod` so the message reads "…in prod." The canonical templates already cover both envs in one shape per `operations.md` §"Confirmation prompt templates".

### 3.4 — Response handling

- **`y` / `yes`** (case-insensitive) → proceed to Step 4.
- **Anything else** → abort. Report: "No changes made." Log a `reset-user:aborted-by-user` event. Do NOT issue any DELETE.

---

## Step 4 — Execute the reset(s)

### 4.1 — Single-flow mode

One `DELETE`:

```bash
curl -sS -w "\n---HTTP_STATUS:%{http_code}---\n" \
  -X DELETE "https://api3.frigade.com/v1/userFlowStates/<flowSlug>/<userSlug>" \
  -H "Authorization: Bearer $FRIGADE_API_KEY_SECRET"
```

(Use `$FRIGADE_API_KEY_SECRET_PROD` for `prod`.)

Interpretation:

| Status | Meaning | Action |
|---|---|---|
| `200` or `204` | UFS row deleted (or was already absent — the endpoint returns `200` with empty body either way; `NotFoundInterceptor` does NOT fire on DELETE per `rest-endpoints.md`) | Success. Proceed to Step 5. |
| `401` | Cross-env ownership mismatch | Halt; surface message. |
| `403` | Bad/revoked key | Halt; route to `first-run-setup.md`. |
| `5xx` / network | Retry once after 1s | If still failing, halt with timestamp in the log. |

Log a `reset-user:single-delete` event with `userId`, `flowSlug`, `env`, `status` (Authorization redacted).

### 4.2 — All-flows mode

Loop over every `slug` from Step 3.2's `GET /v1/flows/` list. For each:

```bash
curl -sS -w "\n---HTTP_STATUS:%{http_code}---\n" \
  -X DELETE "https://api3.frigade.com/v1/userFlowStates/<slug>/<userSlug>" \
  -H "Authorization: Bearer $FRIGADE_API_KEY_SECRET"
```

Per-iteration bookkeeping:
- On `200` / `204`: append the slug to a `successes` list.
- On `401` / `403`: **halt the whole loop** — these are auth failures that will repeat for every subsequent slug. Surface the error; report partial progress (whatever is in `successes` so far); do NOT continue.
- On `5xx` / network: retry **this slug once** after 1s. If the retry also fails, append the slug to a `failures` list and **continue the loop** — each reset is independent, partial progress is acceptable in `all` mode. Do not halt.
- On any other unexpected status: log it, append to `failures`, continue.

Log a `reset-user:bulk-progress` event after the loop completes with the final `successes[]` and `failures[]` arrays and the env.

**Why continue-on-error is safe here (vs. the atomic create-announcement recipe's all-or-nothing stance):** there is no cross-operation state being built up. Resetting flow A doesn't depend on resetting flow B. A half-complete bulk reset leaves the user in a state where some flows are fresh and others still reflect old progress — which is exactly the partial result the user gets, no hidden corruption. Report the exact per-slug outcomes in Step 5 so the user can re-run on the failures.

### 4.3 — Rate-limit awareness

Per `errors.md` §429, the rate-limit guard only covers a handful of public user-facing write endpoints and is a monthly MAU cap rather than a per-second limiter. `DELETE /v1/userFlowStates/...` is NOT behind that guard (see `operations.md` — only `POST /v1/public/users`, `POST /v1/public/userFlowStates`, etc. are). So a bulk loop of resets will not 429. Do NOT insert a sleep between iterations.

---

## Step 5 — Report

### 5.1 — Single-flow success

```
Reset user '<userId>' for flow '<flowSlug>' in <env>.
   Next page load, they'll see the flow again.

If the flow doesn't re-appear:
 - Confirm the flow is `active: true` in the dashboard
   (https://app.frigade.com/flows/<flowSlug>).
 - Hard-refresh the browser (the SDK caches UFS rows in memory for the session).
 - If still stuck, ask me to fetch the current UFS row:
   GET /v1/userFlowStates/<flowSlug>/<userSlug>.
```

### 5.2 — All-flows success (no failures)

```
Reset user '<userId>' across <N>/<N> flow(s) in <env>.
   Flows reset: <slug1>, <slug2>, ..., <slugN>
   Next page load, they'll see each flow again from scratch.
```

### 5.3 — All-flows with partial failures

```
Reset user '<userId>' across <successCount>/<totalCount> flow(s) in <env>.
   Reset: <slug-a>, <slug-b>, <slug-c>
   Failed on: <slug-x>, <slug-y>
     (see .frigade/skill.log for per-slug error details)

To retry the failures:
  "Reset <userId> for flow <slug-x>" (one at a time), or
  "Reset <userId> across all flows" (will no-op on the already-reset slugs
   and re-attempt the failures — each DELETE is idempotent).
```

(Each `DELETE /v1/userFlowStates/:flowSlug/:userSlug` is idempotent — the endpoint returns `200` with empty body even when the UFS row is already absent. Re-running `all` mode after a partial failure is safe.)

### 5.4 — Logging the outcome

Log a `reset-user:success` event (single mode or all mode with zero failures) or `reset-user:partial-failure` event (all mode with ≥1 failure) to `.frigade/skill.log`. Required fields: `userId`, `flowSlug` (or `"all"`), `environment`, `successes[]`, `failures[]` (may be empty), total count, timestamp. Redact the `Authorization` header on every request-logged entry.

---

## Partial-failure handling

### Single-flow mode

No partial-failure surface: either the one DELETE succeeds (→ Step 5.1) or it fails and we halt without any side effects. Auth errors halt before the DELETE runs; 5xx halts after one retry. Nothing to roll back — this recipe performs no code edits and no composite server-side sequence.

### All-flows mode

Per `errors.md` §"Composite operation failures": each DELETE is its own atomic unit with no cross-operation state. On a mid-loop failure:

- **Auth errors (401/403)** halt the loop immediately — those are not "partial" in a recoverable sense; every subsequent DELETE will fail identically. Surface the error and list the slugs already reset.
- **5xx / network on a specific slug** records a failure for that slug, then **continues** the loop. The user sees an exact successes/failures breakdown at the end.
- **No rollback of already-reset slugs.** A "rollback" would mean re-sending the user's completion state, which this recipe does not have — and re-completing on the user's behalf would itself be a destructive server-side write. The correct semantics are: report what succeeded, let the user decide whether to re-trigger flows by re-visiting them, or to proceed with the partial state.

### Partial-failure report template (all-flows mode)

```
Completed:
 Resolved userId '<userId>' → userSlug '<userSlug>' (GET /v1/users → 200)
 Listed flows in <env> (GET /v1/flows/ → 200, <totalCount> flows)
 Reset: <slug-a>, <slug-b>, <slug-c>   (DELETE → 200 each)

Failed at step 4 of 5:
 Could not reset user on flow(s): <slug-x>, <slug-y>
   Reason (<slug-x>): <exact status + message, e.g. "HTTP 500: Internal server error">
   Reason (<slug-y>): <...>
   Rolled back: nothing — DELETEs that succeeded remain applied; each is
     independent and idempotent.

Upstream state:
- User '<userId>' has had their completion state cleared on the <successCount> flow(s) listed above.
- The <failureCount> flow(s) listed as failures are unchanged from before the recipe ran.

Recovery options:
  1. Retry the failures only — I'll re-run `DELETE /v1/userFlowStates/<failed-slug>/<userSlug>`
     for each still-failing slug. Safe to repeat; idempotent.
  2. Re-run "reset across all flows" — will no-op on the already-reset slugs and re-attempt the failures.
  3. Leave things as they are — the user is reset on the successful slugs and retains
     their existing state on the failed slugs.

Which would you like? (1/2/3)
```

All three options always offered (per `errors.md` §"Reporting partial failures").

---

## Worked example — Eric's dogfood loop continuation

**Prior state** (from `create-announcement`, `create-tour`, `link-flows` — Tasks 16/17/18):

- `welcome-to-my-product` (ANNOUNCEMENT) + `welcome-tour` (TOUR) live in Frigade dev.
- Eric loaded `http://localhost:3000`, saw the announcement, clicked through the tour, dismissed the announcement.
- He now wants to re-experience the announcement without creating a new user.

**User's prompt:**

> "Reset me so I can see the announcement again."

**Claude's actions:**

1. **Pre-conditions check.** Run `first-run-setup.md` Section 1 — marker + keys match, silent success.

2. **Parse intent (Step 1).**
   - `userId` → `eric-dogfood-test` (the dogfood userId Eric used for the create-announcement / create-tour flows, carried over from prior turns in this conversation).
   - `flowSlug` → ambiguous ("the announcement" — could be the single welcome announcement, or the user could mean "all flows"). Ask once:
     > "Reset across all flows or just one? If one, which slug?"
   - User: "Just the welcome announcement."
   - `flowSlug` → `welcome-to-my-product`.
   - `environment` → `dev` (no mention of prod).

3. **Resolve userId → userSlug (Step 2):**
   ```bash
   curl -sS "https://api3.frigade.com/v1/users?userId=eric-dogfood-test" \
     -H "Authorization: Bearer $FRIGADE_API_KEY_SECRET"
   # → 200 { "id": 1234, "userId": "eric-dogfood-test", "slug": "user_abc789", ... }
   ```
   Record `userSlug = user_abc789`.

4. **Confirmation (Step 3.1):**
   ```
   About to reset user 'eric-dogfood-test' for flow 'welcome-to-my-product' in dev.
   This clears their completion state so they'll see the flow again.
   Confirm? (y/n)
   ```
   User: `y`.

5. **Execute the reset (Step 4.1):**
   ```bash
   curl -sS -X DELETE \
     "https://api3.frigade.com/v1/userFlowStates/welcome-to-my-product/user_abc789" \
     -H "Authorization: Bearer $FRIGADE_API_KEY_SECRET"
   # → 200 (empty body)
   ```
   Log a `reset-user:single-delete` event: `{ userId: "eric-dogfood-test", flowSlug: "welcome-to-my-product", env: "dev", status: 200 }`.

6. **Report (Step 5.1):**
   ```
   Reset user 'eric-dogfood-test' for flow 'welcome-to-my-product' in dev.
      Next page load, they'll see the flow again.

   If the flow doesn't re-appear:
    - Confirm the flow is `active: true` in the dashboard
      (https://app.frigade.com/flows/welcome-to-my-product).
    - Hard-refresh the browser (the SDK caches UFS rows in memory for the session).
    - If still stuck, ask me to fetch the current UFS row:
      GET /v1/userFlowStates/welcome-to-my-product/user_abc789.
   ```

7. **Log** `reset-user:success` to `.frigade/skill.log`: `{ userId, flowSlug, env, successes: ["welcome-to-my-product"], failures: [], totalCount: 1 }`. Authorization redacted.

Eric refreshes the browser → the announcement re-appears. **Dogfood loop iteration closes.** He can now rerun `link-flows`' acceptance path (click "Take a tour" → tour starts) as many times as he wants.

---

## Alternate worked example — all-flows mode

**User's prompt:**

> "Reset eric-dogfood-test across all flows in dev."

**Claude's actions (abbreviated):**

1. Pre-conditions pass.
2. Inputs: `userId=eric-dogfood-test`, `flowSlug="all"`, `environment=dev`.
3. Resolve userSlug: `GET /v1/users?userId=eric-dogfood-test` → `user_abc789`.
4. List flows: `GET /v1/flows/` → `{ data: [{ slug: "welcome-to-my-product" }, { slug: "welcome-tour" }], ... }`. Count = 2.
5. Confirmation (Step 3.2):
   ```
   About to reset user 'eric-dogfood-test' across ALL 2 flow(s) in dev:
     welcome-to-my-product, welcome-tour
   This clears all their completion state on every listed flow.
   Confirm? (y/n)
   ```
   User: `y`.
6. Loop (Step 4.2):
   - `DELETE /v1/userFlowStates/welcome-to-my-product/user_abc789` → 200. Append to `successes`.
   - `DELETE /v1/userFlowStates/welcome-tour/user_abc789` → 200. Append to `successes`.
7. Report (Step 5.2):
   ```
   Reset user 'eric-dogfood-test' across 2/2 flow(s) in dev.
      Flows reset: welcome-to-my-product, welcome-tour
      Next page load, they'll see each flow again from scratch.
   ```
8. Log `reset-user:success`: `{ userId, flowSlug: "all", env: "dev", successes: ["welcome-to-my-product", "welcome-tour"], failures: [], totalCount: 2 }`. Authorization redacted.

Eric refreshes the browser → both flows start from step 1 again.
