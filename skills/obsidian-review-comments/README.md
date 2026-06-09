# Obsidian Review Comments Agent Skill

This folder contains a bundled Agent Skill for repositories or Obsidian vaults
that use the Review Comments plugin. It teaches agents how to read and write the
plugin's Markdown-native review comment format without depending on private
project context.

## When To Use

Agents may use this skill automatically only when the current workspace appears
to be an Obsidian vault with a compatible plugin installation, normally:

```text
.obsidian/plugins/review-comments/manifest.json
```

If that plugin is not present, agents should use this skill only when the user
explicitly asks for Review Comments, CriticMarkup, or this exact skill.

## What The Skill Covers

- Preferred plain-anchor comments: `{anchor}{>>comment<<}`
- Point comments with no selected text: `{}{>>comment<<}`
- Linear adjacent threads: `{anchor}{>>first<<}{>>second<<}`
- Open/closed lifecycle handling, where missing status means open
- Legacy compatible read formats, including CriticMarkup-style highlights
- Markdown boundary rules for headings, tables, lists, callouts, blockquotes, and
  fenced code blocks
- Deployment caution: preserve plugin-local `data.json` unless the user asks to
  reset settings

## Files

| File | Purpose |
| --- | --- |
| `SKILL.md` | Agent-facing operational instructions. |
| `protocol.md` | Stable Markdown protocol and edge cases. |
| `upstream.md` | Plugin compatibility and original source baseline notes. |
| `CHANGELOG.md` | Skill-level change history. |
| `agents/openai.yaml` | Small metadata shim for OpenAI-style skill loaders. |
| `examples/*.md` | Raw Markdown examples for agent smoke tests. |

## Maintenance Rules

- Keep this skill generic and open-source friendly.
- Do not include private project names, local machine paths, internal task IDs, or
  private review history.
- Keep plugin behavior and skill protocol synchronized when the Markdown format
  changes.
- Prefer adding small examples over embedding long project-specific documents.
- Preserve compatibility notes for older formats so agents can read existing
  comments without automatic migration.

