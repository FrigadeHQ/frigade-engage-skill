# Frigade Engage — Claude Code Skill

Build and manage [Frigade Engage](https://frigade.com/engage) onboarding flows — announcements, product tours, checklists, forms, surveys, banners, cards, NPS — from your terminal through Claude Code, with end-to-end wiring into React and Next.js codebases.

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

Claude Code picks it up on the next session. The skill auto-activates when you mention Frigade, onboarding flows, product tours, checklists, collections, announcements, or in-product guides.

## First run

The first time you ask Claude to do anything Frigade-related in a project, the skill walks you through a one-time setup:

1. Prompts you to paste your dev public + private API keys (from `app.frigade.com/settings/api`).
2. Writes them to `.env.local` (creating it if needed) and makes sure `.gitignore` excludes it.
3. Binds the repo to your Frigade workspace via a committed `.frigade/project.json` marker.
4. Verifies the keys work against the Frigade API.

Prod keys are optional and only needed for prod-side operations or dev→prod promotion.

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
