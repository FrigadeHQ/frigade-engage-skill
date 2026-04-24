# Integration tests for the frigade-engage skill — design

**Date:** 2026-04-23
**Status:** Spec — awaiting implementation plan

## Goal

End-to-end integration tests that exercise the `frigade-engage` Claude Code skill against a real Frigade test workspace, verifying five user-facing behaviors:

1. Create an announcement + wire it into a Next.js codebase.
2. Promote a flow from dev to prod.
3. Delete a flow (confirmation required even in dev).
4. Prod delete must prompt and respect a decline (safety gate).
5. Update flow targeting by user property.

These tests catch regressions when recipes are edited, when the skill's dispatch logic drifts, or when the upstream Frigade API changes under the skill's assumptions.

## Non-goals

- CI integration. Tests run locally only; no GitHub Actions workflow.
- Mock Frigade server. Real API only.
- Cross-framework coverage. Next.js App Router only in v1 (Pages Router, plain React, Remix, Vue etc. are deferred).
- Performance benchmarks.

## Architecture

```
tests/
├── integration/
│   ├── create-flow.test.ts
│   ├── promote-flow.test.ts
│   ├── delete-flow.test.ts
│   ├── prod-delete-confirm.test.ts
│   └── update-targeting.test.ts
├── fixtures/
│   └── next-app-template/            # committed minimal Next App Router scaffold
│       ├── package.json              # next@15, react@19; @frigade/react NOT pre-installed
│       ├── tsconfig.json
│       ├── next.config.js
│       └── app/
│           ├── layout.tsx            # trivial <html><body>{children}</body></html>
│           └── page.tsx              # trivial <h1>Test app</h1>
├── helpers/
│   ├── harness.ts                    # Agent SDK wrapper: loads skill, sends prompt, captures events + text
│   ├── fixture.ts                    # mkdtemp + copy template + symlink node_modules + chdir
│   ├── frigade-client.ts             # thin REST wrapper for setup/teardown (bypasses the skill)
│   ├── confirm.ts                    # programmatic responder for canonical "y"/"n" prompts
│   └── cleanup.ts                    # tracks created flows; afterEach teardown
├── .cache/                           # gitignored; shared node_modules for fixture
└── setup.ts                          # vitest globalSetup: verifies .env.test.local, prewarms cache
package.json                          # adds vitest, @anthropic-ai/claude-agent-sdk, tsx, typescript, dotenv
vitest.config.ts                      # points globalSetup at tests/setup.ts
.env.test.local.example               # committed; documents required vars
.env.test.local                       # gitignored; user-provided creds
```

### Per-test flow

1. `beforeEach`: `mkdtemp()`, copy `tests/fixtures/next-app-template/` into the tmpdir, symlink `node_modules` from `tests/.cache/node_modules/`, chdir into tmpdir.
2. Spawn an Agent SDK session with the skill loaded (skill root = repo root), cwd = tmpdir.
3. Send the prompt. Stream tool-use events and assistant text into two arrays the test can assert against.
4. When the assistant produces text that matches the canonical confirmation prompt format or a known first-run-setup prompt, the harness sends the configured response as a user message into the same SDK session (`y`, `n`, or the relevant API key). Each test declares its response policy up front; the harness fails fast on any prompt it can't classify.
5. Assert on (a) tool-use events, (b) assistant text containing canonical prompts, (c) remote Frigade state via the direct REST helper, (d) tmpdir file contents.
6. `afterEach`: delete all flows this test tracked (both dev and prod), `rm -rf` tmpdir, best-effort — failures logged, not fatal.

### Fixture reuse

The `next-app-template/` ships without `node_modules`. On first test run in a session, `globalSetup` runs `npm install` against the template into `tests/.cache/node_modules/` once. Every `beforeEach` then symlinks that cache into the per-test tmpdir. When the skill runs `npm install @frigade/react` inside the tmpdir, it writes into the symlinked cache — acceptable because the cache is test-only and can be rebuilt.

## Secrets

`.env.test.local` (gitignored), four vars, all from a dedicated Frigade test workspace:

```
FRIGADE_TEST_API_KEY_PUBLIC=
FRIGADE_TEST_API_KEY_SECRET=
FRIGADE_TEST_API_KEY_PUBLIC_PROD=
FRIGADE_TEST_API_KEY_SECRET_PROD=
```

`.env.test.local.example` (committed) documents the same vars with empty values.

`globalSetup` fails fast with a readable error if any var is missing or empty. The harness injects these values when the skill's `first-run-setup` recipe prompts for keys — so the skill writes its own `.env.local` inside the tmpdir using real test credentials, exercising the real onboarding path.

## Flow identification and cleanup

Slugs are server-generated (the skill's own recipes note the server may rewrite a client-proposed slug), so tests cannot rely on slug prefixes for identification. Tests identify flows by **title prefix** instead.

- **Title convention.** `TEST-<yyyymmddhhmm>-<shortid>-<kind>`. Human-readable in the dashboard.
- **Per-test tracking.** The harness captures `{slug, numericId}` pairs from tool-use events and from direct REST helper calls. `afterEach` DELETEs each tracked flow in both dev and prod workspaces — best-effort; errors logged but do not fail the test.
- **Global sweep.** `npm run test:sweep` — lists all flows in dev + prod test workspaces, filters `title.startsWith("TEST-")`, DELETEs each. Safety net for crashed runs.

## Test cases

### 1 · `create-flow.test.ts` — create announcement + wire into Next.js

**Setup.** Fresh tmpdir fixture; no existing `.env.local` or `.frigade/` (so `first-run-setup` runs). Harness responds to key prompts with `.env.test.local` values and auto-confirms batch prompts with `y`.

**Prompt.** *"Create a welcome announcement titled `TEST-<stamp>-welcome` with message 'Hi from tests' and a 'Get started' button."*

**Assertions.**
- Frigade: flow exists with that title; `type == "ANNOUNCEMENT"`. Capture `{slug, numericId}` from tool-use events.
- Tmpdir `.env.local`: contains `NEXT_PUBLIC_FRIGADE_API_KEY=<test-public>` and `FRIGADE_API_KEY_SECRET=<test-secret>`.
- Tmpdir `.frigade/project.json`: exists with workspace id.
- Tmpdir `.gitignore`: contains `.env.local` and `.frigade/skill.log`.
- Tmpdir `app/layout.tsx`: `{children}` is wrapped in the Frigade provider (per `reference/sdk-react.md` — exact component name read from the reference at implementation time).
- Tmpdir: `<Frigade.Announcement flowId="<captured-slug>" />` (string match, tolerant of surrounding whitespace and prop ordering) appears in at least one file under `app/`.
- Tmpdir `package.json`: `@frigade/react` in dependencies.
- Grep guard: `grep -r FRIGADE_API_KEY_SECRET <tmpdir>/{app,src,pages,components}` returns zero hits. Enforces the D07 hard rule.

### 2 · `promote-flow.test.ts` — dev → prod promotion

**Setup.** Tmpdir fixture. Seed `.env.local` with dev + prod creds and `.frigade/project.json` so `first-run-setup` is skipped. Direct REST helper creates a dev flow titled `TEST-<stamp>-promote-me`; capture `{slug, numericId}`.

**Prompt.** *"Promote flow `<slug>` from dev to prod."*

**Harness.** One `y` when the canonical batch-confirmation prompt arrives.

**Assertions.**
- Assistant text contains a line matching the canonical format from `reference/operations.md` with environment=prod. Exact regex derived from `reference/operations.md`'s template at implementation time.
- Prod workspace now contains a flow at the same slug with matching title.
- Dev flow's `internalData.productionActiveFlowId` or `internalData.productionDraftFlowId` is now populated (per D33).

### 3 · `delete-flow.test.ts` — delete dev flow (dangerous in both envs)

**Setup.** Seeded creds; REST helper creates dev flow `TEST-<stamp>-delete-me`; capture `{slug, numericId}`.

**Prompt.** *"Delete flow `<slug>`."*

**Harness.** `y` when the prompt arrives.

**Assertions.**
- Canonical confirmation prompt appears with environment=dev. Per D09, delete is `dangerous` even in dev — regression-guard on the safety tag staying put.
- Dev `GET /v1/flows/<slug>` returns 404.

### 4 · `prod-delete-confirm.test.ts` — prod delete must prompt and respect decline

Two tests in this file.

**4a — prod delete aborts on decline.**

Setup: seeded creds (dev + prod); REST helper creates a prod flow `TEST-<stamp>-prod-decline`.

Prompt: *"Delete flow `<slug>` in prod."*

Harness: respond `n`.

Assertions:
- Canonical prompt appears with environment=prod.
- Tool-use events contain zero `DELETE /v1/flows/<slug>` against the prod base URL.
- Prod `GET /v1/flows/<slug>` still returns 200.

**4b — prod delete proceeds on confirm.**

Same setup; different flow slug (`TEST-<stamp>-prod-accept`). Harness responds `y`.

Assertions:
- Canonical prompt appears with environment=prod.
- Prod `GET /v1/flows/<slug>` returns 404.

### 5 · `update-targeting.test.ts` — update targeting by user property

**Setup.** Seeded creds. REST helper creates a dev flow `TEST-<stamp>-targeted` with empty `targetingLogic`. Capture `{slug, numericId}`.

**Prompt.** *"Update targeting on flow `<slug>` so it only shows to users whose `plan` property equals `pro`."*

**Harness.** No confirmation expected. Per D09 and `reference/operations.md`, `updateFlowTargeting` is `safe` in dev. If a confirmation prompt appears, fail — the safety tag has drifted.

**Assertions.**
- Re-fetched flow has `targetingLogic` matching a valid DSL expression for `userProperty "plan" == "pro"`. Exact expression read from `reference/targeting-and-rules.md` at implementation time; test accepts any syntactically-valid variant the reference documents.
- A `PUT /v1/flows/<numericId>` (or equivalent) write event appears in the tool-use stream.
- Other flow fields (title, type, data/YAML body, status) are unchanged from the pre-update snapshot.

## Error handling

- **Missing env vars.** `globalSetup` fails with a single friendly message listing the required vars and pointing at `.env.test.local.example`.
- **Frigade API 5xx during setup or teardown.** Logged; setup failures abort the test; teardown failures are logged but do not fail the test (the global sweep will catch leaked flows).
- **Claude produces an unexpected prompt the harness doesn't know how to answer.** Harness has a fallback: if an unrecognized prompt appears, the harness captures the full transcript for the failing test's assertion output and fails with "unhandled prompt: <text>".
- **Timeout.** Each test has a 2-minute ceiling (vitest `testTimeout: 120_000`). Exceeded → teardown runs; test fails.

## Package scripts

- `npm test` — run all integration tests.
- `npm run test:create` / `test:promote` / `test:delete` / `test:prod-confirm` / `test:targeting` — run one file.
- `npm run test:sweep` — list and delete all `TEST-`-prefixed flows in dev + prod.

## What this design explicitly does NOT cover

- Testing recipe stubs (the 14 stub recipes in `recipes/` that don't yet have full playbooks).
- Partial-failure recovery paths (D16) — those need their own test patterns and are deferred.
- Link-flows cross-flow CTA wiring (D12 revised) — separate recipe, separate test.
- Reset-user (deleting user-flow-state).
- Version management recipes.
- Pages Router, React-only, or non-Next frameworks.

These are explicit future work, not gaps.

## Open questions resolved during brainstorm

- Test substrate: real Frigade, local-only (no CI), user-provided creds.
- Claude invocation: Claude Agent SDK (TypeScript).
- Test runner: vitest.
- Create-flow scope: full end-to-end including code wiring into a Next.js fixture.
- Flow identification: title prefix, not slug prefix (slugs are server-generated).

## Dependencies

Runtime / test deps (all go in `devDependencies` since there is no production build):

- `@anthropic-ai/claude-agent-sdk`
- `vitest`
- `typescript`
- `tsx`
- `dotenv`

## Risks

- **Upstream Frigade API drift.** Tests using the real API will fail if Frigade changes an endpoint shape. That is intentional — we want to know when the skill's assumptions break. Mitigation: descriptive failure messages and the `reference/` files as the diagnostic starting point.
- **Leaked flows on crashed runs.** Mitigated by title prefix + `npm run test:sweep`. Acceptable baseline.
- **Non-determinism in Claude's output.** Assertions target invariants (tool-use calls made, canonical prompt text, Frigade state, file contents) — not the full assistant transcript. Cosmetic prose variation does not fail tests.
- **Agent SDK behavior changes.** The harness isolates SDK-specific details in `tests/helpers/harness.ts`. Breaking SDK changes are a one-file fix.

## Next step

Hand off to `writing-plans` for a task-by-task implementation plan.
