# Boundary Cases

## Not Comments

These sequences are ordinary text and should not be inventoried as comments:

```markdown
{}
{}{}{}
{ordinary text}
```

Expected agent behavior:

- Do not treat bare braces as review comments.
- A plain anchor becomes a comment only when immediately followed by one or more
  `{>>...<<}` entries.

## Table-Friendly Comment

| Topic | Note |
| --- | --- |
| Metadata | {semicolon fields}{>>author=Human;date=2026-06-09;type=NOTE;id=RC-20260609-122000-ABCD: Use semicolons instead of pipe-separated metadata in tables.<<} |

Expected agent behavior:

- Recognize the table comment.
- When replying inside the table, prefer one compact line.
- Do not introduce pipe-separated metadata that would add table columns.

## Multiline Body

This paragraph has {one anchor}{>>author=Human;date=2026-06-09;type=ASK;id=RC-20260609-122100-EFGH: First line of the comment.

Second paragraph of the same comment body.<<}

Expected agent behavior:

- Treat the multiline body as one comment entry.
- Preserve Markdown line breaks unless the user asks for normalization.
- Do not split the body into multiple thread entries.

