# Upstream And Compatibility Notes

## Plugin

- Obsidian community plugin id: `review-comments`
- Original upstream repository: `https://github.com/ShotaShirai1719/obsidian-review-comments`
- Original upstream baseline observed for this protocol work:
  `6b7bd2e44600524b3d0b2372ffebccb27e7e97cf`
- License: `AGPL-3.0-or-later`

This skill is bundled with the plugin repository so the plugin, its Markdown
protocol, and agent instructions can evolve together.

## Upstream Baseline Behavior

The original implementation used CriticMarkup-style highlights:

```markdown
{==selected text==}{>>author|date|TYPE: body<<}
```

It recognized built-in types:

```text
ASK, EDIT, PRAISE, NOTE
```

It also supported a shorter metadata form:

```markdown
{==selected text==}{>>author|date: body<<}
```

## Markdown-Native Protocol Direction

The bundled skill documents a broader Markdown-native protocol intended for
agent-readable workflows:

- plain anchors: `{anchor}{>>...<<}`
- point comments: `{}{>>...<<}`
- adjacent linear threads: `{anchor}{>>first<<}{>>second<<}`
- semicolon metadata: `author=...;date=...;type=...;id=...`
- closed lifecycle state: `status=closed`
- compatible reading of legacy CriticMarkup forms

Agents should prefer the current plugin's documented write format while preserving
compatible legacy syntax unless the user explicitly requests migration.
