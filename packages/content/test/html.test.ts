import { describe, expect, it } from "vitest";
import { CONTENT_VERSION, ContentValidationError, renderHtml } from "../src/index";
import { canonicalContentDocument } from "./fixtures";

describe("HTML renderer", () => {
  it("renders an empty document as an empty fragment", () => {
    expect(
      renderHtml(
        CONTENT_VERSION,
        { type: "doc", content: [] },
        {
          resolveMediaUrl: () => null,
        },
      ),
    ).toBe("");
  });

  it("renders unchecked and checked task items with accessible deterministic markup", () => {
    const document = {
      type: "doc",
      content: [
        {
          type: "taskList",
          content: [
            {
              type: "taskItem",
              attrs: { checked: false },
              content: [{ type: "paragraph", content: [{ type: "text", text: "Buy milk" }] }],
            },
            {
              type: "taskItem",
              attrs: { checked: true },
              content: [{ type: "paragraph", content: [{ type: "text", text: "Ship release" }] }],
            },
          ],
        },
      ],
    } as const;

    expect(renderHtml(CONTENT_VERSION, document, { resolveMediaUrl: () => null })).toBe(
      '<ul class="task-list"><li class="task-item" data-checked="false"><input type="checkbox" disabled aria-label="Incomplete task"><div class="task-item-content"><p>Buy milk</p></div></li>\n<li class="task-item" data-checked="true"><input type="checkbox" checked disabled aria-label="Completed task"><div class="task-item-content"><p>Ship release</p></div></li></ul>',
    );
  });

  it("preserves nested task, list, quote, and code blocks inside task items", () => {
    const document = {
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
                {
                  type: "bulletList",
                  content: [
                    {
                      type: "listItem",
                      content: [
                        { type: "paragraph", content: [{ type: "text", text: "Bullet child" }] },
                        {
                          type: "orderedList",
                          attrs: { start: 2 },
                          content: [
                            {
                              type: "listItem",
                              content: [
                                {
                                  type: "paragraph",
                                  content: [{ type: "text", text: "Ordered child" }],
                                },
                              ],
                            },
                          ],
                        },
                        {
                          type: "taskList",
                          content: [
                            {
                              type: "taskItem",
                              attrs: { checked: true },
                              content: [
                                {
                                  type: "paragraph",
                                  content: [{ type: "text", text: "Nested task" }],
                                },
                              ],
                            },
                          ],
                        },
                        {
                          type: "blockquote",
                          content: [
                            {
                              type: "paragraph",
                              content: [{ type: "text", text: "Quoted child" }],
                            },
                          ],
                        },
                        {
                          type: "codeBlock",
                          attrs: { language: "typescript" },
                          content: [{ type: "text", text: "const value = 1;\n" }],
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

    expect(renderHtml(CONTENT_VERSION, document, { resolveMediaUrl: () => null })).toBe(
      '<ul class="task-list"><li class="task-item" data-checked="false"><input type="checkbox" disabled aria-label="Incomplete task"><div class="task-item-content"><p>Parent</p>\n<ul><li><p>Bullet child</p>\n<ol start="2"><li><p>Ordered child</p></li></ol>\n<ul class="task-list"><li class="task-item" data-checked="true"><input type="checkbox" checked disabled aria-label="Completed task"><div class="task-item-content"><p>Nested task</p></div></li></ul>\n<blockquote><p>Quoted child</p></blockquote>\n<pre><code class="language-typescript">const value = 1;\n</code></pre></li></ul></div></li></ul>',
    );
  });

  it("renders tables with semantic sections, scoped headers, and paragraph cells", () => {
    const cellAttrs = { colspan: 1, rowspan: 1, colwidth: null } as const;
    const document = {
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
                  attrs: cellAttrs,
                  content: [{ type: "paragraph", content: [{ type: "text", text: "Name" }] }],
                },
                {
                  type: "tableHeader",
                  attrs: cellAttrs,
                  content: [{ type: "paragraph", content: [{ type: "text", text: "Role" }] }],
                },
              ],
            },
            {
              type: "tableRow",
              content: [
                {
                  type: "tableCell",
                  attrs: cellAttrs,
                  content: [{ type: "paragraph", content: [{ type: "text", text: "Ada" }] }],
                },
                {
                  type: "tableCell",
                  attrs: cellAttrs,
                  content: [{ type: "paragraph", content: [{ type: "text", text: "Engineer" }] }],
                },
              ],
            },
            {
              type: "tableRow",
              content: [
                {
                  type: "tableCell",
                  attrs: cellAttrs,
                  content: [{ type: "paragraph", content: [{ type: "text", text: "Grace" }] }],
                },
                {
                  type: "tableCell",
                  attrs: cellAttrs,
                  content: [{ type: "paragraph", content: [{ type: "text", text: "Compiler" }] }],
                },
              ],
            },
          ],
        },
      ],
    } as const;

    expect(renderHtml(CONTENT_VERSION, document, { resolveMediaUrl: () => null })).toBe(
      '<table><thead><tr><th scope="col"><p>Name</p></th><th scope="col"><p>Role</p></th></tr></thead><tbody><tr><td><p>Ada</p></td><td><p>Engineer</p></td></tr>\n<tr><td><p>Grace</p></td><td><p>Compiler</p></td></tr></tbody></table>',
    );
  });

  it("escapes HTML-looking text and marks inside task and table content", () => {
    const cellAttrs = { colspan: 1, rowspan: 1, colwidth: null } as const;
    const document = {
      type: "doc",
      content: [
        {
          type: "taskList",
          content: [
            {
              type: "taskItem",
              attrs: { checked: false },
              content: [
                {
                  type: "paragraph",
                  content: [
                    {
                      type: "text",
                      text: '<img src=x onerror="alert(1)"> &',
                      marks: [
                        { type: "link", attrs: { href: "https://example.com/?a=1&b=2" } },
                        { type: "bold" },
                      ],
                    },
                  ],
                },
              ],
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
                  attrs: cellAttrs,
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "<script>alert(1)</script>" }],
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
                  attrs: cellAttrs,
                  content: [{ type: "paragraph", content: [{ type: "text", text: "</td>" }] }],
                },
              ],
            },
          ],
        },
      ],
    } as const;

    const output = renderHtml(CONTENT_VERSION, document, { resolveMediaUrl: () => null });

    expect(output).toBe(
      '<ul class="task-list"><li class="task-item" data-checked="false"><input type="checkbox" disabled aria-label="Incomplete task"><div class="task-item-content"><p><strong><a href="https://example.com/?a=1&amp;b=2" rel="noopener noreferrer">&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp;</a></strong></p></div></li></ul>\n<table><thead><tr><th scope="col"><p>&lt;script&gt;alert(1)&lt;/script&gt;</p></th></tr></thead><tbody><tr><td><p>&lt;/td&gt;</p></td></tr></tbody></table>',
    );
    expect(output).not.toContain("<script");
    expect(output).not.toContain("<img");
    expect(output).toContain("&lt;/td&gt;");
    expect(output).not.toContain("<p></td>");
  });

  it("rejects malformed task and table nodes before rendering", () => {
    const taskWithExtraAttr = {
      type: "doc",
      content: [
        {
          type: "taskList",
          content: [
            {
              type: "taskItem",
              attrs: { checked: false, extra: true },
              content: [{ type: "paragraph" }],
            },
          ],
        },
      ],
    } as const;
    const tableWithSpan = {
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
        },
      ],
    } as const;
    const options = { resolveMediaUrl: () => null };

    expect(() => renderHtml(CONTENT_VERSION, taskWithExtraAttr, options)).toThrow(
      ContentValidationError,
    );
    expect(() => renderHtml(CONTENT_VERSION, tableWithSpan, options)).toThrow(
      ContentValidationError,
    );
  });

  it("renders task lists and tables deterministically without mutating frozen input", () => {
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
                  content: [{ type: "paragraph", content: [{ type: "text", text: "A" }] }],
                },
              ],
            },
            {
              type: "tableRow",
              content: [
                {
                  type: "tableCell",
                  attrs: { colspan: 1, rowspan: 1, colwidth: null },
                  content: [{ type: "paragraph", content: [{ type: "text", text: "1" }] }],
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

    const options = { resolveMediaUrl: () => null };
    const first = renderHtml(CONTENT_VERSION, input, options);
    const second = renderHtml(CONTENT_VERSION, input, options);

    expect(second).toBe(first);
    expect(input).toEqual(before);
  });

  it("renders every canonical v1 block, nested block, and inline mark in fixed order", () => {
    const expected = [
      '<p><strong><em><s><code><a href="https://example.com/article" rel="noopener noreferrer">HTML-looking data: &lt;script&gt;alert(1)&lt;/script&gt;</a></code></s></em></strong>\nnext plain</p>',
      "<h2>Heading</h2>",
      '<ul><li><p>Bullet</p>\n<p>Continuation</p>\n<ol start="3"><li><p>Nested</p></li></ol>\n<blockquote><p>Quoted</p></blockquote>\n<pre><code class="language-typescript">const value = 1;\n</code></pre></li></ul>',
      "<blockquote><p>A quote</p>\n<h3>A quoted heading</h3>\n<pre><code>plain code</code></pre>\n<hr></blockquote>",
      '<figure><img src="/media/018f0f7b-7b6d-7a2e-8f4e-3f1c8d5e9a10/original" alt="A sample image" loading="lazy" decoding="async"><figcaption>A caption</figcaption></figure>',
      '<a class="link-card" href="https://example.com/bookmark" rel="noopener noreferrer"><span class="link-card-title">Example</span></a>',
      '<a class="link-card provider-youtube" href="https://www.youtube.com/watch?v=dQw4w9WgXcQ" rel="noopener noreferrer"><span class="link-card-title">YouTube video</span></a>',
      '<a class="link-card provider-bluesky" href="https://bsky.app/profile/alice.bsky.social/post/3k2a4r5x7zq2" rel="noopener noreferrer"><span class="link-card-title">Bluesky post</span></a>',
      '<a class="link-card provider-x" href="https://x.com/alice_1/status/1234567890" rel="noopener noreferrer"><span class="link-card-title">X post</span></a>',
      '<aside class="callout callout-warning" role="note"><p>Take care.</p>\n<p>This is important.</p></aside>',
      "<hr>",
    ].join("\n");

    expect(
      renderHtml(CONTENT_VERSION, canonicalContentDocument, {
        resolveMediaUrl: (mediaId) => `/media/${mediaId}/original`,
      }),
    ).toBe(expected);
  });

  it("escapes text, link-card fields, image fields, and resolved media URLs", () => {
    const mediaId = "018f0f7b-7b6d-7a2e-8f4e-3f1c8d5e9a10";
    const document = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
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
    } as const;

    expect(
      renderHtml(CONTENT_VERSION, document, {
        resolveMediaUrl: () => "https://cdn.example.test/media?a=1&b=2",
      }),
    ).toBe(
      '<p><a href="https://example.com/?q=a&amp;v=%22" rel="noopener noreferrer">text &amp; &lt; &gt; &quot; &#39;</a></p>\n<figure><img src="https://cdn.example.test/media?a=1&amp;b=2" alt="alt &amp; &lt; &gt; &quot; &#39;" loading="lazy" decoding="async"><figcaption>caption &amp; &lt; &gt; &quot; &#39;</figcaption></figure>\n<a class="link-card" href="https://example.com/bookmark?a=1&amp;b=2" rel="noopener noreferrer"><span class="link-card-title">title &amp; &lt; &gt; &quot; &#39;</span><span class="link-card-description">description &amp; &lt; &gt; &quot; &#39;</span></a>',
    );
  });

  it("does not emit executable elements for HTML-looking text", () => {
    const output = renderHtml(
      CONTENT_VERSION,
      {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: '<script>alert(1)</script><iframe src="https://evil.test"></iframe>',
              },
            ],
          },
        ],
      },
      { resolveMediaUrl: () => null },
    );

    expect(output).toBe(
      "<p>&lt;script&gt;alert(1)&lt;/script&gt;&lt;iframe src=&quot;https://evil.test&quot;&gt;&lt;/iframe&gt;</p>",
    );
    expect(output).not.toContain("<script");
    expect(output).not.toContain("<iframe");
  });

  it("rejects unsafe media resolver output with a stable error", () => {
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

    expect(() =>
      renderHtml(CONTENT_VERSION, document, { resolveMediaUrl: () => "javascript:alert(1)" }),
    ).toThrow("Media URL resolver returned an unsafe URL");
    expect(() =>
      renderHtml(CONTENT_VERSION, document, {
        resolveMediaUrl: () => "https://user:pass@example.com/image",
      }),
    ).toThrow("Media URL resolver returned an unsafe URL");
    expect(() =>
      renderHtml(CONTENT_VERSION, document, { resolveMediaUrl: () => "//evil.example/image" }),
    ).toThrow("Media URL resolver returned an unsafe URL");
  });

  it("uses the injected resolver once per distinct media ID and renders unresolved images deterministically", () => {
    const firstId = "018f0f7b-7b6d-7a2e-8f4e-3f1c8d5e9a10";
    const secondId = "018f0f7b-7b6d-7a2e-8f4e-3f1c8d5e9a11";
    const document = {
      type: "doc",
      content: [
        { type: "image", attrs: { mediaId: firstId, alt: "first", caption: null } },
        { type: "image", attrs: { mediaId: firstId, alt: "again", caption: "caption" } },
        { type: "image", attrs: { mediaId: secondId, alt: "missing & <", caption: null } },
      ],
    } as const;
    const calls: string[] = [];

    const output = renderHtml(CONTENT_VERSION, document, {
      resolveMediaUrl: (mediaId) => {
        calls.push(mediaId);
        return mediaId === firstId ? "/media/first" : null;
      },
    });

    expect(calls).toEqual([firstId, secondId]);
    expect(output).toBe(
      '<figure><img src="/media/first" alt="first" loading="lazy" decoding="async"></figure>\n<figure><img src="/media/first" alt="again" loading="lazy" decoding="async"><figcaption>caption</figcaption></figure>\n<figure class="media-unavailable"><div class="media-placeholder" role="img" aria-label="missing &amp; &lt;">Image unavailable</div></figure>',
    );
  });

  it("rejects unsupported versions and malformed or unknown nodes through schema parsing", () => {
    const options = { resolveMediaUrl: () => null };
    expect(() => renderHtml(2, { type: "doc", content: [] }, options)).toThrow(
      ContentValidationError,
    );
    expect(() =>
      renderHtml(CONTENT_VERSION, { type: "doc", content: [{ type: "html", attrs: {} }] }, options),
    ).toThrow(ContentValidationError);
    expect(() =>
      renderHtml(
        CONTENT_VERSION,
        { type: "doc", content: [{ type: "paragraph", extra: "raw" }] },
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

    const options = { resolveMediaUrl: (mediaId: string) => `/media/${mediaId}` };
    const first = renderHtml(CONTENT_VERSION, input, options);
    const second = renderHtml(CONTENT_VERSION, input, options);

    expect(second).toBe(first);
    expect(input).toEqual(before);
  });
});
