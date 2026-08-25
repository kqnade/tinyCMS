export const validContentDocument = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "HTML-looking data: <script>alert(1)</script>",
          marks: [
            { type: "link", attrs: { href: "https://example.com/article" } },
            { type: "code" },
            { type: "strike" },
            { type: "italic" },
            { type: "bold" },
          ],
        },
        { type: "text", text: "\r\nnext plain" },
      ],
    },
    {
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "Heading" }],
    },
    {
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "Bullet" }] },
            { type: "paragraph", content: [{ type: "text", text: "Continuation" }] },
            {
              type: "orderedList",
              attrs: { start: 3 },
              content: [
                {
                  type: "listItem",
                  content: [{ type: "paragraph", content: [{ type: "text", text: "Nested" }] }],
                },
              ],
            },
            {
              type: "blockquote",
              content: [{ type: "paragraph", content: [{ type: "text", text: "Quoted" }] }],
            },
            {
              type: "codeBlock",
              attrs: { language: "typescript" },
              content: [{ type: "text", text: "const value = 1;\r\n" }],
            },
          ],
        },
      ],
    },
    {
      type: "blockquote",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "A quote" }] },
        {
          type: "heading",
          attrs: { level: 3 },
          content: [{ type: "text", text: "A quoted heading" }],
        },
        {
          type: "codeBlock",
          attrs: { language: null },
          content: [{ type: "text", text: "plain code" }],
        },
        { type: "horizontalRule" },
      ],
    },
    {
      type: "image",
      attrs: {
        mediaId: "018f0f7b-7b6d-7a2e-8f4e-3f1c8d5e9a10",
        alt: "A sample image",
        caption: "A caption",
      },
    },
    {
      type: "bookmark",
      attrs: {
        href: "https://example.com/bookmark",
        title: "Example",
        description: null,
      },
    },
    { type: "youtube", attrs: { videoId: "dQw4w9WgXcQ" } },
    {
      type: "bluesky",
      attrs: { profile: "alice.bsky.social", postId: "3k2a4r5x7zq2" },
    },
    { type: "x", attrs: { username: "alice_1", postId: "1234567890" } },
    {
      type: "callout",
      attrs: { kind: "warning" },
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Take care." }] },
        { type: "paragraph", content: [{ type: "text", text: "This is important." }] },
      ],
    },
    { type: "horizontalRule" },
  ],
} as const;

export const canonicalContentDocument = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "HTML-looking data: <script>alert(1)</script>",
          marks: [
            { type: "bold" },
            { type: "italic" },
            { type: "strike" },
            { type: "code" },
            { type: "link", attrs: { href: "https://example.com/article" } },
          ],
        },
        { type: "text", text: "\nnext plain" },
      ],
    },
    {
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "Heading" }],
    },
    {
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "Bullet" }] },
            { type: "paragraph", content: [{ type: "text", text: "Continuation" }] },
            {
              type: "orderedList",
              attrs: { start: 3 },
              content: [
                {
                  type: "listItem",
                  content: [{ type: "paragraph", content: [{ type: "text", text: "Nested" }] }],
                },
              ],
            },
            {
              type: "blockquote",
              content: [{ type: "paragraph", content: [{ type: "text", text: "Quoted" }] }],
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
    {
      type: "blockquote",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "A quote" }] },
        {
          type: "heading",
          attrs: { level: 3 },
          content: [{ type: "text", text: "A quoted heading" }],
        },
        {
          type: "codeBlock",
          attrs: { language: null },
          content: [{ type: "text", text: "plain code" }],
        },
        { type: "horizontalRule" },
      ],
    },
    {
      type: "image",
      attrs: {
        mediaId: "018f0f7b-7b6d-7a2e-8f4e-3f1c8d5e9a10",
        alt: "A sample image",
        caption: "A caption",
      },
    },
    {
      type: "bookmark",
      attrs: {
        href: "https://example.com/bookmark",
        title: "Example",
        description: null,
      },
    },
    { type: "youtube", attrs: { videoId: "dQw4w9WgXcQ" } },
    {
      type: "bluesky",
      attrs: { profile: "alice.bsky.social", postId: "3k2a4r5x7zq2" },
    },
    { type: "x", attrs: { username: "alice_1", postId: "1234567890" } },
    {
      type: "callout",
      attrs: { kind: "warning" },
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Take care." }] },
        { type: "paragraph", content: [{ type: "text", text: "This is important." }] },
      ],
    },
    { type: "horizontalRule" },
  ],
} as const;
