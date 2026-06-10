# Changelog

## 2026-06-11

- Added the configurable `批注自动聚焦` behavior with `off`, `left`, and
  `right` modes.
- Recorded that automatic panel focusing follows the actual DOM event target in
  the editor / reading view, while the explicit locate command remains
  cursor-based.
- Added reading-mode protection that skips pseudo-comments fully contained in
  `code` / `pre`, so inline code samples are not rendered as live comments.
- Fixed reading-mode table rendering for detached Obsidian `div.table-cell-wrapper`
  postprocessor roots. Agents should not treat `node.isConnected === false` as
  evidence that table comment markup cannot be rendered.
- Recorded that table comments are parsed from grouped text-node segments and
  replaced through the root `ownerDocument`, preserving Markdown as the truth
  source while keeping Obsidian reading mode usable.
- Added regression coverage for detached table cells, split inline Markdown text
  nodes, multiple comments in one table cell, and per-cell grouping boundaries.

## 2026-06-09

- Added the bundled Agent Skill under the plugin repository's `skills/` folder.
- Documented the preferred plain-anchor protocol, point comments, linear threads,
  and open/closed lifecycle handling.
- Recorded compatible read support for legacy CriticMarkup-style formats.
- Added maintenance guidance so the bundled skill can stay generic, desensitized,
  and synchronized with plugin behavior.
- Aligned examples and protocol text with the plugin's `COMMENT / 批注` default
  type while preserving `NOTE` as an explicit legacy type.
