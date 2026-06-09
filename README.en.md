# Obsidian Review Comments

> 简体中文 README: [README.md](./README.md)
> 日本語版 README: [README.ja.md](./README.ja.md)

Notion-style review comments for Obsidian. Select text, add a comment from the right-click menu, command palette, hotkey, or optional floating toolbar. Comments are stored directly in `.md` files, so Claude / GPT can read the file and apply the requested edits without any export step.

## Comment format

```markdown
The original {text}{>>author=shirai;date=2026-05-13;type=EDIT;id=RC-20260513-120000-ABCD: please rewrite<<} has an issue.
Minimal human draft: {text}{>>please rewrite<<}
Point comment: {}{>>author=shirai;date=2026-05-13;type=NOTE;id=RC-20260513-120100-WXYZ: note<<}
```

- `{...}` — anchored source text. This fork writes this plain-anchor format by default because it avoids Obsidian treating `{<<word>>}` as an HTML-like tag.
- `{}{>>...<<}` — point comment with no selected span. Bare `{}` or repeated braces such as `{}{}{}` are ordinary text unless immediately followed by a comment block.
- `{>>author=...;date=...;type=...;id=RC-...: comment<<}` — full comment metadata. Semicolon-separated key-value metadata avoids `|` breaking Markdown tables. Known `type` values are `ASK`, `EDIT`, `PRAISE`, and `NOTE`; custom types are parsed and preserved.
- `{>>comment<<}` — minimal human draft. Author, date, type, id, and status are optional when typing by hand; the plugin / LLM tooling can normalize them later.
- `id=RC-...` is recommended for stable automation, but not required for human-readable comments. A thread can still be found by its anchored source text and surrounding context.
- `status` is currently `open` or `closed`. Missing status means `open`, so new open comments normally omit `status=open`. Closing a comment writes `status=closed` and preserves the source evidence instead of deleting it.
- Replies are stored as additional metadata blocks on the same anchored thread: `{anchor}{>>first<<}{>>second<<}`.
- New replies do not need `replyTo`; each `{>>...<<}` after the first one is a linear reply to the previous comment in that thread.
- Legacy `{<<...>>}{>>...<<}`, `{==...==}{>>...<<}`, and transitional `{=#...#=}{>>...<<}` comments are still parsed for backward compatibility, but new plugin writes use `{...}{>>...<<}`.
- Heading comments are inserted as point comments below the heading so the comment markup does not become part of Obsidian's heading index.
- Anchors and comment bodies may span multiple lines. The sidebar renders basic Markdown for both the anchored text and the comment body.

## Build

```bash
git clone https://github.com/ShotaShirai1719/obsidian-review-comments.git
cd obsidian-review-comments
npm install
npm run build
```

This produces `main.js`.

## Install

Let `$VAULT` be the absolute path to your Obsidian vault:

```bash
mkdir -p "$VAULT/.obsidian/plugins/review-comments"
cp main.js manifest.json styles.css "$VAULT/.obsidian/plugins/review-comments/"
```

Do not overwrite `data.json` during routine deployments. That file contains vault-specific runtime settings such as author name, auto-open, floating toolbar, and highlight preferences. Avoid wildcard or whole-directory sync commands into the vault plugin directory; copy the three build artifacts explicitly.

Or, for development, symlink the working directory:

```bash
ln -s "$(pwd)" "$VAULT/.obsidian/plugins/review-comments"
```

Then in Obsidian:

1. Settings -> Community plugins -> enable **Review Comments**
2. Settings -> Review Comments -> set `Author name` to your own name

## Usage

1. Drag-select a span of text
2. Right-click the selection and choose a comment type, or use the optional floating toolbar
3. Enter your comment in the modal. Multiline notes, bullet lists, links, inline code, and other basic Markdown are supported in the sidebar.

Alternatively:

- Select text -> Command palette -> `Review Comments: Add comment to selection`
- Command palette -> `Review Comments: 检查当前文件批注`
- Select text -> optional floating toolbar type button
- Assign a hotkey, recommended: `Cmd + Shift + M`

The floating toolbar can be disabled in plugin settings without affecting the right-click menu, commands, or hotkeys.

`检查当前文件批注` scans the current Markdown file for protocol issues and reports errors, warnings, and informational hints in a Notice plus modal. It currently covers duplicate `id`, legacy `replyTo`, orphan `{>>` / `<<}` markers, suspected comments inside fenced code blocks, bare `{}` / `{}{}{}` edge cases, range comments embedded in headings, multiline comments in line-sensitive Markdown structures, legacy pipe metadata inside tables, and minimal drafts without `id`.

## Side panel

Open the comments panel from the left ribbon speech-bubble icon or via `Review Comments: Open comments panel`.

- The top of the panel shows total / open / closed counts for the current file.
- Use the status and type filters to focus on open comments, closed comments, or a specific comment type.
- Click the anchored source text to jump to the corresponding location in the document.
- Double-click the comment body to edit the existing comment in place.
- The anchored text and comment body are rendered as basic Markdown.
- `回复` appends a new `{>>...<<}` block at the end of the selected linear thread.
- `关闭` sets `status=closed` for the comment thread while preserving the Markdown comment.
- Closed comments are folded by default. Use `展开` to inspect them and `打开` to restore the thread to open state.
- `Delete` / `删除` is a separate destructive action. The first click arms the button as `确认删除`; the second click removes the selected comment markup and restores its anchor text.

## AI integration

Pass the `.md` file directly to Claude Code or another LLM with a prompt like:

> Apply the edits described in the review comments (`{...}{>>...<<}` and `{}{>>...<<}`) in this file. Treat legacy `{<<...>>}{>>...<<}` comments as read-compatible old format. Remove the review markup once each comment has been applied, and restore the anchored spans to plain text.

This closes the loop: comment in Obsidian -> hand off to an LLM -> get a clean diff back.

## Development

```bash
npm run dev   # watch mode
npm run build # production build
npm test      # parser and source-editing regression tests
```

## Changelog

- 2026-06-09: Added the `检查当前文件批注` command for current-file comment protocol linting. Validation: `npm test` 43/43 PASS, `npx tsc --noEmit` PASS, `npm run build` PASS, deployed only `main.js`, `manifest.json`, and `styles.css` to the test vault without overwriting `data.json`.

## License

[AGPL-3.0-or-later](./LICENSE).

Any modified version that you distribute, **or expose over a network**, must be made available under the same license. If that's a constraint for your use case, please open an issue before integrating this plugin into a closed product.
