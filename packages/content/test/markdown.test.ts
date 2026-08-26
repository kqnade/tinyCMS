import { HtmlRenderer, Parser } from "commonmark";
import { describe, expect, it } from "vitest";
import { CONTENT_VERSION, ContentValidationError, renderMarkdown } from "../src/index";
import { canonicalContentDocument } from "./fixtures";

const commonmarkParser = new Parser();
const commonmarkHtmlRenderer = new HtmlRenderer();

function renderCommonmarkHtml(markdown: string): string {
  return commonmarkHtmlRenderer.render(commonmarkParser.parse(markdown));
}

describe("Markdown renderer", () => {
  it("renders checked and unchecked task items with exact GFM markers", () => {
    expect(
      renderMarkdown(
        CONTENT_VERSION,
        {
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
        },
        { resolveMediaUrl: () => null },
      ),
    ).toBe("- [ ] Open\n- [x] Done");
  });

  it("indents task continuations and nested blocks by the six-character marker width", () => {
    expect(
      renderMarkdown(
        CONTENT_VERSION,
        {
          type: "doc",
          content: [
            {
              type: "taskList",
              content: [
                {
                  type: "taskItem",
                  attrs: { checked: false },
                  content: [
                    { type: "paragraph", content: [{ type: "text", text: "Parent" }] },
                    { type: "paragraph", content: [{ type: "text", text: "Continuation" }] },
                    {
                      type: "taskList",
                      content: [
                        {
                          type: "taskItem",
                          attrs: { checked: true },
                          content: [
                            { type: "paragraph", content: [{ type: "text", text: "Child" }] },
                          ],
                        },
                      ],
                    },
                    {
                      type: "bulletList",
                      content: [
                        {
                          type: "listItem",
                          content: [
                            { type: "paragraph", content: [{ type: "text", text: "Bullet" }] },
                          ],
                        },
                      ],
                    },
                    {
                      type: "orderedList",
                      attrs: { start: 3 },
                      content: [
                        {
                          type: "listItem",
                          content: [
                            { type: "paragraph", content: [{ type: "text", text: "Ordered" }] },
                          ],
                        },
                      ],
                    },
                    {
                      type: "blockquote",
                      content: [{ type: "paragraph", content: [{ type: "text", text: "Quote" }] }],
                    },
                    {
                      type: "codeBlock",
                      attrs: { language: "typescript" },
                      content: [{ type: "text", text: "const value = 1;" }],
                    },
                  ],
                },
              ],
            },
          ],
        },
        { resolveMediaUrl: () => null },
      ),
    ).toBe(
      [
        "- [ ] Parent",
        "",
        "      Continuation",
        "",
        "      - [x] Child",
        "",
        "      - Bullet",
        "",
        "      3. Ordered",
        "",
        "      > Quote",
        "",
        "      ```typescript",
        "      const value = 1;",
        "      ```",
      ].join("\n"),
    );
  });

  it("renders the minimum table with a GFM delimiter row", () => {
    expect(
      renderMarkdown(
        CONTENT_VERSION,
        {
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
        },
        { resolveMediaUrl: () => null },
      ),
    ).toBe("| Name |\n| --- |\n| Ada |");
  });

  it("renders representative rectangular tables with inline marks and links", () => {
    expect(
      renderMarkdown(
        CONTENT_VERSION,
        {
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
                              text: "Engineer",
                              marks: [{ type: "bold" }],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
                {
                  type: "tableRow",
                  content: [
                    {
                      type: "tableCell",
                      attrs: { colspan: 1, rowspan: 1, colwidth: null },
                      content: [{ type: "paragraph", content: [{ type: "text", text: "Grace" }] }],
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
                              text: "Compiler",
                              marks: [{ type: "link", attrs: { href: "https://example.com" } }],
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
        { resolveMediaUrl: () => null },
      ),
    ).toBe(
      [
        "| Name | Role |",
        "| --- | --- |",
        "| Ada | **Engineer** |",
        "| Grace | [Compiler](https://example.com) |",
      ].join("\n"),
    );
  });

  it("escapes table pipes once across text, code, links, and generated line breaks", () => {
    expect(
      renderMarkdown(
        CONTENT_VERSION,
        {
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
                      content: [{ type: "paragraph", content: [{ type: "text", text: "Plain" }] }],
                    },
                    {
                      type: "tableHeader",
                      attrs: { colspan: 1, rowspan: 1, colwidth: null },
                      content: [{ type: "paragraph", content: [{ type: "text", text: "Code" }] }],
                    },
                    {
                      type: "tableHeader",
                      attrs: { colspan: 1, rowspan: 1, colwidth: null },
                      content: [{ type: "paragraph", content: [{ type: "text", text: "Link" }] }],
                    },
                  ],
                },
                {
                  type: "tableRow",
                  content: [
                    {
                      type: "tableCell",
                      attrs: { colspan: 1, rowspan: 1, colwidth: null },
                      content: [
                        {
                          type: "paragraph",
                          content: [{ type: "text", text: "<script>|line1\nline2" }],
                        },
                      ],
                    },
                    {
                      type: "tableCell",
                      attrs: { colspan: 1, rowspan: 1, colwidth: null },
                      content: [
                        {
                          type: "paragraph",
                          content: [{ type: "text", text: "a|b", marks: [{ type: "code" }] }],
                        },
                      ],
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
                              text: "link|text",
                              marks: [{ type: "link", attrs: { href: "https://example.com/a|b" } }],
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
        { resolveMediaUrl: () => null },
      ),
    ).toBe(
      [
        "| Plain | Code | Link |",
        "| --- | --- | --- |",
        "| &lt;script&gt;\\|line1<br>line2 | `a\\|b` | [link\\|text](https://example.com/a\\|b) |",
      ].join("\n"),
    );
  });

  it("rejects malformed task and table nodes before rendering", () => {
    const options = { resolveMediaUrl: () => null };
    expect(() =>
      renderMarkdown(
        CONTENT_VERSION,
        {
          type: "doc",
          content: [
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
        },
        options,
      ),
    ).toThrow(ContentValidationError);

    const table = {
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
    expect(() =>
      renderMarkdown(CONTENT_VERSION, { type: "doc", content: [table] }, options),
    ).toThrow(ContentValidationError);

    expect(() =>
      renderMarkdown(
        CONTENT_VERSION,
        {
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
                      content: [{ type: "paragraph", content: [{ type: "html" }] }],
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
            },
          ],
        },
        options,
      ),
    ).toThrow(ContentValidationError);
  });

  it("renders an empty document as an empty fragment", () => {
    expect(
      renderMarkdown(
        CONTENT_VERSION,
        { type: "doc", content: [] },
        { resolveMediaUrl: () => null },
      ),
    ).toBe("");
  });

  it("renders every canonical v1 block, nested block, and inline mark", () => {
    const expected = [
      "***~~[`HTML-looking data: <script>alert(1)</script>`](https://example.com/article)~~***\nnext plain",
      "## Heading",
      [
        "- Bullet",
        "",
        "  Continuation",
        "",
        "  3. Nested",
        "",
        "  > Quoted",
        "",
        "  ```typescript",
        "  const value = 1;",
        "  ```",
      ].join("\n"),
      [
        "> A quote",
        ">",
        "> ### A quoted heading",
        ">",
        "> ```",
        "> plain code",
        "> ```",
        ">",
        "> ---",
      ].join("\n"),
      '![A sample image](/media/018f0f7b-7b6d-7a2e-8f4e-3f1c8d5e9a10/original "A caption")',
      "[Example](https://example.com/bookmark)",
      "[YouTube video](https://www.youtube.com/watch?v=dQw4w9WgXcQ)",
      "[Bluesky post](https://bsky.app/profile/alice.bsky.social/post/3k2a4r5x7zq2)",
      "[X post](https://x.com/alice_1/status/1234567890)",
      ["> **Warning**", ">", "> Take care\\.", ">", "> This is important\\."].join("\n"),
      "---",
    ].join("\n\n");

    expect(
      renderMarkdown(CONTENT_VERSION, canonicalContentDocument, {
        resolveMediaUrl: (mediaId) => `/media/${mediaId}/original`,
      }),
    ).toBe(expected);
  });

  it("preserves italic formatting between adjacent text nodes in CommonMark", () => {
    const output = renderMarkdown(
      CONTENT_VERSION,
      {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "before" },
              { type: "text", text: "middle", marks: [{ type: "italic" }] },
              { type: "text", text: "after" },
            ],
          },
        ],
      },
      { resolveMediaUrl: () => null },
    );

    expect(output).toBe("before*middle*after");
    expect(renderCommonmarkHtml(output)).toBe("<p>before<em>middle</em>after</p>\n");
  });

  it("keeps leading and trailing whitespace outside italic delimiters", () => {
    const output = renderMarkdown(
      CONTENT_VERSION,
      {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "\u2003marked\u00a0", marks: [{ type: "italic" }] }],
          },
        ],
      },
      { resolveMediaUrl: () => null },
    );

    expect(output).toBe("\u2003*marked*\u00a0");
    expect(renderCommonmarkHtml(output)).toBe("<p><em>marked</em></p>\n");
  });

  it("keeps leading and trailing whitespace outside strong delimiters", () => {
    const output = renderMarkdown(
      CONTENT_VERSION,
      {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: " marked ", marks: [{ type: "bold" }] }],
          },
        ],
      },
      { resolveMediaUrl: () => null },
    );

    expect(output).toBe(" **marked** ");
    expect(renderCommonmarkHtml(output)).toBe("<p><strong>marked</strong></p>\n");
  });

  it("does not emit delimiters for all-whitespace marked text", () => {
    const output = renderMarkdown(
      CONTENT_VERSION,
      {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "before" },
              {
                type: "text",
                text: "   ",
                marks: [
                  { type: "bold" },
                  { type: "italic" },
                  { type: "strike" },
                  { type: "link", attrs: { href: "https://example.com" } },
                ],
              },
              { type: "text", text: "after" },
            ],
          },
        ],
      },
      { resolveMediaUrl: () => null },
    );

    expect(output).toBe("before   after");
    expect(renderCommonmarkHtml(output)).toBe("<p>before   after</p>\n");
  });

  it("preserves combined bold and italic formatting in CommonMark", () => {
    const output = renderMarkdown(
      CONTENT_VERSION,
      {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "both",
                marks: [{ type: "italic" }, { type: "bold" }],
              },
            ],
          },
        ],
      },
      { resolveMediaUrl: () => null },
    );

    expect(output).toBe("***both***");
    expect(renderCommonmarkHtml(output)).toBe("<p><em><strong>both</strong></em></p>\n");
  });

  it("escapes Markdown text and link, image, and bookmark fields", () => {
    const mediaId = "018f0f7b-7b6d-7a2e-8f4e-3f1c8d5e9a10";
    const output = renderMarkdown(
      CONTENT_VERSION,
      {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: '# heading\n- item *italic* _em_ [link](bad) <script>alert(1)</script><iframe src="https://evil.test"></iframe> &copy;',
              },
              {
                type: "text",
                text: "text & < > \" '",
                marks: [{ type: "link", attrs: { href: "https://example.com/?q=a&v=%22" } }],
              },
            ],
          },
          {
            type: "image",
            attrs: {
              mediaId,
              alt: "alt & < > \" '",
              caption: "caption & < > \" '",
            },
          },
          {
            type: "bookmark",
            attrs: {
              href: "https://example.com/bookmark?a=1&b=2",
              title: "title & < > \" '",
              description: "description & < > \" '",
            },
          },
        ],
      },
      { resolveMediaUrl: () => "https://cdn.example.test/media?a=1&b=2" },
    );

    expect(output).toBe(
      [
        '\\# heading\n\\- item \\*italic\\* \\_em\\_ \\[link\\]\\(bad\\) &lt;script&gt;alert\\(1\\)&lt;/script&gt;&lt;iframe src\\="https://evil\\.test"&gt;&lt;/iframe&gt; &amp;copy;[text &amp; &lt; &gt; " \'](https://example.com/?q=a&v=%22)',
        '![alt &amp; &lt; &gt; " \'](https://cdn.example.test/media?a=1&b=2 "caption &amp; &lt; &gt; \\" \'")',
        "[title &amp; &lt; &gt; \" '](https://example.com/bookmark?a=1&b=2) — description &amp; &lt; &gt; \" '",
      ].join("\n\n"),
    );
    expect(output).not.toContain("<script");
    expect(output).not.toContain("<iframe");
  });

  it("uses adaptive delimiters for inline and fenced code", () => {
    expect(
      renderMarkdown(
        CONTENT_VERSION,
        {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: "inline ` value", marks: [{ type: "code" }] },
                { type: "text", text: " / " },
                { type: "text", text: "``", marks: [{ type: "code" }] },
              ],
            },
            {
              type: "codeBlock",
              attrs: { language: "typescript" },
              content: [{ type: "text", text: "const fence = ```;\nline" }],
            },
            {
              type: "codeBlock",
              attrs: { language: null },
              content: [{ type: "text", text: "plain ````" }],
            },
            { type: "codeBlock", attrs: { language: null } },
          ],
        },
        { resolveMediaUrl: () => null },
      ),
    ).toBe(
      "``inline ` value`` / ``` `` ```\n\n````typescript\nconst fence = ```;\nline\n````\n\n`````\nplain ````\n`````\n\n```\n```",
    );
  });

  it.each([
    ["backtick-only payload", "``", "``` `` ```"],
    ["payload beginning and ending with backticks", "`value`", "`` `value` ``"],
    ["payload with leading and trailing spaces", " value ", "`  value  `"],
    ["all-space payload", "  ", "`  `"],
  ])("preserves %s", (_description, value, expected) => {
    expect(
      renderMarkdown(
        CONTENT_VERSION,
        {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: value, marks: [{ type: "code" }] }],
            },
          ],
        },
        { resolveMediaUrl: () => null },
      ),
    ).toBe(expected);
  });

  it("indents nested multi-block lists and prefixes every blockquote line", () => {
    expect(
      renderMarkdown(
        CONTENT_VERSION,
        {
          type: "doc",
          content: [
            {
              type: "orderedList",
              attrs: { start: 9 },
              content: [
                {
                  type: "listItem",
                  content: [
                    { type: "paragraph", content: [{ type: "text", text: "first\nsecond" }] },
                    {
                      type: "bulletList",
                      content: [
                        {
                          type: "listItem",
                          content: [
                            { type: "paragraph", content: [{ type: "text", text: "nested" }] },
                            {
                              type: "paragraph",
                              content: [{ type: "text", text: "continuation" }],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
                {
                  type: "listItem",
                  content: [{ type: "paragraph", content: [{ type: "text", text: "next" }] }],
                },
              ],
            },
            {
              type: "blockquote",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "line one\n\nline three" }],
                },
                { type: "paragraph", content: [{ type: "text", text: "second" }] },
              ],
            },
          ],
        },
        { resolveMediaUrl: () => null },
      ),
    ).toBe(
      "9. first\n   second\n\n   - nested\n\n     continuation\n10. next\n\n> line one\n>\n> line three\n>\n> second",
    );
  });

  it("uses portable quoted callouts and ordinary links for embeds", () => {
    expect(
      renderMarkdown(
        CONTENT_VERSION,
        {
          type: "doc",
          content: [
            {
              type: "callout",
              attrs: { kind: "danger" },
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Do not use <iframe>." }],
                },
                { type: "paragraph", content: [{ type: "text", text: "Stay safe." }] },
              ],
            },
            {
              type: "bookmark",
              attrs: {
                href: "https://example.com/read?a=1&b=2",
                title: "Read me",
                description: "A description",
              },
            },
            { type: "youtube", attrs: { videoId: "dQw4w9WgXcQ" } },
            {
              type: "bluesky",
              attrs: { profile: "alice.bsky.social", postId: "3k2a4r5x7zq2" },
            },
            { type: "x", attrs: { username: "alice_1", postId: "1234567890" } },
            { type: "horizontalRule" },
          ],
        },
        { resolveMediaUrl: () => null },
      ),
    ).toBe(
      "> **Danger**\n>\n> Do not use &lt;iframe&gt;\\.\n>\n> Stay safe\\.\n\n[Read me](https://example.com/read?a=1&b=2) — A description\n\n[YouTube video](https://www.youtube.com/watch?v=dQw4w9WgXcQ)\n\n[Bluesky post](https://bsky.app/profile/alice.bsky.social/post/3k2a4r5x7zq2)\n\n[X post](https://x.com/alice_1/status/1234567890)\n\n---",
    );
  });

  it("resolves each distinct media ID once and renders stable missing-image text", () => {
    const firstId = "018f0f7b-7b6d-7a2e-8f4e-3f1c8d5e9a10";
    const secondId = "018f0f7b-7b6d-7a2e-8f4e-3f1c8d5e9a11";
    const calls: string[] = [];

    const output = renderMarkdown(
      CONTENT_VERSION,
      {
        type: "doc",
        content: [
          { type: "image", attrs: { mediaId: firstId, alt: "first", caption: null } },
          { type: "image", attrs: { mediaId: firstId, alt: "again", caption: "caption" } },
          {
            type: "image",
            attrs: { mediaId: secondId, alt: "missing & <", caption: "Caption" },
          },
        ],
      },
      {
        resolveMediaUrl: (mediaId) => {
          calls.push(mediaId);
          return mediaId === firstId ? "/media/first" : null;
        },
      },
    );

    expect(calls).toEqual([firstId, secondId]);
    expect(output).toBe(
      '![first](/media/first)\n\n![again](/media/first "caption")\n\nImage unavailable: missing &amp; &lt; — Caption',
    );
  });

  it("rejects unsafe media resolver output at the renderer boundary", () => {
    const document = {
      type: "doc",
      content: [
        {
          type: "image",
          attrs: {
            mediaId: "018f0f7b-7b6d-7a2e-8f4e-3f1c8d5e9a10",
            alt: "unsafe",
            caption: null,
          },
        },
      ],
    } as const;

    for (const value of [
      "javascript:alert(1)",
      "https://user:pass@example.com/image",
      "//evil.example/image",
      "https://cdn.example.test/image with-space",
      "data:text/plain,unsafe",
    ]) {
      expect(() =>
        renderMarkdown(CONTENT_VERSION, document, { resolveMediaUrl: () => value }),
      ).toThrow("Media URL resolver returned an unsafe URL");
    }
  });

  it("rejects unsupported versions, raw HTML, unsafe links, and invalid providers", () => {
    const options = { resolveMediaUrl: () => null };
    expect(() => renderMarkdown(2, { type: "doc", content: [] }, options)).toThrow(
      ContentValidationError,
    );
    expect(() =>
      renderMarkdown(CONTENT_VERSION, { type: "doc", content: [{ type: "html" }] }, options),
    ).toThrow(ContentValidationError);
    expect(() =>
      renderMarkdown(
        CONTENT_VERSION,
        { type: "doc", content: [{ type: "paragraph", extra: "raw" }] },
        options,
      ),
    ).toThrow(ContentValidationError);
    expect(() =>
      renderMarkdown(
        CONTENT_VERSION,
        {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "unsafe",
                  marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }],
                },
              ],
            },
          ],
        },
        options,
      ),
    ).toThrow(ContentValidationError);
    expect(() =>
      renderMarkdown(
        CONTENT_VERSION,
        { type: "doc", content: [{ type: "youtube", attrs: { videoId: "short" } }] },
        options,
      ),
    ).toThrow(ContentValidationError);
    expect(() =>
      renderMarkdown(
        CONTENT_VERSION,
        {
          type: "doc",
          content: [{ type: "x", attrs: { username: "not-valid", postId: "1" } }],
        },
        options,
      ),
    ).toThrow(ContentValidationError);
    expect(() =>
      renderMarkdown(
        CONTENT_VERSION,
        {
          type: "doc",
          content: [
            {
              type: "bluesky",
              attrs: { profile: "@alice", postId: "3k2a4r5x7zq2" },
            },
          ],
        },
        options,
      ),
    ).toThrow(ContentValidationError);
  });

  it("is deterministic across repeated renders and does not mutate frozen input", () => {
    const input = JSON.parse(
      JSON.stringify(canonicalContentDocument),
    ) as typeof canonicalContentDocument;
    const before = JSON.parse(JSON.stringify(input));
    const freeze = (value: unknown): void => {
      if (typeof value !== "object" || value === null || Object.isFrozen(value)) return;
      Object.freeze(value);
      for (const child of Object.values(value)) freeze(child);
    };
    freeze(input);

    const first = renderMarkdown(CONTENT_VERSION, input, {
      resolveMediaUrl: (mediaId) => `/media/${mediaId}`,
    });
    const second = renderMarkdown(CONTENT_VERSION, input, {
      resolveMediaUrl: (mediaId) => `/media/${mediaId}`,
    });

    expect(second).toBe(first);
    expect(input).toEqual(before);
    expect(first.endsWith("\n")).toBe(false);
  });

  it("keeps task and table output deterministic for frozen input", () => {
    const input = {
      type: "doc",
      content: [
        {
          type: "taskList",
          content: [
            {
              type: "taskItem",
              attrs: { checked: true },
              content: [{ type: "paragraph", content: [{ type: "text", text: "Done" }] }],
            },
          ],
        },
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                {
                  type: "tableHeader",
                  attrs: { colspan: 1, rowspan: 1, colwidth: null },
                  content: [{ type: "paragraph", content: [{ type: "text", text: "Key" }] }],
                },
              ],
            },
            {
              type: "tableRow",
              content: [
                {
                  type: "tableCell",
                  attrs: { colspan: 1, rowspan: 1, colwidth: null },
                  content: [{ type: "paragraph", content: [{ type: "text", text: "Value" }] }],
                },
              ],
            },
          ],
        },
      ],
    } as const;
    const before = JSON.parse(JSON.stringify(input));
    const freeze = (value: unknown): void => {
      if (typeof value !== "object" || value === null || Object.isFrozen(value)) return;
      Object.freeze(value);
      for (const child of Object.values(value)) freeze(child);
    };
    freeze(input);

    const first = renderMarkdown(CONTENT_VERSION, input, { resolveMediaUrl: () => null });
    const second = renderMarkdown(CONTENT_VERSION, input, { resolveMediaUrl: () => null });

    expect(second).toBe(first);
    expect(input).toEqual(before);
    expect(first).toBe("- [x] Done\n\n| Key |\n| --- |\n| Value |");
  });
});
