# Frigade Engage — Claude Code Skill

Build and manage [Frigade Engage](https://frigade.com/engage) onboarding flows — announcements, product tours, checklists, forms, surveys, banners, cards, NPS — from your terminal through Claude Code, with end-to-end wiring into React and Next.js codebases.

**Status:** Pre-v1.

## What it does

Once installed, you can ask Claude in your project:

- *"Create a welcome announcement with a 'Take a tour' button."*
- *"Build a 3-step product tour anchored to the Create, Settings, and Sidebar."*
- *"Promote these two flows from dev to prod."*
- *"Reset user `u_123` so they see the onboarding again."*

The skill manipulates your Frigade workspace via the public GraphQL + REST APIs, and wires the `@frigade/react` SDK into your codebase (provider, component mounts, DOM anchors, env-var setup). You never need to open the Frigade dashboard.

## Install

Clone the repo into your Claude Code skills directory:

```sh
git clone https://github.com/FrigadeHQ/frigade-engage-skill.git ~/.claude/skills/frigade-engage
```

Or, if you're working on the skill itself, symlink your checkout:

```sh
git clone https://github.com/FrigadeHQ/frigade-engage-skill.git
ln -s "$(pwd)/frigade-engage-skill" ~/.claude/skills/frigade-engage
```

Claude Code picks it up on the next session. The skill auto-activates when the user mentions Frigade, onboarding flows, product tours, checklists, collections, announcements, or in-product guides.

## First run

The first time you ask Claude to do anything Frigade-related in a project, it runs `recipes/first-run-setup.md`:

1. Prompts you to paste your dev public + private API keys (from `app.frigade.com/settings/api`).
2. Writes them to `.env.local` (creating it if needed), ensures `.gitignore` excludes it.
3. Writes a `.frigade/project.json` marker binding the repo to your Frigade workspace (safe to commit).
4. Verifies the keys work against the Frigade API.

Prod keys are optional and only needed for prod-side ops or dev→prod promotion.

## Repo layout

```
SKILL.md              — entry point (metadata + dispatch tables + hard rules)
recipes/              — step-by-step playbooks for each user intent
reference/            — API surface, SDK wiring, error handling
examples/             — production-quality YAML examples per flow type
tests/                — integration tests (local-only; see below)
scripts/              — maintenance scripts (sweep leaked test flows)
```

## Framework support

- **React (plain)** — supported
- **Next.js App Router (≥13)** — supported
- **Next.js Pages Router** — supported
- **Other (Vue, Remix, SvelteKit, React Native, Angular, Astro)** — the skill creates flows server-side but reports "can't auto-wire this framework — manual setup: https://docs.frigade.com/quickstart"

## Safety model

- **Dev:** all operations run immediately (fast iteration, no friction).
- **Prod:** operations that write to prod state or cross environments require explicit confirmation.
- **Destructive ops** (`delete-flow`, `reset-user`, etc.) always confirm, regardless of environment.

Full model in [`SKILL.md`](SKILL.md) § "Safety model summary" and [`reference/operations.md`](reference/operations.md).

## Running the integration tests

The repo ships with end-to-end integration tests (`tests/integration/`) that exercise the skill against a real Frigade test workspace. They're local-only — no CI.

**Setup (one time):**

1. Create a dedicated Frigade test workspace with both a dev and a prod organization.
2. `cp .env.test.local.example .env.test.local`, then paste your `ANTHROPIC_API_KEY` and the four Frigade test keys.
3. `npm install`

**Run:**

```sh
npm test                        # all six test files
npm run test:create             # create announcement + wire into Next.js
npm run test:promote            # dev→prod promotion (flow)
npm run test:delete             # delete dev flow (confirm required)
npm run test:prod-confirm       # prod delete: decline + accept paths
npm run test:targeting          # update targeting by user property
npm run test:promote-collection # dev→prod promotion (collection)
npm run test:sweep              # delete all TEST-prefixed flows in both envs
```

Tests use title-prefixed flows (`TEST-<stamp>-...`) so leaked flows are identifiable. Each test's `afterEach` deletes flows it created; `npm run test:sweep` is a safety net for crashed runs.
