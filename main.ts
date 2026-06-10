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
import {
  ChangeSet,
  EditorState,
  Range,
  StateEffect,
  StateField,
} from "@codemirror/state";
import {
  COMMENT_FORMAT,
  COMMENT_SYNTAXES,
  CommentExportFormat,
  CommentLintIssue,
  CommentParseOptions,
  CommentStatusFilter,
  CommentSyntax,
  ParsedComment,
  ParsedCommentEntry,
  ParsedMeta,
  appendReplyComment,
  containsCommentMarkup,
  exportCommentsMarkdown,
  filterComments,
  findComments,
  formatComment,
  formatEditableComment,
  generateCommentId,
  isCommentSyntax,
  lintComments,
  normalizeCommentBodyForContext,
  normalizeCommentSyntaxes,
  removeComment,
  replaceCommentEntryMeta,
  replaceCommentThreadStatus,
  summarizeComments,
} from "./comment-core";
import {
  DEFAULT_COMMENT_TYPES,
  ReviewCommentType,
  getCommentTypeColorTriplet,
  getReviewCommentType,
  normalizeCommentTypes,
  normalizeHexColor,
  sanitizeCommentTypeIcon,
  sanitizeCommentTypeId,
  sanitizeCommentTypeLabel,
  sanitizeCommentTypeTag,
} from "./comment-types";
import { renderCommentMarkupInReadingMode } from "./reading-mode-renderer";

interface ReviewCommentsSettings {
  authorName: string;
  dateFormat: "iso" | "japanese";
  commentCreationMode: "modal" | "inline";
  autoOpenPanel: boolean;
  showFloatingBar: boolean;
  foldEditorMarkup: boolean;
  highlightAnchors: boolean;
  commentExportFormat: CommentExportFormat;
  compatibleCommentSyntaxes: CommentSyntax[];
  writeCommentSyntax: CommentSyntax;
  commentTypes: ReviewCommentType[];
}

const DEFAULT_SETTINGS: ReviewCommentsSettings = {
  authorName: "you",
  dateFormat: "iso",
  commentCreationMode: "modal",
  autoOpenPanel: true,
  showFloatingBar: true,
  foldEditorMarkup: true,
  highlightAnchors: false,
  commentExportFormat: "simple",
  compatibleCommentSyntaxes: [...COMMENT_SYNTAXES],
  writeCommentSyntax: COMMENT_FORMAT.defaultSyntax,
  commentTypes: DEFAULT_COMMENT_TYPES.map((type) => ({ ...type })),
};

const SYNTAX_LABELS: Record<CommentSyntax, string> = {
  "plain-anchor": "当前格式：{...}{>>...<<}",
  "shift-anchor": "旧 Shift 格式：{<<...>>}{>>...<<}",
  critic: "CriticMarkup：{==...==}{>>...<<}",
  "hash-anchor": "过渡格式：{=#...#=}{>>...<<}",
};

function normalizeSettings(
  data: Partial<ReviewCommentsSettings> | null | undefined
): ReviewCommentsSettings {
  const loaded = data || {};
  const writeCommentSyntax = isCommentSyntax(loaded.writeCommentSyntax)
    ? loaded.writeCommentSyntax
    : DEFAULT_SETTINGS.writeCommentSyntax;
  const commentCreationMode =
    loaded.commentCreationMode === "inline" ? "inline" : "modal";

  return {
    ...DEFAULT_SETTINGS,
    ...loaded,
    commentCreationMode,
    writeCommentSyntax,
    compatibleCommentSyntaxes: normalizeCommentSyntaxes(
      loaded.compatibleCommentSyntaxes,
      [writeCommentSyntax]
    ),
    commentTypes: normalizeCommentTypes(loaded.commentTypes),
  };
}

function applyTypeColor(
  el: HTMLElement,
  types: ReviewCommentType[],
  typeTag: string | null | undefined,
  variableName = "--review-comment-type-color"
) {
  el.style.setProperty(
    variableName,
    getCommentTypeColorTriplet(types, typeTag)
  );
}

interface ThreadFilterSummary {
  total: number;
  open: number;
  closed: number;
  byType: Record<string, number>;
}

const VIEW_TYPE_COMMENTS = "review-comments-view";
const setCommentDecorationMode = StateEffect.define<boolean>();

interface HeadingCommentContext {
  line: number;
  target: string;
}

interface EditableInsertion {
  startOffset: number;
  bodyStart: number;
  bodyEnd: number;
}

class CommentInputModal extends Modal {
  private selectedTypeTag: string;
  private readonly onSubmit: (body: string, typeTag: string) => void;
  private readonly commentTypes: ReviewCommentType[];
  private readonly titleText: string;
  private readonly submitText: string;
  private draftBody: string;
  private readonly showTypeSelector: boolean;
  private readonly typeSelectorLabel: string;
  private submitted = false;
  private explicitCancel = false;
  private restoringDraft = false;

  constructor(
    app: App,
    commentTypes: ReviewCommentType[],
    typeTag: string,
    onSubmit: (body: string, typeTag: string) => void,
    titleText?: string,
    submitText?: string,
    initialBody?: string,
    showTypeSelector?: boolean,
    typeSelectorLabel?: string
  ) {
    super(app);
    this.commentTypes = withCurrentCommentType(commentTypes, typeTag);
    this.selectedTypeTag = getReviewCommentType(
      this.commentTypes,
      typeTag
    ).tag;
    this.onSubmit = onSubmit;
    this.titleText =
      titleText ||
      formatAddCommentTitle(this.selectedTypeTag, this.commentTypes);
    this.submitText = submitText || "添加批注";
    this.draftBody = initialBody || "";
    this.showTypeSelector = Boolean(showTypeSelector);
    this.typeSelectorLabel = typeSelectorLabel || "批注类型";
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("review-comment-modal");
    this.setTitle(this.titleText);

    if (this.showTypeSelector) {
      this.renderTypeSelector(contentEl);
    }

    contentEl.createEl("p", {
      text: "支持多行和项目符号，内容会直接写入 Markdown。",
      cls: "review-comment-modal-help",
    });

    const textarea = contentEl.createEl("textarea", {
      cls: "review-comment-modal-textarea",
    });
    textarea.placeholder = "例：\n这里需要重新判断\n- 理由\n- 相关上下文";
    textarea.value = this.draftBody;

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

    cancelBtn.addEventListener("click", () => {
      this.explicitCancel = true;
      this.close();
    });
    submitBtn.addEventListener("click", () => this.submit(textarea.value));
    textarea.addEventListener("input", () => {
      this.draftBody = textarea.value;
    });
    textarea.addEventListener("keydown", (evt: KeyboardEvent) => {
      if ((evt.metaKey || evt.ctrlKey) && evt.key === "Enter") {
        evt.preventDefault();
        this.submit(textarea.value);
      }
    });

    window.setTimeout(() => textarea.focus(), 0);
  }

  private submit(body: string) {
    try {
      this.onSubmit(body, this.selectedTypeTag);
      this.submitted = true;
      this.close();
    } catch (error) {
      new Notice(error instanceof Error ? error.message : "批注写入失败");
    }
  }

  onClose() {
    const shouldRestore =
      !this.submitted &&
      !this.explicitCancel &&
      !this.restoringDraft &&
      this.draftBody.trim().length > 0;
    if (!shouldRestore) {
      this.contentEl.empty();
      return;
    }

    this.restoringDraft = true;
    new Notice("批注草稿未保存，请先添加或取消");
    window.setTimeout(() => {
      this.restoringDraft = false;
      this.open();
    }, 0);
  }

  private renderTypeSelector(contentEl: HTMLElement) {
    const selector = contentEl.createDiv({
      cls: "review-comment-modal-type-selector",
    });
    selector.createEl("span", {
      text: this.typeSelectorLabel,
      cls: "review-comment-modal-type-label",
    });
    const options = selector.createDiv({
      cls: "review-comment-modal-type-options",
    });
    const buttons: HTMLButtonElement[] = [];
    const updateSelection = () => {
      for (const button of buttons) {
        const isSelected = button.dataset.type === this.selectedTypeTag;
        button.toggleClass("is-selected", isSelected);
        button.setAttr("aria-pressed", isSelected ? "true" : "false");
      }
    };

    for (const type of this.commentTypes) {
      const button = options.createEl("button", {
        cls: "review-comment-modal-type-option",
        attr: {
          type: "button",
          "data-type": type.tag,
          "aria-pressed": type.tag === this.selectedTypeTag ? "true" : "false",
        },
      });
      button.createSpan({
        text: type.icon,
        cls: "review-comment-modal-type-icon",
      });
      button.createSpan({ text: type.label });
      applyTypeColor(button, this.commentTypes, type.tag, "--review-comment-chip-color");
      button.addEventListener("click", () => {
        this.selectedTypeTag = type.tag;
        updateSelection();
      });
      buttons.push(button);
    }

    updateSelection();
  }
}

class CommentLintModal extends Modal {
  constructor(
    app: App,
    private readonly issues: CommentLintIssue[]
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("review-comment-lint-modal");
    this.setTitle("当前文件批注检查");

    if (this.issues.length === 0) {
      contentEl.createEl("p", {
        text: "没有发现批注格式问题。",
        cls: "review-comment-lint-empty",
      });
      return;
    }

    const summary = countLintIssues(this.issues);
    contentEl.createEl("p", {
      text: `发现 ${this.issues.length} 项：错误 ${summary.error} · 警告 ${summary.warning} · 提示 ${summary.info}`,
      cls: "review-comment-lint-summary",
    });

    const list = contentEl.createEl("ol", {
      cls: "review-comment-lint-list",
    });
    for (const issue of this.issues) {
      const item = list.createEl("li", {
        cls: `review-comment-lint-item is-${issue.severity}`,
      });
      item.createEl("div", {
        text: `${formatLintSeverity(issue.severity)} · ${issue.code} · 第 ${issue.line} 行，第 ${issue.column} 列`,
        cls: "review-comment-lint-meta",
      });
      item.createEl("div", {
        text: issue.message,
        cls: "review-comment-lint-message",
      });
      if (issue.excerpt) {
        item.createEl("code", {
          text: issue.excerpt,
          cls: "review-comment-lint-excerpt",
        });
      }
    }
  }
}

export default class ReviewCommentsPlugin extends Plugin {
  settings: ReviewCommentsSettings = DEFAULT_SETTINGS;
  floatingBar: HTMLDivElement | null = null;
  selectionDebounce: number | null = null;
  private registeredTypeCommandIds = new Set<string>();

  async onload() {
    console.log("[ReviewComments] onload");
    await this.loadSettings();

    this.registerCommentTypeCommands();

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
    this.addCommand({
      id: "lint-current-file-comments",
      name: "检查当前文件批注",
      editorCallback: (editor: Editor) =>
        this.lintCurrentFileComments(editor),
    });
    this.addCommand({
      id: "export-current-file-comments",
      name: "复制当前文件批注清单",
      editorCallback: (editor: Editor) =>
        void this.copyCurrentFileCommentList(editor),
    });
    this.addCommand({
      id: "reveal-current-comment-in-panel",
      name: "在批注栏中定位当前批注",
      editorCallback: (editor: Editor) =>
        void this.revealCurrentCommentInPanel(editor),
    });
    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, editor) => {
        if (this.findCommentNearEditorCursor(editor)) {
          menu.addItem((item) =>
            item
              .setTitle("在批注栏中定位")
              .setIcon("crosshair")
              .setSection("review-comments")
              .onClick(() => void this.revealCurrentCommentInPanel(editor))
          );
        }
        menu.addSeparator();
        menu.addItem((item) =>
          item
            .setTitle("添加批注")
            .setIcon("message-circle")
            .setSection("review-comments")
            .setIsLabel(true)
        );
        for (const t of this.getCommentTypes()) {
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
        () => this.settings.highlightAnchors,
        () => this.getParseOptions(),
        (typeTag) => this.getTypeIcon(typeTag),
        (typeTag) => this.getTypeColorTriplet(typeTag)
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
    this.settings = normalizeSettings(await this.loadData());
  }

  async saveSettings() {
    this.settings = normalizeSettings(this.settings);
    await this.saveData(this.settings);
  }

  getParseOptions(): CommentParseOptions {
    return { syntaxes: this.settings.compatibleCommentSyntaxes };
  }

  getCommentTypes(): ReviewCommentType[] {
    return this.settings.commentTypes;
  }

  getCommentType(typeTag: string | null | undefined): ReviewCommentType {
    return getReviewCommentType(this.settings.commentTypes, typeTag);
  }

  getTypeIcon(typeTag: string | null | undefined): string {
    return this.getCommentType(typeTag).icon;
  }

  getTypeLabel(typeTag: string | null | undefined): string {
    return this.getCommentType(typeTag).label;
  }

  getTypeColor(typeTag: string | null | undefined): string {
    return this.getCommentType(typeTag).color;
  }

  getTypeColorTriplet(typeTag: string | null | undefined): string {
    return getCommentTypeColorTriplet(this.settings.commentTypes, typeTag);
  }

  applyTypeColor(
    el: HTMLElement,
    typeTag: string | null | undefined,
    variableName = "--review-comment-type-color"
  ) {
    applyTypeColor(el, this.settings.commentTypes, typeTag, variableName);
  }

  registerCommentTypeCommands() {
    const activeCommandIds = new Set(
      this.getCommentTypes().map((type) => `add-comment-${type.id}`)
    );
    for (const commandId of this.registeredTypeCommandIds) {
      if (!activeCommandIds.has(commandId)) {
        this.removeCommand(commandId);
        this.registeredTypeCommandIds.delete(commandId);
      }
    }

    for (const type of this.getCommentTypes()) {
      const commandId = `add-comment-${type.id}`;
      if (this.registeredTypeCommandIds.has(commandId)) continue;
      this.registeredTypeCommandIds.add(commandId);
      this.addCommand({
        id: commandId,
        name: `添加${type.label} ${type.icon}`,
        editorCallback: (editor: Editor) => {
          const activeType = this.getCommentTypes().find(
            (current) => current.id === type.id && current.tag === type.tag
          );
          if (!activeType) {
            new Notice("批注类型已变更，请重新打开命令面板");
            return;
          }
          this.addCommentToSelection(editor, activeType.tag);
        },
      });
    }
  }

  escapeCommentBody(body: string): string {
    return body.replace(/<<}/g, "<< }");
  }

  addCommentToSelection(
    editor: Editor,
    typeTag: string = COMMENT_FORMAT.defaultType
  ) {
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
    const commentTypes = this.getCommentTypes();
    const title = headingContext
      ? formatAddCommentTitle(typeTag, commentTypes, "标题批注")
      : selection
        ? undefined
        : formatAddCommentTitle(typeTag, commentTypes, "单点批注");

    if (this.settings.commentCreationMode === "inline") {
      this.insertEditableComment(editor, typeTag, from, to, selection, headingContext);
      return;
    }

    new CommentInputModal(this.app, commentTypes, typeTag, (body, selectedTypeTag) => {
      const insertOffset = headingContext
        ? this.getLineInsertOffset(editor, headingContext.line)
        : editor.posToOffset(from);
      const normalizedBody = normalizeCommentBodyForContext(
        body,
        editor.getValue(),
        insertOffset
      );
      const meta = this.createCommentMeta(selectedTypeTag, normalizedBody);
      if (headingContext) {
        meta.attrs = {
          ...meta.attrs,
          scope: "heading",
          target: headingContext.target,
        };
        this.insertPointCommentAfterLine(editor, headingContext.line, meta);
      } else if (selection) {
        editor.replaceRange(
          formatComment(selection, meta, this.settings.writeCommentSyntax),
          from,
          to
        );
      } else {
        editor.replaceRange(
          formatComment("", meta, this.settings.writeCommentSyntax),
          from,
          to
        );
      }
      editor.focus();
    }, title).open();
  }

  private insertEditableComment(
    editor: Editor,
    typeTag: string,
    from: { line: number; ch: number },
    to: { line: number; ch: number },
    selection: string,
    headingContext: HeadingCommentContext | null
  ) {
    const meta = this.createCommentMeta(typeTag, "", "");
    if (headingContext) {
      meta.attrs = {
        ...meta.attrs,
        scope: "heading",
        target: headingContext.target,
      };
      const inserted = this.insertEditablePointCommentAfterLine(
        editor,
        headingContext.line,
        meta
      );
      this.focusEditableCommentBody(editor, inserted.startOffset, inserted.bodyStart, inserted.bodyEnd);
      return;
    }

    const editable = formatEditableComment(
      selection,
      meta,
      this.settings.writeCommentSyntax
    );
    const startOffset = editor.posToOffset(from);
    editor.replaceRange(editable.markup, from, to);
    this.focusEditableCommentBody(editor, startOffset, editable.bodyStart, editable.bodyEnd);
  }

  createCommentMeta(
    typeTag: string,
    body: string,
    fallbackBody = "请填写批注"
  ): ParsedMeta {
    const date = formatDate(new Date(), this.settings.dateFormat);
    const author = sanitizeAuthor(this.settings.authorName);
    return {
      author,
      date,
      type: typeTag,
      body: this.escapeCommentBody(body.trim() || fallbackBody),
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
    const markup = formatComment("", meta, this.settings.writeCommentSyntax);
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

  private insertEditablePointCommentAfterLine(
    editor: Editor,
    line: number,
    meta: ParsedMeta
  ): EditableInsertion {
    const editable = formatEditableComment(
      "",
      meta,
      this.settings.writeCommentSyntax
    );
    const nextLine = line + 1;
    if (nextLine < editor.lineCount()) {
      const insertAt = { line: nextLine, ch: 0 };
      const startOffset = editor.posToOffset(insertAt);
      editor.replaceRange(`${editable.markup}\n`, insertAt);
      return { startOffset, bodyStart: editable.bodyStart, bodyEnd: editable.bodyEnd };
    }

    const insertAt = { line, ch: editor.getLine(line).length };
    const startOffset = editor.posToOffset(insertAt) + 1;
    editor.replaceRange(`\n${editable.markup}`, insertAt);
    return { startOffset, bodyStart: editable.bodyStart, bodyEnd: editable.bodyEnd };
  }

  private getLineInsertOffset(editor: Editor, line: number): number {
    const nextLine = line + 1;
    if (nextLine < editor.lineCount()) {
      return editor.posToOffset({ line: nextLine, ch: 0 });
    }
    return editor.posToOffset({ line, ch: editor.getLine(line).length }) + 1;
  }

  private focusEditableCommentBody(
    editor: Editor,
    startOffset: number,
    bodyStart: number,
    bodyEnd: number
  ) {
    const from = editor.offsetToPos(startOffset + bodyStart);
    const to = editor.offsetToPos(startOffset + bodyEnd);
    editor.setSelection(from, to);
    editor.scrollIntoView({ from, to }, true);
    editor.focus();
  }

  lintCurrentFileComments(editor: Editor) {
    const issues = lintComments(editor.getValue(), this.getParseOptions());
    const summary = countLintIssues(issues);
    if (issues.length === 0) {
      new Notice("批注检查完成：没有发现问题");
    } else {
      new Notice(
        `批注检查完成：错误 ${summary.error}，警告 ${summary.warning}，提示 ${summary.info}`
      );
    }
    new CommentLintModal(this.app, issues).open();
  }

  async copyCurrentFileCommentList(editor: Editor, filePath?: string) {
    const activeMarkdown = this.app.workspace.getActiveViewOfType(MarkdownView);
    const resolvedPath =
      filePath || activeMarkdown?.file?.path || this.app.workspace.getActiveFile()?.path || "";
    const text = editor.getValue();
    const comments = findComments(text, this.getParseOptions());
    const markdown = exportCommentsMarkdown(comments, {
      format: this.settings.commentExportFormat,
      filePath: resolvedPath,
      sourceText: text,
    });

    try {
      await copyTextToClipboard(markdown);
      new Notice(
        comments.length === 0
          ? "当前文件没有批注，已复制空清单"
          : `已复制 ${comments.length} 个批注线程的清单`
      );
    } catch (error) {
      new Notice(error instanceof Error ? error.message : "复制批注清单失败");
    }
  }

  findCommentNearEditorCursor(editor: Editor): ParsedComment | null {
    const comments = findComments(editor.getValue(), this.getParseOptions());
    if (comments.length === 0) return null;

    const from = editor.posToOffset(editor.getCursor("from"));
    const to = editor.posToOffset(editor.getCursor("to"));
    return findCommentInRange(comments, Math.min(from, to), Math.max(from, to));
  }

  async revealCurrentCommentInPanel(editor: Editor) {
    const match = this.findCommentNearEditorCursor(editor);
    if (!match) {
      new Notice("光标不在批注范围内");
      return;
    }

    const mdView = this.app.workspace.getActiveViewOfType(MarkdownView);
    const commentsView = await this.activateView();
    if (!commentsView) {
      new Notice("无法打开批注栏");
      return;
    }
    if (mdView) commentsView.lastMarkdownView = mdView;
    await commentsView.revealThread(match);
  }

  async activateView(): Promise<CommentsView | null> {
    const { workspace } = this.app;
    const existing = workspace.getLeavesOfType(VIEW_TYPE_COMMENTS);
    if (existing.length > 0) {
      workspace.revealLeaf(existing[0]);
      return existing[0].view instanceof CommentsView
        ? existing[0].view
        : null;
    }

    const leaf = workspace.getRightLeaf(false);
    if (leaf) {
      await leaf.setViewState({ type: VIEW_TYPE_COMMENTS, active: true });
      workspace.revealLeaf(leaf);
      return leaf.view instanceof CommentsView ? leaf.view : null;
    }
    return null;
  }

  setupFloatingBar() {
    const bar = document.createElement("div");
    bar.className = "review-comment-floating-bar";
    bar.style.display = "none";
    document.body.appendChild(bar);
    this.floatingBar = bar;
    this.renderFloatingBarButtons();

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

  renderFloatingBarButtons() {
    const bar = this.floatingBar;
    if (!bar) return;
    bar.empty();

    for (const t of this.getCommentTypes()) {
      const btn = document.createElement("button");
      btn.className = "review-comment-type-btn";
      btn.title = `${t.label}（插入 ${t.tag}）`;
      btn.createSpan({ text: t.icon, cls: "rc-icon" });
      btn.createSpan({ text: t.label, cls: "rc-label" });
      this.applyTypeColor(btn, t.tag);
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
    renderCommentMarkupInReadingMode(el, {
      parseOptions: this.getParseOptions(),
      createCommentElement: (comment, ownerDocument) =>
        this.createReadingModeCommentElement(comment, ownerDocument),
    });
  }

  private createReadingModeCommentElement(
    comment: ParsedComment,
    ownerDocument: Document = document
  ): HTMLElement {
    const meta = comment.meta;
    const span = ownerDocument.createElement("span");
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
    this.applyTypeColor(span, meta.type);
    span.setAttribute(
      "title",
      formatThreadTitle(comment.entries, (typeTag) =>
        this.getTypeIcon(typeTag)
      )
    );
    return span;
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

function countLintIssues(
  issues: CommentLintIssue[]
): Record<CommentLintIssue["severity"], number> {
  return issues.reduce(
    (summary, issue) => {
      summary[issue.severity] += 1;
      return summary;
    },
    { error: 0, warning: 0, info: 0 }
  );
}

function formatLintSeverity(severity: CommentLintIssue["severity"]): string {
  if (severity === "error") return "错误";
  if (severity === "warning") return "警告";
  return "提示";
}

async function copyTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("复制批注清单失败");
}

function isPlainSourceMode(view: EditorView): boolean {
  const sourceView = view.dom.closest(".markdown-source-view");
  if (!sourceView) return false;
  return !sourceView.classList.contains("is-live-preview");
}

function selectionTouchesComment(
  state: EditorState,
  start: number,
  end: number
): boolean {
  return state.selection.ranges.some((range) => {
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
    private readonly type: string,
    private readonly colorTriplet: string
  ) {
    super();
  }

  eq(other: CommentPointWidget): boolean {
    return (
      this.title === other.title &&
      this.type === other.type &&
      this.colorTriplet === other.colorTriplet
    );
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "review-comment-point-live";
    span.dataset.type = this.type;
    span.style.setProperty("--review-comment-type-color", this.colorTriplet);
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
  shouldHighlightAnchors: () => boolean,
  getParseOptions: () => CommentParseOptions,
  getTypeIcon: (typeTag: string | null | undefined) => string,
  getTypeColorTriplet: (typeTag: string | null | undefined) => string
) {
  // Cross-line comment bodies must be folded by directly provided StateField
  // decorations. ViewPlugin-provided replace decorations cannot replace line
  // breaks in Obsidian/CodeMirror, and CSS line hiding still leaves virtual
  // layout space. Keep this path direct unless CodeMirror's constraint changes.
  const decorationField = StateField.define<CommentDecorationState>({
    create(state) {
      return buildCommentDecorationState(
        state,
        shouldFoldMarkup(),
        shouldHighlightAnchors(),
        true,
        getParseOptions(),
        getTypeIcon,
        getTypeColorTriplet
      );
    },
    update(value, transaction) {
      let isLivePreview = value.isLivePreview;
      for (const effect of transaction.effects) {
        if (effect.is(setCommentDecorationMode)) {
          isLivePreview = effect.value;
        }
      }

      if (isLivePreview !== value.isLivePreview) {
        return buildCommentDecorationState(
          transaction.state,
          shouldFoldMarkup(),
          shouldHighlightAnchors(),
          isLivePreview,
          getParseOptions(),
          getTypeIcon,
          getTypeColorTriplet
        );
      }

      if (transaction.docChanged) {
        if (
          changesTouchComments(transaction.changes, value.comments) ||
          changesMayAffectCommentSyntax(transaction.changes, transaction.state)
        ) {
          return buildCommentDecorationState(
            transaction.state,
            shouldFoldMarkup(),
            shouldHighlightAnchors(),
            isLivePreview,
            getParseOptions(),
            getTypeIcon,
            getTypeColorTriplet
          );
        }

        const comments = mapCommentsThroughChanges(
          value.comments,
          transaction.changes
        );
        return {
          comments,
          decorations: buildCommentDecorationsFromComments(
            transaction.state,
            shouldFoldMarkup(),
            shouldHighlightAnchors(),
            isLivePreview,
            comments,
            getTypeIcon,
            getTypeColorTriplet
          ),
          isLivePreview,
        };
      }

      if (!transaction.selection) return value;

      return {
        comments: value.comments,
        decorations: buildCommentDecorationsFromComments(
          transaction.state,
          shouldFoldMarkup(),
          shouldHighlightAnchors(),
          isLivePreview,
          value.comments,
          getTypeIcon,
          getTypeColorTriplet
        ),
        isLivePreview,
      };
    },
    provide: (field) =>
      EditorView.decorations.from(field, (value) => value.decorations),
  });

  const modeWatcher = ViewPlugin.fromClass(
    class {
      private isLivePreview: boolean;
      private pendingMode: boolean | null = null;
      private pendingDispatch: number | null = null;
      private destroyed = false;

      constructor(view: EditorView) {
        this.isLivePreview = !isPlainSourceMode(view);
        this.scheduleModeDispatch(view, this.isLivePreview);
      }

      update(update: ViewUpdate) {
        const next = !isPlainSourceMode(update.view);
        if (next === this.isLivePreview) return;
        this.isLivePreview = next;
        this.scheduleModeDispatch(update.view, next);
      }

      destroy() {
        this.destroyed = true;
        if (this.pendingDispatch !== null) {
          window.clearTimeout(this.pendingDispatch);
          this.pendingDispatch = null;
        }
        this.pendingMode = null;
      }

      private scheduleModeDispatch(view: EditorView, mode: boolean) {
        this.pendingMode = mode;
        if (this.pendingDispatch !== null) return;

        // CodeMirror forbids dispatching while a ViewPlugin constructor/update is
        // running. Defer mode sync to the next task so Obsidian can finish the
        // current editor update before we refresh the folding decorations.
        this.pendingDispatch = window.setTimeout(() => {
          this.pendingDispatch = null;
          if (this.destroyed || this.pendingMode === null) return;

          const nextMode = this.pendingMode;
          this.pendingMode = null;
          const current = view.state.field(decorationField, false);
          if (current?.isLivePreview === nextMode) return;

          view.dispatch({
            effects: setCommentDecorationMode.of(nextMode),
          });
        }, 0);
      }
    }
  );

  return [decorationField, modeWatcher];
}

interface CommentDecorationState {
  decorations: DecorationSet;
  isLivePreview: boolean;
  comments: ParsedComment[];
}

function buildCommentDecorationState(
  state: EditorState,
  shouldFoldMarkup: boolean,
  shouldHighlightAnchors: boolean,
  isLivePreview: boolean,
  parseOptions: CommentParseOptions,
  getTypeIcon: (typeTag: string | null | undefined) => string,
  getTypeColorTriplet: (typeTag: string | null | undefined) => string
): CommentDecorationState {
  const comments = findComments(state.doc.toString(), parseOptions);
  return {
    comments,
    decorations: buildCommentDecorationsFromComments(
      state,
      shouldFoldMarkup,
      shouldHighlightAnchors,
      isLivePreview,
      comments,
      getTypeIcon,
      getTypeColorTriplet
    ),
    isLivePreview,
  };
}

function buildCommentDecorationsFromComments(
  state: EditorState,
  shouldFoldMarkup: boolean,
  shouldHighlightAnchors: boolean,
  isLivePreview: boolean,
  comments: ParsedComment[],
  getTypeIcon: (typeTag: string | null | undefined) => string,
  getTypeColorTriplet: (typeTag: string | null | undefined) => string
): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  const foldMarkup = shouldFoldMarkup && isLivePreview;

  for (const comment of comments) {
    const start = comment.offset;
    const highlightTextStart = comment.anchorStart;
    const highlightTextEnd = comment.anchorEnd;
    const metaStart = comment.metaStart;
    const end = comment.end;
    const meta = comment.meta;
    const title = formatThreadTitle(comment.entries, getTypeIcon);
    const colorTriplet = getTypeColorTriplet(meta.type);
    const expanded = !foldMarkup || selectionTouchesComment(state, start, end);

    if (!comment.anchor) {
      if (expanded) {
        ranges.push(
          Decoration.mark({ class: "review-comment-meta-live" }).range(
            metaStart,
            end
          )
        );
      } else {
        addReplace(ranges, start, end, {
          widget: new CommentPointWidget(title, meta.type, colorTriplet),
        });
      }
      continue;
    }

    if (!expanded) {
      addReplace(ranges, start, highlightTextStart);
    }

    ranges.push(
      Decoration.mark({
        class: `review-comment-highlight-live review-comment-folded-anchor${
          shouldHighlightAnchors ? "" : " review-comment-anchor-muted"
        }`,
        attributes: {
          title,
          "data-type": meta.type,
          style: `--review-comment-type-color: ${colorTriplet}`,
        },
      }).range(highlightTextStart, highlightTextEnd)
    );

    if (expanded) {
      ranges.push(
        Decoration.mark({ class: "review-comment-meta-live" }).range(
          metaStart,
          end
        )
      );
    } else {
      addReplace(ranges, highlightTextEnd, end);
    }
  }

  return Decoration.set(ranges, true);
}

function changesTouchComments(
  changes: ChangeSet,
  comments: ParsedComment[]
): boolean {
  if (comments.length === 0) return false;
  let touches = false;
  changes.iterChanges((fromA, toA) => {
    if (touches) return;
    touches = comments.some((comment) =>
      rangeTouchesComment(fromA, toA, comment.offset, comment.end)
    );
  });
  return touches;
}

function rangeTouchesComment(
  from: number,
  to: number,
  commentStart: number,
  commentEnd: number
): boolean {
  if (from === to) return from >= commentStart && from <= commentEnd;
  return from < commentEnd && to > commentStart;
}

function changesMayAffectCommentSyntax(
  changes: ChangeSet,
  state: EditorState
): boolean {
  let mayAffect = false;
  changes.iterChanges((_fromA, _toA, fromB, toB) => {
    if (mayAffect) return;
    const aroundStart = Math.max(0, fromB - 8);
    const aroundEnd = Math.min(state.doc.length, toB + 8);
    mayAffect = containsCommentMarkup(
      state.doc.sliceString(aroundStart, aroundEnd)
    );
  });
  return mayAffect;
}

function mapCommentsThroughChanges(
  comments: ParsedComment[],
  changes: ChangeSet
): ParsedComment[] {
  return comments.map((comment) => {
    const entries = comment.entries.map((entry) =>
      mapCommentEntryThroughChanges(entry, changes)
    );
    return {
      ...comment,
      offset: changes.mapPos(comment.offset, 1),
      end: changes.mapPos(comment.end, -1),
      anchorStart: changes.mapPos(comment.anchorStart, 1),
      anchorEnd: changes.mapPos(comment.anchorEnd, -1),
      metaStart: changes.mapPos(comment.metaStart, 1),
      entries,
    };
  });
}

function mapCommentEntryThroughChanges(
  entry: ParsedCommentEntry,
  changes: ChangeSet
): ParsedCommentEntry {
  return {
    ...entry,
    offset: changes.mapPos(entry.offset, 1),
    end: changes.mapPos(entry.end, -1),
    metaStart: changes.mapPos(entry.metaStart, 1),
  };
}

function addReplace(
  ranges: Range<Decoration>[],
  from: number,
  to: number,
  spec: Parameters<typeof Decoration.replace>[0] = {}
) {
  if (from >= to) return;
  ranges.push(Decoration.replace(spec).range(from, to));
}

interface RenderCommentsOptions {
  preservePanelScroll?: boolean;
  focusThreadKey?: string;
}

class CommentsView extends ItemView {
  plugin: ReviewCommentsPlugin;
  lastMarkdownView: MarkdownView | null = null;
  selectedStatusFilters: CommentStatusFilter[] = [];
  selectedTypeFilters: string[] = [];
  private renderRevision = 0;
  private renderDebounce: number | null = null;
  private focusClearTimer: number | null = null;

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
    void this.renderComments({ preservePanelScroll: false });
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        this.cancelScheduledRender();
        void this.renderComments({ preservePanelScroll: false });
      })
    );
    this.registerEvent(
      this.app.workspace.on("editor-change", () => {
        this.scheduleRenderComments();
      })
    );
  }

  async onClose() {
    this.cancelScheduledRender();
    if (this.focusClearTimer !== null) {
      window.clearTimeout(this.focusClearTimer);
      this.focusClearTimer = null;
    }
    this.renderRevision += 1;
  }

  private scheduleRenderComments(
    options: RenderCommentsOptions = {},
    delay = 250
  ) {
    this.cancelScheduledRender();
    this.renderDebounce = window.setTimeout(() => {
      this.renderDebounce = null;
      void this.renderComments(options);
    }, delay);
  }

  private cancelScheduledRender() {
    if (this.renderDebounce === null) return;
    window.clearTimeout(this.renderDebounce);
    this.renderDebounce = null;
  }

  async revealThread(match: ParsedComment) {
    this.selectedStatusFilters = [];
    this.selectedTypeFilters = [];
    this.cancelScheduledRender();
    await this.renderComments({
      preservePanelScroll: false,
      focusThreadKey: getCommentThreadKey(match),
    });
  }

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

  async renderComments(options: RenderCommentsOptions = {}) {
    const renderId = ++this.renderRevision;
    const container = this.containerEl.children[1] as HTMLElement;
    const shouldFocusThread = Boolean(options.focusThreadKey);
    const shouldRestoreScroll =
      !shouldFocusThread && options.preservePanelScroll !== false;
    const previousPanelScrollTop = shouldRestoreScroll ? container.scrollTop : 0;
    const nextContainer = document.createElement("div");
    const restorePanelScroll = () => {
      if (!shouldRestoreScroll || previousPanelScrollTop <= 0) return;
      const restore = () => {
        const maxTop = Math.max(0, container.scrollHeight - container.clientHeight);
        container.scrollTop = Math.min(previousPanelScrollTop, maxTop);
      };
      window.requestAnimationFrame(() => {
        restore();
        window.requestAnimationFrame(restore);
        window.setTimeout(restore, 60);
      });
    };
    const finishRender = () => {
      if (renderId !== this.renderRevision) return false;
      container.empty();
      while (nextContainer.firstChild) {
        container.appendChild(nextContainer.firstChild);
      }
      if (options.focusThreadKey) {
        this.scrollFocusedThreadIntoView(container);
      } else {
        restorePanelScroll();
      }
      return true;
    };

    new Setting(nextContainer).setName("批注").setHeading();

    const mdView = this.getMarkdownView();
    if (!mdView) {
      nextContainer.createEl("p", {
        text: "请先打开一个 Markdown 文件",
      });
      finishRender();
      return;
    }

    const sourcePath = mdView.file?.path ?? "";
    const text = mdView.editor.getValue();
    const matches = findComments(text, this.plugin.getParseOptions());

    if (matches.length === 0) {
      nextContainer.createEl("p", {
        text: "还没有批注。选中文本可添加锚定批注；无选区时可通过右键菜单、命令面板或快捷键添加单点批注。",
        cls: "review-comment-empty",
      });
      finishRender();
      return;
    }

    const summary = summarizeComments(matches);
    const availableTypes = this.getAvailableTypeTags(summary);
    this.selectedStatusFilters = normalizeSelectedStatusFilters(
      this.selectedStatusFilters
    );
    this.selectedTypeFilters = this.selectedTypeFilters.filter(
      (type) => type === "all" || availableTypes.includes(type)
    );

    this.renderFilterBar(nextContainer, summary, availableTypes, mdView);

    const visibleMatches = filterComments(matches, {
      status: this.selectedStatusFilters,
      type: this.selectedTypeFilters,
    });

    if (visibleMatches.length === 0) {
      nextContainer.createEl("p", {
        text: "当前筛选下没有批注。",
        cls: "review-comment-empty",
      });
      finishRender();
      return;
    }

    for (const match of visibleMatches) {
      if (renderId !== this.renderRevision) return;
      await this.renderCommentCard(
        nextContainer,
        match,
        mdView,
        sourcePath,
        options.focusThreadKey
      );
      if (renderId !== this.renderRevision) return;
    }
    finishRender();
  }

  private scrollFocusedThreadIntoView(container: HTMLElement) {
    const target = container.querySelector(
      ".review-comment-card.is-focused"
    ) as HTMLElement | null;
    if (!target) return;

    const reveal = () => target.scrollIntoView({ block: "center" });
    window.requestAnimationFrame(() => {
      reveal();
      window.requestAnimationFrame(reveal);
      window.setTimeout(reveal, 80);
    });

    if (this.focusClearTimer !== null) {
      window.clearTimeout(this.focusClearTimer);
    }
    this.focusClearTimer = window.setTimeout(() => {
      target.removeClass("is-focused");
      this.focusClearTimer = null;
    }, 1800);
  }

  async renderCommentCard(
    parent: HTMLElement,
    match: ParsedComment,
    mdView: MarkdownView,
    sourcePath: string,
    focusThreadKey?: string
  ) {
    const card = parent.createDiv({ cls: "review-comment-card" });
    const threadKey = getCommentThreadKey(match);
    card.dataset.reviewThreadKey = threadKey;
    if (focusThreadKey === threadKey) {
      card.classList.add("is-focused");
    }
    const threadStatus = getThreadStatus(match);
    card.dataset.type = match.meta.type;
    card.dataset.status = threadStatus;
    this.plugin.applyTypeColor(card, match.meta.type);
    if (threadStatus === "closed") {
      card.classList.add("is-folded");
    }

    const header = card.createDiv({ cls: "review-comment-card-header" });
    const icon = header.createSpan({ cls: "review-comment-card-icon" });
    icon.textContent = this.plugin.getTypeIcon(match.meta.type);
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
    this.plugin.applyTypeColor(item, entry.meta.type);

    const header = item.createDiv({ cls: "review-comment-thread-entry-header" });
    header.createSpan({
      text: this.plugin.getTypeIcon(entry.meta.type),
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
    summary: ThreadFilterSummary,
    availableTypes: string[],
    mdView: MarkdownView
  ) {
    const filterEl = container.createDiv({ cls: "review-comment-filterbar" });

    this.renderStatusFilterChips(filterEl, summary);
    this.renderTypeFilterChips(filterEl, summary, availableTypes);

    const actions = filterEl.createDiv({ cls: "review-comment-toolbar" });
    const exportBtn = actions.createEl("button", {
      text: "复制清单",
      cls: "review-comment-action-btn",
    });
    exportBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      void this.plugin.copyCurrentFileCommentList(
        mdView.editor,
        mdView.file?.path
      );
    });
  }

  private renderStatusFilterChips(
    parent: HTMLElement,
    summary: ThreadFilterSummary
  ) {
    const section = parent.createDiv({ cls: "review-comment-filter-section" });
    section.createSpan({
      text: "状态",
      cls: "review-comment-filter-label",
    });
    const chips = section.createDiv({ cls: "review-comment-filter-chips" });
    const options: { value: CommentStatusFilter; label: string; count: number }[] = [
      { value: "all", label: "全部", count: summary.total },
      { value: "open", label: "open", count: summary.open },
      { value: "closed", label: "closed", count: summary.closed },
    ];

    for (const option of options) {
      const selected = this.selectedStatusFilters.includes(option.value);
      const chip = chips.createEl("button", {
        cls: `review-comment-filter-chip ${
          selected ? "is-selected" : "is-dimmed"
        }`,
        text: `${option.label} ${option.count}`,
        attr: {
          type: "button",
          "aria-pressed": selected ? "true" : "false",
        },
      });
      if (option.value === "all") {
        chip.style.setProperty("--review-comment-chip-color", "128, 128, 128");
      } else if (option.value === "open") {
        chip.style.setProperty("--review-comment-chip-color", "82, 150, 91");
      } else {
        chip.style.setProperty("--review-comment-chip-color", "132, 142, 156");
      }
      chip.addEventListener("click", () => {
        this.selectedStatusFilters = toggleFilterValue(
          this.selectedStatusFilters,
          option.value
        );
        void this.renderComments({ preservePanelScroll: true });
      });
    }
  }

  private renderTypeFilterChips(
    parent: HTMLElement,
    summary: ThreadFilterSummary,
    availableTypes: string[]
  ) {
    const section = parent.createDiv({ cls: "review-comment-filter-section" });
    section.createSpan({
      text: "类型",
      cls: "review-comment-filter-label",
    });
    const chips = section.createDiv({ cls: "review-comment-filter-chips" });

    const allSelected = this.selectedTypeFilters.includes("all");
    const allChip = chips.createEl("button", {
      cls: `review-comment-filter-chip ${
        allSelected ? "is-selected" : "is-dimmed"
      }`,
      text: `全部 ${summary.total}`,
      attr: {
        type: "button",
        "aria-pressed": allSelected ? "true" : "false",
      },
    });
    allChip.addEventListener("click", () => {
      this.selectedTypeFilters = toggleFilterValue(
        this.selectedTypeFilters,
        "all"
      );
      void this.renderComments({ preservePanelScroll: true });
    });

    for (const type of availableTypes) {
      const selected = this.selectedTypeFilters.includes(type);
      const definition = this.plugin.getCommentType(type);
      const chip = chips.createEl("button", {
        cls: `review-comment-filter-chip review-comment-type-filter-chip ${
          selected ? "is-selected" : "is-dimmed"
        }`,
        attr: {
          type: "button",
          "aria-pressed": selected ? "true" : "false",
          title: `${definition.label} · ${type}`,
        },
      });
      chip.createSpan({
        text: definition.icon,
        cls: "review-comment-filter-chip-icon",
      });
      chip.createSpan({
        text: `${definition.label} ${summary.byType[type] || 0}`,
      });
      this.plugin.applyTypeColor(chip, type, "--review-comment-chip-color");
      chip.addEventListener("click", () => {
        this.selectedTypeFilters = toggleFilterValue(
          this.selectedTypeFilters,
          type
        );
        void this.renderComments({ preservePanelScroll: true });
      });
    }
  }

  private getAvailableTypeTags(summary: ThreadFilterSummary): string[] {
    const configured = this.plugin.getCommentTypes().map((type) => type.tag);
    const unknown = Object.keys(summary.byType)
      .filter((type) => !configured.includes(type))
      .sort((a, b) => a.localeCompare(b));
    return [...configured, ...unknown];
  }

  setCommentStatus(
    mdView: MarkdownView,
    match: ParsedComment,
    status: ParsedMeta["status"]
  ) {
    try {
      const editor = mdView.editor;
      const value = editor.getValue();
      const threadKey = getCommentThreadKey(match);
      this.applyEditorValuePatch(
        editor,
        value,
        replaceCommentThreadStatus(value, match, status)
      );
      this.cancelScheduledRender();
      void this.renderComments({ focusThreadKey: threadKey });
    } catch (error) {
      new Notice(error instanceof Error ? error.message : "批注状态更新失败");
    }
  }

  deleteComment(mdView: MarkdownView, match: ParsedComment) {
    try {
      const editor = mdView.editor;
      const value = editor.getValue();
      this.applyEditorValuePatch(editor, value, removeComment(value, match));
      this.cancelScheduledRender();
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
      this.plugin.getCommentTypes(),
      entry.meta.type,
      (body: string, typeTag: string) => {
        const editor = mdView.editor;
        const value = editor.getValue();
        try {
          const threadKey = getCommentThreadKey(match);
          this.applyEditorValuePatch(
            editor,
            value,
            replaceCommentEntryMeta(value, match, entry.index, {
              ...entry.meta,
              type: typeTag,
              body: this.plugin.escapeCommentBody(
                normalizeCommentBodyForContext(body.trim(), value, match.offset)
              ),
            })
          );
          this.cancelScheduledRender();
          void this.renderComments({ focusThreadKey: threadKey });
        } catch (error) {
          new Notice(error instanceof Error ? error.message : "编辑批注失败");
        }
      },
      `编辑批注${entry.meta.id ? ` · ${entry.meta.id}` : ""}`,
      "保存修改",
      entry.meta.body,
      true,
      "批注类型"
    ).open();
  }

  openReplyModal(mdView: MarkdownView, match: ParsedComment) {
    new CommentInputModal(
      this.plugin.app,
      this.plugin.getCommentTypes(),
      COMMENT_FORMAT.defaultType,
      (body: string, typeTag: string) => {
        const editor = mdView.editor;
        const value = editor.getValue();
        const date = formatDate(new Date(), this.plugin.settings.dateFormat);
        const author = sanitizeAuthor(this.plugin.settings.authorName);
        const threadKey = getCommentThreadKey(match);
        const replyMeta: ParsedMeta = {
          author,
          date,
          type: typeTag || COMMENT_FORMAT.defaultType,
          body: this.plugin.escapeCommentBody(
            normalizeCommentBodyForContext(body.trim() || "回复", value, match.offset)
          ),
          id: generateCommentId(),
          status: "open",
          attrs: {},
        };

        try {
          this.applyEditorValuePatch(
            editor,
            value,
            appendReplyComment(value, match, replyMeta)
          );
          this.cancelScheduledRender();
          void this.renderComments({ focusThreadKey: threadKey });
        } catch (error) {
          new Notice(error instanceof Error ? error.message : "回复失败");
        }
      },
      `回复${match.meta.id ? ` · ${match.meta.id}` : ""}`,
      "回复",
      "",
      true,
      "回复类型"
    ).open();
  }

  private applyEditorValuePatch(editor: Editor, before: string, after: string) {
    if (before === after) return;

    const scroll = this.captureEditorScroll(editor);
    const patch = getMinimalTextPatch(before, after);
    editor.replaceRange(
      patch.replacement,
      editor.offsetToPos(patch.from),
      editor.offsetToPos(patch.to)
    );
    this.restoreEditorScroll(editor, scroll);
  }

  private captureEditorScroll(editor: Editor): { left: number; top: number } | null {
    const scrollableEditor = editor as Editor & {
      getScrollInfo?: () => { left?: number; top?: number };
    };
    const scrollInfo = scrollableEditor.getScrollInfo?.();
    if (!scrollInfo) return null;
    return {
      left: scrollInfo.left ?? 0,
      top: scrollInfo.top ?? 0,
    };
  }

  private restoreEditorScroll(
    editor: Editor,
    scroll: { left: number; top: number } | null
  ) {
    if (!scroll) return;
    const scrollableEditor = editor as Editor & {
      scrollTo?: (left: number, top: number) => void;
    };
    const restore = () => scrollableEditor.scrollTo?.(scroll.left, scroll.top);
    restore();
    window.requestAnimationFrame(restore);
    window.setTimeout(restore, 0);
  }
}

function getMinimalTextPatch(before: string, after: string) {
  let from = 0;
  while (
    from < before.length &&
    from < after.length &&
    before.charCodeAt(from) === after.charCodeAt(from)
  ) {
    from += 1;
  }

  let beforeEnd = before.length;
  let afterEnd = after.length;
  while (
    beforeEnd > from &&
    afterEnd > from &&
    before.charCodeAt(beforeEnd - 1) === after.charCodeAt(afterEnd - 1)
  ) {
    beforeEnd -= 1;
    afterEnd -= 1;
  }

  return {
    from,
    to: beforeEnd,
    replacement: after.slice(from, afterEnd),
  };
}

function getThreadStatus(thread: ParsedComment): ParsedMeta["status"] {
  return thread.entries.some((entry) => entry.meta.status === "open")
    ? "open"
    : "closed";
}

function getCommentThreadKey(thread: ParsedComment): string {
  const firstId = thread.entries.find((entry) => entry.meta.id)?.meta.id;
  if (firstId) return `id:${firstId}`;

  // Replies extend `end`, so key on the stable anchor and first metadata slice.
  // This keeps sidebar locate/re-render behavior stable for minimal draft threads.
  return [
    "thread",
    thread.syntax,
    thread.offset,
    thread.anchorStart,
    thread.anchorEnd,
    stableHash(`${thread.anchor}\n${thread.entries[0]?.metaSource || ""}`),
  ].join(":");
}

function stableHash(value: string): string {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 33) ^ value.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

function findCommentInRange(
  comments: ParsedComment[],
  start: number,
  end: number
): ParsedComment | null {
  const hasSelection = start !== end;
  return (
    comments.find((comment) => {
      if (hasSelection) return start < comment.end && end > comment.offset;
      return start >= comment.offset && start <= comment.end;
    }) || null
  );
}

function getCommentAnchorLabel(comment: ParsedComment): string {
  if (comment.anchor) return comment.anchor;
  if (comment.meta.attrs.scope === "heading") {
    return `标题批注：${comment.meta.attrs.target || "未命名标题"}`;
  }
  return "单点批注";
}

function formatThreadTitle(
  entries: ParsedCommentEntry[],
  getTypeIcon: (typeTag: string | null | undefined) => string = () => ""
): string {
  return entries
    .map(
      (entry) =>
        `${entry.index + 1}. ${getTypeIcon(entry.meta.type)} ${formatThreadEntryLabel(
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
    meta.type || COMMENT_FORMAT.defaultType,
    meta.status,
    meta.id,
  ].filter((part): part is string => Boolean(part));
  return parts.join(" · ");
}

function formatAddCommentTitle(
  typeTag: string,
  commentTypes: ReviewCommentType[],
  scopeLabel = "批注"
): string {
  const label = getReviewCommentType(commentTypes, typeTag).label;
  if (label === "批注") return `添加${scopeLabel}`;
  return `添加${label}${scopeLabel}`;
}

function toggleFilterValue<T extends string>(current: T[], value: T): T[] {
  if (value === "all") {
    return current.includes(value) ? [] : [value];
  }

  const withoutAll = current.filter((item) => item !== "all");
  if (withoutAll.includes(value)) {
    return withoutAll.filter((item) => item !== value);
  }
  return [...withoutAll, value];
}

function normalizeSelectedStatusFilters(
  values: CommentStatusFilter[]
): CommentStatusFilter[] {
  const allowed = new Set<CommentStatusFilter>(["all", "open", "closed"]);
  const result = values.filter((value, index) => {
    return allowed.has(value) && values.indexOf(value) === index;
  });
  if (result.includes("all")) return ["all"];
  return result;
}

function withCurrentCommentType(
  types: ReviewCommentType[],
  typeTag: string | null | undefined
): ReviewCommentType[] {
  const normalized = normalizeCommentTypes(types);
  const current = getReviewCommentType(normalized, typeTag);
  if (normalized.some((type) => type.tag === current.tag)) return normalized;
  return [...normalized, current];
}

class ReviewCommentsSettingTab extends PluginSettingTab {
  plugin: ReviewCommentsPlugin;

  constructor(app: App, plugin: ReviewCommentsPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  private async persistCommentTypes(refresh = false) {
    this.plugin.settings.commentTypes = normalizeCommentTypes(
      this.plugin.settings.commentTypes
    );
    await this.plugin.saveSettings();
    this.plugin.registerCommentTypeCommands();
    this.plugin.renderFloatingBarButtons();
    if (refresh) this.display();
  }

  private async updateCommentType(
    index: number,
    patch: Partial<ReviewCommentType>
  ) {
    const current = this.plugin.settings.commentTypes[index];
    if (!current) return;
    const nextPatch = { ...patch };
    if (current.protected) {
      delete nextPatch.tag;
      nextPatch.protected = true;
    }
    this.plugin.settings.commentTypes = this.plugin.settings.commentTypes.map(
      (type, i) => (i === index ? { ...type, ...nextPatch } : type)
    );
    await this.persistCommentTypes();
  }

  private renderCommentTypes(containerEl: HTMLElement) {
    containerEl.createEl("h3", { text: "批注类型" });
    containerEl.createEl("p", {
      text: "每种类型都会出现在命令面板、右键菜单、回复 / 编辑弹窗、侧栏筛选和编辑器颜色中。修改命令 id 后，新命令会立即注册，不再使用的旧命令会即时移除。",
      cls: "setting-item-description",
    });

    new Setting(containerEl)
      .setName("新增自定义类型")
      .setDesc("新增类型可删除；默认的 COMMENT / 批注只能编辑，不能删除。")
      .addButton((button) =>
        button
          .setButtonText("新增类型")
          .setCta()
          .onClick(async () => {
            this.plugin.settings.commentTypes = [
              ...this.plugin.getCommentTypes(),
              createNextCustomCommentType(this.plugin.getCommentTypes()),
            ];
            await this.persistCommentTypes(true);
          })
      );

    const list = containerEl.createDiv({
      cls: "review-comment-type-settings",
    });

    this.plugin.getCommentTypes().forEach((type, index) => {
      const card = list.createDiv({ cls: "review-comment-type-setting" });
      this.plugin.applyTypeColor(card, type.tag, "--review-comment-chip-color");

      const header = card.createDiv({
        cls: "review-comment-type-setting-header",
      });
      header.createSpan({
        text: type.icon,
        cls: "review-comment-type-setting-icon",
      });
      header.createSpan({
        text: `${type.label} · ${type.tag}`,
        cls: "review-comment-type-setting-title",
      });
      if (type.protected) {
        header.createSpan({
          text: "默认类型",
          cls: "review-comment-type-setting-badge",
        });
      }

      new Setting(card)
        .setName("命令 id")
        .setDesc(`命令面板编号：add-comment-${type.id}`)
        .addText((text) =>
          text.setValue(type.id).onChange(async (value) => {
            await this.updateCommentType(index, {
              id: sanitizeCommentTypeId(value, type.id),
            });
          })
        );

      new Setting(card)
        .setName("元数据 tag")
        .setDesc(
          type.protected
            ? "默认批注类型固定写入 COMMENT，确保回复和无类型批注有稳定落点。"
            : "写入 Markdown 的 type=... 标签；建议使用大写英文、数字、下划线或连字符。"
        )
        .addText((text) => {
          text.setValue(type.tag);
          if (type.protected) {
            text.inputEl.disabled = true;
          } else {
            text.onChange(async (value) => {
              await this.updateCommentType(index, {
                tag: sanitizeCommentTypeTag(value, type.tag),
              });
            });
          }
        });

      new Setting(card)
        .setName("显示名称")
        .addText((text) =>
          text.setValue(type.label).onChange(async (value) => {
            await this.updateCommentType(index, {
              label: sanitizeCommentTypeLabel(value, type.label),
            });
          })
        );

      new Setting(card)
        .setName("Emoji")
        .addText((text) =>
          text.setValue(type.icon).onChange(async (value) => {
            await this.updateCommentType(index, {
              icon: sanitizeCommentTypeIcon(value, type.icon),
            });
          })
        );

      new Setting(card)
        .setName("颜色")
        .setDesc("使用 6 位十六进制颜色，例如 #e6be28。")
        .addText((text) =>
          text.setValue(type.color).onChange(async (value) => {
            await this.updateCommentType(index, {
              color: normalizeHexColor(value, type.color),
            });
            this.plugin.applyTypeColor(
              card,
              this.plugin.settings.commentTypes[index]?.tag || type.tag,
              "--review-comment-chip-color"
            );
          })
        );

      if (!type.protected) {
        new Setting(card)
          .setName("删除类型")
          .setDesc("删除后不会迁移已有 Markdown 批注；旧 type 仍会被读取为自定义未知类型。")
          .addButton((button) =>
            button
              .setButtonText("删除")
              .setWarning()
              .onClick(async () => {
                this.plugin.settings.commentTypes =
                  this.plugin.getCommentTypes().filter((_, i) => i !== index);
                await this.persistCommentTypes(true);
              })
          );
      }
    });
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
      .setName("复制批注清单格式")
      .setDesc("极简版只保留被批注文本与回复正文；简单版带清单标题与分节；完整版会额外带文件、位置、状态、类型、作者、日期和 id。")
      .addDropdown((dd) =>
        dd
          .addOption("minimal", "极简版")
          .addOption("simple", "简单版")
          .addOption("full", "完整版")
          .setValue(this.plugin.settings.commentExportFormat)
          .onChange(async (value: string) => {
            this.plugin.settings.commentExportFormat =
              value as CommentExportFormat;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("批注方式")
      .setDesc("弹框式使用专用输入框；编辑式会直接插入批注源码并把光标放进正文位置，适合长批注。")
      .addDropdown((dd) =>
        dd
          .addOption("modal", "弹框式批注")
          .addOption("inline", "编辑式批注")
          .setValue(this.plugin.settings.commentCreationMode)
          .onChange(async (value: string) => {
            this.plugin.settings.commentCreationMode =
              value === "inline" ? "inline" : "modal";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("新建批注使用格式")
      .setDesc("决定插件新建范围批注和单点批注时写入 Markdown 的锚点格式；修改设置不会自动迁移旧批注。")
      .addDropdown((dd) => {
        for (const syntax of COMMENT_SYNTAXES) {
          dd.addOption(syntax, SYNTAX_LABELS[syntax]);
        }
        return dd
          .setValue(this.plugin.settings.writeCommentSyntax)
          .onChange(async (value: string) => {
            if (!isCommentSyntax(value)) return;
            this.plugin.settings.writeCommentSyntax = value;
            this.plugin.settings.compatibleCommentSyntaxes =
              normalizeCommentSyntaxes(
                this.plugin.settings.compatibleCommentSyntaxes,
                [value]
              );
            await this.plugin.saveSettings();
            this.display();
          });
      });

    containerEl.createEl("h3", { text: "兼容读取格式" });
    containerEl.createEl("p", {
      text: "启用后，对应格式会被编辑器折叠、阅读模式渲染、侧栏列出和批注检查识别。当前写入格式必须保持兼容读取。",
      cls: "setting-item-description",
    });

    for (const syntax of COMMENT_SYNTAXES) {
      new Setting(containerEl)
        .setName(SYNTAX_LABELS[syntax])
        .addToggle((toggle) =>
          toggle
            .setValue(
              this.plugin.settings.compatibleCommentSyntaxes.includes(syntax)
            )
            .onChange(async (value) => {
              const writeSyntax = this.plugin.settings.writeCommentSyntax;
              if (!value && syntax === writeSyntax) {
                new Notice("当前写入格式必须保持兼容读取");
                this.plugin.settings.compatibleCommentSyntaxes =
                  normalizeCommentSyntaxes(
                    this.plugin.settings.compatibleCommentSyntaxes,
                    [writeSyntax]
                  );
                await this.plugin.saveSettings();
                this.display();
                return;
              }

              const current =
                this.plugin.settings.compatibleCommentSyntaxes.filter(
                  (item) => item !== syntax
                );
              if (value) current.push(syntax);
              this.plugin.settings.compatibleCommentSyntaxes =
                normalizeCommentSyntaxes(current, [writeSyntax]);
              await this.plugin.saveSettings();
              this.display();
            })
        );
    }

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

    this.renderCommentTypes(containerEl);
  }
}

function createNextCustomCommentType(
  existingTypes: ReviewCommentType[]
): ReviewCommentType {
  const usedIds = new Set(existingTypes.map((type) => type.id));
  const usedTags = new Set(existingTypes.map((type) => type.tag));
  let index = 1;
  while (
    usedIds.has(`custom-${index}`) ||
    usedTags.has(`CUSTOM_${index}`)
  ) {
    index += 1;
  }

  return {
    id: `custom-${index}`,
    tag: `CUSTOM_${index}`,
    label: `自定义${index}`,
    icon: "🏷️",
    color: "#dddddd",
  };
}
