import { Window } from "happy-dom";
import { describe, expect, it } from "vitest";
import {
  COMMENT_THREAD_DATA_ATTR,
  getCommentThreadKeyFromTarget,
  normalizeCommentAutoFocusMode,
  resolveAutoFocusCommentThreadKey,
  shouldAutoFocusCommentThread,
} from "./comment-autofocus";

describe("comment auto focus helpers", () => {
  it("normalizes persisted setting values", () => {
    expect(normalizeCommentAutoFocusMode("left")).toBe("left");
    expect(normalizeCommentAutoFocusMode("right")).toBe("right");
    expect(normalizeCommentAutoFocusMode("off")).toBe("off");
    expect(normalizeCommentAutoFocusMode("unknown")).toBe("off");
    expect(normalizeCommentAutoFocusMode(undefined)).toBe("off");
  });

  it("only enables auto focus for the configured trigger", () => {
    expect(shouldAutoFocusCommentThread("off", "left")).toBe(false);
    expect(shouldAutoFocusCommentThread("off", "right")).toBe(false);
    expect(shouldAutoFocusCommentThread("left", "left")).toBe(true);
    expect(shouldAutoFocusCommentThread("left", "right")).toBe(false);
    expect(shouldAutoFocusCommentThread("right", "left")).toBe(false);
    expect(shouldAutoFocusCommentThread("right", "right")).toBe(true);
  });

  it("finds the nearest rendered comment thread key from nested DOM targets", () => {
    const win = new Window();
    const root = win.document.createElement("span");
    root.className = "review-comment-highlight";
    root.dataset[COMMENT_THREAD_DATA_ATTR] = "id:RC-123";
    const child = win.document.createElement("strong");
    child.textContent = "inside";
    root.appendChild(child);

    expect(getCommentThreadKeyFromTarget(child)).toBe("id:RC-123");
    expect(getCommentThreadKeyFromTarget(child.firstChild)).toBe("id:RC-123");
  });

  it("ignores non-comment DOM targets", () => {
    const win = new Window();
    const root = win.document.createElement("div");
    const child = win.document.createElement("span");
    root.appendChild(child);

    expect(getCommentThreadKeyFromTarget(child)).toBeNull();
    expect(getCommentThreadKeyFromTarget(null)).toBeNull();
  });

  it("only resolves a thread key when the configured trigger matches the DOM event", () => {
    const win = new Window();
    const root = win.document.createElement("span");
    root.className = "review-comment-point-live";
    root.dataset[COMMENT_THREAD_DATA_ATTR] = "id:RC-456";

    expect(resolveAutoFocusCommentThreadKey("off", "left", root)).toBeNull();
    expect(resolveAutoFocusCommentThreadKey("left", "right", root)).toBeNull();
    expect(resolveAutoFocusCommentThreadKey("right", "right", root)).toBe(
      "id:RC-456"
    );
  });

  it("never infers auto focus from a missing DOM target", () => {
    expect(resolveAutoFocusCommentThreadKey("left", "left", null)).toBeNull();
    expect(resolveAutoFocusCommentThreadKey("right", "right", null)).toBeNull();
  });
});
