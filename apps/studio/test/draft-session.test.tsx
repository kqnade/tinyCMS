// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";
import {
  type DraftSaveRequest,
  type DraftSessionOptions,
  useDraftSession,
} from "../src/draft-session";
import { createEditorContent, createEmptyEditorContent } from "../src/editor-content";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
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

function DraftSessionProbe(options: DraftSessionOptions) {
  const session = useDraftSession(options);
  const updatedBody = createEditorContent({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "Updated body" }] }],
  });

  return (
    <>
      <button type="button" onClick={() => session.setTitle("Updated title")}>
        Update title
      </button>
      <button type="button" onClick={() => session.setContent(updatedBody)}>
        Update body
      </button>
      <button type="button" onClick={() => void session.save()}>
        Save draft
      </button>
      <output aria-label="Session title">{session.title}</output>
      <output aria-label="Session body">
        {session.content.content.content[0]?.content?.[0]?.text}
      </output>
      <output aria-label="Session status">{session.saveState}</output>
    </>
  );
}

describe("draft session", () => {
  it("autosaves a dirty title with the canonical content and advances the draft version", async () => {
    const saveDraft = vi.fn(
      async (
        request: Parameters<NonNullable<ComponentProps<typeof App>["persistence"]>["saveDraft"]>[0],
      ) => ({
        ok: true as const,
        draftVersion: request.expectedDraftVersion + 1,
      }),
    );
    render(
      <App
        initialContent={createEmptyEditorContent()}
        initialDraftVersion={1}
        initialTitle="Initial title"
        persistence={{ saveDraft }}
        autosaveDelay={20}
      />,
    );

    const title = screen.getByRole("textbox", { name: "Title" });
    expect((title as HTMLInputElement).disabled).toBe(false);
    fireEvent.change(title, { target: { value: "Updated title" } });

    await waitFor(() => expect(saveDraft).toHaveBeenCalled());
    expect(saveDraft).toHaveBeenCalledWith({
      expectedDraftVersion: 1,
      title: "Updated title",
      contentVersion: 1,
      content: createEmptyEditorContent().content,
    });
    await waitFor(() =>
      expect(screen.getByRole("status").getAttribute("aria-label")).toBe("Saved"),
    );
  });

  it("forwards optional API fields with independent content and metadata clones", async () => {
    const initialContent = createEditorContent({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Draft" }] }],
    });
    const initialMetadata = {
      seo: { description: "A draft" },
      tags: ["writing"],
    };
    const saveDraft = vi.fn(async (_request: DraftSaveRequest) => ({
      ok: true as const,
      draftVersion: 2,
    }));

    render(
      <App
        initialContent={initialContent}
        initialDraftVersion={1}
        initialExcerpt={null}
        initialMetadata={initialMetadata}
        initialTitle="Initial title"
        persistence={{ saveDraft }}
        autosaveDelay={0}
      />,
    );

    fireEvent.change(screen.getByRole("textbox", { name: "Title" }), {
      target: { value: "Updated title" },
    });

    await waitFor(() => expect(saveDraft).toHaveBeenCalledTimes(1));
    expect(saveDraft).toHaveBeenCalledWith({
      expectedDraftVersion: 1,
      title: "Updated title",
      contentVersion: 1,
      content: initialContent.content,
      excerpt: null,
      metadata: initialMetadata,
    });

    const request = saveDraft.mock.calls[0]?.[0];
    const requestMetadata = request?.metadata as typeof initialMetadata | undefined;
    expect(request?.content).not.toBe(initialContent.content);
    expect(request?.content.content[0]).not.toBe(initialContent.content.content[0]);
    expect(requestMetadata).not.toBe(initialMetadata);
    expect(requestMetadata?.seo).not.toBe(initialMetadata.seo);
    expect(requestMetadata?.tags).not.toBe(initialMetadata.tags);
  });

  it("exposes saving while one request is pending and then reports saved", async () => {
    let resolveSave: ((result: { ok: true; draftVersion: number }) => void) | undefined;
    const saveDraft = vi.fn(
      () =>
        new Promise<{ ok: true; draftVersion: number }>((resolve) => {
          resolveSave = resolve;
        }),
    );

    render(<App initialDraftVersion={3} persistence={{ saveDraft }} autosaveDelay={0} />);

    fireEvent.change(screen.getByRole("textbox", { name: "Title" }), {
      target: { value: "Pending" },
    });

    await waitFor(() => expect(saveDraft).toHaveBeenCalled());
    expect(screen.getByRole("status").getAttribute("aria-label")).toBe("Saving");
    expect(saveDraft).toHaveBeenCalledTimes(1);

    resolveSave?.({ draftVersion: 4, ok: true });
    await waitFor(() =>
      expect(screen.getByRole("status").getAttribute("aria-label")).toBe("Saved"),
    );
  });

  it.each([
    ["a conflict", { code: "CONFLICT" as const, ok: false as const }, "Conflict"],
    ["a returned error", { code: "ERROR" as const, ok: false as const }, "Error"],
  ])("preserves the draft after %s and leaves Save retryable", async (_label, result, status) => {
    const saveDraft = vi.fn(async (_request: DraftSaveRequest) => result);

    render(
      <App
        initialContent={createEmptyEditorContent()}
        initialTitle="Keep this title"
        persistence={{ saveDraft }}
        autosaveDelay={0}
      />,
    );

    fireEvent.change(screen.getByRole("textbox", { name: "Title" }), {
      target: { value: "Keep this title, edited" },
    });

    await waitFor(() => expect(screen.getByRole("status").getAttribute("aria-label")).toBe(status));
    expect(screen.getByRole("textbox", { name: "Title" }).getAttribute("value")).toBe(
      "Keep this title, edited",
    );
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it.each([
    ["a conflict", { code: "CONFLICT" as const, ok: false as const }, "conflict"],
    ["a returned error", { code: "ERROR" as const, ok: false as const }, "error"],
  ])("retains title and body after %s", async (_label, result, status) => {
    const saveDraft = vi.fn(async (_request: DraftSaveRequest) => result);

    render(<DraftSessionProbe persistence={{ saveDraft }} autosaveDelay={0} />);
    fireEvent.click(screen.getByRole("button", { name: "Update title" }));
    fireEvent.click(screen.getByRole("button", { name: "Update body" }));

    await waitFor(() => expect(saveDraft).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByRole("status", { name: "Session status" }).textContent).toBe(status),
    );
    expect(screen.getByRole("status", { name: "Session title" }).textContent).toBe("Updated title");
    expect(screen.getByRole("status", { name: "Session body" }).textContent).toBe("Updated body");
  });

  it("keeps a stale conflict explicit without retrying the stale version", async () => {
    let resolveSave: ((result: { ok: false; code: "CONFLICT" }) => void) | undefined;
    const saveDraft = vi.fn(
      (_request: DraftSaveRequest) =>
        new Promise<{ ok: false; code: "CONFLICT" }>((resolve) => {
          resolveSave = resolve;
        }),
    );

    render(<App persistence={{ saveDraft }} autosaveDelay={0} />);
    const title = screen.getByRole("textbox", { name: "Title" });
    fireEvent.change(title, { target: { value: "First" } });
    await waitFor(() => expect(saveDraft).toHaveBeenCalledTimes(1));

    fireEvent.change(title, { target: { value: "Newer" } });
    resolveSave?.({ code: "CONFLICT", ok: false });

    await waitFor(() =>
      expect(screen.getByRole("status").getAttribute("aria-label")).toBe("Conflict"),
    );
    expect(title.getAttribute("value")).toBe("Newer");
    expect(saveDraft).toHaveBeenCalledTimes(1);
  });

  it("turns a thrown persistence failure into a retryable error", async () => {
    const saveDraft = vi.fn(async (_request: DraftSaveRequest) => {
      throw new Error("network unavailable");
    });

    render(<App persistence={{ saveDraft }} autosaveDelay={0} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Title" }), {
      target: { value: "Retain me" },
    });

    await waitFor(() =>
      expect(screen.getByRole("status").getAttribute("aria-label")).toBe("Error"),
    );
    expect(screen.getByRole("textbox", { name: "Title" }).getAttribute("value")).toBe("Retain me");
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it("retains title and body after a thrown persistence failure", async () => {
    const saveDraft = vi.fn(async (_request: DraftSaveRequest) => {
      throw new Error("network unavailable");
    });

    render(<DraftSessionProbe persistence={{ saveDraft }} autosaveDelay={0} />);
    fireEvent.click(screen.getByRole("button", { name: "Update title" }));
    fireEvent.click(screen.getByRole("button", { name: "Update body" }));

    await waitFor(() =>
      expect(screen.getByRole("status", { name: "Session status" }).textContent).toBe("error"),
    );
    expect(screen.getByRole("status", { name: "Session title" }).textContent).toBe("Updated title");
    expect(screen.getByRole("status", { name: "Session body" }).textContent).toBe("Updated body");
  });

  it.each([0, -1, 1.5])("rejects an invalid initial draft version %s", (draftVersion) => {
    expect(() => render(<App initialDraftVersion={draftVersion} />)).toThrow(
      "Initial draftVersion must be a positive integer",
    );
  });

  it("does not accept an invalid successful version or add revision data", async () => {
    const saveDraft = vi.fn(async (_request: DraftSaveRequest) => ({
      ok: true as const,
      draftVersion: 9,
    }));

    render(<App initialDraftVersion={4} persistence={{ saveDraft }} autosaveDelay={0} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Title" }), {
      target: { value: "Version check" },
    });

    await waitFor(() =>
      expect(screen.getByRole("status").getAttribute("aria-label")).toBe("Error"),
    );
    expect(Object.hasOwn(saveDraft.mock.calls[0]?.[0] ?? {}, "revision")).toBe(false);
    expect(screen.getByRole("status").getAttribute("data-save-state")).toBe("error");
  });

  it("flushes manually and autosaves edits made during the pending request", async () => {
    const resolvers: Array<(result: { ok: true; draftVersion: number }) => void> = [];
    const saveDraft = vi.fn(
      (_request: DraftSaveRequest) =>
        new Promise<{ ok: true; draftVersion: number }>((resolve) => {
          resolvers.push(resolve);
        }),
    );

    render(<App persistence={{ saveDraft }} autosaveDelay={0} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Title" }), {
      target: { value: "First snapshot" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(saveDraft).toHaveBeenCalledTimes(1));
    expect(saveDraft.mock.calls[0]?.[0]).toMatchObject({
      expectedDraftVersion: 1,
      title: "First snapshot",
    });

    fireEvent.change(screen.getByRole("textbox", { name: "Title" }), {
      target: { value: "Newer snapshot" },
    });
    expect(screen.getByRole("status").getAttribute("aria-label")).toBe("Dirty");
    expect(screen.getByRole("textbox", { name: "Title" }).getAttribute("value")).toBe(
      "Newer snapshot",
    );

    resolvers[0]?.({ draftVersion: 2, ok: true });
    await waitFor(() => expect(saveDraft).toHaveBeenCalledTimes(2));
    expect(saveDraft.mock.calls[1]?.[0]).toMatchObject({
      expectedDraftVersion: 2,
      title: "Newer snapshot",
    });

    resolvers[1]?.({ draftVersion: 3, ok: true });
    await waitFor(() =>
      expect(screen.getByRole("status").getAttribute("aria-label")).toBe("Saved"),
    );
  });

  it("preserves unsaved title and body across an equivalent initial-prop rerender", async () => {
    const initialContent = createEmptyEditorContent();
    const user = userEvent.setup();
    installJsdomGeometry();
    const view = render(
      <App initialContent={initialContent} initialTitle="Initial" initialDraftVersion={1} />,
    );

    fireEvent.change(screen.getByRole("textbox", { name: "Title" }), {
      target: { value: "Local title" },
    });
    await user.type(screen.getByRole("textbox", { name: "Body" }), "Local body");

    view.rerender(
      <App
        initialContent={createEmptyEditorContent()}
        initialTitle="Initial"
        initialDraftVersion={1}
      />,
    );

    expect(screen.getByRole("textbox", { name: "Title" }).getAttribute("value")).toBe(
      "Local title",
    );
    expect(screen.getByRole("textbox", { name: "Body" }).textContent).toContain("Local body");
  });

  it("keeps the editor editable while unavailable commands stay disabled without persistence", () => {
    render(<App />);

    const title = screen.getByRole("textbox", { name: "Title" }) as HTMLInputElement;
    const body = screen.getByRole("textbox", { name: "Body" });
    expect(title.disabled).toBe(false);
    expect(body.getAttribute("contenteditable")).toBe("true");
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Publish" }) as HTMLButtonElement).disabled).toBe(
      true,
    );

    fireEvent.change(title, { target: { value: "Local" } });
    expect(screen.getByRole("status").getAttribute("aria-label")).toBe("Dirty");

    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    expect(screen.getByRole("button", { name: "Close menu" })).toBeTruthy();
    for (const label of ["Posts", "Media", "AI assist", "Settings"]) {
      expect((screen.getByRole("button", { name: label }) as HTMLButtonElement).disabled).toBe(
        true,
      );
    }
  });

  it("debounces autosave from the latest edit", async () => {
    const saveDraft = vi.fn(async (_request: DraftSaveRequest) => ({
      draftVersion: 2,
      ok: true as const,
    }));

    render(<App persistence={{ saveDraft }} autosaveDelay={50} />);
    const title = screen.getByRole("textbox", { name: "Title" });
    fireEvent.change(title, { target: { value: "First" } });
    await new Promise((resolve) => setTimeout(resolve, 35));
    fireEvent.change(title, { target: { value: "Latest" } });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(saveDraft.mock.calls.length).toBe(0);

    await waitFor(() => expect(saveDraft.mock.calls.length).toBe(1));
    expect(saveDraft.mock.calls[0]?.[0]).toMatchObject({ title: "Latest" });
  });

  it("waits exactly 2000 milliseconds after the latest edit by default", async () => {
    vi.useFakeTimers();
    const saveDraft = vi.fn(async (request: DraftSaveRequest) => ({
      draftVersion: request.expectedDraftVersion + 1,
      ok: true as const,
    }));

    render(<App persistence={{ saveDraft }} />);
    const title = screen.getByRole("textbox", { name: "Title" });
    fireEvent.change(title, { target: { value: "First" } });

    await vi.advanceTimersByTimeAsync(1999);
    expect(saveDraft).not.toHaveBeenCalled();

    fireEvent.change(title, { target: { value: "Latest" } });
    await vi.advanceTimersByTimeAsync(1999);
    expect(saveDraft).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(saveDraft).toHaveBeenCalledTimes(1);
    expect(saveDraft.mock.calls[0]?.[0]).toMatchObject({ title: "Latest" });
  });

  it("flushes manual Save immediately and cancels its pending autosave", async () => {
    vi.useFakeTimers();
    let resolveSave: ((result: { draftVersion: number; ok: true }) => void) | undefined;
    const saveDraft = vi.fn(
      (request: DraftSaveRequest) =>
        new Promise<{ draftVersion: number; ok: true }>((resolve) => {
          resolveSave = () => resolve({ draftVersion: request.expectedDraftVersion + 1, ok: true });
        }),
    );

    render(<DraftSessionProbe persistence={{ saveDraft }} />);
    const baselineTimerCount = vi.getTimerCount();
    fireEvent.click(screen.getByRole("button", { name: "Update title" }));
    expect(vi.getTimerCount()).toBe(baselineTimerCount + 1);

    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await vi.advanceTimersByTimeAsync(0);

    expect(saveDraft).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(baselineTimerCount);

    await vi.advanceTimersByTimeAsync(2000);
    expect(saveDraft).toHaveBeenCalledTimes(1);

    resolveSave?.({ draftVersion: 2, ok: true });
    await vi.advanceTimersByTimeAsync(0);
  });

  it("reports an invalid version as an error even when a newer edit is pending", async () => {
    let resolveSave: ((result: { ok: true; draftVersion: number }) => void) | undefined;
    const saveDraft = vi.fn(
      (_request: DraftSaveRequest) =>
        new Promise<{ ok: true; draftVersion: number }>((resolve) => {
          resolveSave = resolve;
        }),
    );

    render(<App persistence={{ saveDraft }} autosaveDelay={0} />);
    const title = screen.getByRole("textbox", { name: "Title" });
    fireEvent.change(title, { target: { value: "First" } });
    await waitFor(() => expect(saveDraft).toHaveBeenCalledTimes(1));
    fireEvent.change(title, { target: { value: "Newer" } });

    resolveSave?.({ draftVersion: 99, ok: true });
    await waitFor(() =>
      expect(screen.getByRole("status").getAttribute("aria-label")).toBe("Error"),
    );
    expect(screen.getByRole("textbox", { name: "Title" }).getAttribute("value")).toBe("Newer");
    expect(saveDraft).toHaveBeenCalledTimes(1);
  });

  it("marks a body-only edit dirty and persists its canonical content", async () => {
    installJsdomGeometry();
    const saveDraft = vi.fn(async (_request: DraftSaveRequest) => ({
      draftVersion: 2,
      ok: true as const,
    }));
    const user = userEvent.setup();
    render(<App persistence={{ saveDraft }} autosaveDelay={25} />);

    const body = screen.getByRole("textbox", { name: "Body" });
    await user.type(body, "Body text");
    expect(screen.getByRole("status").getAttribute("aria-label")).toBe("Dirty");

    await waitFor(() => expect(saveDraft).toHaveBeenCalledTimes(1));
    expect(saveDraft.mock.calls[0]?.[0]).toMatchObject({
      expectedDraftVersion: 1,
      title: "",
      contentVersion: 1,
      content: {
        content: [{ type: "paragraph", content: [{ type: "text", text: "Body text" }] }],
        type: "doc",
      },
    });
  });

  it("persists the mounted editor JSON through the canonical outbound route", async () => {
    installJsdomGeometry();
    const initialContent = createEditorContent({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Lead" }] },
        {
          type: "orderedList",
          attrs: { start: 3, type: null },
          content: [
            {
              type: "listItem",
              content: [{ type: "paragraph", content: [{ type: "text", text: "Numbered" }] }],
            },
          ],
        },
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Linked",
              marks: [
                {
                  type: "link",
                  attrs: {
                    href: "https://example.test/docs",
                    rel: "author-supplied",
                    target: "_blank",
                  },
                },
              ],
            },
          ],
        },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "before" },
            { type: "hardBreak" },
            { type: "text", text: "after" },
          ],
        },
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
                  content: [{ type: "paragraph", content: [{ type: "text", text: "Engineer" }] }],
                },
              ],
            },
          ],
        },
      ],
    });
    const saveDraft = vi.fn(async (request: DraftSaveRequest) => ({
      draftVersion: request.expectedDraftVersion + 1,
      ok: true as const,
    }));
    const user = userEvent.setup();

    render(
      <App
        initialContent={initialContent}
        initialDraftVersion={1}
        persistence={{ saveDraft }}
        autosaveDelay={0}
      />,
    );

    const body = screen.getByRole("textbox", { name: "Body" });
    const proseMirror = body as HTMLElement;
    const leadText = proseMirror.querySelector("p")?.firstChild;
    if (!leadText) throw new Error("Lead paragraph is missing");

    proseMirror.focus();
    const leadRange = document.createRange();
    leadRange.setStart(leadText, 0);
    leadRange.setEnd(leadText, leadText.textContent?.length ?? 0);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(leadRange);
    document.dispatchEvent(new Event("selectionchange"));
    fireEvent.mouseUp(proseMirror);
    await new Promise((resolve) => window.setTimeout(resolve, 30));
    vi.spyOn(window, "prompt").mockReturnValue("javascript:alert(1)");
    fireEvent.click(screen.getByRole("button", { name: "Link" }));
    expect(saveDraft).not.toHaveBeenCalled();

    const link = proseMirror.querySelector("a");
    expect(link?.getAttribute("href")).toBe("https://example.test/docs");

    proseMirror.focus();
    const cursorRange = document.createRange();
    cursorRange.setStart(leadText, leadText.textContent?.length ?? 0);
    cursorRange.setEnd(leadText, leadText.textContent?.length ?? 0);
    selection?.removeAllRanges();
    selection?.addRange(cursorRange);
    document.dispatchEvent(new Event("selectionchange"));
    await user.keyboard("!");

    await waitFor(() => expect(saveDraft).toHaveBeenCalledTimes(1));
    expect(saveDraft.mock.calls[0]?.[0]).toEqual({
      expectedDraftVersion: 1,
      title: "",
      contentVersion: 1,
      content: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Lead!" }] },
          {
            type: "orderedList",
            attrs: { start: 3 },
            content: [
              {
                type: "listItem",
                content: [{ type: "paragraph", content: [{ type: "text", text: "Numbered" }] }],
              },
            ],
          },
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "Linked",
                marks: [{ type: "link", attrs: { href: "https://example.test/docs" } }],
              },
            ],
          },
          {
            type: "paragraph",
            content: [
              { type: "text", text: "before" },
              { type: "hardBreak" },
              { type: "text", text: "after" },
            ],
          },
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
                    content: [{ type: "paragraph", content: [{ type: "text", text: "Engineer" }] }],
                  },
                ],
              },
            ],
          },
        ],
      },
    });
  });
});
