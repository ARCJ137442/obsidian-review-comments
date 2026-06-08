# Obsidian Review Comments

> 日本語版 README: [README.ja.md](./README.ja.md)

Notion-style review comments for Obsidian. Select text, add a comment from the right-click menu, command palette, hotkey, or optional floating toolbar. Comments are stored directly in `.md` files, so Claude / GPT can read the file and apply the requested edits without any export step.

## Comment format

```markdown
The original {<<text>>}{>>shirai|2026-05-13|EDIT|id=RC-20260513-120000-ABCD|status=open: please rewrite<<} has an issue.
```

- `{<<...>>}` — anchored source text. This fork writes this format by default because it does not collide with Obsidian / CriticMarkup highlight syntax.
- `{>>author|date|TYPE|id=RC-...|status=open: comment<<}` — comment metadata. Known `TYPE` values are `ASK`, `EDIT`, `PRAISE`, and `NOTE`; custom types are parsed and preserved.
- `status` is currently `open` or `closed`. Closing a comment preserves the source evidence instead of deleting it.
- Replies are stored as ordinary comments with `replyTo=RC-...`.
- Reply comments use an empty anchor by default: `{<<>>}{>>you|2026-06-08|NOTE|id=RC-reply|status=open|replyTo=RC-parent: reply body<<}`.
- Legacy `{==...==}{>>...<<}` and transitional `{=#...#=}{>>...<<}` comments are still parsed for backward compatibility.
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

1. Settings → Community plugins → enable **Review Comments**
2. Settings → Review Comments → set `Author name` to your own name

## Usage

1. Drag-select a span of text
2. Right-click the selection and choose a comment type, or use the optional floating toolbar
3. Enter your comment in the modal. Multiline notes, bullet lists, links, inline code, and other basic Markdown are supported in the sidebar.

Alternatively:

- Select text → Command palette → `Review Comments: Add comment to selection`
- Select text → optional floating toolbar type button
- Assign a hotkey (recommended: `Cmd + Shift + M`)

The floating toolbar can be disabled in plugin settings without affecting the right-click menu, commands, or hotkeys.

## Side panel

Open the comments panel from the left ribbon (speech-bubble icon) or via `Review Comments: Open comments panel`.

- The top of the panel shows total / open / closed counts for the current file.
- Use the status and type filters to focus on open comments, closed comments, or a specific comment type.
- Click the anchored source text → jump to the corresponding location in the document.
- Double-click the comment body → edit the existing comment in place.
- The anchored text and comment body are rendered as basic Markdown.
- `回复` → append a reply under the selected card, with `replyTo` pointing to the original comment id.
- `关闭` → set `status=closed` for the comment thread while preserving the Markdown comment.
- Closed comments are folded by default. Use `展开` to inspect them and `打开` to restore the thread to `status=open`.
- `Delete` / `删除` is a separate destructive action. The first click arms the button as `确认删除`; the second click removes the selected comment markup and restores its anchor text.

## AI integration

Pass the `.md` file directly to Claude Code or another LLM with a prompt like:

> Apply the edits described in the review comments (`{<<...>>}{>>...<<}`) in this file. Remove the review markup once each comment has been applied, and restore the anchored spans to plain text.

This closes the loop: comment in Obsidian → hand off to an LLM → get a clean diff back.

## Development

```bash
npm run dev   # watch mode
npm run build # production build
npm test      # parser and source-editing regression tests
```

## License

[AGPL-3.0-or-later](./LICENSE).

Any modified version that you distribute, **or expose over a network**, must be made available under the same license. If that's a constraint for your use case, please open an issue before integrating this plugin into a closed product.
