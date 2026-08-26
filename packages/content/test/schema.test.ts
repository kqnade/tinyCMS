import { describe, expect, it } from "vitest";
import {
  CONTENT_VERSION,
  ContentValidationError,
  parseContentDocument,
  validateContentDocument,
} from "../src/index";
import {
  canonicalContentDocument,
  tiptapDefaultLinkDocument,
  tiptapHardBreakDocument,
  validContentDocument,
} from "./fixtures";

type TestRecord = Record<string, unknown>;

function minimumTable(): TestRecord {
  return {
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
            type: "tableCell",
            attrs: { colspan: 1, rowspan: 1, colwidth: null },
            content: [{ type: "paragraph" }],
          },
        ],
      },
    ],
  };
}

function tableWithSize(rowCount: number, columnCount: number): TestRecord {
  return {
    type: "table",
    content: Array.from({ length: rowCount }, (_, rowIndex) => ({
      type: "tableRow",
      content: Array.from({ length: columnCount }, () => ({
        type: rowIndex === 0 ? "tableHeader" : "tableCell",
        attrs: { colspan: 1, rowspan: 1, colwidth: null },
        content: [{ type: "paragraph" }],
      })),
    })),
  };
}

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

  it("accepts the exact hardBreak node from Tiptap inline content", () => {
    expect(validateContentDocument(CONTENT_VERSION, tiptapHardBreakDocument)).toEqual({
      ok: true,
      value: tiptapHardBreakDocument,
    });
  });

  it("accepts hardBreak nodes in every paragraph-derived text context", () => {
    const paragraph = {
      type: "paragraph",
      content: [{ type: "text", text: "Before" }, { type: "hardBreak" }],
    } as const;
    const document = {
      type: "doc",
      content: [
        paragraph,
        { type: "heading", attrs: { level: 2 }, content: [{ type: "hardBreak" }] },
        {
          type: "bulletList",
          content: [{ type: "listItem", content: [paragraph] }],
        },
        {
          type: "taskList",
          content: [
            {
              type: "taskItem",
              attrs: { checked: false },
              content: [paragraph],
            },
          ],
        },
        { type: "blockquote", content: [paragraph] },
        { type: "callout", attrs: { kind: "info" }, content: [paragraph] },
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                {
                  type: "tableHeader",
                  attrs: { colspan: 1, rowspan: 1, colwidth: null },
                  content: [paragraph],
                },
              ],
            },
            {
              type: "tableRow",
              content: [
                {
                  type: "tableCell",
                  attrs: { colspan: 1, rowspan: 1, colwidth: null },
                  content: [paragraph],
                },
              ],
            },
          ],
        },
      ],
    } as const;

    expect(validateContentDocument(CONTENT_VERSION, document)).toEqual({
      ok: true,
      value: document,
    });
  });

  it("rejects hardBreak properties outside the exact inline shape", () => {
    const properties = ["attrs", "content", "marks", "text", "extra"] as const;
    for (const property of properties) {
      const node = { type: "hardBreak", [property]: property === "extra" ? true : {} };
      const result = validateContentDocument(CONTENT_VERSION, {
        type: "doc",
        content: [{ type: "paragraph", content: [node] }],
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.issues).toEqual([
          {
            code: "unknown_key",
            message: "Unknown property is not allowed",
            path: ["content", 0, "content", 0, property],
          },
        ]);
      }
    }
  });

  it("rejects hardBreak nodes at block, list-child, and code-block positions", () => {
    const cases = [
      {
        document: { type: "doc", content: [{ type: "hardBreak" }] },
        path: ["content", 0, "type"],
        code: "unknown_node",
      },
      {
        document: {
          type: "doc",
          content: [
            {
              type: "bulletList",
              content: [{ type: "listItem", content: [{ type: "hardBreak" }] }],
            },
          ],
        },
        path: ["content", 0, "content", 0, "content", 0, "type"],
        code: "invalid_nesting",
      },
      {
        document: {
          type: "doc",
          content: [
            {
              type: "codeBlock",
              attrs: { language: null },
              content: [{ type: "hardBreak" }],
            },
          ],
        },
        path: ["content", 0, "content", 0, "type"],
        code: "invalid_nesting",
      },
    ] as const;

    for (const testCase of cases) {
      const result = validateContentDocument(CONTENT_VERSION, testCase.document);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.issues[0]).toMatchObject({
          code: testCase.code,
          path: testCase.path,
        });
      }
    }
  });

  it("rejects Tiptap default and arbitrary link attrs with stable paths", () => {
    const defaultResult = validateContentDocument(CONTENT_VERSION, tiptapDefaultLinkDocument);
    expect(defaultResult.ok).toBe(false);
    if (!defaultResult.ok) {
      expect(defaultResult.error.issues.map((issue) => issue.path)).toEqual([
        ["content", 0, "content", 0, "marks", 0, "attrs", "target"],
        ["content", 0, "content", 0, "marks", 0, "attrs", "rel"],
        ["content", 0, "content", 0, "marks", 0, "attrs", "class"],
      ]);
    }

    const arbitraryAttrs = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Link",
              marks: [{ type: "link", attrs: { href: "https://example.com", dataTest: "x" } }],
            },
          ],
        },
      ],
    } as const;
    const arbitraryResult = validateContentDocument(CONTENT_VERSION, arbitraryAttrs);
    expect(arbitraryResult.ok).toBe(false);
    if (!arbitraryResult.ok) {
      expect(arbitraryResult.error.issues.map((issue) => issue.path)).toEqual([
        ["content", 0, "content", 0, "marks", 0, "attrs", "dataTest"],
      ]);
    }
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

  it("accepts checked and unchecked task items and rebuilds canonical content", () => {
    const input = {
      type: "doc",
      content: [
        {
          type: "taskList",
          content: [
            {
              type: "taskItem",
              attrs: { checked: false },
              content: [{ type: "paragraph", content: [{ type: "text", text: "Open" }] }],
            },
            {
              type: "taskItem",
              attrs: { checked: true },
              content: [{ type: "paragraph", content: [{ type: "text", text: "Done" }] }],
            },
          ],
        },
      ],
    } as const;
    const original = JSON.parse(JSON.stringify(input));

    const result = validateContentDocument(CONTENT_VERSION, input);

    expect(result).toEqual({ ok: true, value: input });
    expect(result.ok && result.value).not.toBe(input);
    expect(input).toEqual(original);
  });

  it("accepts a minimum canonical table and rebuilds without mutation", () => {
    const input = {
      type: "doc",
      content: [
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                {
                  type: "tableHeader",
                  attrs: { colspan: 1, rowspan: 1, colwidth: null },
                  content: [{ type: "paragraph", content: [{ type: "text", text: "Name" }] }],
                },
              ],
            },
            {
              type: "tableRow",
              content: [
                {
                  type: "tableCell",
                  attrs: { colspan: 1, rowspan: 1, colwidth: null },
                  content: [{ type: "paragraph", content: [{ type: "text", text: "Ada" }] }],
                },
              ],
            },
          ],
        },
      ],
    } as const;
    const original = JSON.parse(JSON.stringify(input));

    const result = validateContentDocument(CONTENT_VERSION, input);

    expect(result).toEqual({ ok: true, value: input });
    expect(result.ok && result.value).not.toBe(input);
    expect(input).toEqual(original);
  });

  it("accepts a representative rectangular table and canonicalizes cell paragraphs", () => {
    const input = {
      type: "doc",
      content: [
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                {
                  type: "tableHeader",
                  attrs: { colspan: 1, rowspan: 1, colwidth: null },
                  content: [{ type: "paragraph", content: [{ type: "text", text: "Name" }] }],
                },
                {
                  type: "tableHeader",
                  attrs: { colspan: 1, rowspan: 1, colwidth: null },
                  content: [{ type: "paragraph", content: [{ type: "text", text: "Role" }] }],
                },
              ],
            },
            {
              type: "tableRow",
              content: [
                {
                  type: "tableCell",
                  attrs: { colspan: 1, rowspan: 1, colwidth: null },
                  content: [{ type: "paragraph", content: [{ type: "text", text: "Ada" }] }],
                },
                {
                  type: "tableCell",
                  attrs: { colspan: 1, rowspan: 1, colwidth: null },
                  content: [
                    {
                      type: "paragraph",
                      content: [
                        {
                          type: "text",
                          text: "Engineer\r\n",
                          marks: [
                            { type: "link", attrs: { href: "https://example.com" } },
                            { type: "bold" },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    } as const;

    const result = validateContentDocument(CONTENT_VERSION, input);

    expect(result).toEqual({
      ok: true,
      value: {
        type: "doc",
        content: [
          {
            type: "table",
            content: [
              {
                type: "tableRow",
                content: [
                  {
                    type: "tableHeader",
                    attrs: { colspan: 1, rowspan: 1, colwidth: null },
                    content: [{ type: "paragraph", content: [{ type: "text", text: "Name" }] }],
                  },
                  {
                    type: "tableHeader",
                    attrs: { colspan: 1, rowspan: 1, colwidth: null },
                    content: [{ type: "paragraph", content: [{ type: "text", text: "Role" }] }],
                  },
                ],
              },
              {
                type: "tableRow",
                content: [
                  {
                    type: "tableCell",
                    attrs: { colspan: 1, rowspan: 1, colwidth: null },
                    content: [{ type: "paragraph", content: [{ type: "text", text: "Ada" }] }],
                  },
                  {
                    type: "tableCell",
                    attrs: { colspan: 1, rowspan: 1, colwidth: null },
                    content: [
                      {
                        type: "paragraph",
                        content: [
                          {
                            type: "text",
                            text: "Engineer\n",
                            marks: [
                              { type: "bold" },
                              { type: "link", attrs: { href: "https://example.com" } },
                            ],
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    });
  });

  it("accepts tables only as document-level blocks", () => {
    const table = {
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
              type: "tableCell",
              attrs: { colspan: 1, rowspan: 1, colwidth: null },
              content: [{ type: "paragraph" }],
            },
          ],
        },
      ],
    } as const;
    const nested = [
      { type: "blockquote", content: [table] },
      {
        type: "bulletList",
        content: [{ type: "listItem", content: [{ type: "paragraph" }, table] }],
      },
      {
        type: "taskList",
        content: [
          {
            type: "taskItem",
            attrs: { checked: false },
            content: [{ type: "paragraph" }, table],
          },
        ],
      },
    ] as const;

    for (const node of nested) {
      expect(validateContentDocument(CONTENT_VERSION, { type: "doc", content: [node] }).ok).toBe(
        false,
      );
    }
  });

  it.each([
    [
      "table unknown property",
      (table: TestRecord) => {
        table.extra = true;
      },
      { code: "unknown_key", path: ["content", 0, "extra"] },
    ],
    [
      "table missing content",
      (table: TestRecord) => {
        delete table.content;
      },
      { code: "missing_key", path: ["content", 0, "content"] },
    ],
    [
      "empty table",
      (table: TestRecord) => {
        table.content = [];
      },
      { code: "invalid_content", path: ["content", 0, "content"] },
    ],
    [
      "one-row table",
      (table: TestRecord) => {
        table.content = [(table.content as TestRecord[])[0] as TestRecord];
      },
      { code: "invalid_content", path: ["content", 0, "content"] },
    ],
    [
      "row unknown property",
      (table: TestRecord) => {
        ((table.content as TestRecord[])[0] as TestRecord).attrs = {};
      },
      { code: "unknown_key", path: ["content", 0, "content", 0, "attrs"] },
    ],
    [
      "wrong row type",
      (table: TestRecord) => {
        ((table.content as TestRecord[])[0] as TestRecord).type = "tableCell";
      },
      { code: "invalid_node_type", path: ["content", 0, "content", 0, "type"] },
    ],
    [
      "empty row",
      (table: TestRecord) => {
        ((table.content as TestRecord[])[0] as TestRecord).content = [];
      },
      { code: "invalid_content", path: ["content", 0, "content", 0, "content"] },
    ],
    [
      "ragged rows",
      (table: TestRecord) => {
        const rows = table.content as TestRecord[];
        const secondRow = rows[1] as TestRecord;
        secondRow.content = [
          ...(secondRow.content as TestRecord[]),
          {
            type: "tableCell",
            attrs: { colspan: 1, rowspan: 1, colwidth: null },
            content: [{ type: "paragraph" }],
          },
        ];
      },
      { code: "invalid_content", path: ["content", 0, "content", 1, "content"] },
    ],
    [
      "header row with data cell",
      (table: TestRecord) => {
        const rows = table.content as TestRecord[];
        const firstCell = ((rows[0] as TestRecord).content as TestRecord[])[0] as TestRecord;
        firstCell.type = "tableCell";
      },
      {
        code: "invalid_node_type",
        path: ["content", 0, "content", 0, "content", 0, "type"],
      },
    ],
    [
      "body row with header cell",
      (table: TestRecord) => {
        const rows = table.content as TestRecord[];
        const firstCell = ((rows[1] as TestRecord).content as TestRecord[])[0] as TestRecord;
        firstCell.type = "tableHeader";
      },
      {
        code: "invalid_node_type",
        path: ["content", 0, "content", 1, "content", 0, "type"],
      },
    ],
    [
      "cell missing attrs",
      (table: TestRecord) => {
        const rows = table.content as TestRecord[];
        const firstCell = ((rows[0] as TestRecord).content as TestRecord[])[0] as TestRecord;
        delete firstCell.attrs;
      },
      { code: "missing_key", path: ["content", 0, "content", 0, "content", 0, "attrs"] },
    ],
    [
      "cell unknown attr",
      (table: TestRecord) => {
        const rows = table.content as TestRecord[];
        const cell = ((rows[0] as TestRecord).content as TestRecord[])[0] as TestRecord;
        (cell.attrs as TestRecord).extra = true;
      },
      {
        code: "unknown_key",
        path: ["content", 0, "content", 0, "content", 0, "attrs", "extra"],
      },
    ],
    [
      "cell colspan span",
      (table: TestRecord) => {
        const rows = table.content as TestRecord[];
        const cell = ((rows[0] as TestRecord).content as TestRecord[])[0] as TestRecord;
        (cell.attrs as TestRecord).colspan = 2;
      },
      {
        code: "invalid_attribute",
        path: ["content", 0, "content", 0, "content", 0, "attrs", "colspan"],
      },
    ],
    [
      "cell rowspan span",
      (table: TestRecord) => {
        const rows = table.content as TestRecord[];
        const cell = ((rows[0] as TestRecord).content as TestRecord[])[0] as TestRecord;
        (cell.attrs as TestRecord).rowspan = 2;
      },
      {
        code: "invalid_attribute",
        path: ["content", 0, "content", 0, "content", 0, "attrs", "rowspan"],
      },
    ],
    [
      "cell width array",
      (table: TestRecord) => {
        const rows = table.content as TestRecord[];
        const cell = ((rows[0] as TestRecord).content as TestRecord[])[0] as TestRecord;
        (cell.attrs as TestRecord).colwidth = [1];
      },
      {
        code: "invalid_attribute",
        path: ["content", 0, "content", 0, "content", 0, "attrs", "colwidth"],
      },
    ],
    [
      "cell without paragraph",
      (table: TestRecord) => {
        const rows = table.content as TestRecord[];
        const cell = ((rows[0] as TestRecord).content as TestRecord[])[0] as TestRecord;
        cell.content = [];
      },
      { code: "invalid_content", path: ["content", 0, "content", 0, "content", 0, "content"] },
    ],
    [
      "cell with multiple paragraphs",
      (table: TestRecord) => {
        const rows = table.content as TestRecord[];
        const cell = ((rows[0] as TestRecord).content as TestRecord[])[0] as TestRecord;
        cell.content = [{ type: "paragraph" }, { type: "paragraph" }];
      },
      { code: "invalid_content", path: ["content", 0, "content", 0, "content", 0, "content"] },
    ],
    [
      "cell with nonparagraph content",
      (table: TestRecord) => {
        const rows = table.content as TestRecord[];
        const cell = ((rows[0] as TestRecord).content as TestRecord[])[0] as TestRecord;
        cell.content = [{ type: "html" }];
      },
      {
        code: "invalid_node_type",
        path: ["content", 0, "content", 0, "content", 0, "content", 0, "type"],
      },
    ],
  ] as const)("rejects malformed table shape: %s", (_name, mutate, expected) => {
    const table = minimumTable();
    mutate(table);

    const result = validateContentDocument(CONTENT_VERSION, { type: "doc", content: [table] });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.issues[0]).toMatchObject(expected);
  });

  it("rejects unsafe inline marks in a table cell", () => {
    const table = minimumTable();
    const rows = table.content as TestRecord[];
    const cell = ((rows[0] as TestRecord).content as TestRecord[])[0] as TestRecord;
    cell.content = [
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "<script>alert(1)</script>",
            marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }],
          },
        ],
      },
    ];

    const result = validateContentDocument(CONTENT_VERSION, { type: "doc", content: [table] });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.issues[0]).toEqual({
      code: "invalid_url",
      message: "URL must be an absolute HTTP(S) URL without credentials",
      path: [
        "content",
        0,
        "content",
        0,
        "content",
        0,
        "content",
        0,
        "content",
        0,
        "marks",
        0,
        "attrs",
        "href",
      ],
    });
  });

  it.each([
    ["maximum rows", 100, 1, true, undefined],
    ["one row beyond maximum", 101, 1, false, "max_table_rows"],
    ["maximum columns", 2, 20, true, undefined],
    ["one column beyond maximum", 2, 21, false, "max_table_columns"],
    ["maximum cells", 20, 20, true, undefined],
    ["first rectangular table beyond maximum cells", 21, 20, false, "max_table_cells"],
  ] as const)("enforces table bounds: %s", (_name, rows, columns, accepted, code) => {
    const result = validateContentDocument(CONTENT_VERSION, {
      type: "doc",
      content: [tableWithSize(rows, columns)],
    });

    expect(result.ok).toBe(accepted);
    if (accepted) return;
    if (result.ok) return;
    expect(result.error.issues).toEqual([
      {
        code,
        message:
          code === "max_table_rows"
            ? "Table contains too many rows"
            : code === "max_table_columns"
              ? "Table contains too many columns"
              : "Table contains too many cells",
        path: [
          "content",
          0,
          "content",
          ...(code === "max_table_rows" ? [] : [code === "max_table_columns" ? 0 : 20, "content"]),
        ],
      },
    ]);
  });

  it("allows task lists wherever safe list blocks may be nested", () => {
    const nestedTaskList = {
      type: "taskList",
      content: [
        {
          type: "taskItem",
          attrs: { checked: true },
          content: [{ type: "paragraph", content: [{ type: "text", text: "Nested" }] }],
        },
      ],
    } as const;
    const input = {
      type: "doc",
      content: [
        {
          type: "taskList",
          content: [
            {
              type: "taskItem",
              attrs: { checked: false },
              content: [
                { type: "paragraph", content: [{ type: "text", text: "Root" }] },
                nestedTaskList,
                {
                  type: "bulletList",
                  content: [
                    {
                      type: "listItem",
                      content: [
                        { type: "paragraph", content: [{ type: "text", text: "List" }] },
                        nestedTaskList,
                      ],
                    },
                  ],
                },
                {
                  type: "blockquote",
                  content: [
                    { type: "paragraph", content: [{ type: "text", text: "Quote" }] },
                    nestedTaskList,
                  ],
                },
              ],
            },
          ],
        },
        {
          type: "blockquote",
          content: [nestedTaskList],
        },
      ],
    } as const;

    const result = validateContentDocument(CONTENT_VERSION, input);

    expect(result).toEqual({ ok: true, value: input });
  });

  it.each([
    ["empty task list", { type: "taskList", content: [] }],
    [
      "empty task item",
      { type: "taskList", content: [{ type: "taskItem", attrs: { checked: false }, content: [] }] },
    ],
    [
      "task item without a paragraph first",
      {
        type: "taskList",
        content: [
          {
            type: "taskItem",
            attrs: { checked: false },
            content: [{ type: "bulletList", content: [] }],
          },
        ],
      },
    ],
  ] as const)("rejects %s", (_name, node) => {
    expect(validateContentDocument(CONTENT_VERSION, { type: "doc", content: [node] }).ok).toBe(
      false,
    );
  });

  it.each([
    [
      "task list attrs",
      {
        type: "taskList",
        attrs: {},
        content: [
          {
            type: "taskItem",
            attrs: { checked: false },
            content: [{ type: "paragraph" }],
          },
        ],
      },
    ],
    [
      "missing checked attr",
      {
        type: "taskList",
        content: [{ type: "taskItem", attrs: {}, content: [{ type: "paragraph" }] }],
      },
    ],
    [
      "extra task item attr",
      {
        type: "taskList",
        content: [
          {
            type: "taskItem",
            attrs: { checked: false, priority: 1 },
            content: [{ type: "paragraph" }],
          },
        ],
      },
    ],
    [
      "nonboolean checked attr",
      {
        type: "taskList",
        content: [
          {
            type: "taskItem",
            attrs: { checked: "false" },
            content: [{ type: "paragraph" }],
          },
        ],
      },
    ],
    [
      "wrong task item node",
      {
        type: "taskList",
        content: [
          {
            type: "listItem",
            attrs: { checked: false },
            content: [{ type: "paragraph" }],
          },
        ],
      },
    ],
  ] as const)("rejects strict task-list shape: %s", (_name, node) => {
    expect(validateContentDocument(CONTENT_VERSION, { type: "doc", content: [node] }).ok).toBe(
      false,
    );
  });

  it.each([
    [
      "heading child",
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "No" }] },
    ],
    [
      "embed child",
      {
        type: "image",
        attrs: {
          mediaId: "018f0f7b-7b6d-7a2e-8f4e-3f1c8d5e9a10",
          alt: "",
          caption: null,
        },
      },
    ],
    ["raw HTML child", { type: "html", attrs: { html: "<img src=x onerror=alert(1)>" } }],
    ["paragraph embed child", { type: "paragraph", content: [{ type: "image", attrs: {} }] }],
    [
      "marked code child",
      {
        type: "codeBlock",
        attrs: { language: null },
        content: [{ type: "text", text: "code", marks: [{ type: "bold" }] }],
      },
    ],
  ] as const)("rejects unsafe task-item child: %s", (_name, child) => {
    const node = {
      type: "taskList",
      content: [
        {
          type: "taskItem",
          attrs: { checked: false },
          content: [{ type: "paragraph" }, child],
        },
      ],
    } as const;

    expect(validateContentDocument(CONTENT_VERSION, { type: "doc", content: [node] }).ok).toBe(
      false,
    );
  });

  it("reports deterministic task-item validation evidence", () => {
    const result = validateContentDocument(CONTENT_VERSION, {
      type: "doc",
      content: [
        {
          type: "taskList",
          content: [
            {
              type: "taskItem",
              attrs: { checked: "yes" },
              content: [{ type: "paragraph" }],
            },
          ],
        },
      ],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.issues).toEqual([
      {
        code: "invalid_attribute",
        message: "Task item checked must be a boolean",
        path: ["content", 0, "content", 0, "attrs", "checked"],
      },
    ]);
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
