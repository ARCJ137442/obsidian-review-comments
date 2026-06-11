# Obsidian Review Comments

> English README: [README.en.md](./README.en.md)
> 日本語版 README: [README.ja.md](./README.ja.md)

面向 Obsidian 的 Notion 风格批注插件。你可以选中文本后通过右键菜单、命令面板、快捷键或可选的悬浮工具条添加批注。批注直接存储在 `.md` 文件中，所以 Claude / GPT 等 Agent 可以直接读取 Markdown 源文件并应用修改，不需要额外导出。

需要人工审阅或“批注辩论”时，也可以把当前文件的批注线程复制成 Markdown 清单：极简版只保留 `> 被批注文本` 与批注 / 回复正文；简单版从 `# 当前文件批注清单` 开始，并按 `批注对象` / `批注正文` 分节；完整版会额外带文件、位置、状态、类型、作者、日期和 id。

## 批注格式

```markdown
原文中这段 {文本}{>>author=shirai;date=2026-05-13;type=EDIT;id=RC-20260513-120000-ABCD: 请改写<<} 有问题。
人类最小草稿：{文本}{>>请改写<<}
单点批注：{}{>>author=shirai;date=2026-05-13;type=COMMENT;id=RC-20260513-120100-WXYZ: 这里需要补充说明<<}
```

- `{...}` 表示锚定原文。本 fork 默认写入这种 plain-anchor 格式，避免 Obsidian 把 `{<<word>>}` 中的 `<word>` 误识别为类似 HTML 的标签。
- `{}{>>...<<}` 表示没有选中文本的单点批注。裸 `{}` 或 `{}{}{}` 这类连续花括号只是普通文本，只有紧跟 `{>>...<<}` 时才会被识别为批注。
- `{>>author=...;date=...;type=...;id=RC-...: 正文<<}` 表示完整批注元数据。元数据使用分号分隔的 key-value 形式，避免 `|` 破坏 Markdown 表格。内置 `type` 包括默认通用类型 `COMMENT`（界面文案“批注”）以及 `ASK`、`EDIT`、`PRAISE`、`NOTE`，自定义类型也会被解析并保留。
- `{>>正文<<}` 是人类手写的最小草稿。手写时可以省略 author、date、type、id、status，插件和 Agent 工具后续可按需规范化。
- `id=RC-...` 推荐用于自动化、回复、关闭、迁移和 Agent 交接，但不是人类可读批注的强制字段。没有 id 的批注仍可通过锚定原文、周围上下文和线程顺序定位。
- `status` 当前支持 `open` 和 `closed`。缺省状态即 `open`，所以新建 open 批注通常不写 `status=open`；关闭时显式写入 `status=closed`，并保留 Markdown 批注证据。
- 回复是同一个锚点后的连续 metadata block：`{锚点}{>>第一条<<}{>>第二条<<}`。
- 新回复不需要 `replyTo`。第一条之后的每个 `{>>...<<}` 都被视为同一线性线程中对上一条批注的回复。
- 旧格式 `{<<...>>}{>>...<<}`、`{==...==}{>>...<<}` 和过渡格式 `{=#...#=}{>>...<<}` 仍可兼容读取，但插件新写入默认使用 `{...}{>>...<<}`。
- 设置页可分别配置 `新建批注使用格式` 与 `兼容读取格式`。前者决定插件主动写入哪一种锚点格式，后者决定哪些历史格式会被解析、折叠、渲染、列入侧栏和参与 lint。
- 设置页可配置批注类型 registry：每种类型都有命令 id、Markdown `type` tag、显示名称、emoji 和颜色。默认通用类型 `COMMENT / 批注` 固定保留且不可删除，但可以编辑命令 id、显示名称、emoji 和颜色；新增自定义类型可以删除。
- 标题批注会插入为标题下方的单点批注，避免批注标记进入 Obsidian 标题索引。
- 锚定文本和批注正文都可以跨行；Live Preview 会隐藏多行批注正文元数据并保留锚定文本的多行高亮 / 下划线，侧栏会对锚定原文与批注正文做基础 Markdown 渲染。
- 在表格、列表、引用块和 callout 这类行敏感结构中，通过弹窗或侧栏写入的多行批注正文会把物理换行规范化为 `<br>`，避免破坏 Markdown 源结构。

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
- 命令面板 -> `Review Comments: 检查当前文件批注`
- 命令面板 -> `Review Comments: 复制当前文件批注清单`
- 选中文本 -> 可选悬浮工具条类型按钮
- 绑定快捷键，推荐 `Cmd + Shift + M`

悬浮工具条可以在插件设置中关闭，不影响右键菜单、命令面板或快捷键。

设置页的 `批注方式` 可以在 `弹框式批注` 与 `编辑式批注` 之间切换。弹框式会在专用输入框中输入批注，并在行敏感结构中自动保护多行正文；编辑式会直接把批注源码插入 Markdown，并把光标放到正文位置，适合需要完全控制源文本的长批注。

设置页还提供 `新建批注使用格式` 和 `兼容读取格式`：默认写入 `{...}{>>...<<}` plain-anchor，同时兼容读取 `{<<...>>}{>>...<<}`、`{==...==}{>>...<<}` 与 `{=#...#=}{>>...<<}`。当前写入格式会自动保持在兼容读取集合中，避免新建批注写出后立刻不可读。

设置页的 `批注类型` 区域可以新增类型，或调整现有类型的命令 id、显示名称、emoji 与颜色。默认 `COMMENT / 批注` 是通用类型，默认颜色为 `#e6be28`；它的 Markdown `type=COMMENT` tag 固定保留且不能删除，用来给缺省类型、普通批注和回复提供稳定落点。

设置页还提供 `批注自动聚焦`，可选 `不开启`、`左键`、`右键`。开启后，点击或右键编辑器 / 阅读模式里的批注，会把右侧批注面板自动滚动到对应线程。这个自动聚焦跟随真实 DOM 事件目标，而不是依赖当前编辑器光标；这样右键菜单、分栏和陈旧选区下不会误定位。命令 `在批注栏中定位当前批注` 仍保留为独立入口，但它是按当前光标所在批注定位。

`检查当前文件批注` 会扫描当前 Markdown 文件中的批注协议问题，并用 Notice + 弹窗列出错误、警告与提示。当前检查覆盖重复 `id`、旧 `replyTo`、半截 `{>>` / `<<}` 标记、代码块内疑似批注、裸 `{}` / `{}{}{}` 伪批注、标题内嵌范围批注、列表 / 表格 / 引用 / callout 内多行风险、表格内旧式 `|` 元数据，以及缺少 `id` 的最小草稿提示。

`复制当前文件批注清单` 会把当前文件批注线程复制到剪贴板。设置页的 `复制批注清单格式` 可在 `极简版`、`简单版` 与 `完整版` 之间切换；极简版适合直接粘贴给人类或 Agent 继续审阅，简单版适合批注辩论分节，完整版适合归档、审计和定位。

## 侧栏面板

可以通过左侧 ribbon 的对话气泡图标，或命令 `Review Comments: Open comments panel` 打开批注面板。

- 面板顶部使用状态与类型两行轻量筛选标签；标签内直接显示当前文件的全部 / open / closed 与各类型计数，不再保留重复的静态计数行。
- 状态和类型都用可点亮的标签筛选：同一行内按 OR 合并，不同行之间按 AND 合并。没有选中标签时默认查看全部；点亮 `全部` 会临时覆盖该行筛选。
- 单击锚定原文可以跳转到文档中的对应位置。
- 双击批注正文可以编辑原批注，确认后直接写回 Markdown 源文件。
- 回复与编辑弹窗顶部都可以选择批注类型；类型颜色会同步到正文锚点、下划线、侧栏卡片和线程条目。
- 锚定原文和批注正文都会做基础 Markdown 渲染。
- `复制清单` 会按设置页选择的格式把当前文件批注复制为 Markdown。
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

CodeMirror 模式同步也必须延迟调度：不要在 `ViewPlugin` 构造函数或 `update` 回调里直接 `view.dispatch(...)`，否则会触发 `Calls to EditorView.update are not allowed while an update is in progress`。当前实现通过零延迟任务合并模式切换，避免在 Obsidian 正在刷新编辑器时重入 dispatch。

阅读模式中的表格批注不能按单个 DOM text node 解析。Obsidian 渲染行内代码、强调等 Markdown 时会把一个 `{anchor}{>>...<<}` 批注线程拆成多个 text node；表格单元格的 Markdown postprocessor 还可能收到尚未挂载到文档树上的 `div.table-cell-wrapper`，此时 `node.isConnected === false` 但 DOM Range 替换仍然有效。当前实现先按表格单元格、段落、列表项、引用块、callout 等容器分组，再拼接片段解析，并基于 `ownerDocument` 与仍有 `parentElement` 的 text node 一次性替换完整线程。后续不要退回逐 text node 替换，也不要把 `isConnected` 当作渲染门槛，否则会重现“表格里 7 个批注只有部分可见 / 完全不渲染”的问题。

阅读模式还会跳过完全落在 `code` / `pre` 内的整段伪批注，避免把行内代码或代码块中的示例语法误渲染成真实批注。

## 变更记录

- 2026-06-11：补充阅读模式表格批注回归测试，模拟 `local/reply.local.md` 同形态的 7 条表格线程，以及 Obsidian 将单个线程拆成 `<code>` / `<strong>` / `<br>` / detached `div.table-cell-wrapper` DOM 片段的情况；确认 7 条批注均可渲染且原始 `{>>...<<}` 标记会被完整隐藏。验证：`npm test` 84/84 PASS，`npx tsc --noEmit` PASS，`npm run build` PASS。
- 2026-06-11：新增 `批注自动聚焦` 设置，支持 `不开启`、`左键`、`右键` 三种模式；开启后会根据真实 DOM 事件目标，把编辑器 / 阅读模式中被点击或右键命中的批注线程自动滚动到右侧面板，对右键菜单和分栏场景不再依赖当前光标。命令 `在批注栏中定位当前批注` 继续保留，但它仍是按光标定位。阅读模式同时新增整段行内代码 / 代码块伪批注跳过保护，避免 `code` / `pre` 中的完整示例语法被误渲染。验证：`npm test` 83/83 PASS，`npx tsc --noEmit` PASS，`npm run build` PASS。
- 2026-06-11：修复阅读模式 / Live Preview 中表格批注被 Obsidian 拆分成多个 DOM text node 后无法完整识别的问题，并补上 `div.table-cell-wrapper` detached DOM 回归测试，覆盖 `local/reply.local.md` 同形态的表格批注样本；新增 `批注方式` 设置，可在弹框式批注与编辑式批注之间切换；弹框式和侧栏编辑 / 回复在表格、列表、引用块、callout 中会把多行批注正文规范化为 `<br>`，避免破坏 Markdown 源结构；弹窗关闭时会保护未提交草稿，避免误点遮罩丢失正文。验证：`npm test` 83/83 PASS，`npx tsc --noEmit` PASS，`npm run build` PASS。
- 2026-06-10：完成 M5 类型 registry 收尾，并修复侧栏筛选与编辑器模式同步细节。设置页支持自定义批注类型的命令 id、metadata tag、显示名称、emoji 与颜色；默认 `COMMENT / 批注` 固定保留、不可删除，但可编辑 id / 名称 / emoji / 颜色，默认色为 `#e6be28`。命令面板、右键菜单、悬浮工具条、回复 / 编辑弹窗、正文装饰、侧栏卡片、线程条目和状态 / 类型标签筛选都改为读取 registry；侧栏移除重复静态计数行，改用更轻的凹陷 pill 筛选标签；CodeMirror 模式同步改为延迟 dispatch，避免打开带批注文件时重入更新。验证：`npm test` 67/67 PASS，`npx tsc --noEmit` PASS，`npm run build` PASS。
- 2026-06-09：新增 `极简版` 批注清单导出格式，只输出被批注文本与连续批注 / 回复正文；默认通用类型 `COMMENT / 批注` 的高亮、下划线、卡片边线改回黄色，增强默认批注识别度。验证：`npm test` 55/55 PASS，`npx tsc --noEmit` PASS。
- 2026-06-09：完成 M4/M5 第一轮。设置页新增 `新建批注使用格式` 与 `兼容读取格式`，解析器可按配置兼容 `{...}`、`{<<...>>}`、`{==...==}`、`{=#...#=}`，新建范围批注、单点批注与回复按当前使用格式写入；新增默认通用类型 `COMMENT / 批注`，新批注与回复默认使用该类型，颜色为浅灰 `#dddddd`，旧显式 `NOTE` 继续原样读取。验证：`npm test` 52/52 PASS，`npx tsc --noEmit` PASS，`npm run build` PASS。
- 2026-06-09：新增 `复制当前文件批注清单` 命令与侧栏 `复制清单` 按钮。支持 `简单版 / 完整版` 两种导出格式：简单版按 `# 当前文件批注清单`、`批注对象`、`批注正文` 组织，完整版追加文件、位置、线程、状态、类型、作者、日期、id 与自定义属性。验证：`npm test` 47/47 PASS，`npx tsc --noEmit` PASS，`npm run build` PASS，并已只部署 `main.js`、`manifest.json`、`styles.css` 到测试 vault，未覆盖 `data.json`。
- 2026-06-09：新增 `检查当前文件批注` 命令。可在当前文件中检查重复 `id`、旧 `replyTo`、孤立 metadata 标记、代码块内疑似批注、裸 `{}` 边界、标题内嵌批注、行敏感结构多行风险、表格 pipe metadata 风险和缺少 `id` 的最小草稿提示。验证：`npm test` 43/43 PASS，`npx tsc --noEmit` PASS，`npm run build` PASS，并已只部署 `main.js`、`manifest.json`、`styles.css` 到测试 vault，未覆盖 `data.json`。
- 2026-06-09：修复多行批注正文折叠。多行锚定文本继续跨行高亮 / 下划线；多行批注正文在 Live Preview 中折叠后不再残留空白行。验证：`npm test` 36/36 PASS，`npx tsc --noEmit` PASS，`npm run build` PASS，并已在 `ExoNet-Reticulum-rt44-migration` 测试 vault 中人工确认效果正常。

## License

[AGPL-3.0-or-later](./LICENSE).

如果你分发修改版本，或通过网络暴露修改版本，必须按同一许可证开放源代码。如果这会影响你的使用场景，请在把插件集成到闭源产品前先开 issue 讨论。
