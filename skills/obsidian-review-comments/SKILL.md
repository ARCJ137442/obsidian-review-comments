---
name: obsidian-review-comments
description: |
  Use when working in an Obsidian vault that has the Review Comments plugin enabled,
  or when the user explicitly asks to process Review Comments or CriticMarkup-style
  Markdown annotations. Before using automatically, check for a compatible plugin
  installation such as `.obsidian/plugins/review-comments/manifest.json`. If no
  compatible plugin is present, do not use this skill unless the user explicitly
  invokes it.
---

# Obsidian Review Comments Skill

## Core Rule

Treat the Markdown file as the source of truth. Obsidian may improve display, but
agent behavior must remain correct when reading raw `.md` files.

Do not convert, delete, close, resolve, or rewrite review comments unless the user
explicitly asks you to process those comments.

When deploying the plugin into a vault, copy only built plugin artifacts
(`main.js`, `manifest.json`, `styles.css`) unless the user explicitly asks to reset
settings. Preserve `.obsidian/plugins/review-comments/data.json`; it is vault-local
runtime configuration, not a build artifact.

## Activation Check

Before using this skill automatically:

1. Confirm the current workspace is an Obsidian vault or contains Markdown files
   from one.
2. Check for a compatible plugin installation, normally
   `.obsidian/plugins/review-comments/manifest.json`.
3. If the plugin is not present, use this skill only when the user explicitly asks
   for Review Comments, CriticMarkup, or this exact skill.

## Supported Syntax

Prefer the plugin's Markdown-native plain-anchor syntax:

```markdown
{selected text}{>>author=Human;date=2026-06-09;type=NOTE;id=RC-20260609-120000-ABCD: comment body<<}
{selected text}{>>author=Human;date=2026-06-09;type=ASK;id=RC-20260609-120100-EFGH: first comment<<}{>>author=Agent;date=2026-06-09;type=NOTE;id=RC-20260609-120200-IJKL: linear reply<<}
{selected text}{>>minimal draft comment<<}
{}{>>author=Human;date=2026-06-09;type=NOTE;id=RC-20260609-120300-MNOP: point comment body<<}
```

Also recognize compatible legacy forms:

```markdown
{==selected text==}{>>author|date|TYPE: comment body<<}
{==selected text==}{>>author|date: comment body<<}
{<<selected text>>}{>>author|date|TYPE: comment body<<}
{=#selected text#=}{>>author|date|TYPE: comment body<<}
```

Rules:

- `{plain text}` alone is ordinary Markdown text. A plain anchor is a comment only
  when it is immediately followed by one or more `{>>...<<}` blocks.
- Bare `{}` or `{}{}{}` is not a comment. An empty anchor is valid only as a point
  comment when immediately followed by `{>>...<<}`.
- Missing `status` defaults to `open`; new open comments should normally omit
  `status=open`.
- `status=closed` means closed, not deleted. Preserve closed comments unless the
  user explicitly requests removal.
- Replies are linear. A reply is the next adjacent `{>>...<<}` block in the same
  anchored thread. Do not add `replyTo` to new replies.
- `replyTo=...` may appear in older documents. Preserve it when reading; normalize
  it only when the user explicitly asks for migration.
- Anchors and comment bodies may span multiple lines. Preserve line breaks and
  Markdown formatting unless the requested edit requires a change.
- Fenced code blocks are not parsed as comments. Tables, lists, callouts, and
  blockquotes may contain comments.
- Inside Markdown tables, lists, callouts, and blockquotes, prefer compact
  one-line agent replies when possible to avoid breaking raw Markdown structure.
- Heading comments should not wrap the heading text. Prefer a point comment on the
  line immediately below the heading.
- Preserve unknown `type` values exactly and infer intent from body and context.
- Do not treat `PRAISE` as an action item.

See `protocol.md` for the full protocol and edge cases.

## Workflow

1. Inventory comments before editing: record status, type, anchor text, thread
   order, id presence, and any legacy syntax.
2. Classify comments as unresolved unless the user says they are already handled
   or the comment is explicitly closed.
3. Apply only the comments the user asked you to process.
4. Preserve unresolved comments verbatim.
5. When resolving a normal editing comment, update the underlying prose first,
   then remove only the handled review markup if the user wants it removed.
6. When closing a comment, write or update `status=closed` and preserve the
   Markdown evidence.
7. Report what was applied, what remains unresolved, and any ambiguity.

## Writing New Comments

When the user asks you to add a visible Review Comments annotation:

- Use `{span}{>>author=Agent;date=YYYY-MM-DD;type=TYPE;id=RC-...: body<<}` for
  comments anchored to selected text.
- Use `{}{>>author=Agent;date=YYYY-MM-DD;type=TYPE;id=RC-...: body<<}` for point
  comments with no selected text.
- Use a concrete author value available in the working context. If none is known,
  use `Agent`.
- Include `id=RC-...` for agent-authored comments and replies.
- Keep comment bodies concise and action-oriented.
- Append replies as another adjacent `{>>...<<}` block after the previous entry in
  the same thread. Do not duplicate the parent anchor.

## Do Not

- Do not store review state only in JSON, sidecar files, or Obsidian plugin data
  when the user needs agent-readable Markdown.
- Do not overwrite Obsidian plugin `data.json` during routine deployments.
- Do not mirror a whole plugin working tree into `.obsidian/plugins/review-comments/`.
- Do not convert legacy CriticMarkup or compatible syntax automatically unless the
  user explicitly asks for migration.
- Do not make broad prose rewrites under the cover of processing comments. Keep
  edits scoped to comment intent.

## References

- `protocol.md` - Markdown annotation protocol.
- `upstream.md` - plugin compatibility and source baseline.
- `examples/` - small raw Markdown examples for agent tests.
