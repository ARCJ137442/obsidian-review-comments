# Review Comments Markdown Protocol

This protocol describes how agents should read and write Markdown-native review
comments created by the Review Comments plugin.

## Source Of Truth

The Markdown file is the source of truth. Plugin settings and Obsidian UI state
may help presentation, but an agent must be able to understand comments from raw
Markdown alone.

## Preferred Format

```markdown
{anchor}{>>author=Human;date=2026-06-09;type=NOTE;id=RC-20260609-120000-ABCD: body<<}
```

Fields:

- `anchor`: the reviewed text. It may be empty only for point comments.
- `{>>...<<}`: one comment entry.
- metadata: optional semicolon-separated key-value fields before the first `:`.
- body: the comment body after the first `:`.

Recommended metadata:

```text
author=Human;date=YYYY-MM-DD;type=NOTE;id=RC-YYYYMMDD-HHMMSS-RAND
```

`status=open` is optional and should usually be omitted. `status=closed` is
explicit because it changes lifecycle state.

## Minimal Draft

Humans may write low-friction comments without metadata:

```markdown
{anchor}{>>please clarify this<<}
```

Agents should preserve minimal drafts unless the requested operation requires
normalization.

## Linear Threads

Threads are linear and adjacent:

```markdown
{anchor}{>>first comment<<}{>>second comment<<}{>>third comment<<}
```

The second entry replies to the first, the third replies to the second, and so on.
Do not create tree-shaped reply topology by adding `replyTo` to new comments.

## Point Comments

Point comments have no selected text:

```markdown
{}{>>author=Human;date=2026-06-09;type=NOTE;id=RC-20260609-120000-ABCD: point comment<<}
```

Use point comments for cursor comments, no-selection right-click comments, or
heading comments that should not alter a heading line.

These are not comments:

```markdown
{}
{}{}{}
{ordinary text}
```

A plain anchor is a comment only when followed immediately by `{>>...<<}`.

## Compatible Legacy Formats

Agents should recognize these formats when present:

```markdown
{==anchor==}{>>author|date|TYPE: body<<}
{==anchor==}{>>author|date: body<<}
{<<anchor>>}{>>author|date|TYPE: body<<}
{=#anchor#=}{>>author|date|TYPE: body<<}
```

Do not migrate compatible legacy syntax unless the user explicitly asks for it.

## Lifecycle

- Missing status means `open`.
- `status=closed` means the comment is closed but preserved.
- Closing is not deletion.
- Deletion is destructive and should require explicit user intent.

## Types

Known built-in types include:

```text
ASK, EDIT, PRAISE, NOTE
```

Custom types may appear. Preserve unknown types exactly.

`PRAISE` is normally evidence or feedback, not an action item.

## Markdown Boundaries

- Do not parse comments inside fenced code blocks.
- Tables, lists, blockquotes, and callouts may contain comments.
- In line-sensitive structures such as tables and lists, prefer one-line agent
  replies when possible.
- Metadata should use semicolon key-value fields rather than pipe-separated fields
  when writing new comments, because `|` can break Markdown tables.

## Heading Comments

Do not wrap heading text in comment anchors. Put a point comment immediately below
the heading:

```markdown
## Heading Text
{}{>>author=Human;date=2026-06-09;type=NOTE;id=RC-20260609-120000-ABCD;scope=heading;target=Heading Text: comment body<<}
```

This keeps heading indexes and wiki links stable.
