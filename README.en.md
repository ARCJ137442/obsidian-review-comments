# Obsidian Review Comments

> 简体中文 README: [README.md](./README.md)
> 日本語版 README: [README.ja.md](./README.ja.md)

Notion-style review comments for Obsidian. Select text, add a comment from the right-click menu, command palette, hotkey, or optional floating toolbar. Comments are stored directly in `.md` files, so Claude / GPT can read the file and apply the requested edits without any export step.

For human review or comment debates, the plugin can also copy the current file's comment threads as Markdown. The minimal format only keeps `> anchored text` plus the comment/reply bodies; the simple format starts with `# 当前文件批注清单` and separates each item into `批注对象` and `批注正文`; the full format adds file, location, status, type, author, date, and id metadata.

## Comment format

```markdown
The original {text}{>>author=shirai;date=2026-05-13;type=EDIT;id=RC-20260513-120000-ABCD: please rewrite<<} has an issue.
Minimal human draft: {text}{>>please rewrite<<}
Point comment: {}{>>author=shirai;date=2026-05-13;type=COMMENT;id=RC-20260513-120100-WXYZ: note<<}
```

- `{...}` — anchored source text. This fork writes this plain-anchor format by default because it avoids Obsidian treating `{<<word>>}` as an HTML-like tag.
- `{}{>>...<<}` — point comment with no selected span. Bare `{}` or repeated braces such as `{}{}{}` are ordinary text unless immediately followed by a comment block.
- `{>>author=...;date=...;type=...;id=RC-...: comment<<}` — full comment metadata. Semicolon-separated key-value metadata avoids `|` breaking Markdown tables. Built-in `type` values include the generic default `COMMENT` (shown as `批注` in the UI), plus `ASK`, `EDIT`, `PRAISE`, and `NOTE`; custom types are parsed and preserved.
- `{>>comment<<}` — minimal human draft. Author, date, type, id, and status are optional when typing by hand; the plugin / LLM tooling can normalize them later.
- `id=RC-...` is recommended for stable automation, but not required for human-readable comments. A thread can still be found by its anchored source text and surrounding context.
- `status` is currently `open` or `closed`. Missing status means `open`, so new open comments normally omit `status=open`. Closing a comment writes `status=closed` and preserves the source evidence instead of deleting it.
- Replies are stored as additional metadata blocks on the same anchored thread: `{anchor}{>>first<<}{>>second<<}`.
- New replies do not need `replyTo`; each `{>>...<<}` after the first one is a linear reply to the previous comment in that thread.
- Legacy `{<<...>>}{>>...<<}`, `{==...==}{>>...<<}`, and transitional `{=#...#=}{>>...<<}` comments are still parsed for backward compatibility, but new plugin writes use `{...}{>>...<<}`.
- The settings tab separates `新建批注使用格式` from `兼容读取格式`: the first controls the syntax used for newly written comments, while the second controls which historical formats are parsed, folded, rendered, listed, and linted.
- Heading comments are inserted as point comments below the heading so the comment markup does not become part of Obsidian's heading index.
- Anchors and comment bodies may span multiple lines. The sidebar renders basic Markdown for both the anchored text and the comment body.
- In line-sensitive structures such as tables, lists, blockquotes, and callouts, multiline comment bodies created through the modal or side panel are normalized to `<br>` so the raw Markdown structure stays intact.

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
- Command palette -> `Review Comments: 复制当前文件批注清单`
- Select text -> optional floating toolbar type button
- Assign a hotkey, recommended: `Cmd + Shift + M`

The floating toolbar can be disabled in plugin settings without affecting the right-click menu, commands, or hotkeys.

The `批注方式` setting switches between `弹框式批注` and `编辑式批注`. Modal creation uses a dedicated input box and protects multiline bodies in line-sensitive Markdown; inline creation inserts the raw comment markup directly into the Markdown file and places the cursor inside the body slot for source-level editing.

The settings tab also includes `新建批注使用格式` and `兼容读取格式`. By default the plugin writes `{...}{>>...<<}` plain-anchor comments while remaining read-compatible with `{<<...>>}{>>...<<}`, `{==...==}{>>...<<}`, and `{=#...#=}{>>...<<}`. The active write syntax is always kept in the compatible read set.

The settings tab also exposes `批注自动聚焦` with three modes: `不开启`, `左键`, and `右键`. When enabled, clicking or right-clicking a rendered comment in the editor / reading view automatically scrolls the side panel to the matching thread. This auto-focus follows the real DOM event target rather than the current editor cursor, which avoids mis-targeting during right-click menus, split panes, or stale selections. The explicit command `在批注栏中定位当前批注` remains available, but it is still cursor-based by design.

`检查当前文件批注` scans the current Markdown file for protocol issues and reports errors, warnings, and informational hints in a Notice plus modal. It currently covers duplicate `id`, legacy `replyTo`, orphan `{>>` / `<<}` markers, suspected comments inside fenced code blocks, bare `{}` / `{}{}{}` edge cases, range comments embedded in headings, multiline comments in line-sensitive Markdown structures, legacy pipe metadata inside tables, and minimal drafts without `id`.

`复制当前文件批注清单` copies the current file's comment threads to the clipboard. The `复制批注清单格式` setting switches between `极简版`, `简单版`, and `完整版`.

## Side panel

Open the comments panel from the left ribbon speech-bubble icon or via `Review Comments: Open comments panel`.

- The panel uses two lightweight chip rows for filtering: one for status and one for type. Counts are shown inside the chips themselves, so there is no separate static top count row anymore.
- Chips combine as OR within the same row and AND across rows. With nothing selected, that row defaults to “all”. Clicking `全部` temporarily overrides that row and shows every item there.
- Click the anchored source text to jump to the corresponding location in the document.
- Double-click the comment body to edit the existing comment in place.
- Reply and edit modals both expose the comment type selector at the top, and type colors are reused in anchor underlines, highlight accents, cards, and thread entries.
- The anchored text and comment body are rendered as basic Markdown.
- `复制清单` copies the current file's comments as Markdown using the configured export format.
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

Implementation notes:

- Cross-line `{>>...<<}` comment bodies must be folded through `StateField` decorations provided directly to CodeMirror. Do not move cross-line `Decoration.replace` back into a `ViewPlugin`; Obsidian / CodeMirror rejects plugin-provided decorations that replace line breaks.
- CodeMirror mode synchronization must be deferred. Do not call `view.dispatch(...)` inside a `ViewPlugin` constructor or `update` callback, or Obsidian can throw `Calls to EditorView.update are not allowed while an update is in progress`.
- Reading-mode table comments must not be parsed per DOM text node. Obsidian splits one raw comment thread across multiple text nodes when inline Markdown such as code spans is rendered. Table-cell Markdown postprocessors can also receive detached `div.table-cell-wrapper` roots before Obsidian attaches them to the document, so `node.isConnected === false` is not a valid renderability check. Group text nodes by table-cell / paragraph / list-item / blockquote / callout container, parse the joined text, then replace the full DOM range through the root `ownerDocument` while requiring only parented text nodes.
- Reading mode should also skip pseudo-comments that are fully contained inside `code` or `pre`, so inline-code samples do not get rendered as real review comments.

## Changelog

- 2026-06-11: Added the `批注自动聚焦` setting with `off`, `left`, and `right` modes. When enabled, auto-focus scrolls the side panel to the matching thread based on the actual DOM event target from the editor / reading view, instead of depending on the current cursor. The explicit `在批注栏中定位当前批注` command remains cursor-based. Reading mode also skips fully inline-code / code-block pseudo-comments so `code` and `pre` samples are not rendered as live comments. Validation: `npm test` 83/83 PASS, `npx tsc --noEmit` PASS, `npm run build` PASS.
- 2026-06-11: Fixed reading-mode / Live Preview table comments when Obsidian splits one raw comment thread across multiple DOM text nodes, and added detached `div.table-cell-wrapper` regression coverage shaped after `local/reply.local.md`. Added the `批注方式` setting for modal vs inline source-level comment creation. Modal creation plus side-panel edit/reply now normalize multiline comment bodies to `<br>` inside tables, lists, blockquotes, and callouts so raw Markdown structure is not broken. The input modal also protects non-empty drafts when dismissed by accident. Validation: `npm test` 83/83 PASS, `npx tsc --noEmit` PASS, `npm run build` PASS。
- 2026-06-09: Added the `极简版` export format, which only outputs anchored text plus continuous comment/reply bodies. Restored the generic default `COMMENT / 批注` highlight, underline, and card accent to yellow for stronger default visibility. Validation: `npm test` 55/55 PASS, `npx tsc --noEmit` PASS.
- 2026-06-09: Completed the first M4/M5 pass. Settings now separate `新建批注使用格式` from `兼容读取格式`; parser calls can be limited to configured syntaxes, and new range comments, point comments, and replies use the selected write syntax. Added the generic default `COMMENT / 批注` type with light gray `#dddddd`; new comments and replies default to it, while explicit legacy `NOTE` metadata remains preserved. Validation: `npm test` 52/52 PASS, `npx tsc --noEmit` PASS, `npm run build` PASS.
- 2026-06-09: Added `复制当前文件批注清单` and the side-panel `复制清单` button. Supports simple and full Markdown export formats for review, debate, and audit workflows. Validation: `npm test` 47/47 PASS, `npx tsc --noEmit` PASS, `npm run build` PASS, deployed only `main.js`, `manifest.json`, and `styles.css` to the test vault without overwriting `data.json`.
- 2026-06-09: Added the `检查当前文件批注` command for current-file comment protocol linting. Validation: `npm test` 43/43 PASS, `npx tsc --noEmit` PASS, `npm run build` PASS, deployed only `main.js`, `manifest.json`, and `styles.css` to the test vault without overwriting `data.json`.

## License

[AGPL-3.0-or-later](./LICENSE).

Any modified version that you distribute, **or expose over a network**, must be made available under the same license. If that's a constraint for your use case, please open an issue before integrating this plugin into a closed product.
