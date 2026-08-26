// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StudioEditor, type StudioEditorHandle } from "../src/editor";
import { createEditorContent, type EditorContent } from "../src/editor-content";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function installJsdomGeometry() {
  const rect = {
    bottom: 20,
    height: 20,
    left: 0,
    right: 640,
    top: 0,
    width: 640,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect;

  Object.defineProperty(document, "elementFromPoint", {
    configurable: true,
    value: () => document.querySelector(".ProseMirror"),
  });
  Object.defineProperty(window, "scrollBy", {
    configurable: true,
    value: () => undefined,
  });
  Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => rect,
  });
  Object.defineProperty(HTMLElement.prototype, "getClientRects", {
    configurable: true,
    value: () => [rect],
  });
  Object.defineProperty(Range.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => rect,
  });
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    value: () => [rect],
  });
}

describe("StudioEditor", () => {
  it("mounts canonical JSON and exposes cloned imperative content", () => {
    const content = createEditorContent({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Draft" }] }],
    });
    const onChange = vi.fn();
    const editorRef = createRef<StudioEditorHandle>();
    render(<StudioEditor content={content} onChange={onChange} ref={editorRef} />);

    const proseMirror = document.querySelector<HTMLElement>(".ProseMirror");
    expect(proseMirror?.getAttribute("contenteditable")).toBe("true");
    expect(proseMirror?.textContent).toBe("Draft");

    const read = editorRef.current?.getContent();
    expect(read).toEqual(content);
    expect(read).not.toBe(content);
    expect(read?.content).not.toBe(content.content);

    editorRef.current?.setContent(
      createEditorContent({
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Updated" }] }],
      }),
    );

    expect(onChange).toHaveBeenCalled();
    expect(onChange.mock.lastCall?.[0]).toEqual(
      createEditorContent({
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Updated" }] }],
      }),
    );
  });

  it("fails explicitly when the top-level UI content shape is malformed", () => {
    const malformed = {
      contentVersion: 1,
      document: { type: "doc", content: [] },
    } as unknown as EditorContent;

    expect(() => render(<StudioEditor content={malformed} />)).toThrow(
      "Studio editor content normalization failed",
    );
  });

  it("normalizes link attrs from the mounted Tiptap JSON", () => {
    const editorRef = createRef<StudioEditorHandle>();
    render(
      <StudioEditor
        content={createEditorContent({
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "Docs",
                  marks: [
                    {
                      type: "link",
                      attrs: {
                        class: "author-supplied",
                        href: "https://example.test/docs",
                        rel: "author-supplied",
                        target: "_self",
                        title: "Author supplied",
                      },
                    },
                  ],
                },
              ],
            },
          ],
        })}
        ref={editorRef}
      />,
    );

    expect(editorRef.current?.getContent()).toEqual(
      createEditorContent({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "Docs",
                marks: [{ type: "link", attrs: { href: "https://example.test/docs" } }],
              },
            ],
          },
        ],
      }),
    );
    expect(editorRef.current?.getContent()).not.toHaveProperty("document");
  });

  it("preserves inline hard breaks from the mounted Tiptap JSON", () => {
    const editorRef = createRef<StudioEditorHandle>();
    render(
      <StudioEditor
        content={createEditorContent({
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: "before" },
                { type: "hardBreak" },
                { type: "text", text: "after" },
              ],
            },
          ],
        })}
        ref={editorRef}
      />,
    );

    expect(editorRef.current?.getContent()).toEqual(
      createEditorContent({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "before" },
              { type: "hardBreak" },
              { type: "text", text: "after" },
            ],
          },
        ],
      }),
    );
  });

  it("emits cloned versioned content for typed document changes", async () => {
    installJsdomGeometry();
    const content = createEditorContent({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Draft" }] }],
    });
    const onChange = vi.fn();
    const user = userEvent.setup();

    render(<StudioEditor content={content} onChange={onChange} />);
    const proseMirror = document.querySelector<HTMLElement>(".ProseMirror");
    if (!proseMirror) throw new Error("Editor content is missing");
    const text = proseMirror.querySelector("p")?.firstChild;
    if (!text) throw new Error("Editor text is missing");

    proseMirror.focus();
    const range = document.createRange();
    range.setStart(text, text.textContent?.length ?? 0);
    range.setEnd(text, text.textContent?.length ?? 0);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
    await new Promise((resolve) => window.setTimeout(resolve, 30));
    await user.type(proseMirror, "!");

    const emitted = onChange.mock.lastCall?.[0];
    expect(emitted).toMatchObject({
      contentVersion: 1,
      content: { type: "doc" },
    });
    expect(emitted).toEqual(
      createEditorContent({
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Draft!" }] }],
      }),
    );
    expect(emitted).not.toBe(content);
    expect(emitted?.content).not.toBe(content.content);
    expect(emitted?.content.content[0]).not.toBe(content.content.content[0]);
  });

  it("round-trips task items and canonical header-first tables", () => {
    const content = createEditorContent({
      type: "doc",
      content: [
        {
          type: "taskList",
          content: [
            {
              type: "taskItem",
              attrs: { checked: false },
              content: [{ type: "paragraph", content: [{ type: "text", text: "Ship" }] }],
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
    });
    const editorRef = createRef<StudioEditorHandle>();

    render(
      <StudioEditor content={createEditorContent({ type: "doc", content: [] })} ref={editorRef} />,
    );
    editorRef.current?.setContent(content);

    expect(editorRef.current?.getContent()).toEqual(content);
  });

  it("shows an icon-led formatting toolbar for a non-empty selection", async () => {
    installJsdomGeometry();
    const content = createEditorContent({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Draft" }] }],
    });
    const editorRef = createRef<StudioEditorHandle>();
    render(<StudioEditor content={content} ref={editorRef} />);
    const proseMirror = document.querySelector<HTMLElement>(".ProseMirror");
    if (!proseMirror) throw new Error("Editor content is missing");

    proseMirror.focus();
    const text = proseMirror.querySelector("p")?.firstChild;
    if (!text) throw new Error("Editor text is missing");
    const range = document.createRange();
    range.setStart(text, 4);
    range.setEnd(text, 5);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
    await new Promise((resolve) => window.setTimeout(resolve, 30));

    expect(screen.getByRole("toolbar", { name: "Formatting" })).toBeTruthy();
    for (const label of ["Bold", "Italic", "Strike", "Inline code", "Link"]) {
      expect(screen.getByRole("button", { name: label })).toBeTruthy();
    }

    fireEvent.click(screen.getByRole("button", { name: "Bold" }));

    expect(editorRef.current?.getContent()).toEqual(
      createEditorContent({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "Draf" },
              { type: "text", text: "t", marks: [{ type: "bold" }] },
            ],
          },
        ],
      }),
    );
  });

  it.each([
    ["Bold", "bold"],
    ["Italic", "italic"],
    ["Strike", "strike"],
    ["Inline code", "code"],
    ["Link", "link"],
  ] as const)("clicks the %s formatting command", async (label, markType) => {
    installJsdomGeometry();
    const content = createEditorContent({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Draft" }] }],
    });
    const editorRef = createRef<StudioEditorHandle>();
    const proseMirrorOnChange = vi.fn();
    render(<StudioEditor content={content} onChange={proseMirrorOnChange} ref={editorRef} />);
    const proseMirror = document.querySelector<HTMLElement>(".ProseMirror");
    if (!proseMirror) throw new Error("Editor content is missing");
    const text = proseMirror.querySelector("p")?.firstChild;
    if (!text) throw new Error("Editor text is missing");

    proseMirror.focus();
    const range = document.createRange();
    range.setStart(text, 4);
    range.setEnd(text, 5);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
    await new Promise((resolve) => window.setTimeout(resolve, 30));

    const button = screen.getByRole("button", { name: label });
    expect(button.textContent).toBe("");
    expect(button.querySelector("svg")).not.toBeNull();
    if (markType === "link") {
      vi.spyOn(window, "prompt").mockReturnValue("https://example.test/article");
    }
    fireEvent.click(button);

    const emitted = proseMirrorOnChange.mock.lastCall?.[0];
    expect(emitted).toMatchObject({ contentVersion: 1, content: { type: "doc" } });
    const marks = emitted?.content.content[0]?.content?.[1]?.marks;
    expect(marks?.[0]?.type).toBe(markType);
    if (markType === "link") {
      expect(marks?.[0]?.attrs).toMatchObject({ href: "https://example.test/article" });
    }
    expect(editorRef.current?.getContent()).toEqual(emitted);
  });

  it("opens a named slash menu after typing a slash", async () => {
    installJsdomGeometry();
    const user = userEvent.setup();
    const content = createEditorContent({ type: "doc", content: [] });

    render(<StudioEditor content={content} />);
    const proseMirror = document.querySelector<HTMLElement>(".ProseMirror");
    if (!proseMirror) throw new Error("Editor content is missing");

    proseMirror.focus();
    await user.type(proseMirror, "/");

    expect(screen.getByRole("listbox", { name: "Insert block" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Paragraph" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Table" })).toBeTruthy();

    const listbox = screen.getByRole("listbox", { name: "Insert block" });
    expect(listbox.getAttribute("aria-activedescendant")).toBe("studio-editor-slash-paragraph");
    fireEvent.keyDown(proseMirror, { key: "ArrowDown" });
    expect(listbox.getAttribute("aria-activedescendant")).toBe("studio-editor-slash-heading1");
    fireEvent.keyDown(proseMirror, { key: "ArrowUp" });
    expect(listbox.getAttribute("aria-activedescendant")).toBe("studio-editor-slash-paragraph");
    fireEvent.keyDown(proseMirror, { key: "Escape" });
    expect(screen.queryByRole("listbox", { name: "Insert block" })).toBeNull();
  });

  it("deletes a slash query and inserts a header-first simple table with Enter", async () => {
    installJsdomGeometry();
    const user = userEvent.setup();
    const editorRef = createRef<StudioEditorHandle>();
    const content = createEditorContent({
      type: "doc",
      content: [{ type: "paragraph" }],
    });

    render(<StudioEditor content={content} ref={editorRef} />);
    const proseMirror = document.querySelector<HTMLElement>(".ProseMirror");
    if (!proseMirror) throw new Error("Editor content is missing");

    proseMirror.focus();
    await user.type(proseMirror, "/table");
    expect(screen.getByRole("option", { name: "Table" })).toBeTruthy();
    fireEvent.keyDown(proseMirror, { key: "ArrowDown" });
    fireEvent.keyDown(proseMirror, { key: "Enter" });

    expect(screen.queryByRole("listbox", { name: "Insert block" })).toBeNull();
    expect(editorRef.current?.getContent()).toEqual(
      createEditorContent({
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
                    content: [{ type: "paragraph" }],
                  },
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
      }),
    );
  });

  it("keeps Markdown heading shortcuts for levels one through three", async () => {
    installJsdomGeometry();
    const user = userEvent.setup();

    for (const level of [1, 2, 3] as const) {
      const editorRef = createRef<StudioEditorHandle>();
      render(
        <StudioEditor
          content={createEditorContent({ type: "doc", content: [{ type: "paragraph" }] })}
          ref={editorRef}
        />,
      );
      const proseMirror = document.querySelector<HTMLElement>(".ProseMirror");
      if (!proseMirror) throw new Error("Editor content is missing");

      proseMirror.focus();
      await user.type(proseMirror, `${"#".repeat(level)} `);

      expect(editorRef.current?.getContent()).toEqual(
        createEditorContent({
          type: "doc",
          content: [{ type: "heading", attrs: { level } }],
        }),
      );
      cleanup();
    }
  });

  it.each([
    ["* ", "bulletList"],
    ["1. ", "orderedList"],
    ["[ ] ", "taskList"],
    ["- [ ] ", "taskList"],
    ["> ", "blockquote"],
    ["``` ", "codeBlock"],
    ["--- ", "horizontalRule"],
  ] as const)("transforms the Markdown shortcut %s", async (shortcut, expectedType) => {
    installJsdomGeometry();
    const user = userEvent.setup();
    const editorRef = createRef<StudioEditorHandle>();

    render(
      <StudioEditor
        content={createEditorContent({ type: "doc", content: [{ type: "paragraph" }] })}
        ref={editorRef}
      />,
    );
    const proseMirror = document.querySelector<HTMLElement>(".ProseMirror");
    if (!proseMirror) throw new Error("Editor content is missing");

    proseMirror.focus();
    if (shortcut === "[ ] " || shortcut === "- [ ] ") {
      if (shortcut.startsWith("-")) await user.type(proseMirror, "- ");
      await user.keyboard("{[}");
      await user.type(proseMirror, " ");
      await user.keyboard("{]}");
      await user.type(proseMirror, " ");
    } else {
      await user.type(proseMirror, shortcut);
    }

    expect(editorRef.current?.getContent().content.content[0]?.type).toBe(expectedType);
    cleanup();
  });
});
