// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { createEmptyEditorContent } from "../src/editor-content";

type SaveDraftRequest = Parameters<
  NonNullable<ComponentProps<typeof App>["persistence"]>["saveDraft"]
>[0];

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
      title: "Updated title",
      content: createEmptyEditorContent(),
      expectedDraftVersion: 1,
    });
    await waitFor(() =>
      expect(screen.getByRole("status").getAttribute("aria-label")).toBe("Saved"),
    );
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
    const saveDraft = vi.fn(async (_request: SaveDraftRequest) => result);

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

  it("keeps a stale conflict explicit without retrying the stale version", async () => {
    let resolveSave: ((result: { ok: false; code: "CONFLICT" }) => void) | undefined;
    const saveDraft = vi.fn(
      (_request: SaveDraftRequest) =>
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
    const saveDraft = vi.fn(async (_request: SaveDraftRequest) => {
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

  it.each([0, -1, 1.5])("rejects an invalid initial draft version %s", (draftVersion) => {
    expect(() => render(<App initialDraftVersion={draftVersion} />)).toThrow(
      "Initial draftVersion must be a positive integer",
    );
  });

  it("does not accept an invalid successful version or add revision data", async () => {
    const saveDraft = vi.fn(async (_request: SaveDraftRequest) => ({
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
      (_request: SaveDraftRequest) =>
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
    const saveDraft = vi.fn(async (_request: SaveDraftRequest) => ({
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

  it("reports an invalid version as an error even when a newer edit is pending", async () => {
    let resolveSave: ((result: { ok: true; draftVersion: number }) => void) | undefined;
    const saveDraft = vi.fn(
      (_request: SaveDraftRequest) =>
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

  it("marks a body-only edit dirty and persists its canonical document", async () => {
    installJsdomGeometry();
    const saveDraft = vi.fn(async (_request: SaveDraftRequest) => ({
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
      content: {
        contentVersion: 1,
        document: {
          content: [{ type: "paragraph", content: [{ type: "text", text: "Body text" }] }],
          type: "doc",
        },
      },
      expectedDraftVersion: 1,
      title: "",
    });
  });
});
