import { Window } from "happy-dom";
import { describe, expect, it } from "vitest";
import { ParsedComment } from "./comment-core";
import {
  collectReadingModeTextNodeGroups,
  renderCommentMarkupInReadingMode,
} from "./reading-mode-renderer";

function createDetachedTableCell(): HTMLElement {
  const win = new Window();
  const cell = win.document.createElement("div");
  cell.className = "table-cell-wrapper";
  return cell;
}

function appendText(parent: Element, text: string) {
  parent.appendChild(parent.ownerDocument.createTextNode(text));
}

function appendInline(parent: Element, tagName: string, text: string) {
  const el = parent.ownerDocument.createElement(tagName);
  el.textContent = text;
  parent.appendChild(el);
}

function appendBreak(parent: Element) {
  parent.appendChild(parent.ownerDocument.createElement("br"));
}

function createCommentElement(
  comment: ParsedComment,
  ownerDocument: Document
): HTMLElement {
  const span = ownerDocument.createElement("span");
  span.className = comment.anchor
    ? "review-comment-highlight"
    : "review-comment-point";
  span.textContent = comment.anchor || "•";
  span.dataset.type = comment.meta.type;
  span.title = comment.entries.map((entry) => entry.meta.body).join("\n");
  return span;
}

describe("reading mode renderer", () => {
  it("renders table-cell comments while the postprocessor DOM is detached", () => {
    const cell = createDetachedTableCell();
    appendText(cell, "前缀 {Option");
    appendInline(cell, "code", "<usize>");
    appendText(
      cell,
      "}{>>author=Argon;date=2026-06-10;type=COMMENT;id=RC-TABLE-1: 这里要注意 "
    );
    appendInline(cell, "strong", "地基");
    appendText(cell, " 与 ");
    appendInline(cell, "code", "&mut Self");
    appendText(cell, "<<} 后缀");

    expect(cell.isConnected).toBe(false);

    const rendered = renderCommentMarkupInReadingMode(cell, {
      createCommentElement,
    });

    expect(rendered).toBe(1);
    expect(cell.isConnected).toBe(false);
    expect(cell.querySelectorAll(".review-comment-highlight")).toHaveLength(1);
    expect(cell.textContent).toContain("前缀 Option<usize> 后缀");
    expect(cell.textContent).not.toContain("{>>");
    expect(cell.textContent).not.toContain("<<}");
  });

  it("renders multiple comments in one detached table-cell wrapper", () => {
    const cell = createDetachedTableCell();
    appendText(cell, "{Arc");
    appendInline(cell, "code", "<Mutex>");
    appendText(
      cell,
      "}{>>author=Argon;date=2026-06-10;type=ASK;id=RC-TABLE-2: 第一个批注<<} / "
    );
    appendText(
      cell,
      "{borrow}{>>author=Argon;date=2026-06-10;type=EDIT;id=RC-TABLE-3: 第二个批注<<}"
    );

    const rendered = renderCommentMarkupInReadingMode(cell, {
      createCommentElement,
    });

    expect(rendered).toBe(2);
    const highlights = [...cell.querySelectorAll(".review-comment-highlight")];
    expect(highlights.map((el) => el.textContent)).toEqual([
      "Arc<Mutex>",
      "borrow",
    ]);
    expect(cell.textContent).not.toContain("{>>");
    expect(cell.textContent).not.toContain("<<}");
  });

  it("does not render a complete pseudo-comment inside inline code", () => {
    const cell = createDetachedTableCell();
    appendText(cell, "代码 ");
    appendInline(cell, "code", "{not-comment}{>>body<<}");
    appendText(
      cell,
      " 正文 {real}{>>author=Argon;date=2026-06-11;type=COMMENT;id=RC-TABLE-4: 真实批注<<}"
    );

    const rendered = renderCommentMarkupInReadingMode(cell, {
      createCommentElement,
    });

    expect(rendered).toBe(1);
    expect(cell.querySelectorAll(".review-comment-highlight")).toHaveLength(1);
    expect(cell.querySelector(".review-comment-highlight")?.textContent).toBe(
      "real"
    );
    expect(cell.querySelector("code")?.textContent).toBe(
      "{not-comment}{>>body<<}"
    );
  });

  it("groups split text by each table-cell wrapper", () => {
    const win = new Window();
    const root = win.document.createElement("div");
    const first = win.document.createElement("div");
    const second = win.document.createElement("div");
    first.className = "table-cell-wrapper";
    second.className = "table-cell-wrapper";
    appendText(first, "{a}{>>one<<}");
    appendText(second, "{b}{>>two<<}");
    root.append(first, second);

    const groups = collectReadingModeTextNodeGroups(root);

    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.map((node) => node.textContent).join("")))
      .toEqual(["{a}{>>one<<}", "{b}{>>two<<}"]);
  });

  it("renders every known reply.local table comment when preview DOM splits metadata across inline nodes", () => {
    const win = new Window();
    const root = win.document.createElement("div");

    const cases: Array<{
      id: string;
      anchorText: string;
      build: (cell: HTMLElement) => void;
    }> = [
      {
        id: "RC-20260610-030139-IO2F",
        anchorText: "被搬运的比特串",
        build(cell) {
          appendText(
            cell,
            "{被搬运的比特串}{>>author=Argon;date=2026-06-10;type=COMMENT;id=RC-20260610-030139-IO2F: 正常<<}"
          );
        },
      },
      {
        id: "RC-20260610-223332-DQIW",
        anchorText: "可空/有限/无界（size hint=Option<usize>，读作\"长度上界\"）",
        build(cell) {
          appendText(cell, "{可空/有限/无界（size hint=");
          appendInline(cell, "code", "Option<usize>");
          appendText(cell, "，读作\"长度上界\"）}{>>author=Argon;date=2026-06-10;type=COMMENT;id=RC-20260610-223332-DQIW: 第一行");
          appendBreak(cell);
          appendText(cell, "第二行<<}");
        },
      },
      {
        id: "RC-20260610-223554-V4FZ",
        anchorText: "内容被压入、再被取出的共享载体；带投递语义（FIFO/广播/有损）",
        build(cell) {
          appendText(
            cell,
            "{内容被压入、再被取出的共享载体；带投递语义（FIFO/广播/有损）}{>>author=Argon;date=2026-06-10;type=COMMENT;id=RC-20260610-223554-V4FZ: 这个介质可以是共享的"
          );
          appendInline(cell, "code", "Arc<Mutex>");
          appendText(cell, " 或者 ");
          appendInline(cell, "code", "&mut Self");
          appendText(cell, "<<}");
        },
      },
      {
        id: "RC-20260610-224436-LXGG",
        anchorText:
          "send@发端 取一块内容 C 压入介质；recv@收端 取出 C 加进数据。地基",
        build(cell) {
          appendText(
            cell,
            "{send@发端 取一块内容 C 压入介质；recv@收端 取出 C 加进数据。"
          );
          appendInline(cell, "strong", "地基");
          appendText(cell, "}{>>author=Argon;date=2026-06-10;type=COMMENT;id=RC-20260610-224436-LXGG: 第一行");
          appendBreak(cell);
          appendText(cell, "> 第二行<<}");
        },
      },
      {
        id: "RC-20260610-224754-DJAT",
        anchorText: "反复生成传输过程的那个 send/recv 本身",
        build(cell) {
          appendText(
            cell,
            "{反复生成传输过程的那个 send/recv 本身}{>>author=Argon;date=2026-06-10;type=COMMENT;id=RC-20260610-224754-DJAT: 正常<<}"
          );
        },
      },
      {
        id: "RC-20260610-231202-K0MD",
        anchorText: "方式→方式 的映射",
        build(cell) {
          appendText(
            cell,
            "{方式→方式 的映射}{>>author=Argon;date=2026-06-10;type=COMMENT;id=RC-20260610-231202-K0MD: 正常<<}"
          );
        },
      },
      {
        id: "RC-20260610-231406-QKA2",
        anchorText: "又一个 trait object",
        build(cell) {
          appendText(
            cell,
            "{又一个 trait object}{>>author=Argon;date=2026-06-10;type=COMMENT;id=RC-20260610-231406-QKA2: 第一行"
          );
          appendBreak(cell);
          appendText(cell, "第二行");
          appendBreak(cell);
          appendText(cell, "第三行<<}");
        },
      },
    ];

    for (const testCase of cases) {
      const cell = win.document.createElement("div");
      cell.className = "table-cell-wrapper";
      testCase.build(cell);
      root.appendChild(cell);
    }

    const rendered = renderCommentMarkupInReadingMode(root, {
      createCommentElement,
    });

    expect(rendered).toBe(cases.length);

    const highlights = [...root.querySelectorAll(".review-comment-highlight")];
    expect(highlights).toHaveLength(cases.length);
    expect(highlights.map((el) => el.textContent)).toEqual(
      cases.map((testCase) => testCase.anchorText)
    );

    for (const cell of root.querySelectorAll(".table-cell-wrapper")) {
      expect(cell.textContent).not.toContain("{>>");
      expect(cell.textContent).not.toContain("<<}");
    }
  });
});
