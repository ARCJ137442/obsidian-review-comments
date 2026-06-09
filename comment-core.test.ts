import { describe, expect, it } from "vitest";
import {
  appendReplyComment,
  exportCommentsMarkdown,
  filterComments,
  findComments,
  formatComment,
  parseMeta,
  lintComments,
  removeComment,
  replaceCommentEntryMeta,
  replaceCommentMeta,
  replaceCommentStatus,
  replaceCommentThreadStatus,
  summarizeComments,
} from "./comment-core";

describe("comment-core parsing", () => {
  it("parses the preferred plain-anchor format", () => {
    const source =
      "正文 {传输函子}{>>author=Argon;date=2026-06-09;type=ASK;id=RC-A: 比较奇怪<<} 继续";

    const comments = findComments(source);

    expect(comments).toHaveLength(1);
    expect(comments[0].anchor).toBe("传输函子");
    expect(comments[0].syntax).toBe("plain-anchor");
    expect(comments[0].entries).toHaveLength(1);
    expect(comments[0].meta).toMatchObject({
      author: "Argon",
      date: "2026-06-09",
      type: "ASK",
      body: "比较奇怪",
      id: "RC-A",
      status: "open",
    });
  });

  it("does not parse bare empty braces as point comments", () => {
    const source = ["{}", "{}{}{}", "前 {} 后"].join("\n");

    const comments = findComments(source);

    expect(comments).toHaveLength(0);
  });

  it("does not parse plain braces unless metadata follows immediately", () => {
    const source = ["{普通文本}", "{普通文本} {>>批注<<}"].join("\n");

    const comments = findComments(source);

    expect(comments).toHaveLength(0);
  });

  it("parses point comments only when empty braces are followed by metadata", () => {
    const source =
      "{}{>>author=Argon;date=2026-06-09;type=NOTE;id=RC-P1: 单点批注<<}";

    const [thread] = findComments(source);

    expect(thread.anchor).toBe("");
    expect(thread.syntax).toBe("plain-anchor");
    expect(thread.entries).toHaveLength(1);
    expect(thread.meta).toMatchObject({
      author: "Argon",
      date: "2026-06-09",
      type: "NOTE",
      id: "RC-P1",
      status: "open",
      body: "单点批注",
    });
  });

  it("parses long point-comment threads without requiring replyTo", () => {
    const entries = Array.from({ length: 60 }, (_, index) => {
      const n = String(index + 1).padStart(2, "0");
      return `{>>author=Agent;date=2026-06-09;type=NOTE;id=RC-P-${n}: 第 ${n} 条<<}`;
    }).join("");
    const source = `{}${entries} 后文`;

    const [thread] = findComments(source);

    expect(thread.anchor).toBe("");
    expect(thread.entries).toHaveLength(60);
    expect(thread.entries[0].meta.id).toBe("RC-P-01");
    expect(thread.entries[59].meta.body).toBe("第 60 条");
    expect(thread.entries.every((entry) => entry.meta.replyTo === undefined)).toBe(
      true
    );
    expect(source.slice(thread.end)).toBe(" 后文");
  });

  it("parses the ExoNet shift-anchor format", () => {
    const source =
      "正文 {<<锚定文本>>}{>>Argon|2026-06-08|NOTE|id=RC-1|status=open: **批注**<<} 继续";

    const comments = findComments(source);

    expect(comments).toHaveLength(1);
    expect(comments[0].anchor).toBe("锚定文本");
    expect(comments[0].syntax).toBe("shift-anchor");
    expect(comments[0].entries).toHaveLength(1);
    expect(comments[0].meta).toMatchObject({
      author: "Argon",
      date: "2026-06-08",
      type: "NOTE",
      body: "**批注**",
      id: "RC-1",
      status: "open",
    });
  });

  it("keeps legacy and transitional formats readable", () => {
    const source = [
      "{==旧锚点==}{>>Argon|2026-06-08|EDIT: 旧批注<<}",
      "{=#过渡锚点#=}{>>Argon|2026-06-08|ASK: 过渡批注<<}",
    ].join("\n");

    const comments = findComments(source);

    expect(comments.map((comment) => comment.syntax)).toEqual([
      "critic",
      "hash-anchor",
    ]);
    expect(comments.map((comment) => comment.anchor)).toEqual([
      "旧锚点",
      "过渡锚点",
    ]);
  });

  it("parses a linear thread as one anchor with multiple comment entries", () => {
    const source =
      "{<<传输函子>>}{>>Argon|2026-06-08|ASK|id=RC-A|status=open: 比较奇怪<<}{>>Argon|2026-06-08|NOTE|id=RC-B|status=open: 现在可以回复批注了<<}";

    const [thread] = findComments(source);

    expect(thread.anchor).toBe("传输函子");
    expect(thread.entries).toHaveLength(2);
    expect(thread.entries.map((entry) => entry.meta.body)).toEqual([
      "比较奇怪",
      "现在可以回复批注了",
    ]);
    expect(thread.entries[1].meta.replyTo).toBeUndefined();
    expect(thread.full).toBe(source);
  });

  it("parses body-only human draft comments without requiring metadata ids", () => {
    const source = "{<<原文>>}{>>批注<<}";

    const [thread] = findComments(source);

    expect(thread.anchor).toBe("原文");
    expect(thread.entries).toHaveLength(1);
    expect(thread.entries[0].meta).toMatchObject({
      author: "",
      date: "",
      type: "NOTE",
      status: "open",
      body: "批注",
    });
    expect(thread.entries[0].meta.id).toBeUndefined();
  });

  it("parses long linear threads without splitting them into nested comments", () => {
    const entries = Array.from({ length: 40 }, (_, index) => {
      const n = String(index + 1).padStart(2, "0");
      return `{>>Agent|2026-06-08|NOTE|id=RC-${n}|status=open: 第 ${n} 条回复<<}`;
    }).join("");
    const source = `{<<长线程锚点>>}${entries} 后文`;

    const [thread] = findComments(source);

    expect(thread.entries).toHaveLength(40);
    expect(thread.entries[0].meta.id).toBe("RC-01");
    expect(thread.entries[39].meta.body).toBe("第 40 条回复");
    expect(source.slice(thread.end)).toBe(" 后文");
  });

  it("keeps adjacent anchored threads separate", () => {
    const source =
      "{<<甲>>}{>>A|2026-06-08|ASK|id=RC-A|status=open: 一<<}{>>B|2026-06-08|NOTE|id=RC-B|status=open: 二<<}{<<乙>>}{>>C|2026-06-08|NOTE|id=RC-C|status=open: 三<<}";

    const comments = findComments(source);

    expect(comments).toHaveLength(2);
    expect(comments[0].anchor).toBe("甲");
    expect(comments[0].entries).toHaveLength(2);
    expect(comments[1].anchor).toBe("乙");
    expect(comments[1].entries).toHaveLength(1);
  });

  it("supports multiline anchors and multiline Markdown bodies in every thread entry", () => {
    const source = [
      "{<<第一行",
      "- 第二行>>}{>>Argon|2026-06-08|NOTE|id=RC-2|status=open: 第一段",
      "- **第二段** `code`<<}{>>Codex|2026-06-08|NOTE|id=RC-3|status=open: 回复第一段",
      "- 回复第二段<<}",
    ].join("\n");

    const [thread] = findComments(source);

    expect(thread.anchor).toBe("第一行\n- 第二行");
    expect(thread.entries[0].meta.body).toBe("第一段\n- **第二段** `code`");
    expect(thread.entries[1].meta.body).toBe("回复第一段\n- 回复第二段");
  });

  it("supports multiline anchors and multiline Markdown bodies in the preferred plain-anchor format", () => {
    const source = [
      "{第一行",
      "第二行}{>>author=Argon;date=2026-06-09;type=ASK;id=RC-PLAIN-1: 第一段",
      "",
      "- 支持 Markdown 列表",
      "- 支持长内容<<}{>>author=GPT-5.5·Codex;date=2026-06-09;type=NOTE;id=RC-PLAIN-2: 回复第一段",
      "",
      "> 支持引用块<<} 收尾",
    ].join("\n");

    const [thread] = findComments(source);

    expect(thread.syntax).toBe("plain-anchor");
    expect(thread.anchor).toBe("第一行\n第二行");
    expect(thread.entries).toHaveLength(2);
    expect(thread.entries[0].meta.body).toBe(
      "第一段\n\n- 支持 Markdown 列表\n- 支持长内容"
    );
    expect(thread.entries[1].meta.body).toBe("回复第一段\n\n> 支持引用块");
    expect(source.slice(thread.end)).toBe(" 收尾");
  });

  it("supports long multiline threads without losing entry order", () => {
    const entries = Array.from({ length: 80 }, (_, index) => {
      const n = String(index + 1).padStart(2, "0");
      return `{>>author=Agent;date=2026-06-09;type=NOTE;id=RC-MULTI-${n}: 第 ${n} 条第一行\n第 ${n} 条第二行<<}`;
    }).join("");
    const source = `{长线程\n多行锚点}${entries} 后文`;

    const [thread] = findComments(source);

    expect(thread.anchor).toBe("长线程\n多行锚点");
    expect(thread.entries).toHaveLength(80);
    expect(thread.entries[0].meta.body).toBe("第 01 条第一行\n第 01 条第二行");
    expect(thread.entries[79].meta.id).toBe("RC-MULTI-80");
    expect(thread.entries[79].meta.body).toBe("第 80 条第一行\n第 80 条第二行");
    expect(source.slice(thread.end)).toBe(" 后文");
  });

  it("does not parse review markup inside fenced code blocks", () => {
    const source = [
      "```md",
      "{<<代码里的锚点>>}{>>Argon|2026-06-08|NOTE: 不应解析<<}{>>Argon|2026-06-08|NOTE: 也不解析<<}",
      "```",
      "{<<正文锚点>>}{>>Argon|2026-06-08|NOTE: 应解析<<}",
    ].join("\n");

    const comments = findComments(source);

    expect(comments).toHaveLength(1);
    expect(comments[0].anchor).toBe("正文锚点");
  });

  it("parses comments in tables, blockquotes, and callouts", () => {
    const source = [
      "| A | B |",
      "| - | - |",
      "| {<<表格锚点>>}{>>Argon|2026-06-08|NOTE: 表格批注<<}{>>Codex|2026-06-08|NOTE: 表格回复<<} | x |",
      "> {<<引用锚点>>}{>>Argon|2026-06-08|NOTE: 引用批注<<}",
      "> [!note]",
      "> {<<callout锚点>>}{>>Argon|2026-06-08|NOTE: callout批注<<}",
    ].join("\n");

    const comments = findComments(source);

    expect(comments.map((comment) => comment.anchor)).toEqual([
      "表格锚点",
      "引用锚点",
      "callout锚点",
    ]);
    expect(comments[0].entries).toHaveLength(2);
  });

  it("parses multiline comments inside Markdown lists", () => {
    const source = [
      "- 前置事项",
      "- {<<列表锚点第一行",
      "  列表锚点第二行>>}{>>Argon|2026-06-08|EDIT|id=RC-LIST|status=open: 第一段",
      "  - 第二段<<}{>>Codex|2026-06-08|NOTE|id=RC-LIST-R|status=open: 线性回复",
      "  - 回复第二段<<}",
      "- 后续事项",
    ].join("\n");

    const [thread] = findComments(source);

    expect(thread.anchor).toBe("列表锚点第一行\n  列表锚点第二行");
    expect(thread.entries[0].meta.body).toBe("第一段\n  - 第二段");
    expect(thread.entries[1].meta.body).toBe("线性回复\n  - 回复第二段");
    expect(source.slice(thread.end)).toContain("- 后续事项");
  });

  it("does not parse review markup inside tilded fenced code blocks", () => {
    const source = [
      "~~~markdown",
      "{<<代码锚点>>}{>>Argon|2026-06-08|NOTE: 不应解析<<}",
      "~~~",
      "{<<正文锚点>>}{>>Argon|2026-06-08|NOTE: 应解析<<}{>>Codex|2026-06-08|NOTE: 应解析回复<<}",
    ].join("\n");

    const comments = findComments(source);

    expect(comments).toHaveLength(1);
    expect(comments[0].entries).toHaveLength(2);
  });
});

describe("comment-core metadata", () => {
  it("parses comment id, status, legacy reply target, and custom types", () => {
    const meta =
      "Argon|2026-06-08|CLAIM_GAP|id=RC-3|status=closed|replyTo=RC-1: 需要补证据";

    const parsed = parseMeta(meta);

    expect(parsed).toMatchObject({
      author: "Argon",
      date: "2026-06-08",
      type: "CLAIM_GAP",
      id: "RC-3",
      status: "closed",
      replyTo: "RC-1",
      body: "需要补证据",
    });
  });

  it("defaults older metadata to NOTE and open", () => {
    const meta = "Argon|2026-06-08: 老格式批注";

    const parsed = parseMeta(meta);

    expect(parsed).toMatchObject({
      author: "Argon",
      date: "2026-06-08",
      type: "NOTE",
      status: "open",
      body: "老格式批注",
    });
  });
});

describe("comment-core summary and filtering", () => {
  it("summarizes thread entries and filters them by status and type", () => {
    const source = [
      "{<<一>>}{>>Argon|2026-06-08|ASK|id=RC-F1|status=open: 提问<<}{>>Codex|2026-06-08|NOTE|id=RC-F1R|status=closed: 回复<<}",
      "{<<二>>}{>>Argon|2026-06-08|NOTE|id=RC-F2|status=closed: 备注<<}",
      "{<<三>>}{>>Argon|2026-06-08|NOTE|id=RC-F3|status=open: 另一条备注<<}",
    ].join("\n");
    const comments = findComments(source);

    const summary = summarizeComments(comments);
    const openNotes = filterComments(comments, {
      status: "open",
      type: "NOTE",
    });
    const closedComments = filterComments(comments, {
      status: "closed",
      type: "all",
    });

    expect(summary).toEqual({
      total: 4,
      open: 2,
      closed: 2,
      byType: {
        ASK: 1,
        NOTE: 3,
      },
    });
    expect(openNotes.map((comment) => comment.anchor)).toEqual(["三"]);
    expect(closedComments.map((comment) => comment.anchor)).toEqual(["一", "二"]);
    expect(closedComments[0].entries.map((entry) => entry.meta.body)).toEqual([
      "回复",
    ]);
  });
});

describe("comment-core linting", () => {
  it("returns no issues for a fully attributed linear thread", () => {
    const source =
      "{锚点}{>>author=Argon;date=2026-06-09;type=ASK;id=RC-LINT-1: 正文<<}{>>author=Codex;date=2026-06-09;type=NOTE;id=RC-LINT-2: 回复<<}";

    const issues = lintComments(source);

    expect(issues).toHaveLength(0);
  });

  it("reports duplicate ids and legacy reply targets", () => {
    const source = [
      "{一}{>>author=A;date=2026-06-09;type=NOTE;id=RC-DUP: 第一条<<}",
      "{二}{>>author=B;date=2026-06-09;type=NOTE;id=RC-DUP;replyTo=RC-OLD: 第二条<<}",
    ].join("\n");

    const issues = lintComments(source);

    expect(issues.map((issue) => issue.code)).toEqual([
      "duplicate-id",
      "duplicate-id",
      "legacy-reply-to",
    ]);
    expect(issues.filter((issue) => issue.severity === "error")).toHaveLength(2);
    expect(issues.find((issue) => issue.code === "legacy-reply-to")).toMatchObject({
      severity: "warning",
      line: 2,
    });
  });

  it("reports orphan metadata markers outside fenced code blocks", () => {
    const source = [
      "正文 {>>没有锚点",
      "另一处 <<}",
      "```md",
      "{代码}{>>不解析<<}",
      "```",
    ].join("\n");

    const issues = lintComments(source);

    expect(issues.map((issue) => issue.code)).toEqual([
      "orphan-meta-open",
      "orphan-meta-close",
      "comment-markup-in-code-fence",
    ]);
    expect(issues[0]).toMatchObject({
      severity: "error",
      line: 1,
    });
  });

  it("treats bare empty braces as an informational point-comment hint", () => {
    const source = [
      "{}",
      "{}{}{}",
      "{}{>>author=Argon;date=2026-06-09;type=NOTE;id=RC-POINT: 真正单点批注<<}",
    ].join("\n");

    const issues = lintComments(source);

    expect(findComments(source)).toHaveLength(1);
    expect(issues.map((issue) => issue.code)).toEqual([
      "bare-empty-braces",
      "bare-empty-braces",
    ]);
    expect(issues.every((issue) => issue.severity === "info")).toBe(true);
  });

  it("warns about title-embedded comments and multiline line-sensitive comments", () => {
    const source = [
      "# {标题}{>>author=Argon;date=2026-06-09;type=ASK;id=RC-H: 不要嵌标题<<}",
      "- {列表第一行",
      "  列表第二行}{>>author=Argon;date=2026-06-09;type=NOTE;id=RC-LIST: 多行批注",
      "  - 继续<<}",
    ].join("\n");

    const issues = lintComments(source);

    expect(issues.map((issue) => issue.code)).toEqual([
      "heading-embedded-comment",
      "multiline-in-line-sensitive-block",
    ]);
    expect(issues.every((issue) => issue.severity === "warning")).toBe(true);
  });

  it("warns when legacy pipe metadata appears inside a Markdown table row", () => {
    const source = [
      "| A | B |",
      "| - | - |",
      "| {表格锚点}{>>Argon|2026-06-09|NOTE|id=RC-TABLE: 管道元数据<<} | x |",
    ].join("\n");

    const issues = lintComments(source);

    expect(issues.map((issue) => issue.code)).toEqual([
      "pipe-metadata-in-table",
    ]);
    expect(issues[0]).toMatchObject({
      severity: "warning",
      line: 3,
    });
  });

  it("keeps minimal human drafts valid but suggests adding an id", () => {
    const source = "{草稿锚点}{>>人工草稿<<}";

    const issues = lintComments(source);

    expect(issues).toEqual([
      expect.objectContaining({
        code: "missing-id",
        severity: "info",
      }),
    ]);
  });
});

describe("comment-core export", () => {
  it("exports a simple current-file comment list for human review", () => {
    const source =
      "正文 {传输函子}{>>author=Argon;date=2026-06-09;type=ASK;id=RC-A: **比较奇怪**<<} 后文";

    const markdown = exportCommentsMarkdown(findComments(source), {
      format: "simple",
      filePath: "notes/example.md",
      sourceText: source,
    });

    expect(markdown).toBe(
      [
        "# 当前文件批注清单",
        "",
        "## 0",
        "",
        "### 批注对象",
        "",
        "> 传输函子",
        "",
        "### 批注正文",
        "",
        "**比较奇怪**",
      ].join("\n")
    );
  });

  it("keeps every linear reply entry in simple exports", () => {
    const source =
      "{anchor}{>>first<<}{>>author=Codex;date=2026-06-09;type=NOTE;id=RC-2: second<<}";

    const markdown = exportCommentsMarkdown(findComments(source), {
      format: "simple",
    });

    expect(markdown).toContain("#### 0.0\n\nfirst");
    expect(markdown).toContain("#### 0.1\n\nsecond");
  });

  it("exports full metadata for debate and audit workflows", () => {
    const source =
      "前文\n{对象}{>>author=Argon;date=2026-06-09;type=ASK;id=RC-A;scope=heading;target=H1: 第一条<<}{>>author=Codex;date=2026-06-09;type=NOTE;id=RC-B;status=closed: 第二条<<}";

    const markdown = exportCommentsMarkdown(findComments(source), {
      format: "full",
      filePath: "research-board/RT-44.md",
      sourceText: source,
    });

    expect(markdown).toContain("- 文件：`research-board/RT-44.md`");
    expect(markdown).toContain("- 批注线程数：1");
    expect(markdown).toContain("- 线程序号：0");
    expect(markdown).toContain("- 线程状态：`open`");
    expect(markdown).toContain("- 条目：0.1");
    expect(markdown).toContain("- id：`RC-B`");
    expect(markdown).toContain("- status：`closed`");
    expect(markdown).toContain("- type：`NOTE`");
    expect(markdown).toContain("- attrs：scope=heading; target=H1");
    expect(markdown).toMatch(/- 位置：`L2:C\d+-L2:C\d+`/);
  });

  it("exports a stable empty report when no comments exist", () => {
    const markdown = exportCommentsMarkdown([], { format: "full" });

    expect(markdown).toBe(
      [
        "# 当前文件批注清单",
        "",
        "- 文件：`（未知）`",
        "- 批注线程数：0",
        "",
        "当前文件没有批注。",
      ].join("\n")
    );
  });
});

describe("comment-core editing", () => {
  it("formats new comments with id and open status", () => {
    const meta = {
      author: "Argon",
      date: "2026-06-08",
      type: "NOTE",
      body: "正文",
      id: "RC-4",
      status: "open" as const,
      attrs: {},
    };

    const markup = formatComment("锚点", meta);

    expect(markup).toBe(
      "{锚点}{>>author=Argon;date=2026-06-08;type=NOTE;id=RC-4: 正文<<}"
    );
    expect(markup).not.toContain("|");
  });

  it("formats body-only human drafts without forcing metadata", () => {
    const markup = formatComment("原文", {
      author: "",
      date: "",
      type: "NOTE",
      body: "批注",
      status: "open",
      attrs: {},
    });

    expect(markup).toBe("{原文}{>>批注<<}");
  });

  it("closes a single first entry without deleting the source evidence", () => {
    const source =
      "前 {<<锚点>>}{>>Argon|2026-06-08|NOTE|id=RC-5|status=open: 批注<<}{>>Codex|2026-06-08|NOTE|id=RC-5R|status=open: 回复<<} 后";
    const [thread] = findComments(source);

    const next = replaceCommentStatus(source, thread, "closed");

    const [updated] = findComments(next);
    expect(updated.entries.map((entry) => entry.meta.status)).toEqual([
      "closed",
      "open",
    ]);
    expect(next).toContain("批注");
  });

  it("closes an entire linear thread", () => {
    const source = [
      "{<<锚点>>}{>>Argon|2026-06-08|ASK|id=RC-11|status=open: 为什么？<<}",
      "{>>Codex|2026-06-08|NOTE|id=RC-12|status=open: 因为需要定义。<<}",
      "{>>Argon|2026-06-08|NOTE|id=RC-13|status=open: 那就补。<<}",
      " {<<别处>>}{>>Argon|2026-06-08|NOTE|id=RC-14|status=open: 不相关<<}",
    ].join("");
    const [thread] = findComments(source);

    const next = replaceCommentThreadStatus(source, thread, "closed");

    const comments = findComments(next);
    expect(comments[0].entries.map((entry) => entry.meta.status)).toEqual([
      "closed",
      "closed",
      "closed",
    ]);
    expect(comments[1].entries[0].meta.status).toBe("open");
  });

  it("closes long threads without losing order", () => {
    const entries = Array.from({ length: 25 }, (_, index) => {
      return `{>>Agent|2026-06-08|NOTE|id=RC-L-${index}|status=open: 回复 ${index}<<}`;
    }).join("");
    const source = `{<<长线程>>}{>>Argon|2026-06-08|ASK|id=RC-L-root|status=open: 起点<<}${entries}`;
    const [thread] = findComments(source);

    const next = replaceCommentThreadStatus(source, thread, "closed");

    const [updated] = findComments(next);
    expect(updated.entries).toHaveLength(26);
    expect(updated.entries.every((entry) => entry.meta.status === "closed")).toBe(
      true
    );
    expect(updated.entries.map((entry) => entry.meta.body).slice(0, 3)).toEqual([
      "起点",
      "回复 0",
      "回复 1",
    ]);
  });

  it("edits the first comment body while preserving anchor and the rest of the thread", () => {
    const source =
      "{<<锚点>>}{>>Argon|2026-06-08|NOTE|id=RC-24|status=closed: 旧正文<<}{>>Codex|2026-06-08|NOTE|id=RC-25|status=open: 回复正文<<}";
    const [thread] = findComments(source);

    const next = replaceCommentMeta(source, thread, {
      ...thread.meta,
      body: "新正文\n- 保留 Markdown",
    });

    const [edited] = findComments(next);
    expect(edited.anchor).toBe("锚点");
    expect(edited.entries.map((entry) => entry.meta.body)).toEqual([
      "新正文\n- 保留 Markdown",
      "回复正文",
    ]);
    expect(edited.entries[0].meta).toMatchObject({
      id: "RC-24",
      status: "closed",
    });
  });

  it("edits a minimal human draft while keeping it minimal", () => {
    const source = "{<<原文>>}{>>旧批注<<}";
    const [thread] = findComments(source);

    const next = replaceCommentMeta(source, thread, {
      ...thread.meta,
      body: "新批注",
    });

    expect(next).toBe("{<<原文>>}{>>新批注<<}");
  });

  it("edits a later thread entry without changing sibling entries", () => {
    const source =
      "{<<锚点>>}{>>Argon|2026-06-08|ASK|id=RC-30|status=open: 第一条<<}{>>Codex|2026-06-08|NOTE|id=RC-31|status=open: 第二条<<}{>>Argon|2026-06-08|NOTE|id=RC-32|status=closed: 第三条<<}";
    const [thread] = findComments(source);

    const next = replaceCommentEntryMeta(source, thread, 1, {
      ...thread.entries[1].meta,
      body: "第二条已编辑",
    });

    expect(findComments(next)[0].entries.map((entry) => entry.meta.body)).toEqual([
      "第一条",
      "第二条已编辑",
      "第三条",
    ]);
  });

  it("refuses to edit stale comment slices", () => {
    const source = "{<<锚点>>}{>>Argon|2026-06-08|NOTE|id=RC-6|status=open: 批注<<}";
    const [thread] = findComments(source);
    const changed = source.replace("批注", "别人已经改了");

    expect(() => replaceCommentStatus(changed, thread, "closed")).toThrow(
      "Comment source changed"
    );
  });

  it("appends a reply as the next metadata entry in the same linear thread", () => {
    const source =
      "{<<锚点>>}{>>Argon|2026-06-08|ASK|id=RC-7|status=open: 为什么？<<}";
    const [thread] = findComments(source);

    const next = appendReplyComment(source, thread, {
      author: "GPT-5.5·Codex",
      date: "2026-06-08",
      type: "NOTE",
      body: "因为这里需要补定义。",
      id: "RC-8",
      status: "open",
      attrs: {},
    });

    expect(next).toBe(
      "{<<锚点>>}{>>Argon|2026-06-08|ASK|id=RC-7|status=open: 为什么？<<}{>>author=GPT-5.5·Codex;date=2026-06-08;type=NOTE;id=RC-8: 因为这里需要补定义。<<}"
    );
    const [updated] = findComments(next);
    expect(updated.entries).toHaveLength(2);
    expect(updated.entries[1].meta.replyTo).toBeUndefined();
  });

  it("appends an agent reply to a minimal human draft without needing replyTo", () => {
    const source = "{<<原文>>}{>>人类批注<<}";
    const [thread] = findComments(source);

    const next = appendReplyComment(source, thread, {
      author: "GPT-5.5·Codex",
      date: "2026-06-08",
      type: "NOTE",
      body: "Agent 回复",
      id: "RC-AGENT",
      status: "open",
      attrs: {},
    });

    expect(next).toBe(
      "{<<原文>>}{>>人类批注<<}{>>author=GPT-5.5·Codex;date=2026-06-08;type=NOTE;id=RC-AGENT: Agent 回复<<}"
    );
    expect(findComments(next)[0].entries.map((entry) => entry.meta.body)).toEqual([
      "人类批注",
      "Agent 回复",
    ]);
  });

  it("normalizes minimal drafts only when metadata is needed for status", () => {
    const source = "{<<原文>>}{>>人类批注<<}";
    const [thread] = findComments(source);

    const next = replaceCommentThreadStatus(source, thread, "closed");

    expect(next).toBe("{<<原文>>}{>>author=you;type=NOTE;status=closed: 人类批注<<}");
    expect(findComments(next)[0].meta.status).toBe("closed");
  });

  it("appends replies after all existing entries, even for long threads", () => {
    const source =
      "{<<锚点>>}{>>A|2026-06-08|ASK|id=RC-A|status=open: 一<<}{>>B|2026-06-08|NOTE|id=RC-B|status=open: 二<<}";
    const [thread] = findComments(source);

    const next = appendReplyComment(source, thread, {
      author: "C",
      date: "2026-06-08",
      type: "NOTE",
      body: "三",
      id: "RC-C",
      status: "open",
      attrs: {},
    });

    expect(findComments(next)[0].entries.map((entry) => entry.meta.id)).toEqual([
      "RC-A",
      "RC-B",
      "RC-C",
    ]);
  });

  it("removes an entire thread only after preserving the anchor text", () => {
    const source =
      "前 {<<锚点>>}{>>Argon|2026-06-08|NOTE|id=RC-9|status=closed: 已关闭<<}{>>Codex|2026-06-08|NOTE|id=RC-9R|status=open: 回复<<} 后";
    const [thread] = findComments(source);

    const next = removeComment(source, thread);

    expect(next).toBe("前 锚点 后");
    expect(findComments(next)).toHaveLength(0);
  });

  it("refuses to remove stale comment slices", () => {
    const source = "{<<锚点>>}{>>Argon|2026-06-08|NOTE|id=RC-10|status=open: 批注<<}";
    const [thread] = findComments(source);
    const changed = source.replace("批注", "被别处改动");

    expect(() => removeComment(changed, thread)).toThrow(
      "Comment source changed"
    );
  });
});
