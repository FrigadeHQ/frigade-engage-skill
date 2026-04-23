---
name: frigade-engage
description: Build and manage Frigade Engage flows (announcements, tours, checklists, nudges, forms, banners, cards, NPS surveys) directly from Claude Code, including end-to-end wiring into React/Next.js codebases. Use when the user mentions Frigade, onboarding flows, product tours, checklists, announcements, or in-product guides.
version: 0.0.1
authored-against:
  backend-app: d245b4fd
  frigade-web: 17326986
  docs: fc1fe0c3
  demo-v2: 82b68403
  frigade-react: 2.9.4
---

# frigade-engage

## What this skill does

`frigade-engage` lets you build onboarding flows for your product — announcements, tours, checklists, forms, surveys, banners, and cards — directly from Claude Code. It manipulates your Frigade workspace via the Frigade API (GraphQL + REST) and wires the `@frigade/react` SDK into your Next.js or React codebase end-to-end. Once your keys are set up, you never need to open the Frigade dashboard: Claude reads and writes flow definitions, targeting rules, YAML payloads, and the component calls that render flows in your app — all from one conversation.

## Critical pre-flight: always run first-run-setup

**Every skill invocation runs `recipes/first-run-setup.md` first.** This ensures the project has Frigade API keys configured, the repo is bound to a Frigade workspace, and the `.env.local` / `.gitignore` / `.frigade/project.json` are set up correctly before any API call is made. Never skip this step. If keys or the workspace binding are missing, the setup recipe walks the user through initialization (public key + private secret for dev, optionally prod) and writes `.frigade/project.json` so subsequent invocations skip straight to work.

If the user's request looks entirely read-only ("what flows do I have?"), setup still runs — it's what proves we have credentials to read in the first place.

## Safety model summary

- **Dev environment (default):** All operations run immediately. Fast iteration, low friction, no confirmation prompts.
- **Prod environment:** Any operation tagged `dangerous` in `reference/operations.md` requires explicit confirmation (`"About to <verb> <target> in prod. Confirm? (y/n)"`) before executing.
- **Destructive operations** (`delete-flow`, `reset-user`, `delete-user-group`, `delete-rule`, and others flagged in `reference/operations.md`) are tagged `dangerous` in **both** environments — confirmation is always required regardless of env.
- **Batch confirmations:** One confirmation per operation batch, not per sub-item. Example: promoting 3 flows dev → prod = one confirmation covering all three, not three separate prompts.
- **Confirmation canonical format:** `"About to <verb> <target> in <environment>. Confirm? (y/n)"`. Anything other than `y`/`yes` aborts cleanly — no partial state is left behind.

The authoritative list of operation names, their verbs, their targets, and their `dangerous` flag is `reference/operations.md`. Always consult that file before emitting a confirmation prompt.

## Dispatch table — recipes

| If the user wants to… | Read |
|---|---|
| First use, set up, plug in keys | `recipes/first-run-setup.md` |
| Create an announcement | `recipes/create-announcement.md` |
| Create a tour (with DOM anchors) | `recipes/create-tour.md` |
| Link flows (e.g., announcement CTA starts a tour) | `recipes/link-flows.md` |
| Promote dev → prod | `recipes/promote-to-prod.md` |
| Reset a user so they see flows again | `recipes/reset-user.md` |
| Create a checklist | `recipes/create-checklist.md` |
| Create a form | `recipes/create-form.md` |
| Create a survey | `recipes/create-survey.md` |
| Create an NPS survey | `recipes/create-nps-survey.md` |
| Create a banner | `recipes/create-banner.md` |
| Create a card | `recipes/create-card.md` |
| Duplicate a flow | `recipes/duplicate-flow.md` |
| Delete a flow | `recipes/delete-flow.md` |
| Update a flow's YAML | `recipes/update-yaml.md` |
| Update targeting on a flow | `recipes/update-targeting.md` |
| Publish a flow | `recipes/publish-flow.md` |
| List flows in the workspace | `recipes/list-flows.md` |
| Get a single flow's details | `recipes/get-flow.md` |
| Manage flow versions (revert, diff, history) | `recipes/version-management.md` |
| Anything not above | Consult `reference/operations.md` + `reference/rest-endpoints.md` and extend the closest fully-authored recipe pattern |

## Dispatch table — references

| For questions about… | Read |
|---|---|
| Which ops exist, their verb/target, their safety tag | `reference/operations.md` |
| GraphQL queries and mutations (shapes, arguments, responses) | `reference/graphql-schema.md` |
| REST endpoints (URLs, headers, bodies, auth) | `reference/rest-endpoints.md` |
| `@frigade/react` SDK surface (provider, components, hooks, env vars) | `reference/sdk-react.md` |
| How to wire Frigade into a Next.js App Router project (≥13) | `reference/next-app-router.md` |
| How to wire Frigade into a Next.js Pages Router project | `reference/next-pages-router.md` |
| Flow YAML structure (the `data` field of a flow) | `reference/yaml-spec.md` |
| Targeting rules and audience DSL | `reference/targeting-and-rules.md` |
| Error classes, status codes, and recovery strategy | `reference/errors.md` |
| Why the skill is scoped/shaped this way (D## decisions referenced in recipes and references) | `reference/decisions.md` |

## Hard rules (non-negotiable)

1. **Private keys never enter web-app code.** `FRIGADE_API_KEY_SECRET` and `FRIGADE_API_KEY_SECRET_PROD` only appear in `.env.local` (gitignored) and in `Authorization: Bearer ...` headers in `curl` / server-side fetch calls issued from the skill itself. Never inside JSX/TSX, never as a React prop, never in a client-side `fetch`, never in any file under `src/`, `app/`, `pages/`, or `components/`. **Grep guard:** after any code emission, confirm `grep -r FRIGADE_API_KEY_SECRET src/ app/ pages/ components/` returns zero hits. If it returns anything, revert the emission and report the violation.

2. **Multi-file code edits are atomic.** If any edit in a batch fails (syntax error, type error, failed write, failed API call mid-batch), revert all prior edits in that same batch. Keep pre-edit snapshots of every file touched. Never leave the repo half-wired.

3. **Upstream Frigade state is preserved on partial failure.** Never auto-delete a server-side flow to "recover" from a downstream failure. If flow creation succeeded but code wiring failed, report what succeeded and what failed, and offer an explicit retry path or user-initiated cleanup (`recipes/delete-flow.md`). The skill does not silently unwind server state.

4. **Consistency between server and code.** Deleting a flow also removes in-code `<Flow flowId="..." />` / `<Tour flowId="..." />` / hook references. Renaming a flow ID updates both the server-side flow **and** every code site that references it. If code cannot be safely updated (e.g., the flow ID is constructed dynamically, is referenced from a file the skill can't parse, or lives in an unsupported framework), refuse the rename and explain why.

5. **Every write op logs to `.frigade/skill.log`** in the host repo. Log entries: ISO timestamp, operation name, request (with `Authorization` REDACTED), response body, and any recovery taken on failure. `.frigade/skill.log` is gitignored by the setup recipe. Reads are not logged — only writes (create, update, delete, publish, promote, reset).

6. **Confirmation prompts use the canonical format.** Exact wording: `"About to <verb> <target> in <environment>. Confirm? (y/n)"`. The verb and target come from the matching row in `reference/operations.md`. Anything other than `y`/`yes` aborts — no partial state, no "well I already did step 1".

7. **Recipe-based execution.** For every user intent, consult the dispatch table, read the matched recipe end to end, then follow it. Do not improvise multi-step operations. If the matched recipe is a stub (short file, no concrete steps) and the user's request needs depth the stub doesn't cover, extend the pattern from the closest fully-authored recipe (`create-announcement.md`, `create-tour.md`, `link-flows.md`, `promote-to-prod.md`, `reset-user.md`, `first-run-setup.md`) and surface that you're extrapolating so the user can sanity-check.

## Framework support

- **React (plain):** supported via the vanilla `<FrigadeProvider>` + component pattern. See the relevant recipe's "wire into React" section and `reference/sdk-react.md`.
- **Next.js App Router (≥13):** supported. See `reference/next-app-router.md` for provider placement, server/client boundaries, and env var wiring.
- **Next.js Pages Router:** supported. See `reference/next-pages-router.md` for `_app.tsx` wiring and API route patterns.
- **Other frameworks (Vue, Remix, SvelteKit, React Native, Angular, Astro, etc.):** not yet. The skill will happily create flows server-side, but code-emission stops at the framework check. It reports:

  > Flow is live in Frigade but I can't automatically wire it into this framework — manual setup: https://docs.frigade.com/quickstart

  Flow creation, update, delete, and promotion still work end-to-end — only codebase wiring is affected.

The framework detection happens in `recipes/first-run-setup.md` and is re-checked by every wiring-capable recipe before it emits code.

## Cross-references and governance

- Decisions log (all locked decisions + rationale): `reference/decisions.md`

If you are Claude and a user's request does not map cleanly to a row in the dispatch table, do not silently improvise. Tell the user which recipe you think is closest, propose an extension of that pattern, and wait for confirmation before executing. The decisions log captures why the skill is scoped and shaped the way it is — consult it when an ambiguity comes up that isn't answered here.
