import { describe, expect, it } from "vitest";
import {
  createEditorContent,
  createEmptyEditorContent,
  getEditorContent,
  setEditorContent,
  validateEditorContent,
} from "../src/editor-content";

describe("Studio editor content", () => {
  it("creates a version-one envelope with an empty document", () => {
    expect(createEmptyEditorContent()).toEqual({
      contentVersion: 1,
      document: { type: "doc", content: [] },
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
    expect(read.document).not.toBe(original.document);
    expect(replacement.document.content[0]).toEqual({
      type: "paragraph",
      content: [{ type: "text", text: "Updated" }],
    });
    expect(original.document.content[0]).toEqual({
      type: "paragraph",
      content: [{ type: "text", text: "Draft" }],
    });
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
                  attrs: { colspan: 1, rowspan: 1, colwidth: null },
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
                  attrs: { colspan: 1, rowspan: 1, colwidth: null },
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

    expect(validateEditorContent(content)).toEqual({ ok: true, value: content });

    const invalid = {
      ...content,
      document: {
        ...content.document,
        content: [
          {
            ...content.document.content[0],
            content: [
              {
                ...(content.document.content[0]?.content?.[0] ?? {}),
                attrs: { checked: "true" },
              },
            ],
          },
        ],
      },
    };
    const result = validateEditorContent(invalid);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.issues[0]).toMatchObject({
      code: "invalid_task_item_checked",
      path: ["document", "content", 0, "content", 0, "attrs", "checked"],
    });
  });

  it.each([
    [
      "data cell in the header row",
      {
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [
              {
                type: "tableCell",
                attrs: { colspan: 1, rowspan: 1, colwidth: null },
                content: [{ type: "paragraph" }],
              },
            ],
          },
        ],
      },
    ],
    [
      "header cell in a data row",
      {
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [
              {
                type: "tableHeader",
                attrs: { colspan: 1, rowspan: 1, colwidth: null },
                content: [{ type: "paragraph" }],
              },
            ],
          },
          {
            type: "tableRow",
            content: [
              {
                type: "tableHeader",
                attrs: { colspan: 1, rowspan: 1, colwidth: null },
                content: [{ type: "paragraph" }],
              },
            ],
          },
        ],
      },
    ],
    [
      "cell with non-canonical attrs",
      {
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [
              {
                type: "tableHeader",
                attrs: { colspan: 2, rowspan: 1, colwidth: null },
                content: [{ type: "paragraph" }],
              },
            ],
          },
        ],
      },
    ],
    [
      "cell with two paragraph children",
      {
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [
              {
                type: "tableHeader",
                attrs: { colspan: 1, rowspan: 1, colwidth: null },
                content: [{ type: "paragraph" }, { type: "paragraph" }],
              },
            ],
          },
        ],
      },
    ],
    [
      "cell with a non-paragraph child",
      {
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [
              {
                type: "tableHeader",
                attrs: { colspan: 1, rowspan: 1, colwidth: null },
                content: [{ type: "text", text: "not a paragraph" }],
              },
            ],
          },
        ],
      },
    ],
    ["raw HTML node", { type: "html", attrs: { html: "<p>unsafe</p>" } }],
  ])("rejects %s", (_description, node) => {
    expect(
      validateEditorContent({ contentVersion: 1, document: { type: "doc", content: [node] } }),
    ).toMatchObject({ ok: false });
  });
});
