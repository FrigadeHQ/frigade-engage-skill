# Decisions Log — Frigade Engage Skill

Each decision records the choice, alternatives considered, who recommended what, and why. Use the IDs (D01, D02, …) in conversation so specific decisions can be revisited without re-reading the whole doc. Anything marked **REVISIT** is explicitly flagged for team discussion.

---

## D01 — Target audience: external customers, Eric dogfoods first
**Locked:** 2026-04-17
**Choice:** Build for external Frigade customers (developer shape), but Eric dogfoods against a fresh web app + fresh Frigade account personally before giving it to anyone else.
**Alternatives considered:** (A) External-only, ship and see; (B) Internal-team-only; (C) both simultaneously.
**Why:** Valley/G-P signaled strong pull 2026-04-17; external shape (API-key only, doc-driven, no privileged backend access) forces the right constraints; personal dogfood catches first-class UX issues before external blast radius.

## D02 — Scope: full dashboard + full API parity
**Locked:** 2026-04-17
**Choice:** Every capability reachable from the Engage dashboard or the public GraphQL/REST APIs — flows of all types, YAML edits, targeting, theme, content, draft/publish lifecycle, duplicate, reset user, promote, version management.
**Alternatives considered:** (A) narrow to announcement+checklist+sequencing; (B) medium: +tours/nudges/targeting; (C) full parity.
**Why:** Eric explicitly rejected scope reduction: *"I want parity for everything you can do in the Engage dashboard."*
**REVISIT:** If build timeline threatens Phase 0d (dogfood tonight), we may need to phase operations by priority; Eric/Christian to weigh in if that happens.

## D03 — Execution model: skill-only, Claude drives HTTP; structured as scaffolding for a future CLI
**Locked:** 2026-04-17
**Choice:** Skill files are API reference + recipes; Claude composes `curl`/`fetch` directly from Bash using the user's private key. No companion binary in v1.
**Alternatives considered:** (A) skill-only (chosen); (B) skill + thin CLI now; (C) skill + live-introspection-only.
**Why:** Fastest to ship for tonight's dogfood. ~80% of the work (op inventory, schema, recipes, error shapes) transfers cleanly to a CLI extraction (Phase 2), *if* the skill is structured as API reference + recipes rather than Claude-prompt-soup. That structural constraint is what keeps this non-throwaway.
**REVISIT:** Once dogfood surfaces painful spots (schema drift, destructive-op confirmation friction, error normalization), extract a CLI that wraps those pains.

## D04 — Codebase modification: yes, full-job skill
**Locked:** 2026-04-17
**Choice:** Skill reaches into the user's codebase — installs `@frigade/react`, wraps provider, mounts components, injects tour anchors — as well as manipulating the Frigade workspace.
**Alternatives considered:** (A) API-only; (B) API + code-emission; (C) API-only v1, codebase wiring later.
**Why:** Without codebase wiring, the dogfood loop stalls at "flow exists but nothing renders." Eric: *"Otherwise there's still so much work for them."* The magic demo is end-to-end.

## D05 — Framework support (v1): React + Next.js (App Router + Pages Router)
**Locked:** 2026-04-17
**Choice:** Recipes ship adapters for React, Next App Router, Next Pages Router. Vue, Remix, React Native, plain JS degrade gracefully to "not yet" with manual setup docs.
**Why:** Matches Frigade SDK surface (`@frigade/react` is primary); covers the dogfood app and most customer repos; each new framework is its own adapter file to add later.

## D06 — Key storage: per-project `.env.local`, not user-level config
**Locked:** 2026-04-17
**Choice:** Keys live in project `.env.local` (or `.env`), which the skill creates/updates. Skill verifies `.gitignore` excludes it before writing.
**Alternatives considered:** (A) project `.env.local` (chosen); (B) user-level `~/.frigade/config.json`; (C) OS keychain; (D) `~/.claude/frigade/`.
**Why:** Eric: *"people will already have a .env file. Just put it in their existing .env file."* Same file the SDK reads; no new config convention to learn; pairs naturally with per-repo key lifecycle.

## D07 — Two environments × two key types
**Locked:** 2026-04-17
**Choice:** Up to 4 env vars — dev public, dev private, prod public, prod private. At least dev pair required to operate; prod pair needed for prod ops and promote.
**Hard rule:** Private keys never enter the web app runtime. Skill's code-emission patterns refuse to paste `*_SECRET*` var names into any non-`.env.local` file. Verified by grep guard at build end.
**Why:** Frigade separates environments and key scopes; skill must respect that. Eric explicit: *"private API keys can never go into the web app."*
**REVISIT:** Exact env var names to match current `@frigade/react` expectations during build (Q: confirm `NEXT_PUBLIC_FRIGADE_API_KEY` is the right public-facing var name).

## D08 — First-run: support existing and new Frigade users
**Locked:** 2026-04-17
**Choice:** Skill detects existing-user vs new-user path. Existing → paste keys from `app.frigade.com/settings/api`. New → signup first, then keys. Minimum viable = dev pair; prod optional.
**Why:** Most Phase 3+ customers already have accounts; the new-user path is mostly for Eric's dogfood and fresh external customers. Both paths must feel clean.

## D09 — Safety model: dev open, prod two-tier
**Locked:** 2026-04-17
**Choice:** In dev, all operations run immediately (including destructive ones like delete-flow, reset-user). In prod, any `dangerous`-tagged operation requires explicit confirmation (`"About to <verb> <target> in prod. Confirm? (y/n)"`). No `forbidden` class in v1.
**Alternatives considered:** (A) trust-user (no friction); (B) two-tier (safe/dangerous) per env; (C) three-tier (+forbidden); (D) env-first (dev open, prod gated).
**Why:** Eric: *"in dev, just do everything. When they move to production, two-tier guardrail. We don't have any actions we'd call forbidden, especially if they're going to confirm."* Dev's openness matches how people will actually use the skill during iteration; prod's confirmation is a cheap speed bump.
**REVISIT:** If prod confirmation friction is too noisy, add per-session "remember yes for this op on this workspace" — explicit only, never silent.

## D10 — Skill location: user-level `~/.claude/skills/frigade-engage/`
**Locked:** 2026-04-17
**Choice:** Install at user level so it's available across repos.
**Alternatives considered:** project-level `.claude/skills/`.
**Why:** Skill needs to be invocable from any customer repo; one install, upgrades cleanly, matches future distribution model.

## D11 — Examples source: Frigade docs + `FrigadeHQ/demo` public repo
**Locked:** 2026-04-17
**Choice:** `examples/` YAML pulled from `/Users/ericbrownrout/Library/Code/docs` (Mintlify repo, local) and `github.com/FrigadeHQ/demo` (public, to be cloned).
**Why:** Real production-quality examples beat hand-authored. Both sources are authoritative and maintained.
**REVISIT:** Whether to auto-sync examples from those sources vs. commit snapshots — decide after seeing how often they drift.

## D12 — Cross-flow triggering: React handler default (REVISED 2026-04-17)

**Original choice (2026-04-17, morning):** Frigade-native flow-to-flow action in YAML; fallback to React handler.

**REVISED 2026-04-17 (during Task 6):** Native declarative flow-to-flow action **does not exist** in @frigade/react v2. The YAML `primaryButton.action` enum (`flow.start`, `flow.complete`, `flow.skip`, `flow.restart`, `flow.forward`, `flow.back`, `step.complete`, `step.start`, `step.skip`, `step.reset`, `false`) operates only on the containing flow. Cross-flow linking is React-handler-only: the source flow's CTA uses `onPrimary`/`onSecondary` to call `useFlow(targetFlowId).flow.start()`.

**Current choice:** `recipes/link-flows.md` (Task 18) defaults to the React handler pattern. No fallback (there is no other mechanism in v2).

**Impact:**
- Link-flows recipe is pure code-emission (adds an `onPrimary` prop to the source flow's component mount), not YAML.
- The linkage lives in the host codebase, not in Frigade's workspace. This is a meaningful departure from D12's "keep linkage in Frigade" motivation — flagged for team discussion. Counter-argument: the YAML-action enum *does* cover intra-flow sequencing (`flow.forward`, `step.complete`), so the "everything in Frigade" story still holds for single-flow multi-step experiences; cross-flow is the specific gap.
- Design doc Section 6.5 needs a corresponding revision during Task 22 (SKILL.md dispatch table).

**REVISIT:** Post-dogfood with Christian — is a native `flow.start(targetFlowId)` action on roadmap, or is React-handler-by-design? If the former, link-flows recipe gets a one-file flip once available.

## D13 — Repo↔workspace binding: committed `.frigade/project.json`
**Locked:** 2026-04-17
**Choice:** Skill writes `.frigade/project.json` (workspace ID + metadata, safe to commit) at onboarding. Every invocation runs a binding check before any API call and flags mismatches.
**Alternatives considered:** user-level binding map in `~/.claude/frigade/bindings.json`; no binding check at all.
**Why:** Eric flagged the cross-repo footgun: *"if I ran the skill in my first repo and I go to website B and say add a new announcement, we need to know that's actually a different website."* Committed marker gives collaborators shared truth; workspace IDs aren't secret so commit is safe; matches patterns from Vercel, SST, Prisma.

## D14 — Dev server startup: ask first, never auto-launch
**Locked:** 2026-04-17
**Choice:** Skill prompts `"Start the dev server now? (y/n)"` rather than running `npm run dev` in the background unsolicited.
**Why:** Respects existing dev servers on the port, monorepo oddities, and the user's terminal ownership.

## D15 — Anchor injection: one confirmation batch per flow
**Locked:** 2026-04-17
**Choice:** When tour steps need DOM anchors added to the codebase, skill lists all proposed additions at once and asks once per flow, not per-element.
**Why:** Quieter for happy path, preserves veto power.

## D16 — Partial failure: auto-rollback codebase; preserve upstream Frigade state
**Locked:** 2026-04-17
**Choice:** Multi-file code-edit batches are atomic (revert all on any failure). Server-side flows already created in a composite op are **not** auto-deleted; skill reports what succeeded, what failed, and offers explicit retry or cleanup.
**Alternatives considered:** full auto-rollback; full preserve-all.
**Why:** Partial code edits break the build (must rollback); server-side orphans are cheaper to recover from than silently deleted work (must preserve). Matches how an experienced dev would handle it manually.

## D17 — Diagnostic log: `.frigade/skill.log` (gitignored)
**Locked:** 2026-04-17
**Choice:** Skill appends structured log entries to `.frigade/skill.log` in the repo, gitignored.
**Why:** Debug "what did the skill actually do last Tuesday" without re-running. Local only; not telemetry.

## D18 — Knowledge freshness: committed schema snapshot + live introspection fallback
**Locked:** 2026-04-17
**Choice:** `reference/graphql-schema.md` is a committed snapshot. Skill instructs Claude to live-introspect via the user's private key when it suspects drift (unknown fields, unexpected errors). Periodic manual refresh.
**Alternatives considered:** bundled-only (stale); live-only (no offline story); docs-scraped (format-dependent).
**Why:** Deterministic grounding + safety net; avoids requiring live access for every invocation.

## D19 — Repo home (provisional): `/Users/ericbrownrout/Library/Code/frigade-engage-skill/`
**Locked:** 2026-04-17 (name provisional)
**Choice:** Build in this directory; git-initialize locally; symlink into `~/.claude/skills/frigade-engage/` during development.

## D20 — Phase-0 same-day execution
**Locked:** 2026-04-17
**Choice:** Design → implementation plan → build → Eric dogfood all compressed into today/tonight. Internal team review (Christian, Byung, LT) happens after Eric's dogfood passes.
**Why:** Dogfood loop is the fastest way to surface real issues; team review is more productive against a working artifact than a design doc.

---

## Source snapshot for build — 2026-04-17

All four source repos pulled to known SHAs before skill authoring begins.

| Repo | Local path | SHA (after `git pull --ff-only origin main`) |
|---|---|---|
| backend-app | `/Users/ericbrownrout/Library/Code/backend-app` | `d245b4fd10f7a3ae2d9920deaf2ace12ea7d29f6` |
| frigade-web | `/Users/ericbrownrout/Library/Code/frigade-web` | `1732698b60fc983186186248f94b0838a6509179` |
| docs | `/Users/ericbrownrout/Library/Code/docs` | `fc1fe0c35edd37c77f7827c6863864f2647b3aa0` |
| demo-v2 | `/Users/ericbrownrout/Library/Code/demo-v2` | `82b68403fc0a996c8fcaff80ca0dde5ed15363e9` |

**Preflight decisions (2026-04-17):**
- **D21:** backend-app dirty state (6 files, legitimate Frigade backend WIP — FlowsService perf experiment) stashed as `pre-skill-build WIP 2026-04-17`; will `git stash pop` at Task 26 to restore Eric's WIP.
- **D22:** Examples source is the already-local `/Users/ericbrownrout/Library/Code/demo-v2` (remote: `FrigadeHQ/demo-v2`), not a fresh clone of `FrigadeHQ/demo`. The originally-referenced `FrigadeHQ/demo` may or may not exist separately; `demo-v2` is the modern one and is sufficient. Revisit if post-dogfood we discover content only in the other repo.

## D23 — API surface carve-up: GraphQL for reads/analytics; REST for flow CRUD and most writes
**Locked:** 2026-04-17 (discovered during Task 4)
**Choice:** Treat the Frigade GraphQL and REST APIs as peers, not GraphQL-primary. GraphQL covers flow reads, user/user-group reads, analytics, rules CRUD, integrations, webhooks, and some user/user-group deletes. **Flow CRUD (create/update/delete/duplicate/publish/promote/activate) is REST-only.** User create/update, user-flow-state resets, org/api-keys/environment management are also REST.
**Why:** Discovered by Task 4 implementer reading `backend-app/src/flows/flows.resolver.ts` et al. — the dashboard writes flows via REST, not GraphQL. The design's unstated assumption that most ops live in GraphQL is wrong; doesn't invalidate the design's shape (Claude still drives HTTP from the skill), just rebalances which reference file carries the weight.
**Impact on plan:**
- Task 5 (REST endpoints) expands to cover the bulk of the dashboard's write surface — originally scoped as "small gap-fill," now the primary write reference.
- Task 10 (operations.md) pulls mostly from Task 5's REST inventory, lightly from Task 4's GraphQL inventory.
- Tasks 15-20 (dogfood-critical recipes) primarily call REST.
**REVISIT:** Christian/Byung may have context on why the carve-up is this way (historical or deliberate); post-dogfood is fine to ask.

## D24 — Live introspection works on dev only; prod introspection is disabled
**Locked:** 2026-04-17 (discovered during Task 4)
**Choice:** `reference/graphql-schema.md`'s "live introspection fallback" (D18) is a dev-only mechanism. On prod (`NODE_ENV === 'production'`), the server disables introspection entirely (`src/app.module.ts`), so introspection queries return a schema-hidden error.
**Why:** Standard security posture — avoids leaking schema surface publicly. Matches Apollo defaults.
**Impact on plan:** D18's "Hybrid: snapshot + live introspection" still holds, but the live-introspection half only works when Claude is targeting dev. Recipes should not suggest prod introspection; `errors.md` should document "introspection returns a hidden-schema error in prod — fall back to the committed snapshot."
**REVISIT:** If we ever add prod introspection for internal use, revise.

## D25 — GraphQL errors are wrapped; detailed messages don't surface
**Locked:** 2026-04-17 (discovered during Task 4)
**Choice:** The backend's `formatError` in `src/app.module.ts` rewrites every GraphQL error body to `"An unexpected error occurred in graphql"`. Detailed error messages (validation, not-found, etc.) don't reach API callers.
**Why:** Intentional — avoids leaking internal implementation details. Also makes error-based recipes (e.g., "if 422, read the message to auto-correct") impossible on the GraphQL side.
**Impact on plan:** `errors.md` must call this out explicitly. Recipes must not rely on parseable GraphQL error bodies; fall back to re-fetch + diff semantics to determine what went wrong. REST errors may be more descriptive (confirm during Task 5).
**REVISIT:** Post-dogfood, consider a dev-only endpoint that returns full errors for skill debugging — ask Christian.

## D26 — Dev→prod flow promotion is a client-orchestrated multi-call sequence, not a single op
**Locked:** 2026-04-17 (discovered during Task 5)
**Choice:** `recipes/promote-to-prod.md` (Task 19) must reproduce the dashboard's client-side orchestration — no single `POST /v1/flows/:slug/promote`. The sequence: (1) read `internalData` from source flow for matching prod flow id, (2) switch API key to prod-env private key, (3) version + update the prod-env flow record, (4) activate. Dashboard source: `frigade-web/src/components/dialog-copy-flow-to-prod.tsx`.
**Why:** Historical; backend didn't bake a "promote" abstraction — dashboard handles the 2-key dance. Matches how env scoping works (D23): each key is environment-bound, so any cross-env op is client-orchestrated.
**Impact on plan:** Task 19's recipe is more complex than initially planned — it reads both source and target, computes the diff, applies it against the target env with a different key, and the confirmation prompt must list the exact sequence of side effects. Error-recovery matters more (partial progress across two keys).
**REVISIT:** Post-dogfood, worth asking Christian if there's appetite for a single `POST /promote` endpoint — this is exactly the kind of roughness a CLI or MCP would smooth over (the Phase-2 story).

## D27 — Workspace-binding verification can't use GET /v1/me; use an alternative
**Locked:** 2026-04-17 (discovered during Task 5)
**Choice:** `GET /v1/me` looks skill-reachable (guard allows API keys) but its handler requires Clerk `request.user` to populate `customerId`, so it 500s for API-key callers. For the first-run workspace-binding verification step (D13 / recipes/first-run-setup.md), use an alternative: `GET /v1/flows` or `GET /v1/apiKeys` — both are private-key-reachable and include enough org/environment info to confirm the key → workspace mapping.
**Why:** Must work from `first-run-setup.md` without a dashboard-user session. `GET /v1/apiKeys` returns `{ data: [{ id, key, environment, type, organizationId }] }` — the filter match for the presented key reveals the workspace and environment in one call.
**Impact on plan:** Task 15 (first-run-setup recipe) uses `GET /v1/apiKeys` (or equivalent) for the verification step. Skill docs must not call this "whoami" — no such endpoint.
**REVISIT:** A public `GET /v1/whoami` for API-key callers would be a clean add; flag to Christian post-dogfood.

## D28 — Guard auth failures surface as 403; 401 is narrower (ownership check)
**Locked:** 2026-04-17 (discovered during Task 9)
**Choice:** Skill's error-recovery heuristics treat 403 as the "bad/missing/wrong-scope key" signal (most common auth failure), not 401. 401 means the key was valid and admitted by the guard, but an ownership check inside the service tripped (`rules.service.ts`, `actors.service.ts`, `webhook-subscriptions.service.ts`).
**Why:** Nest's default behavior when a guard returns false is `ForbiddenException` → 403 `"Forbidden resource"`. Explicit `UnauthorizedException` throws are rare and exist only in service-layer ownership checks.
**Impact:** `recipes/first-run-setup.md` and `errors.md` must check 403 first when auth is suspect. 401 triggers a more specific recovery ("user may be operating across orgs or deleting someone else's entity").
**REVISIT:** Never — this is the runtime reality.

## D29 — 429 means MAU cap exceeded, NOT rate limit; do not retry
**Locked:** 2026-04-17 (discovered during Task 9)
**Choice:** On receiving `429 Too Many Requests`, the skill halts with an upgrade message — does NOT attempt exponential backoff. `backend-app/src/middlewares/rate-limit.guard.ts` checks a persisted `organization.isRateLimited` flag that only flips off when the organization's plan is upgraded or a new billing period begins.
**Why:** Retrying would fail 100% of the time until the underlying condition changes. Backoff advice (common for per-second rate limits) is actively misleading here.
**Impact:** `errors.md` includes a "do NOT retry 429" note and suggests the user visit `https://app.frigade.com/settings/billing` instead. All recipes that might hit 429 (bulk ops, high-volume user operations) respect this.
**REVISIT:** If Frigade later introduces a genuine per-second rate limit alongside the MAU cap, this needs revision.

## D30 — Real FlowType enum has no NUDGE or MODAL; these are rendering variants
**Locked:** 2026-04-17 (discovered during Task 11)
**Choice:** Canonical `FlowType` enum (from `@frigade/js/dist/index.d.ts:597`): `ANNOUNCEMENT`, `CHECKLIST`, `FORM`, `TOUR`, `SUPPORT`, `CUSTOM`, `BANNER`, `EMBEDDED_TIP`, `NPS_SURVEY`, `SURVEY`, `CARD`. "Nudge" and "modal" are colloquial terms — in practice:
- **Nudge** → choose `HINT` (TOUR variant), `BANNER`, or `CARD` per use case.
- **Modal** → render any flow with `as={Frigade.Dialog}` (rendering variant, not a flow type).

**Impact on plan:**
- Task 21 stub list updated: replace `create-nudge.md` and `create-modal.md` with stubs for `create-card.md`, `create-banner.md` (already in plan), `create-nps-survey.md`, `create-survey.md`, `create-form.md` (already), and a general note under the relevant recipes about the modal rendering variant.
- Task 22 SKILL.md dispatch table reflects real flow type names.
**REVISIT:** If Frigade later adds a first-class NUDGE or MODAL flow type, update accordingly.

## D31 — Rules entities are Collections, not DSL carriers
**Locked:** 2026-04-17 (discovered during Task 14)
**Choice:** The `Rule` entity in Frigade is a Collection (orchestration container: cool-off, priority, allowed component types), NOT a DSL-carrying audience definition. The targeting DSL lives on the flow itself via the `targetingLogic` string (REST `PUT /v1/flows/:numericFlowId` with partial body). There is no `rule:<slug>` reference syntax from `targetingLogic` into a Rule entity.
**Why:** Source inspection of `backend-app/src/rules/` confirmed the Collection shape; no DSL-parse code in the rules module.
**Impact:** `reference/targeting-and-rules.md` and all targeting-related recipes avoid the `rule:<slug>` pattern. Rules and targeting are two separate mechanisms in the skill's mental model.

## D32 — Real YAML field names: subtitle, imageUri (not body, media)
**Locked:** 2026-04-17 (discovered during Task 16)
**Choice:** In flow YAML, the step body text field is `subtitle` (not `body`), and the step image URL field is `imageUri` (not `media.url`). There is no `media: { type, url, alt }` block; images are a flat `imageUri` string. No first-class `alt` text field.
**Why:** Confirmed against `@frigade/js/dist/index.d.ts` and real YAML in `demo-v2/src/lib/flow-details.ts`.
**Impact:** `yaml-spec.md` uses correct field names. All create-* recipes (create-announcement, create-tour, create-checklist, create-card, etc.) must translate user shorthand ("body", "media") to `subtitle` / `imageUri` before POSTing. Trap note explicit in every relevant recipe.

## D33 — Dev→prod pairing via internalData.productionDraftFlowId / productionActiveFlowId
**Locked:** 2026-04-17 (discovered during Task 19)
**Choice:** When a dev flow has a prod counterpart, the dev flow's `internalData` field carries two numeric fields — `productionDraftFlowId` (the prod-env draft, if exists) and `productionActiveFlowId` (the prod-env active flow, if exists). Promote-to-prod reads these to determine CREATE vs UPDATE path. Backend populates these server-side via slug matching across sibling orgs (dev and prod organizations are siblings); the skill does NOT write these fields manually.
**Why:** Confirmed from `frigade-web/src/components/dialogs/dialog-copy-flow-to-prod.tsx` and the `InternalFlowData` type in `frigade-web/src/data/api/flows.ts`.
**Impact:** `recipes/promote-to-prod.md` uses real field names. Partial-failure handling is simpler because re-runs self-heal (skill's CREATE that succeeded upstream turns into an UPDATE path on retry, since the backend pairs slugs).

## D34 — Reset-user endpoint wants Frigade-generated userSlug, not raw userId
**Locked:** 2026-04-17 (discovered during Task 20)
**Choice:** `DELETE /v1/userFlowStates/:flowSlug/:userSlug` — the `userSlug` is the Frigade-generated `user_xxx` slug, NOT the raw caller-supplied `userId`. Skill does a pre-flight `GET /v1/users?userId=<userId>` to resolve `userId` → `user_xxx` slug before calling DELETE.
**Why:** The path parameter name `userSlug` is the giveaway; the controller expects the internal slug, not the externally-meaningful id. Confirmed from `rest-endpoints.md` source inspection.
**Impact:** `recipes/reset-user.md` adds the resolution step; also informs any future recipe that references users by slug path.

## D35 — backend-app stash pop 2026-04-17 hit a merge conflict; stash preserved
**Locked:** 2026-04-17 (at end of build)
**Choice:** When the build completed, `git stash pop` on backend-app hit a merge conflict on `src/ai/ai-query.service.ts` (deleted on main during the build window; Eric's stash had modifications). Auto-merge of 5 other files succeeded. Since the stash was preserved, we `git reset --hard HEAD` the backend-app to a clean main state and left stash@{0} intact for Eric to resolve manually.
**Why:** Automatic conflict resolution could destroy Eric's intended changes; the stash is safe and Eric is the right person to decide whether to keep his modifications or accept the upstream deletion.
**How Eric resolves:** `cd /Users/ericbrownrout/Library/Code/backend-app && git stash pop` then manually handle `src/ai/ai-query.service.ts` (likely `git checkout HEAD -- src/ai/ai-query.service.ts` if accepting upstream deletion, or `git checkout --ours <path>` then re-create / restore if keeping his version). Stash is `stash@{0}: On main: pre-skill-build WIP 2026-04-17`.

## Verification pass 2026-04-17 — pre-dogfood

**Symlink installed:** `/Users/ericbrownrout/.claude/skills/frigade-engage` → `/Users/ericbrownrout/Library/Code/frigade-engage-skill/skill` ✅

**Private-key grep guard results:**
- `api_private_<value>` (literal secrets): 0 occurrences (clean)
- `api_public` / `api_private` in `examples/`: 0 occurrences (clean)
- `FRIGADE_API_KEY_SECRET` (variable name): 124 occurrences across 27 files — all verified in safe contexts (Authorization headers, `.env.local` template writes, hard-rule prohibitions, variable-name references in prose)

**Files committed in skill/:**
- 10 reference files (reference/)
- 20 recipes (recipes/): 6 fully-authored + 14 stubs
- 1 entry-point (SKILL.md)
- 7 example YAML files (examples/)
- Total: 38 files

**Ready for Phase 0d dogfood** — Eric runs the acceptance loop (Section 3 of design doc) against a fresh Next app + fresh Frigade workspace. Expected surface for new bugs: first-run-setup (most-touched recipe), tour anchor resolution, link-flows React handler emission, promote-to-prod multi-call orchestration. Record dogfood results in a new file `docs/dogfood-2026-04-17.md`.

## Decisions deferred to build-time discovery
- **Exact env var names** to match `@frigade/react` v-current (D07 revisit).
- **Whether native flow-to-flow action supports announcement→tour** specifically (D12 revisit).
- **Whether `<FrigadeProvider>` needs build-time or runtime env** on Next App Router.
- **Whether GraphQL covers the full dashboard surface** or some ops require REST/undocumented endpoints.
- **`backend-app` dirty state** — needs resolution before relying on its schema for ops inventory.
- **`FrigadeHQ/demo` clone** — confirm before `git clone` at sibling path.

## Decisions to revisit post-dogfood
- D03: CLI extraction trigger — what painful spots surface?
- D09: Confirmation friction — too noisy? Cache "yes" per op per session?
- D11: Example-sync strategy — auto-sync or snapshot?
- D19: Final skill name.

---

*Edit this file during build and after dogfood. Keep IDs stable; if a decision is superseded, mark it `SUPERSEDED BY Dxx` rather than rewriting in place.*
