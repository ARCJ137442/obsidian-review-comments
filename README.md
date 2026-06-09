# Obsidian Review Comments

> English README: [README.en.md](./README.en.md)
> 日本語版 README: [README.ja.md](./README.ja.md)

面向 Obsidian 的 Notion 风格批注插件。你可以选中文本后通过右键菜单、命令面板、快捷键或可选的悬浮工具条添加批注。批注直接存储在 `.md` 文件中，所以 Claude / GPT 等 Agent 可以直接读取 Markdown 源文件并应用修改，不需要额外导出。

## 批注格式

```markdown
原文中这段 {文本}{>>author=shirai;date=2026-05-13;type=EDIT;id=RC-20260513-120000-ABCD: 请改写<<} 有问题。
人类最小草稿：{文本}{>>请改写<<}
单点批注：{}{>>author=shirai;date=2026-05-13;type=NOTE;id=RC-20260513-120100-WXYZ: 这里需要补充说明<<}
```

- `{...}` 表示锚定原文。本 fork 默认写入这种 plain-anchor 格式，避免 Obsidian 把 `{<<word>>}` 中的 `<word>` 误识别为类似 HTML 的标签。
- `{}{>>...<<}` 表示没有选中文本的单点批注。裸 `{}` 或 `{}{}{}` 这类连续花括号只是普通文本，只有紧跟 `{>>...<<}` 时才会被识别为批注。
- `{>>author=...;date=...;type=...;id=RC-...: 正文<<}` 表示完整批注元数据。元数据使用分号分隔的 key-value 形式，避免 `|` 破坏 Markdown 表格。内置 `type` 包括 `ASK`、`EDIT`、`PRAISE`、`NOTE`，自定义类型也会被解析并保留。
- `{>>正文<<}` 是人类手写的最小草稿。手写时可以省略 author、date、type、id、status，插件和 Agent 工具后续可按需规范化。
- `id=RC-...` 推荐用于自动化、回复、关闭、迁移和 Agent 交接，但不是人类可读批注的强制字段。没有 id 的批注仍可通过锚定原文、周围上下文和线程顺序定位。
- `status` 当前支持 `open` 和 `closed`。缺省状态即 `open`，所以新建 open 批注通常不写 `status=open`；关闭时显式写入 `status=closed`，并保留 Markdown 批注证据。
- 回复是同一个锚点后的连续 metadata block：`{锚点}{>>第一条<<}{>>第二条<<}`。
- 新回复不需要 `replyTo`。第一条之后的每个 `{>>...<<}` 都被视为同一线性线程中对上一条批注的回复。
- 旧格式 `{<<...>>}{>>...<<}`、`{==...==}{>>...<<}` 和过渡格式 `{=#...#=}{>>...<<}` 仍可兼容读取，但插件新写入默认使用 `{...}{>>...<<}`。
- 标题批注会插入为标题下方的单点批注，避免批注标记进入 Obsidian 标题索引。
- 锚定文本和批注正文都可以跨行；Live Preview 会隐藏多行批注正文元数据并保留锚定文本的多行高亮 / 下划线，侧栏会对锚定原文与批注正文做基础 Markdown 渲染。

## 构建

```bash
git clone https://github.com/ShotaShirai1719/obsidian-review-comments.git
cd obsidian-review-comments
npm install
npm run build
```

构建完成后会生成 `main.js`。

## 安装

设 `$VAULT` 为 Obsidian 仓库的绝对路径：

```bash
mkdir -p "$VAULT/.obsidian/plugins/review-comments"
cp main.js manifest.json styles.css "$VAULT/.obsidian/plugins/review-comments/"
```

例行部署时不要覆盖 `data.json`。这个文件保存 vault 本地运行配置，例如作者名、启动时自动打开侧栏、悬浮工具条和高亮偏好。也不要用通配符或整目录同步命令覆盖插件目录；只显式复制 `main.js`、`manifest.json`、`styles.css` 这三个构建产物。

开发时也可以把当前工作目录软链接到插件目录：

```bash
ln -s "$(pwd)" "$VAULT/.obsidian/plugins/review-comments"
```

然后在 Obsidian 中：

1. 打开 Settings -> Community plugins，启用 **Review Comments**
2. 打开 Settings -> Review Comments，把 `Author name` 设置为你自己的名字

## 使用

1. 选中一段文本
2. 右键选择批注类型，或使用可选的悬浮工具条
3. 在弹窗中输入批注。侧栏支持多行备注、列表、链接、行内代码等基础 Markdown 展示。

也可以使用：

- 选中文本 -> 命令面板 -> `Review Comments: Add comment to selection`
- 选中文本 -> 可选悬浮工具条类型按钮
- 绑定快捷键，推荐 `Cmd + Shift + M`

悬浮工具条可以在插件设置中关闭，不影响右键菜单、命令面板或快捷键。

## 侧栏面板

可以通过左侧 ribbon 的对话气泡图标，或命令 `Review Comments: Open comments panel` 打开批注面板。

- 面板顶部显示当前文件的全部 / open / closed 计数。
- 可以按状态和类型筛选 open、closed 或某一种批注类型。
- 单击锚定原文可以跳转到文档中的对应位置。
- 双击批注正文可以编辑原批注，确认后直接写回 Markdown 源文件。
- 锚定原文和批注正文都会做基础 Markdown 渲染。
- `回复` 会在当前线性线程末尾追加新的 `{>>...<<}` block。
- `关闭` 会把线程写为 `status=closed`，但保留 Markdown 批注证据。
- closed 批注默认折叠。可以用 `展开` 查看，用 `打开` 恢复为 open 状态。
- `Delete` / `删除` 是独立的破坏性操作。第一次点击会把按钮切换为 `确认删除`；第二次点击才会移除批注标记并还原锚定文本。

## Agent 集成

可以把 `.md` 文件直接交给 Claude Code 或其他 LLM，并使用类似提示：

> 请应用本文件中 review comments（`{...}{>>...<<}` 和 `{}{>>...<<}`）描述的修改。旧 `{<<...>>}{>>...<<}` 批注只作为兼容格式读取。每条批注处理完成后移除对应批注标记，并把锚定文本还原为普通文本。

这样可以闭合流程：在 Obsidian 中批注 -> 交给 LLM 处理 -> 得到干净 diff。


## 开发

```bash
npm run dev   # watch mode
npm run build # production build
npm test      # parser and source-editing regression tests
```

实现注意：多行 `{>>...<<}` 批注正文折叠必须使用直接提供给 CodeMirror 的 `StateField` decorations。不要把跨行 `Decoration.replace` 放回 ViewPlugin，也不要尝试只用 CSS 隐藏整行；这两种方式都会在 Obsidian Live Preview 中暴露崩溃或空行残留问题。

## 变更记录

- 2026-06-09：修复多行批注正文折叠。多行锚定文本继续跨行高亮 / 下划线；多行批注正文在 Live Preview 中折叠后不再残留空白行。验证：`npm test` 36/36 PASS，`npx tsc --noEmit` PASS，`npm run build` PASS，并已在 `ExoNet-Reticulum-rt44-migration` 测试 vault 中人工确认效果正常。

## License

[AGPL-3.0-or-later](./LICENSE).

如果你分发修改版本，或通过网络暴露修改版本，必须按同一许可证开放源代码。如果这会影响你的使用场景，请在把插件集成到闭源产品前先开 issue 讨论。
