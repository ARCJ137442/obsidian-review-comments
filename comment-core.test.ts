import { describe, expect, it } from "vitest";
import {
  appendReplyComment,
  filterComments,
  findComments,
  formatComment,
  parseMeta,
  removeComment,
  replaceCommentMeta,
  replaceCommentStatus,
  replaceCommentThreadStatus,
  summarizeComments,
} from "./comment-core";

describe("comment-core parsing", () => {
  it("parses the ExoNet shift-anchor format", () => {
    // --- ARRANGE ---
    const source =
      "正文 {<<锚定文本>>}{>>Argon|2026-06-08|NOTE|id=RC-1|status=open: **批注**<<} 继续";

    // --- ACT ---
    const comments = findComments(source);

    // --- ASSERT ---
    expect(comments).toHaveLength(1);
    expect(comments[0].anchor).toBe("锚定文本");
    expect(comments[0].syntax).toBe("shift-anchor");
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
    // --- ARRANGE ---
    const source = [
      "{==旧锚点==}{>>Argon|2026-06-08|EDIT: 旧批注<<}",
      "{=#过渡锚点#=}{>>Argon|2026-06-08|ASK: 过渡批注<<}",
    ].join("\n");

    // --- ACT ---
    const comments = findComments(source);

    // --- ASSERT ---
    expect(comments.map((comment) => comment.syntax)).toEqual([
      "critic",
      "hash-anchor",
    ]);
    expect(comments.map((comment) => comment.anchor)).toEqual([
      "旧锚点",
      "过渡锚点",
    ]);
  });

  it("supports multiline anchors and multiline Markdown bodies", () => {
    // --- ARRANGE ---
    const source =
      "{<<第一行\n- 第二行>>}{>>Argon|2026-06-08|NOTE|id=RC-2|status=open: 第一段\n- **第二段** `code`<<}";

    // --- ACT ---
    const [comment] = findComments(source);

    // --- ASSERT ---
    expect(comment.anchor).toBe("第一行\n- 第二行");
    expect(comment.meta.body).toBe("第一段\n- **第二段** `code`");
  });

  it("does not parse review markup inside fenced code blocks", () => {
    // --- ARRANGE ---
    const source = [
      "```md",
      "{<<代码里的锚点>>}{>>Argon|2026-06-08|NOTE: 不应解析<<}",
      "```",
      "{<<正文锚点>>}{>>Argon|2026-06-08|NOTE: 应解析<<}",
    ].join("\n");

    // --- ACT ---
    const comments = findComments(source);

    // --- ASSERT ---
    expect(comments).toHaveLength(1);
    expect(comments[0].anchor).toBe("正文锚点");
  });

  it("parses comments in tables, blockquotes, and callouts", () => {
    // --- ARRANGE ---
    const source = [
      "| A | B |",
      "| - | - |",
      "| {<<表格锚点>>}{>>Argon|2026-06-08|NOTE: 表格批注<<} | x |",
      "> {<<引用锚点>>}{>>Argon|2026-06-08|NOTE: 引用批注<<}",
      "> [!note]",
      "> {<<callout锚点>>}{>>Argon|2026-06-08|NOTE: callout批注<<}",
    ].join("\n");

    // --- ACT ---
    const comments = findComments(source);

    // --- ASSERT ---
    expect(comments.map((comment) => comment.anchor)).toEqual([
      "表格锚点",
      "引用锚点",
      "callout锚点",
    ]);
  });

  it("parses multiline comments inside Markdown lists", () => {
    // --- ARRANGE ---
    const source = [
      "- 前置事项",
      "- {<<列表锚点第一行",
      "  列表锚点第二行>>}{>>Argon|2026-06-08|EDIT|id=RC-LIST|status=open: 第一段",
      "  - 第二段<<}",
      "- 后续事项",
    ].join("\n");

    // --- ACT ---
    const comments = findComments(source);

    // --- ASSERT ---
    expect(comments).toHaveLength(1);
    expect(comments[0].anchor).toBe("列表锚点第一行\n  列表锚点第二行");
    expect(comments[0].meta.body).toBe("第一段\n  - 第二段");
    expect(source.slice(comments[0].end)).toContain("- 后续事项");
  });

  it("does not parse review markup inside tilded fenced code blocks", () => {
    // --- ARRANGE ---
    const source = [
      "~~~markdown",
      "{<<代码锚点>>}{>>Argon|2026-06-08|NOTE: 不应解析<<}",
      "~~~",
      "{<<正文锚点>>}{>>Argon|2026-06-08|NOTE: 应解析<<}",
    ].join("\n");

    // --- ACT ---
    const comments = findComments(source);

    // --- ASSERT ---
    expect(comments).toHaveLength(1);
    expect(comments[0].anchor).toBe("正文锚点");
  });
});

describe("comment-core metadata", () => {
  it("parses comment id, status, reply target, and custom types", () => {
    // --- ARRANGE ---
    const meta =
      "Argon|2026-06-08|CLAIM_GAP|id=RC-3|status=closed|replyTo=RC-1: 需要补证据";

    // --- ACT ---
    const parsed = parseMeta(meta);

    // --- ASSERT ---
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
    // --- ARRANGE ---
    const meta = "Argon|2026-06-08: 老格式批注";

    // --- ACT ---
    const parsed = parseMeta(meta);

    // --- ASSERT ---
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
  it("summarizes comments and filters them by status and type", () => {
    // --- ARRANGE ---
    const source = [
      "{<<一>>}{>>Argon|2026-06-08|ASK|id=RC-F1|status=open: 提问<<}",
      "{<<二>>}{>>Argon|2026-06-08|NOTE|id=RC-F2|status=closed: 备注<<}",
      "{<<三>>}{>>Argon|2026-06-08|NOTE|id=RC-F3|status=open: 另一条备注<<}",
    ].join("\n");
    const comments = findComments(source);

    // --- ACT ---
    const summary = summarizeComments(comments);
    const openNotes = filterComments(comments, {
      status: "open",
      type: "NOTE",
    });
    const closedComments = filterComments(comments, {
      status: "closed",
      type: "all",
    });

    // --- ASSERT ---
    expect(summary).toEqual({
      total: 3,
      open: 2,
      closed: 1,
      byType: {
        ASK: 1,
        NOTE: 2,
      },
    });
    expect(openNotes.map((comment) => comment.anchor)).toEqual(["三"]);
    expect(closedComments.map((comment) => comment.anchor)).toEqual(["二"]);
  });
});

describe("comment-core editing", () => {
  it("formats new comments with id and open status", () => {
    // --- ARRANGE ---
    const meta = {
      author: "Argon",
      date: "2026-06-08",
      type: "NOTE",
      body: "正文",
      id: "RC-4",
      status: "open" as const,
      attrs: {},
    };

    // --- ACT ---
    const markup = formatComment("锚点", meta);

    // --- ASSERT ---
    expect(markup).toBe(
      "{<<锚点>>}{>>Argon|2026-06-08|NOTE|id=RC-4|status=open: 正文<<}"
    );
  });

  it("closes a comment without deleting the source evidence", () => {
    // --- ARRANGE ---
    const source =
      "前 {<<锚点>>}{>>Argon|2026-06-08|NOTE|id=RC-5|status=open: 批注<<} 后";
    const [comment] = findComments(source);

    // --- ACT ---
    const next = replaceCommentStatus(source, comment, "closed");

    // --- ASSERT ---
    expect(next).toContain("status=closed");
    expect(next).toContain("批注");
    expect(findComments(next)[0].meta.status).toBe("closed");
  });

  it("closes a comment thread including reply comments", () => {
    // --- ARRANGE ---
    const source = [
      "{<<锚点>>}{>>Argon|2026-06-08|ASK|id=RC-11|status=open: 为什么？<<}",
      "{<<锚点>>}{>>Codex|2026-06-08|NOTE|id=RC-12|status=open|replyTo=RC-11: 因为需要定义。<<}",
      "{<<别处>>}{>>Argon|2026-06-08|NOTE|id=RC-13|status=open: 不相关<<}",
    ].join(" ");
    const [parent] = findComments(source);

    // --- ACT ---
    const next = replaceCommentThreadStatus(source, parent, "closed");

    // --- ASSERT ---
    const comments = findComments(next);
    expect(comments.map((comment) => comment.meta.status)).toEqual([
      "closed",
      "closed",
      "open",
    ]);
  });

  it("closes transitive reply chains", () => {
    // --- ARRANGE ---
    const source = [
      "{<<锚点>>}{>>Argon|2026-06-08|ASK|id=RC-20|status=open: 为什么？<<}",
      "{<<锚点>>}{>>Codex|2026-06-08|NOTE|id=RC-21|status=open|replyTo=RC-20: 第一层回复<<}",
      "{<<锚点>>}{>>Argon|2026-06-08|NOTE|id=RC-22|status=open|replyTo=RC-21: 第二层回复<<}",
    ].join(" ");
    const [parent] = findComments(source);

    // --- ACT ---
    const next = replaceCommentThreadStatus(source, parent, "closed");

    // --- ASSERT ---
    expect(findComments(next).map((comment) => comment.meta.status)).toEqual([
      "closed",
      "closed",
      "closed",
    ]);
  });

  it("closes only the selected legacy comment when it has no id", () => {
    // --- ARRANGE ---
    const source = [
      "{==旧锚点==}{>>Argon|2026-06-08: 旧批注<<}",
      "{<<新锚点>>}{>>Argon|2026-06-08|NOTE|id=RC-23|status=open: 新批注<<}",
    ].join(" ");
    const [legacy] = findComments(source);

    // --- ACT ---
    const next = replaceCommentThreadStatus(source, legacy, "closed");

    // --- ASSERT ---
    const comments = findComments(next);
    expect(comments.map((comment) => comment.meta.status)).toEqual([
      "closed",
      "open",
    ]);
    expect(comments[0].syntax).toBe("critic");
  });

  it("edits a comment body while preserving anchor and lifecycle metadata", () => {
    // --- ARRANGE ---
    const source =
      "{<<锚点>>}{>>Argon|2026-06-08|NOTE|id=RC-24|status=closed|replyTo=RC-20: 旧正文<<}";
    const [comment] = findComments(source);

    // --- ACT ---
    const next = replaceCommentMeta(source, comment, {
      ...comment.meta,
      body: "新正文\n- 保留 Markdown",
    });

    // --- ASSERT ---
    const [edited] = findComments(next);
    expect(edited.anchor).toBe("锚点");
    expect(edited.meta).toMatchObject({
      id: "RC-24",
      status: "closed",
      replyTo: "RC-20",
      body: "新正文\n- 保留 Markdown",
    });
  });

  it("refuses to edit stale comment slices", () => {
    // --- ARRANGE ---
    const source = "{<<锚点>>}{>>Argon|2026-06-08|NOTE|id=RC-6|status=open: 批注<<}";
    const [comment] = findComments(source);
    const changed = source.replace("批注", "别人已经改了");

    // --- ACT / ASSERT ---
    expect(() => replaceCommentStatus(changed, comment, "closed")).toThrow(
      "Comment source changed"
    );
  });

  it("appends a reply comment after the original comment", () => {
    // --- ARRANGE ---
    const source =
      "{<<锚点>>}{>>Argon|2026-06-08|ASK|id=RC-7|status=open: 为什么？<<}";
    const [comment] = findComments(source);

    // --- ACT ---
    const next = appendReplyComment(source, comment, {
      author: "GPT-5.5·Codex",
      date: "2026-06-08",
      type: "NOTE",
      body: "因为这里需要补定义。",
      id: "RC-8",
      status: "open",
      replyTo: "RC-7",
      attrs: {},
    });

    // --- ASSERT ---
    const comments = findComments(next);
    expect(comments).toHaveLength(2);
    expect(comments[1].anchor).toBe("");
    expect(comments[1].meta.replyTo).toBe("RC-7");
    expect(comments[1].meta.body).toBe("因为这里需要补定义。");
  });

  it("removes comment markup only after preserving the anchor text", () => {
    // --- ARRANGE ---
    const source = "前 {<<锚点>>}{>>Argon|2026-06-08|NOTE|id=RC-9|status=closed: 已关闭<<} 后";
    const [comment] = findComments(source);

    // --- ACT ---
    const next = removeComment(source, comment);

    // --- ASSERT ---
    expect(next).toBe("前 锚点 后");
    expect(findComments(next)).toHaveLength(0);
  });

  it("refuses to remove stale comment slices", () => {
    // --- ARRANGE ---
    const source = "{<<锚点>>}{>>Argon|2026-06-08|NOTE|id=RC-10|status=open: 批注<<}";
    const [comment] = findComments(source);
    const changed = source.replace("批注", "被别处改动");

    // --- ACT / ASSERT ---
    expect(() => removeComment(changed, comment)).toThrow(
      "Comment source changed"
    );
  });
});
