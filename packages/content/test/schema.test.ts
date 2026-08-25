import { describe, expect, it } from "vitest";
import {
  CONTENT_VERSION,
  ContentValidationError,
  parseContentDocument,
  validateContentDocument,
} from "../src/index";
import { canonicalContentDocument, validContentDocument } from "./fixtures";

describe("content document schema", () => {
  it("accepts the supported numeric content version and an empty document", () => {
    const result = validateContentDocument(CONTENT_VERSION, {
      type: "doc",
      content: [],
    });

    expect(result).toEqual({
      ok: true,
      value: {
        type: "doc",
        content: [],
      },
    });
  });

  it("accepts every v1 block, nesting form, and safe mark", () => {
    const original = JSON.parse(
      JSON.stringify(validContentDocument),
    ) as typeof validContentDocument;
    const result = validateContentDocument(CONTENT_VERSION, validContentDocument);

    expect(result).toEqual({ ok: true, value: canonicalContentDocument });
    expect(validContentDocument).toEqual(original);
  });

  it("accepts canonical attr-free bullet lists and rejects bullet list attrs", () => {
    const bulletList = {
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [{ type: "paragraph", content: [{ type: "text", text: "Bullet" }] }],
        },
      ],
    } as const;

    expect(
      validateContentDocument(CONTENT_VERSION, { type: "doc", content: [bulletList] }),
    ).toEqual({
      ok: true,
      value: { type: "doc", content: [bulletList] },
    });
    expect(
      validateContentDocument(CONTENT_VERSION, {
        type: "doc",
        content: [{ ...bulletList, attrs: {} }],
      }).ok,
    ).toBe(false);
    expect(
      validateContentDocument(CONTENT_VERSION, {
        type: "doc",
        content: [{ ...bulletList, attrs: { start: 1 } }],
      }).ok,
    ).toBe(false);
  });

  it("returns stable issue paths for malformed documents", () => {
    const result = validateContentDocument(CONTENT_VERSION, {
      type: "doc",
      content: [{ type: "paragraph", extra: true }],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.issues[0]).toEqual({
      code: "unknown_key",
      message: "Unknown property is not allowed",
      path: ["content", 0, "extra"],
    });
  });

  it("stops after the node budget with one terminal issue", () => {
    const result = validateContentDocument(CONTENT_VERSION, {
      type: "doc",
      content: Array.from({ length: 5_000 }, () => ({ type: "paragraph" })),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.issues).toHaveLength(1);
    expect(result.error.issues[0]).toEqual({
      code: "max_nodes",
      message: "Document contains too many nodes",
      path: ["content", 1_000],
    });
  });

  it("counts malformed child entries toward the node budget", () => {
    const result = validateContentDocument(CONTENT_VERSION, {
      type: "doc",
      content: [null, ...Array.from({ length: 1_000 }, () => ({ type: "paragraph" }))],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.issues).toContainEqual({
      code: "invalid_node",
      message: "Node must be an object",
      path: ["content", 0],
    });
    expect(result.error.issues).toContainEqual({
      code: "max_nodes",
      message: "Document contains too many nodes",
      path: ["content", 1_000],
    });
    expect(result.error.issues.filter((issue) => issue.code === "max_nodes")).toHaveLength(1);
  });

  it("caps diagnostics and stops traversing after the issue budget", () => {
    const malformed: Record<string, unknown> = { type: "paragraph" };
    for (let index = 0; index < 128; index += 1) {
      malformed[`unknown${index}`] = true;
    }

    const result = validateContentDocument(CONTENT_VERSION, {
      type: "doc",
      content: [malformed, { type: "paragraph", extra: true }],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.issues).toHaveLength(64);
    expect(result.error.issues.every((issue) => issue.code === "unknown_key")).toBe(true);
    expect(result.error.issues.at(-1)).toEqual({
      code: "unknown_key",
      message: "Unknown property is not allowed",
      path: ["content", 0, "unknown63"],
    });
    expect(result.error.issues.some((issue) => issue.path[1] === 1)).toBe(false);
  });

  it("caps total canonical text length across text nodes", () => {
    const result = validateContentDocument(CONTENT_VERSION, {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "a".repeat(600_000) }] },
        { type: "paragraph", content: [{ type: "text", text: "b".repeat(600_000) }] },
        { type: "paragraph", content: [{ type: "text", text: "after" }] },
      ],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.issues).toEqual([
      {
        code: "max_total_text_length",
        message: "Total text content is too long",
        path: ["content", 1, "content", 0, "text"],
      },
    ]);
  });

  it("rejects line breaks in code-marked text with a stable issue", () => {
    const result = validateContentDocument(CONTENT_VERSION, {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "before\r\nafter", marks: [{ type: "code" }] }],
        },
      ],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.issues).toEqual([
      {
        code: "code_newline",
        message: "Code-marked text cannot contain carriage returns or line feeds",
        path: ["content", 0, "content", 0, "text"],
      },
    ]);
  });

  it("throws its structured validation error from parse", () => {
    expect(() => parseContentDocument(CONTENT_VERSION, { type: "html" })).toThrow(
      ContentValidationError,
    );
    try {
      parseContentDocument(CONTENT_VERSION, { type: "html" });
    } catch (error) {
      expect(error).toBeInstanceOf(ContentValidationError);
      expect((error as ContentValidationError).issues[0]?.path).toEqual(["content"]);
    }
  });

  it("rejects unsupported and string versions", () => {
    expect(validateContentDocument(2, { type: "doc", content: [] })).toMatchObject({
      ok: false,
    });
    expect(validateContentDocument("1", { type: "doc", content: [] })).toMatchObject({
      ok: false,
    });
  });

  it.each([
    ["unknown node", { type: "mystery" }],
    ["raw HTML node", { type: "html", attrs: { html: "<p>unsafe</p>" } }],
    ["leaf content", { type: "horizontalRule", content: [] }],
    ["paragraph embed", { type: "paragraph", content: [{ type: "image", attrs: {} }] }],
    ["empty bullet list", { type: "bulletList", content: [] }],
    ["invalid list start", { type: "orderedList", attrs: { start: 0 }, content: [] }],
    [
      "list item without paragraph",
      {
        type: "bulletList",
        content: [
          { type: "listItem", content: [{ type: "codeBlock", attrs: { language: null } }] },
        ],
      },
    ],
    ["empty blockquote", { type: "blockquote", content: [] }],
    ["invalid heading level", { type: "heading", attrs: { level: 7 }, content: [] }],
    ["invalid code language", { type: "codeBlock", attrs: { language: "brainfuck" }, content: [] }],
    [
      "marked code",
      {
        type: "codeBlock",
        attrs: { language: null },
        content: [{ type: "text", text: "code", marks: [{ type: "bold" }] }],
      },
    ],
    [
      "invalid media ID",
      {
        type: "image",
        attrs: { mediaId: "018f0f7b-7b6d-7a2e-8f4e-3f1c8d5e9A10", alt: "", caption: null },
      },
    ],
    [
      "credential URL",
      {
        type: "bookmark",
        attrs: { href: "https://user:pass@example.com", title: "", description: null },
      },
    ],
    [
      "unsafe URL",
      {
        type: "bookmark",
        attrs: { href: "javascript:alert(1)", title: "", description: null },
      },
    ],
    ["invalid YouTube ID", { type: "youtube", attrs: { videoId: "too-short" } }],
    [
      "invalid Bluesky profile",
      {
        type: "bluesky",
        attrs: { profile: "@alice", postId: "3k2a4r5x7zq2" },
      },
    ],
    [
      "invalid Bluesky rkey",
      {
        type: "bluesky",
        attrs: { profile: "alice.bsky.social", postId: "bad/rkey" },
      },
    ],
    ["invalid X username", { type: "x", attrs: { username: "a-user", postId: "1" } }],
    [
      "invalid X post ID",
      {
        type: "x",
        attrs: { username: "alice", postId: "123456789012345678901" },
      },
    ],
    ["empty callout", { type: "callout", attrs: { kind: "info" }, content: [] }],
    ["empty text", { type: "paragraph", content: [{ type: "text", text: "" }] }],
    [
      "unknown mark",
      {
        type: "paragraph",
        content: [{ type: "text", text: "x", marks: [{ type: "highlight" }] }],
      },
    ],
    [
      "duplicate mark",
      {
        type: "paragraph",
        content: [{ type: "text", text: "x", marks: [{ type: "bold" }, { type: "bold" }] }],
      },
    ],
    [
      "mark attributes",
      {
        type: "paragraph",
        content: [{ type: "text", text: "x", marks: [{ type: "bold", attrs: {} }] }],
      },
    ],
  ] as const)("rejects %s", (_name, node) => {
    expect(validateContentDocument(CONTENT_VERSION, { type: "doc", content: [node] }).ok).toBe(
      false,
    );
  });
});
