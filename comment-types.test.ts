import { describe, expect, it } from "vitest";
import {
  DEFAULT_COMMENT_TYPES,
  getCommentTypeColorTriplet,
  getReviewCommentType,
  normalizeCommentTypes,
} from "./comment-types";

describe("comment-types", () => {
  it("keeps COMMENT as the protected default type", () => {
    const [defaultType] = normalizeCommentTypes([]);

    expect(defaultType).toMatchObject({
      id: "comment",
      tag: "COMMENT",
      label: "批注",
      icon: "💬",
      color: "#e6be28",
      protected: true,
    });
  });

  it("allows the protected COMMENT type to edit command id, label, icon, and color", () => {
    const [defaultType] = normalizeCommentTypes([
      {
        id: "general-review",
        tag: "COMMENT",
        label: "总批注",
        icon: "📌",
        color: "#dddddd",
      },
    ]);

    expect(defaultType).toMatchObject({
      id: "general-review",
      tag: "COMMENT",
      label: "总批注",
      icon: "📌",
      color: "#dddddd",
      protected: true,
    });
  });

  it("sanitizes custom type ids, tags, labels, icons, and colors", () => {
    const custom = normalizeCommentTypes([
      {
        id: " Debate Type ",
        tag: " debate type ",
        label: "  辩论  ",
        icon: "  ⚖️  ",
        color: "ABCDEF",
      },
    ]).find((type) => type.tag === "DEBATE_TYPE");

    expect(custom).toMatchObject({
      id: "debate-type",
      tag: "DEBATE_TYPE",
      label: "辩论",
      icon: "⚖️",
      color: "#abcdef",
      protected: false,
    });
  });

  it("drops duplicate tags and keeps command ids unique", () => {
    const types = normalizeCommentTypes([
      {
        id: "same",
        tag: "CUSTOM",
        label: "第一条",
        icon: "1",
        color: "#111111",
      },
      {
        id: "same",
        tag: "OTHER",
        label: "第二条",
        icon: "2",
        color: "#222222",
      },
      {
        id: "third",
        tag: "CUSTOM",
        label: "重复 tag",
        icon: "3",
        color: "#333333",
      },
    ]);

    expect(types.map((type) => type.tag)).toEqual([
      "COMMENT",
      "CUSTOM",
      "OTHER",
    ]);
    expect(types.find((type) => type.tag === "CUSTOM")?.label).toBe("第一条");
    expect(types.find((type) => type.tag === "OTHER")?.id).toBe("same-2");
  });

  it("falls back to default colors when custom colors are invalid", () => {
    const types = normalizeCommentTypes([
      { tag: "ASK", color: "not-a-color" },
      { tag: "CUSTOM", color: "#12345" },
    ]);

    expect(types.find((type) => type.tag === "ASK")?.color).toBe("#4a90e2");
    expect(types.find((type) => type.tag === "CUSTOM")?.color).toBe(
      "#e6be28"
    );
  });

  it("inserts the protected COMMENT type when a saved config omits it", () => {
    const types = normalizeCommentTypes([
      { id: "ask-custom", tag: "ASK", label: "追问" },
    ]);

    expect(types[0].tag).toBe("COMMENT");
    expect(types[0].protected).toBe(true);
    expect(types.find((type) => type.tag === "ASK")?.label).toBe("追问");
  });

  it("preserves unknown tags as readable ad-hoc types", () => {
    const type = getReviewCommentType(DEFAULT_COMMENT_TYPES, "risk review");

    expect(type).toMatchObject({
      tag: "RISK_REVIEW",
      label: "RISK_REVIEW",
      color: "#e6be28",
      protected: false,
    });
  });

  it("returns RGB triplets for configured and unknown type colors", () => {
    const types = normalizeCommentTypes([
      { tag: "CUSTOM", color: "#123456" },
    ]);

    expect(getCommentTypeColorTriplet(types, "CUSTOM")).toBe("18, 52, 86");
    expect(getCommentTypeColorTriplet(types, "UNKNOWN")).toBe("230, 190, 40");
  });
});
