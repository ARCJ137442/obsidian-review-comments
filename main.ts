import {
  App,
  Editor,
  ItemView,
  MarkdownRenderer,
  MarkdownPostProcessorContext,
  MarkdownView,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  WorkspaceLeaf,
} from "obsidian";
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";
import {
  ParsedComment,
  ParsedCommentEntry,
  ParsedMeta,
  appendReplyComment,
  containsCommentMarkup,
  filterComments,
  findComments,
  formatComment,
  generateCommentId,
  removeComment,
  replaceCommentEntryMeta,
  replaceCommentThreadStatus,
  summarizeComments,
  CommentStatusFilter,
} from "./comment-core";

interface ReviewCommentsSettings {
  authorName: string;
  dateFormat: "iso" | "japanese";
  autoOpenPanel: boolean;
  showFloatingBar: boolean;
  foldEditorMarkup: boolean;
  highlightAnchors: boolean;
}

const DEFAULT_SETTINGS: ReviewCommentsSettings = {
  authorName: "you",
  dateFormat: "iso",
  autoOpenPanel: true,
  showFloatingBar: true,
  foldEditorMarkup: true,
  highlightAnchors: false,
};

const VIEW_TYPE_COMMENTS = "review-comments-view";

const TYPES: { id: string; tag: string; label: string; icon: string }[] = [
  { id: "ask", tag: "ASK", label: "提问", icon: "❓" },
  { id: "edit", tag: "EDIT", label: "修改", icon: "✏️" },
  { id: "praise", tag: "PRAISE", label: "称赞", icon: "👍" },
  { id: "note", tag: "NOTE", label: "备注", icon: "💬" },
];

const TYPE_ICON: Record<string, string> = TYPES.reduce((acc, t) => {
  acc[t.tag] = t.icon;
  return acc;
}, {} as Record<string, string>);

const TYPE_LABEL: Record<string, string> = TYPES.reduce((acc, t) => {
  acc[t.tag] = t.label;
  return acc;
}, {} as Record<string, string>);

interface HeadingCommentContext {
  line: number;
  target: string;
}

class CommentInputModal extends Modal {
  private readonly typeTag: string;
  private readonly onSubmit: (body: string) => void;
  private readonly titleText: string;
  private readonly submitText: string;
  private readonly initialBody: string;

  constructor(
    app: App,
    typeTag: string,
    onSubmit: (body: string) => void,
    titleText?: string,
    submitText?: string,
    initialBody?: string
  ) {
    super(app);
    this.typeTag = typeTag;
    this.onSubmit = onSubmit;
    this.titleText = titleText || `添加${TYPE_LABEL[this.typeTag] || "备注"}批注`;
    this.submitText = submitText || "添加批注";
    this.initialBody = initialBody || "";
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("review-comment-modal");
    this.setTitle(this.titleText);

    contentEl.createEl("p", {
      text: "支持多行和项目符号，内容会直接写入 Markdown。",
      cls: "review-comment-modal-help",
    });

    const textarea = contentEl.createEl("textarea", {
      cls: "review-comment-modal-textarea",
    });
    textarea.placeholder = "例：\n这里需要重新判断\n- 理由\n- 相关上下文";
    textarea.value = this.initialBody;

    const actions = contentEl.createDiv({
      cls: "review-comment-modal-actions",
    });
    const cancelBtn = actions.createEl("button", {
      text: "取消",
      cls: "mod-muted",
    });
    const submitBtn = actions.createEl("button", {
      text: this.submitText,
      cls: "mod-cta",
    });

    cancelBtn.addEventListener("click", () => this.close());
    submitBtn.addEventListener("click", () => this.submit(textarea.value));
    textarea.addEventListener("keydown", (evt: KeyboardEvent) => {
      if ((evt.metaKey || evt.ctrlKey) && evt.key === "Enter") {
        evt.preventDefault();
        this.submit(textarea.value);
      }
    });

    window.setTimeout(() => textarea.focus(), 0);
  }

  private submit(body: string) {
    this.onSubmit(body);
    this.close();
  }
}

export default class ReviewCommentsPlugin extends Plugin {
  settings: ReviewCommentsSettings = DEFAULT_SETTINGS;
  floatingBar: HTMLDivElement | null = null;
  selectionDebounce: number | null = null;

  async onload() {
    console.log("[ReviewComments] onload");
    await this.loadSettings();

    for (const t of TYPES) {
      this.addCommand({
        id: `add-comment-${t.id}`,
        name: `添加${t.label} ${t.icon}`,
        editorCallback: (editor: Editor) =>
          this.addCommentToSelection(editor, t.tag),
      });
    }

    this.addCommand({
      id: "open-comments-panel",
      name: "打开右侧批注面板",
      callback: () => this.activateView(),
    });
    this.addCommand({
      id: "open-comments-workbench",
      name: "显示批注工作台",
      callback: () => this.activateView(),
    });
    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, editor) => {
        menu.addSeparator();
        menu.addItem((item) =>
          item
            .setTitle("添加批注")
            .setIcon("message-circle")
            .setSection("review-comments")
            .setIsLabel(true)
        );
        for (const t of TYPES) {
          menu.addItem((item) =>
            item
              .setTitle(`${t.icon} ${t.label}`)
              .setSection("review-comments")
              .onClick(() => this.addCommentToSelection(editor, t.tag))
          );
        }
      })
    );

    this.addRibbonIcon("message-circle", "打开右侧批注面板", () => {
      this.activateView();
    });

    this.registerView(
      VIEW_TYPE_COMMENTS,
      (leaf) => new CommentsView(leaf, this)
    );

    this.registerEditorExtension([
      createCommentDecorationExtension(
        () => this.settings.foldEditorMarkup,
        () => this.settings.highlightAnchors
      ),
    ]);

    this.registerMarkdownPostProcessor((el, ctx) =>
      this.renderCommentsInReadingMode(el, ctx)
    );

    this.setupFloatingBar();
    this.addSettingTab(new ReviewCommentsSettingTab(this.app, this));

    this.app.workspace.onLayoutReady(() => {
      if (this.settings.autoOpenPanel) {
        void this.activateView();
      }
    });
  }

  onunload() {
    console.log("[ReviewComments] onunload");
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_COMMENTS);
    if (this.floatingBar) {
      this.floatingBar.remove();
      this.floatingBar = null;
    }
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  escapeCommentBody(body: string): string {
    return body.replace(/<<}/g, "<< }");
  }

  addCommentToSelection(editor: Editor, typeTag: string = "NOTE") {
    const selection = editor.getSelection();
    if (containsCommentMarkup(selection)) {
      new Notice("选区中已经包含批注标记");
      return;
    }

    const from = editor.getCursor("from");
    const to = editor.getCursor("to");
    const headingContext = this.getHeadingCommentContext(
      editor,
      from,
      to
    );
    const title = headingContext
      ? `添加${TYPE_LABEL[typeTag] || "备注"}标题批注`
      : selection
        ? undefined
        : `添加${TYPE_LABEL[typeTag] || "备注"}单点批注`;

    new CommentInputModal(this.app, typeTag, (body) => {
      const meta = this.createCommentMeta(typeTag, body);
      if (headingContext) {
        meta.attrs = {
          ...meta.attrs,
          scope: "heading",
          target: headingContext.target,
        };
        this.insertPointCommentAfterLine(editor, headingContext.line, meta);
      } else if (selection) {
        editor.replaceRange(formatComment(selection, meta), from, to);
      } else {
        editor.replaceRange(formatComment("", meta), from, to);
      }
      editor.focus();
    }, title).open();
  }

  createCommentMeta(typeTag: string, body: string): ParsedMeta {
    const date = formatDate(new Date(), this.settings.dateFormat);
    const author = sanitizeAuthor(this.settings.authorName);
    return {
      author,
      date,
      type: typeTag,
      body: this.escapeCommentBody(body.trim() || "请填写批注"),
      id: generateCommentId(),
      status: "open",
      attrs: {},
    };
  }

  getHeadingCommentContext(
    editor: Editor,
    from: { line: number; ch: number },
    to: { line: number; ch: number }
  ): HeadingCommentContext | null {
    if (from.line !== to.line) return null;
    const lineText = editor.getLine(from.line);
    const target = extractHeadingTarget(lineText);
    if (!target) return null;
    return { line: from.line, target };
  }

  insertPointCommentAfterLine(
    editor: Editor,
    line: number,
    meta: ParsedMeta
  ) {
    const markup = formatComment("", meta);
    const nextLine = line + 1;
    if (nextLine < editor.lineCount()) {
      editor.replaceRange(`${markup}\n`, { line: nextLine, ch: 0 });
      return;
    }

    editor.replaceRange(`\n${markup}`, {
      line,
      ch: editor.getLine(line).length,
    });
  }

  async activateView() {
    const { workspace } = this.app;
    const existing = workspace.getLeavesOfType(VIEW_TYPE_COMMENTS);
    if (existing.length > 0) {
      workspace.revealLeaf(existing[0]);
      return;
    }

    const leaf = workspace.getRightLeaf(false);
    if (leaf) {
      await leaf.setViewState({ type: VIEW_TYPE_COMMENTS, active: true });
      workspace.revealLeaf(leaf);
    }
  }

  setupFloatingBar() {
    const bar = document.createElement("div");
    bar.className = "review-comment-floating-bar";
    bar.style.display = "none";
    document.body.appendChild(bar);
    this.floatingBar = bar;

    for (const t of TYPES) {
      const btn = document.createElement("button");
      btn.className = "review-comment-type-btn";
      btn.title = `${t.label}（插入 ${t.tag}）`;
      btn.innerHTML = `<span class="rc-icon">${t.icon}</span><span class="rc-label">${t.label}</span>`;
      btn.addEventListener("mousedown", (e) => e.preventDefault());
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const mdView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (mdView && mdView.editor.getSelection()) {
          this.addCommentToSelection(mdView.editor, t.tag);
        }
        this.hideFloatingBar();
      });
      bar.appendChild(btn);
    }

    this.registerDomEvent(document, "selectionchange", () => {
      if (this.selectionDebounce !== null) {
        window.clearTimeout(this.selectionDebounce);
      }
      this.selectionDebounce = window.setTimeout(
        () => this.updateFloatingBar(),
        80
      );
    });

    this.registerDomEvent(window, "scroll", () => this.hideFloatingBar(), {
      capture: true,
    });

    this.registerDomEvent(document, "keydown", (e: KeyboardEvent) => {
      if (e.key === "Escape") this.hideFloatingBar();
    });
  }

  updateFloatingBar() {
    if (!this.floatingBar) return;
    if (!this.settings.showFloatingBar) {
      this.hideFloatingBar();
      return;
    }

    const mdView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!mdView) {
      this.hideFloatingBar();
      return;
    }

    const selText = mdView.editor.getSelection();
    if (!selText) {
      this.hideFloatingBar();
      return;
    }

    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
      this.hideFloatingBar();
      return;
    }

    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      this.hideFloatingBar();
      return;
    }

    const bar = this.floatingBar;
    bar.style.display = "flex";
    const barWidth = bar.offsetWidth || 280;
    const barHeight = bar.offsetHeight || 36;

    let left = rect.left;
    let top = rect.top - barHeight - 8;

    if (left + barWidth > window.innerWidth - 8) {
      left = window.innerWidth - barWidth - 8;
    }
    if (left < 8) left = 8;
    if (top < 8) {
      top = rect.bottom + 6;
    }

    bar.style.left = `${left}px`;
    bar.style.top = `${top}px`;
  }

  hideFloatingBar() {
    if (this.floatingBar) {
      this.floatingBar.style.display = "none";
    }
  }

  renderCommentsInReadingMode(
    el: HTMLElement,
    _ctx: MarkdownPostProcessorContext
  ) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    const textNodes: Text[] = [];
    let node: Node | null;
    while ((node = walker.nextNode())) {
      textNodes.push(node as Text);
    }

    for (const tn of textNodes) {
      if (tn.parentElement?.closest("pre, code")) continue;
      const text = tn.textContent || "";
      const comments = findComments(text);
      if (comments.length === 0) continue;

      let lastIndex = 0;
      const frag = document.createDocumentFragment();

      for (const comment of comments) {
        if (comment.offset > lastIndex) {
          frag.appendChild(document.createTextNode(text.slice(lastIndex, comment.offset)));
        }

        const meta = comment.meta;
        const span = document.createElement("span");
        if (comment.anchor) {
          span.className = "review-comment-highlight";
          if (!this.settings.highlightAnchors) {
            span.classList.add("review-comment-anchor-muted");
          }
          span.textContent = comment.anchor;
        } else {
          span.className = "review-comment-point";
          span.textContent = "•";
          span.setAttribute("aria-label", "单点批注");
        }
        span.dataset.type = meta.type;
        span.setAttribute(
          "title",
          formatThreadTitle(comment.entries)
        );
        frag.appendChild(span);
        lastIndex = comment.end;
      }

      if (lastIndex < text.length) {
        frag.appendChild(document.createTextNode(text.slice(lastIndex)));
      }
      tn.parentNode?.replaceChild(frag, tn);
    }
  }
}

function sanitizeAuthor(name: string): string {
  const trimmed = (name || "").trim();
  const stripped = trimmed.replace(/[|:<>;{}=]/g, "_");
  return stripped || "you";
}

function formatDate(d: Date, format: "iso" | "japanese"): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  if (format === "japanese") return `${y}年${m}月${day}日`;
  return `${y}-${m}-${day}`;
}

function isPlainSourceMode(view: EditorView): boolean {
  const sourceView = view.dom.closest(".markdown-source-view");
  if (!sourceView) return false;
  return !sourceView.classList.contains("is-live-preview");
}

function selectionTouchesComment(view: EditorView, start: number, end: number): boolean {
  return view.state.selection.ranges.some((range) => {
    if (range.empty) return range.from >= start && range.from <= end;
    return range.from < end && range.to > start;
  });
}

function extractHeadingTarget(line: string): string | null {
  const match = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
  return match?.[1].trim() || null;
}

class CommentPointWidget extends WidgetType {
  constructor(
    private readonly title: string,
    private readonly type: string
  ) {
    super();
  }

  eq(other: CommentPointWidget): boolean {
    return this.title === other.title && this.type === other.type;
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "review-comment-point-live";
    span.dataset.type = this.type;
    span.textContent = "•";
    span.title = this.title;
    span.setAttribute("aria-label", "单点批注");
    return span;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

function createCommentDecorationExtension(
  shouldFoldMarkup: () => boolean,
  shouldHighlightAnchors: () => boolean
) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = this.buildDecorations(view);
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged || update.selectionSet) {
          this.decorations = this.buildDecorations(update.view);
        }
      }

      buildDecorations(view: EditorView): DecorationSet {
        const builder = new RangeSetBuilder<Decoration>();
        const text = view.state.doc.toString();
        const foldMarkup = shouldFoldMarkup() && !isPlainSourceMode(view);
        const highlightAnchors = shouldHighlightAnchors();

        for (const comment of findComments(text)) {
          const start = comment.offset;
          const highlightTextStart = comment.anchorStart;
          const highlightTextEnd = comment.anchorEnd;
          const metaStart = comment.metaStart;
          const end = comment.end;
          const meta = comment.meta;
          const title = formatThreadTitle(comment.entries);
          const expanded = !foldMarkup || selectionTouchesComment(view, start, end);

          if (!comment.anchor) {
            if (expanded) {
              builder.add(
                metaStart,
                end,
                Decoration.mark({ class: "review-comment-meta-live" })
              );
            } else {
              builder.add(
                start,
                end,
                Decoration.replace({
                  widget: new CommentPointWidget(title, meta.type),
                })
              );
            }
            continue;
          }

          if (!expanded) {
            builder.add(start, highlightTextStart, Decoration.replace({}));
          }

          builder.add(
            highlightTextStart,
            highlightTextEnd,
            Decoration.mark({
              class: `review-comment-highlight-live review-comment-folded-anchor${
                highlightAnchors ? "" : " review-comment-anchor-muted"
              }`,
              attributes: { title, "data-type": meta.type },
            })
          );

          if (expanded) {
            builder.add(
              metaStart,
              end,
              Decoration.mark({ class: "review-comment-meta-live" })
            );
          } else {
            builder.add(highlightTextEnd, metaStart, Decoration.replace({}));
            builder.add(metaStart, end, Decoration.replace({}));
          }
        }

        return builder.finish();
      }
    },
    {
      decorations: (v) => v.decorations,
    }
  );
}

class CommentsView extends ItemView {
  plugin: ReviewCommentsPlugin;
  lastMarkdownView: MarkdownView | null = null;
  statusFilter: CommentStatusFilter = "all";
  typeFilter = "all";

  constructor(leaf: WorkspaceLeaf, plugin: ReviewCommentsPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() {
    return VIEW_TYPE_COMMENTS;
  }

  getDisplayText() {
    return "批注";
  }

  getIcon() {
    return "message-circle";
  }

  async onOpen() {
    void this.renderComments();
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        void this.renderComments();
      })
    );
    this.registerEvent(
      this.app.workspace.on("editor-change", () => {
        void this.renderComments();
      })
    );
  }

  async onClose() {}

  getMarkdownView(): MarkdownView | null {
    const activeMdView =
      this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
    if (activeMdView) {
      this.lastMarkdownView = activeMdView;
      return activeMdView;
    }

    if (
      this.lastMarkdownView &&
      this.plugin.app.workspace
        .getLeavesOfType("markdown")
        .some((leaf) => leaf.view === this.lastMarkdownView)
    ) {
      return this.lastMarkdownView;
    }

    this.lastMarkdownView = null;
    return null;
  }

  jumpTo(mdView: MarkdownView, offset: number, length: number) {
    this.plugin.app.workspace.setActiveLeaf(mdView.leaf, { focus: true });
    const editor = mdView.editor;
    const pos = editor.offsetToPos(offset);
    const endPos = editor.offsetToPos(offset + length);
    editor.setSelection(pos, endPos);
    editor.scrollIntoView({ from: pos, to: endPos }, true);
    editor.focus();
  }

  async renderMarkdownBlock(
    el: HTMLElement,
    markdown: string,
    sourcePath: string
  ) {
    el.empty();
    el.addClass("markdown-rendered");
    await MarkdownRenderer.render(
      this.plugin.app,
      markdown || "",
      el,
      sourcePath,
      this
    );
  }

  async renderComments() {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    new Setting(container).setName("批注").setHeading();

    const mdView = this.getMarkdownView();
    if (!mdView) {
      container.createEl("p", {
        text: "请先打开一个 Markdown 文件",
      });
      return;
    }

    const sourcePath = mdView.file?.path ?? "";
    const text = mdView.editor.getValue();
    const matches = findComments(text);

    if (matches.length === 0) {
      container.createEl("p", {
        text: "还没有批注。选中文本可添加锚定批注；无选区时可通过右键菜单、命令面板或快捷键添加单点批注。",
        cls: "review-comment-empty",
      });
      return;
    }

    const summary = summarizeComments(matches);
    const availableTypes = Object.keys(summary.byType).sort((a, b) =>
      a.localeCompare(b)
    );
    if (
      this.typeFilter !== "all" &&
      !availableTypes.includes(this.typeFilter)
    ) {
      this.typeFilter = "all";
    }

    this.renderFilterBar(container, summary, availableTypes);

    const visibleMatches = filterComments(matches, {
      status: this.statusFilter,
      type: this.typeFilter,
    });

    if (visibleMatches.length === 0) {
      container.createEl("p", {
        text: "当前筛选下没有批注。",
        cls: "review-comment-empty",
      });
      return;
    }

    for (const match of visibleMatches) {
      await this.renderCommentCard(container, match, mdView, sourcePath);
    }
  }

  async renderCommentCard(
    parent: HTMLElement,
    match: ParsedComment,
    mdView: MarkdownView,
    sourcePath: string
  ) {
    const card = parent.createDiv({ cls: "review-comment-card" });
    const threadStatus = getThreadStatus(match);
    card.dataset.type = match.meta.type;
    card.dataset.status = threadStatus;
    if (threadStatus === "closed") {
      card.classList.add("is-folded");
    }

    const header = card.createDiv({ cls: "review-comment-card-header" });
    const icon = header.createSpan({ cls: "review-comment-card-icon" });
    icon.textContent = TYPE_ICON[match.meta.type] || "💬";
    const meta = header.createSpan({ cls: "review-comment-card-meta" });
    meta.textContent = `线程 · ${match.entries.length} 条 · ${threadStatus}`;
    if (match.meta.id) {
      meta.textContent += ` · ${match.meta.id}`;
    }

    const content = card.createDiv({ cls: "review-comment-card-content" });
    const original = content.createDiv({ cls: "review-comment-card-original" });
    const originalText = getCommentAnchorLabel(match);
    if (match.anchor) {
      await this.renderMarkdownBlock(original, originalText, sourcePath);
    } else {
      original.textContent = originalText;
      original.classList.add("is-point");
    }
    original.setAttribute("title", "单击定位到原文");
    original.addEventListener("click", (e) => {
      e.stopPropagation();
      this.jumpTo(mdView, match.offset, match.full.length);
    });

    const threadEl = content.createDiv({ cls: "review-comment-thread" });
    for (const entry of match.entries) {
      await this.renderThreadEntry(threadEl, match, entry, mdView, sourcePath);
    }

    const actions = card.createDiv({ cls: "review-comment-card-actions" });

    if (threadStatus === "closed") {
      const expandBtn = actions.createEl("button", {
        text: "展开",
        cls: "review-comment-action-btn",
      });
      expandBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const expanded = card.classList.toggle("is-expanded");
        card.classList.toggle("is-folded", !expanded);
        expandBtn.textContent = expanded ? "收起" : "展开";
      });
    }

    const replyBtn = actions.createEl("button", {
      text: "回复",
      cls: "review-comment-action-btn",
    });
    replyBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.openReplyModal(mdView, match);
    });

    const closeBtn = actions.createEl("button", {
      text: threadStatus === "closed" ? "打开" : "关闭",
      cls: "review-comment-action-btn review-comment-close-btn",
    });
    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.setCommentStatus(
        mdView,
        match,
        threadStatus === "closed" ? "open" : "closed"
      );
    });

    const deleteBtn = actions.createEl("button", {
      text: "删除",
      cls: "review-comment-action-btn review-comment-delete-btn",
    });
    let deleteArmed = false;
    let resetTimer: number | null = null;
    deleteBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!deleteArmed) {
        deleteArmed = true;
        deleteBtn.textContent = "确认删除";
        deleteBtn.classList.add("is-confirming");
        if (resetTimer !== null) window.clearTimeout(resetTimer);
        resetTimer = window.setTimeout(() => {
          deleteArmed = false;
          deleteBtn.textContent = "删除";
          deleteBtn.classList.remove("is-confirming");
          resetTimer = null;
        }, 5000);
        return;
      }
      this.deleteComment(mdView, match);
    });
  }

  async renderThreadEntry(
    parent: HTMLElement,
    thread: ParsedComment,
    entry: ParsedCommentEntry,
    mdView: MarkdownView,
    sourcePath: string
  ) {
    const item = parent.createDiv({ cls: "review-comment-thread-entry" });
    item.dataset.type = entry.meta.type;
    item.dataset.status = entry.meta.status;

    const header = item.createDiv({ cls: "review-comment-thread-entry-header" });
    header.createSpan({
      text: TYPE_ICON[entry.meta.type] || "💬",
      cls: "review-comment-card-icon",
    });
    header.createSpan({
      text: formatThreadEntryLabel(entry),
      cls: "review-comment-card-meta",
    });

    const body = item.createDiv({ cls: "review-comment-card-body" });
    await this.renderMarkdownBlock(body, entry.meta.body, sourcePath);
    body.setAttribute("title", "双击编辑");
    body.addEventListener("click", (e) => e.stopPropagation());
    body.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      this.openEditModal(mdView, thread, entry);
    });
  }

  renderFilterBar(
    container: HTMLElement,
    summary: ReturnType<typeof summarizeComments>,
    availableTypes: string[]
  ) {
    const filterEl = container.createDiv({ cls: "review-comment-filterbar" });

    const counts = filterEl.createDiv({ cls: "review-comment-counts" });
    counts.createSpan({
      text: `全部 ${summary.total}`,
      cls: "review-comment-count-pill",
    });
    counts.createSpan({
      text: `open ${summary.open}`,
      cls: "review-comment-count-pill",
    });
    counts.createSpan({
      text: `closed ${summary.closed}`,
      cls: "review-comment-count-pill",
    });

    const controls = filterEl.createDiv({ cls: "review-comment-filter-controls" });

    const statusSelect = controls.createEl("select", {
      cls: "review-comment-filter-select",
    });
    const statusOptions: { value: CommentStatusFilter; label: string }[] = [
      { value: "all", label: "全部状态" },
      { value: "open", label: "open" },
      { value: "closed", label: "closed" },
    ];
    for (const option of statusOptions) {
      statusSelect.createEl("option", {
        value: option.value,
        text: option.label,
      });
    }
    statusSelect.value = this.statusFilter;
    statusSelect.addEventListener("change", () => {
      this.statusFilter = statusSelect.value as CommentStatusFilter;
      void this.renderComments();
    });

    const typeSelect = controls.createEl("select", {
      cls: "review-comment-filter-select",
    });
    typeSelect.createEl("option", {
      value: "all",
      text: "全部类型",
    });
    for (const type of availableTypes) {
      const label = TYPE_LABEL[type] ? `${TYPE_LABEL[type]} · ${type}` : type;
      typeSelect.createEl("option", {
        value: type,
        text: `${label} (${summary.byType[type]})`,
      });
    }
    typeSelect.value = this.typeFilter;
    typeSelect.addEventListener("change", () => {
      this.typeFilter = typeSelect.value;
      void this.renderComments();
    });
  }

  setCommentStatus(
    mdView: MarkdownView,
    match: ParsedComment,
    status: ParsedMeta["status"]
  ) {
    try {
      const editor = mdView.editor;
      const value = editor.getValue();
      editor.setValue(replaceCommentThreadStatus(value, match, status));
      void this.renderComments();
    } catch (error) {
      new Notice(error instanceof Error ? error.message : "批注状态更新失败");
    }
  }

  deleteComment(mdView: MarkdownView, match: ParsedComment) {
    try {
      const editor = mdView.editor;
      const value = editor.getValue();
      editor.setValue(removeComment(value, match));
      void this.renderComments();
    } catch (error) {
      new Notice(error instanceof Error ? error.message : "删除批注失败");
    }
  }

  openEditModal(
    mdView: MarkdownView,
    match: ParsedComment,
    entry: ParsedCommentEntry = match.entries[0]
  ) {
    new CommentInputModal(
      this.plugin.app,
      entry.meta.type,
      (body) => {
        const editor = mdView.editor;
        const value = editor.getValue();
        try {
          editor.setValue(
            replaceCommentEntryMeta(value, match, entry.index, {
              ...entry.meta,
              body: this.plugin.escapeCommentBody(body.trim()),
            })
          );
          void this.renderComments();
        } catch (error) {
          new Notice(error instanceof Error ? error.message : "编辑批注失败");
        }
      },
      `编辑批注${entry.meta.id ? ` · ${entry.meta.id}` : ""}`,
      "保存修改",
      entry.meta.body
    ).open();
  }

  openReplyModal(mdView: MarkdownView, match: ParsedComment) {
    new CommentInputModal(
      this.plugin.app,
      "NOTE",
      (body) => {
        const editor = mdView.editor;
        const value = editor.getValue();
        const date = formatDate(new Date(), this.plugin.settings.dateFormat);
        const author = sanitizeAuthor(this.plugin.settings.authorName);
        const replyMeta: ParsedMeta = {
          author,
          date,
          type: "NOTE",
          body: this.plugin.escapeCommentBody(body.trim() || "回复"),
          id: generateCommentId(),
          status: "open",
          attrs: {},
        };

        try {
          editor.setValue(appendReplyComment(value, match, replyMeta));
          void this.renderComments();
        } catch (error) {
          new Notice(error instanceof Error ? error.message : "回复失败");
        }
      },
      `回复${match.meta.id ? ` · ${match.meta.id}` : ""}`,
      "回复"
    ).open();
  }
}

function getThreadStatus(thread: ParsedComment): ParsedMeta["status"] {
  return thread.entries.some((entry) => entry.meta.status === "open")
    ? "open"
    : "closed";
}

function getCommentAnchorLabel(comment: ParsedComment): string {
  if (comment.anchor) return comment.anchor;
  if (comment.meta.attrs.scope === "heading") {
    return `标题批注：${comment.meta.attrs.target || "未命名标题"}`;
  }
  return "单点批注";
}

function formatThreadTitle(entries: ParsedCommentEntry[]): string {
  return entries
    .map(
      (entry) =>
        `${entry.index + 1}. ${TYPE_ICON[entry.meta.type] || ""} ${formatThreadEntryLabel(
          entry
        )}\n${entry.meta.body}`
    )
    .join("\n\n");
}

function formatThreadEntryLabel(entry: ParsedCommentEntry): string {
  const meta = entry.meta;
  const parts = [
    `#${entry.index + 1}`,
    meta.author || "草稿",
    meta.date,
    meta.type || "NOTE",
    meta.status,
    meta.id,
  ].filter((part): part is string => Boolean(part));
  return parts.join(" · ");
}

class ReviewCommentsSettingTab extends PluginSettingTab {
  plugin: ReviewCommentsPlugin;

  constructor(app: App, plugin: ReviewCommentsPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("作者名称")
      .setDesc("写入批注元数据的名称")
      .addText((text) =>
        text
          .setValue(this.plugin.settings.authorName)
          .onChange(async (value) => {
            this.plugin.settings.authorName = value || "you";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("日期格式")
      .addDropdown((dd) =>
        dd
          .addOption("iso", "ISO：2026-05-13")
          .addOption("japanese", "中文日期：2026年05月13日")
          .setValue(this.plugin.settings.dateFormat)
          .onChange(async (value: string) => {
            this.plugin.settings.dateFormat = value as "iso" | "japanese";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("右侧批注面板")
      .setDesc("打开类似 Quiet Outline 的右侧批注窗口。")
      .addButton((button) =>
        button
          .setButtonText("打开面板")
          .setCta()
          .onClick(() => {
            void this.plugin.activateView();
          })
      );

    new Setting(containerEl)
      .setName("启动时自动打开右侧面板")
      .setDesc("Obsidian 布局加载完成后自动打开批注工作台。")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoOpenPanel)
          .onChange(async (value) => {
            this.plugin.settings.autoOpenPanel = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("编辑器折叠批注标记")
      .setDesc("普通编辑/Live Preview 中隐藏批注标记，只显示被批注正文；源码模式或光标进入批注时展开。")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.foldEditorMarkup)
          .onChange(async (value) => {
            this.plugin.settings.foldEditorMarkup = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("划线时显示悬浮工具条")
      .setDesc("开启后，选中文本时显示批注类型按钮；关闭后仍可通过右键菜单、命令面板或快捷键添加批注。")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showFloatingBar)
          .onChange(async (value) => {
            this.plugin.settings.showFloatingBar = value;
            if (!value) this.plugin.hideFloatingBar();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("默认高亮批注锚点")
      .setDesc("开启后用底色高亮被批注文本；关闭后只保留轻微下划线和悬浮提示，正文阅读更安静。")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.highlightAnchors)
          .onChange(async (value) => {
            this.plugin.settings.highlightAnchors = value;
            await this.plugin.saveSettings();
          })
      );

    containerEl.createEl("h3", { text: "批注类型" });
    const list = containerEl.createEl("ul");
    for (const t of TYPES) {
      const li = list.createEl("li");
      li.textContent = `${t.icon} ${t.label} → 标签：${t.tag}（命令 / 右键菜单：添加${t.label}批注）`;
    }

    containerEl.createEl("p", {
      text: "每种批注类型都会注册为独立命令，也会出现在编辑器右键菜单中；可在“设置 → 快捷键”中分配常用快捷键。",
      cls: "setting-item-description",
    });
  }
}
