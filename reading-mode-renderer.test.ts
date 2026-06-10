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
});
