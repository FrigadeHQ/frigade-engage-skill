# Harness compatibility (Claude Code, Codex, and other agents)

This skill is **harness-neutral**. The instructions in `SKILL.md`, `recipes/`, and `reference/` are plain-markdown procedures that any capable coding agent can execute. Nothing here is specific to one vendor's runtime.

## Entrypoints

| Harness | Entry file | How it loads |
|---|---|---|
| **Claude Code** | `SKILL.md` | Auto-registers via the YAML frontmatter (`name` / `description`); activates on Frigade-related requests. |
| **Codex** (and other AGENTS.md-aware agents) | `AGENTS.md` | Read automatically as project instructions; it tells the agent to open and follow `SKILL.md`. |
| **Any other agent** | `SKILL.md` | Point the agent at `SKILL.md` and have it follow the dispatch tables and hard rules. |

The YAML frontmatter at the top of `SKILL.md` is Claude Code metadata. Other harnesses can ignore it and start reading at the first Markdown heading.

## Terminology: "Claude" = you, the agent

`SKILL.md` and the recipes were first authored for Claude Code, so they sometimes say **"Claude"** or **"Claude Code"** when describing who performs a step (e.g. "Claude reads the file", "Claude emits the confirmation prompt"). Read every such reference as **"you, the coding agent running this skill"** — Claude Code, Codex, or anything else. Follow the step regardless of harness. The behavior is identical; only the runtime differs.

## Tool-name mapping

The recipes name Claude Code's built-in tools. Use your harness's equivalent — the *action* is what matters, not the tool name.

| Recipe says (Claude Code) | Action | Codex equivalent |
|---|---|---|
| `Read` | Read a file | `shell` (`cat`, `sed -n`) |
| `Write` | Create / overwrite a file | `apply_patch` (Add File) |
| `Edit` | Modify part of a file | `apply_patch` (Update File) |
| `Glob` | Find files by pattern | `shell` (`rg --files`, `find`, `ls`) |
| `Grep` | Search file contents | `shell` (`rg`) |
| `Bash` | Run a shell command | `shell` |
| `Bash` with `run_in_background: true` | Run a long-lived command (e.g. `npm run dev`) without blocking | `shell` with `&` / `nohup`, or your harness's background mechanism |

All API calls in the recipes are plain `curl` against the Frigade REST/GraphQL endpoints, so they run identically on any harness with shell access.

## What is shared vs harness-specific

- **Shared (authoritative for all harnesses):** every dispatch table, hard rule, safety-model rule, recipe, and reference doc.
- **Harness-specific:** only the two things above — the entry file each harness loads, and the tool names used to carry out file/shell actions.

If your harness lacks a capability a recipe assumes (e.g. no background process support for the dev-server step), do the equivalent manually and tell the user, rather than skipping the step.
