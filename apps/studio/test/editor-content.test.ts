import { describe, expect, it } from "vitest";
import {
  createEditorContent,
  createEmptyEditorContent,
  getEditorContent,
  normalizeEditorContent,
  parseEditorContent,
  setEditorContent,
} from "../src/editor-content";

describe("Studio editor content", () => {
  it("creates version-one content with an empty Tiptap document", () => {
    expect(createEmptyEditorContent()).toEqual({
      contentVersion: 1,
      content: { type: "doc", content: [] },
    });
  });

  it("clones reads and replacements without sharing document nodes", () => {
    const original = createEditorContent({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Draft" }] }],
    });
    const read = getEditorContent(original);
    const replacement = setEditorContent(original, {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Updated" }] }],
    });

    expect(read).toEqual(original);
    expect(read).not.toBe(original);
    expect(read.content).not.toBe(original.content);
    expect(replacement.content.content[0]).toEqual({
      type: "paragraph",
      content: [{ type: "text", text: "Updated" }],
    });
    expect(original.content.content[0]).toEqual({
      type: "paragraph",
      content: [{ type: "text", text: "Draft" }],
    });
  });

  it("fails explicitly for malformed top-level UI content", () => {
    expect(() =>
      parseEditorContent({
        contentVersion: 1,
        document: { type: "doc", content: [] },
      }),
    ).toThrow("Studio editor content normalization failed");
  });

  it("rejects raw HTML nodes instead of normalizing them", () => {
    expect(
      normalizeEditorContent({
        contentVersion: 1,
        content: { type: "doc", content: [{ type: "html", attrs: { html: "<p>unsafe</p>" } }] },
      }),
    ).toMatchObject({ ok: false });
  });

  it("accepts checked task items and canonical simple tables", () => {
    const document = {
      type: "doc" as const,
      content: [
        {
          type: "taskList" as const,
          content: [
            {
              type: "taskItem" as const,
              attrs: { checked: true },
              content: [
                { type: "paragraph" as const, content: [{ type: "text" as const, text: "Ship" }] },
              ],
            },
          ],
        },
        {
          type: "table" as const,
          content: [
            {
              type: "tableRow" as const,
              content: [
                {
                  type: "tableHeader" as const,
                  attrs: { colspan: 2, rowspan: 2, colwidth: [80, 120] },
                  content: [
                    {
                      type: "paragraph" as const,
                      content: [{ type: "text" as const, text: "Cell" }],
                    },
                  ],
                },
              ],
            },
            {
              type: "tableRow" as const,
              content: [
                {
                  type: "tableCell" as const,
                  attrs: { colspan: 3, rowspan: 1, colwidth: null },
                  content: [
                    {
                      type: "paragraph" as const,
                      content: [{ type: "text" as const, text: "Value" }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const content = createEditorContent(document);

    expect(normalizeEditorContent(content)).toEqual({ ok: true, value: content });
    expect(content.content.content[1]?.content?.[0]?.content?.[0]?.attrs).toEqual({
      colspan: 1,
      rowspan: 1,
      colwidth: null,
    });

    const invalid = {
      ...content,
      content: {
        ...content.content,
        content: [
          {
            ...content.content.content[0],
            content: [
              {
                ...(content.content.content[0]?.content?.[0] ?? {}),
                attrs: { checked: "true" },
              },
            ],
          },
        ],
      },
    };
    const result = normalizeEditorContent(invalid);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.issues[0]).toMatchObject({
      code: "invalid_task_item_checked",
      path: ["content", "content", 0, "content", 0, "attrs", "checked"],
    });
  });

  it.each([
    ["missing start", {}, "invalid_start"],
    ["zero start", { start: 0 }, "invalid_start"],
    ["negative start", { start: -1 }, "invalid_start"],
    ["fractional start", { start: 1.5 }, "invalid_start"],
    ["unsafe start", { start: Number.MAX_SAFE_INTEGER + 1 }, "invalid_start"],
    ["unsupported numbering type", { start: 1, type: "a" }, "invalid_ordered_list_type"],
    ["unknown attr", { start: 1, reversed: false }, "unknown_key"],
  ] as const)("rejects ordered-list attrs with %s", (_label, attrs, code) => {
    const result = normalizeEditorContent({
      contentVersion: 1,
      content: {
        type: "doc",
        content: [{ type: "orderedList", attrs }],
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.issues[0]?.code).toBe(code);
  });
});
