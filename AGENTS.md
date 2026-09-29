# AGENTS.md — Frigade Engage skill (Codex / generic agent entrypoint)

This directory is the **frigade-engage** skill: build and manage Frigade Engage flows (announcements, tours, checklists, forms, surveys, banners, cards, NPS) and collections, and wire the `@frigade/react` SDK into React / Next.js codebases — all from your coding agent.

It is harness-neutral. Claude Code loads it via `SKILL.md`; you (Codex, or any other agent that reads `AGENTS.md`) load it via this file.

## How to operate this skill

1. **Read `reference/agent-harness.md` first.** It maps Claude Code tool names (`Read`/`Write`/`Edit`/`Glob`/`Bash`) to your equivalents and explains that "Claude" in the docs means **you, the running agent**.
2. **Read `SKILL.md` and follow it exactly** — its dispatch tables, hard rules, safety model, and framework-support rules are authoritative. Ignore its top YAML frontmatter (that is Claude Code metadata).
3. **Always run `recipes/first-run-setup.md` first**, every invocation, before any Frigade API call — it verifies keys and the workspace binding.
4. For a given user intent, look it up in the `SKILL.md` §"Dispatch table — recipes", open the matched recipe under `recipes/`, and follow it end to end. Consult `reference/` for API/SDK/YAML details.

## When this skill applies

Activate when the user mentions Frigade, onboarding flows, product tours, checklists, announcements, in-product guides, forms/surveys/NPS, banners, cards, or flow collections (creating, promoting, or adding flows to a collection).

## Non-negotiables (see `SKILL.md` §"Hard rules" for the full list)

- Private keys (`FRIGADE_API_KEY_SECRET*`) live only in `.env.local` and `Authorization: Bearer` headers — never in app code.
- Prod is promote-only: don't author flows/collections directly in prod; steer to dev→promote (typed override `edit prod directly` required).
- Never send a client-invented flow `slug` on create — Frigade generates `flow_<id>`; read it back from the response and use it for wiring.
- Log every write op to `.frigade/skill.log` with the `Authorization` header redacted.
