# Point Comment

## Heading That Should Stay Clean
{}{>>author=Human;date=2026-06-09;type=COMMENT;id=RC-20260609-121000-IJKL;scope=heading;target=Heading That Should Stay Clean: This is a heading-level comment stored below the heading.<<}

Expected agent behavior:

- Treat `{}{>>...<<}` as a valid point comment.
- Do not treat bare `{}` as a comment.
- Do not move the comment marker into the heading text.
