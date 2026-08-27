// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ErrorCode,
  type PostDto,
  type PostListItemDto,
  type PostRevisionDto,
  type PostRevisionListItemDto,
} from "@tinycms/contracts";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { type EditorialApi, EditorialApiError, type MediaAsset } from "../src/editorial-api";

afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/");
  vi.restoreAllMocks();
});

const firstId = "018f0e5d-6a25-7b01-8f4a-7d62a5d3e401";
const secondId = "018f0e5d-6a25-7b01-8f4a-7d62a5d3e402";
const firstRevisionId = "018f0e5d-6a25-7b01-8f4a-7d62a5d3e403";

function post(
  id: string,
  title: string,
  body: string,
  draftVersion = 1,
  revisionVersion = 1,
): PostDto {
  return {
    content: {
      content: [{ content: [{ text: body, type: "text" }], type: "paragraph" }],
      type: "doc",
    },
    contentVersion: 1,
    createdAt: "2026-08-26T00:00:00.000Z",
    createdByAuthorId: firstId,
    currentRevisionVersion: revisionVersion,
    draftVersion,
    excerpt: null,
    id,
    lifecycle: "draft",
    metadata: {},
    slug: `${id}-slug`,
    title,
    updatedAt: "2026-08-26T00:00:00.000Z",
    updatedByAuthorId: firstId,
  };
}

function listItem(value: PostDto): PostListItemDto {
  return {
    createdAt: value.createdAt,
    createdByAuthorId: value.createdByAuthorId,
    currentRevisionVersion: value.currentRevisionVersion,
    draftVersion: value.draftVersion,
    excerpt: value.excerpt,
    id: value.id,
    lifecycle: value.lifecycle,
    slug: value.slug,
    title: value.title,
    updatedAt: value.updatedAt,
    updatedByAuthorId: value.updatedByAuthorId,
  };
}

const firstPost = post(firstId, "First post", "First body");
const secondPost = post(secondId, "Second post", "Second body");

function mediaAsset(
  id: string,
  filename: string,
  altText = "A media asset",
  version = 1,
): MediaAsset {
  return {
    altText,
    byteSize: 12_345,
    contentHash: `${id}-hash`,
    createdAt: "2026-08-26T00:00:00.000Z",
    createdBy: firstId,
    filename,
    height: 800,
    id,
    mediaType: "image/jpeg",
    state: "ready",
    updatedAt: "2026-08-26T00:00:00.000Z",
    variants: [],
    version,
    width: 1_200,
  };
}

const firstMedia = mediaAsset("018f0e5d-6a25-7b01-8f4a-7d62a5d3e410", "hero.jpg");

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

function revision(
  postId: string,
  id: string,
  title: string,
  revisionVersion: number,
): PostRevisionDto {
  return {
    authorId: firstId,
    content: { content: [], type: "doc" },
    contentVersion: 1,
    createdAt: "2026-08-26T00:00:00.000Z",
    excerpt: null,
    id,
    metadata: {},
    postId,
    revisionVersion,
    title,
  };
}

function createMockApi(overrides: Partial<EditorialApi> = {}): EditorialApi {
  return {
    checkpointRevision: vi.fn<EditorialApi["checkpointRevision"]>(async (postId, _request) => ({
      post: post(postId, "Checkpoint", "Checkpoint body", 2, 2),
      revision: revision(postId, firstRevisionId, "Checkpoint", 2),
    })),
    createPost: vi.fn(async () => post("018f0e5d-6a25-7b01-8f4a-7d62a5d3e404", "", "")),
    getPost: vi.fn(async (postId) => (postId === secondId ? secondPost : firstPost)),
    listPosts: vi.fn(async () => ({
      items: [listItem(firstPost), listItem(secondPost)],
      nextCursor: null,
    })),
    listMedia: vi.fn(async () => ({ items: [firstMedia], nextCursor: null })),
    getMedia: vi.fn(async () => firstMedia),
    getMediaOriginalUrl: vi.fn((mediaId) => `/api/v1/admin/media/${mediaId}/original`),
    uploadMedia: vi.fn(async () => firstMedia),
    updateMedia: vi.fn(async (_mediaId, request) => ({
      ...firstMedia,
      altText: request.altText,
      version: firstMedia.version + 1,
    })),
    deleteMedia: vi.fn(async () => ({ ...firstMedia, state: "trash" as const })),
    listRevisions: vi.fn<EditorialApi["listRevisions"]>(async (postId) => ({
      items: [
        {
          authorId: firstId,
          createdAt: "2026-08-26T00:00:00.000Z",
          excerpt: null,
          id: firstRevisionId,
          postId,
          revisionVersion: 1,
          title: "First post",
        },
      ],
      nextCursor: null,
    })),
    restoreRevision: vi.fn<EditorialApi["restoreRevision"]>(
      async (postId, _revisionId, _request) => ({
        post: post(postId, "Restored post", "Restored body", 2, 2),
        revision: revision(postId, "018f0e5d-6a25-7b01-8f4a-7d62a5d3e405", "Restored post", 2),
      }),
    ),
    saveDraft: vi.fn(async (postId, request) =>
      post(postId, request.title, "Saved body", request.expectedDraftVersion + 1, 1),
    ),
    ...overrides,
  };
}

async function openStudioMenu() {
  await waitFor(() => expect(screen.getByRole("button", { name: "Open menu" })).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
}

describe("Studio editorial workspace", () => {
  it("opens the Media panel through its enabled icon control", async () => {
    const api = createMockApi();
    render(<App api={api} />);
    await waitFor(() => expect(api.getPost).toHaveBeenCalledWith(firstId));

    await openStudioMenu();
    const mediaButton = screen.getByRole("button", { name: "Media" }) as HTMLButtonElement;
    expect(mediaButton.disabled).toBe(false);
    fireEvent.click(mediaButton);

    expect(screen.getByRole("region", { name: "Media" })).toBeTruthy();
  });

  it("opens the Media panel from the keyboard-reachable icon control", async () => {
    const api = createMockApi();
    const user = userEvent.setup();
    render(<App api={api} />);
    await waitFor(() => expect(api.getPost).toHaveBeenCalledWith(firstId));

    await openStudioMenu();
    const mediaButton = screen.getByRole("button", { name: "Media" });
    mediaButton.focus();
    await user.keyboard("{Enter}");

    expect(screen.getByRole("region", { name: "Media" })).toBeTruthy();
  });

  it("toggles the active Media icon closed", async () => {
    const api = createMockApi();
    render(<App api={api} />);
    await waitFor(() => expect(api.getPost).toHaveBeenCalledWith(firstId));

    await openStudioMenu();
    const mediaButton = screen.getByRole("button", { name: "Media" });
    fireEvent.click(mediaButton);
    expect(screen.getByRole("region", { name: "Media" })).toBeTruthy();

    fireEvent.click(mediaButton);
    await waitFor(() =>
      expect(screen.getByLabelText("Menu", { selector: "aside" }).hasAttribute("hidden")).toBe(
        true,
      ),
    );
  });

  it("shows only ready media with authenticated originals and compact metadata", async () => {
    const pendingMedia = {
      ...firstMedia,
      id: "018f0e5d-6a25-7b01-8f4a-7d62a5d3e411",
      state: "pending" as const,
      filename: "pending.jpg",
    };
    const listMedia = vi.fn<EditorialApi["listMedia"]>(async () => ({
      items: [firstMedia, pendingMedia],
      nextCursor: null,
    }));
    const api = createMockApi({ listMedia });
    render(<App api={api} />);
    await waitFor(() => expect(api.getPost).toHaveBeenCalledWith(firstId));

    await openStudioMenu();
    fireEvent.click(screen.getByRole("button", { name: "Media" }));

    await waitFor(() => expect(listMedia).toHaveBeenCalledWith({ limit: 20 }));
    expect(screen.getByRole("button", { name: "Select media hero.jpg" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Select media pending.jpg" })).toBeNull();
    expect(
      screen
        .getByRole("button", { name: "Select media hero.jpg" })
        .querySelector("img")
        ?.getAttribute("src"),
    ).toBe(`/api/v1/admin/media/${firstMedia.id}/original`);
    expect(screen.getByText("1,200 × 800 · 12.1 KB")).toBeTruthy();
  });

  it("closes the open panel from the keyboard Escape action", async () => {
    const api = createMockApi();
    render(<App api={api} />);
    await waitFor(() => expect(api.getPost).toHaveBeenCalledWith(firstId));

    await openStudioMenu();
    fireEvent.click(screen.getByRole("button", { name: "Media" }));
    expect(screen.getByRole("region", { name: "Media" })).toBeTruthy();

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(screen.getByRole("button", { name: "Open menu" })).toBeTruthy());
    expect(screen.getByLabelText("Menu", { selector: "aside" }).hasAttribute("hidden")).toBe(true);
  });

  it("loads the next media cursor page and appends its ready assets", async () => {
    const secondMedia = mediaAsset(
      "018f0e5d-6a25-7b01-8f4a-7d62a5d3e412",
      "detail.png",
      "Detail image",
    );
    const listMedia = vi.fn<EditorialApi["listMedia"]>(async (query) =>
      query?.cursor === "next-media"
        ? { items: [secondMedia], nextCursor: null }
        : { items: [firstMedia], nextCursor: "next-media" },
    );
    const api = createMockApi({ listMedia });
    render(<App api={api} />);
    await waitFor(() => expect(api.getPost).toHaveBeenCalledWith(firstId));

    await openStudioMenu();
    fireEvent.click(screen.getByRole("button", { name: "Media" }));
    await waitFor(() => expect(listMedia).toHaveBeenCalledWith({ limit: 20 }));

    fireEvent.click(screen.getByRole("button", { name: "Load more media" }));
    await waitFor(() =>
      expect(listMedia).toHaveBeenCalledWith({ cursor: "next-media", limit: 20 }),
    );
    expect(screen.getByRole("button", { name: "Select media detail.png" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Load more media" })).toBeNull();
  });

  it("uploads a supported image from the hidden picker and selects the returned asset", async () => {
    const uploadedMedia = mediaAsset(
      "018f0e5d-6a25-7b01-8f4a-7d62a5d3e413",
      "uploaded.webp",
      "",
      1,
    );
    const uploadMedia = vi.fn<EditorialApi["uploadMedia"]>(async () => uploadedMedia);
    const api = createMockApi({ uploadMedia });
    const user = userEvent.setup();
    render(<App api={api} />);
    await waitFor(() => expect(api.getPost).toHaveBeenCalledWith(firstId));

    await openStudioMenu();
    fireEvent.click(screen.getByRole("button", { name: "Media" }));
    await waitFor(() => expect(api.listMedia).toHaveBeenCalledWith({ limit: 20 }));

    const file = new File(["webp bytes"], "uploaded.webp", { type: "image/webp" });
    await user.upload(screen.getByLabelText("Choose media file"), file);

    await waitFor(() => expect(uploadMedia).toHaveBeenCalledWith(file));
    await waitFor(() =>
      expect(
        screen
          .getByRole("button", { name: "Select media uploaded.webp" })
          .getAttribute("aria-pressed"),
      ).toBe("true"),
    );
  });

  it("retains the selected asset and chosen file context when upload fails", async () => {
    const uploadMedia = vi.fn<EditorialApi["uploadMedia"]>(async () => {
      throw new Error("network unavailable");
    });
    const api = createMockApi({ uploadMedia });
    const user = userEvent.setup();
    render(<App api={api} />);
    await waitFor(() => expect(api.getPost).toHaveBeenCalledWith(firstId));

    await openStudioMenu();
    fireEvent.click(screen.getByRole("button", { name: "Media" }));
    await waitFor(() => expect(api.listMedia).toHaveBeenCalledWith({ limit: 20 }));
    fireEvent.click(screen.getByRole("button", { name: "Select media hero.jpg" }));

    const file = new File(["png bytes"], "failed.png", { type: "image/png" });
    const input = screen.getByLabelText("Choose media file") as HTMLInputElement;
    await user.upload(input, file);

    await waitFor(() => expect(uploadMedia).toHaveBeenCalledWith(file));
    expect(screen.getByRole("alert").textContent).toContain("upload");
    expect(
      screen.getByRole("button", { name: "Select media hero.jpg" }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(screen.getByRole("status", { name: "Selected file failed.png" })).toBeTruthy();
    expect(input.files?.[0]).toBe(file);
  });

  it("rejects unsupported upload files while retaining their chosen context", async () => {
    const uploadMedia = vi.fn<EditorialApi["uploadMedia"]>(async () => firstMedia);
    const api = createMockApi({ uploadMedia });
    render(<App api={api} />);
    await waitFor(() => expect(api.getPost).toHaveBeenCalledWith(firstId));

    await openStudioMenu();
    fireEvent.click(screen.getByRole("button", { name: "Media" }));
    await waitFor(() => expect(api.listMedia).toHaveBeenCalledWith({ limit: 20 }));

    const file = new File(["gif bytes"], "unsupported.gif", { type: "image/gif" });
    const input = screen.getByLabelText("Choose media file") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    expect(uploadMedia).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("JPEG"));
    expect(screen.getByRole("status", { name: "Selected file unsupported.gif" })).toBeTruthy();
    expect(input.files?.[0]).toBe(file);
  });

  it("persists blank alt text with the selected asset version", async () => {
    const saved = { ...firstMedia, altText: "", version: 2 };
    const updateMedia = vi.fn<EditorialApi["updateMedia"]>(async () => saved);
    const api = createMockApi({ updateMedia });
    render(<App api={api} />);
    await waitFor(() => expect(api.getPost).toHaveBeenCalledWith(firstId));

    await openStudioMenu();
    fireEvent.click(screen.getByRole("button", { name: "Media" }));
    await waitFor(() => expect(api.listMedia).toHaveBeenCalledWith({ limit: 20 }));
    fireEvent.click(screen.getByRole("button", { name: "Select media hero.jpg" }));

    const alt = screen.getByRole("textbox", { name: "Alt text" }) as HTMLInputElement;
    fireEvent.change(alt, { target: { value: "" } });
    fireEvent.blur(alt);

    await waitFor(() =>
      expect(updateMedia).toHaveBeenCalledWith(firstMedia.id, {
        expectedVersion: 1,
        altText: "",
      }),
    );
    expect(alt.value).toBe("");
  });

  it("preserves an edited alt value when its save conflicts", async () => {
    const updateMedia = vi.fn<EditorialApi["updateMedia"]>(async () => {
      throw new EditorialApiError(409, ErrorCode.CONFLICT);
    });
    const api = createMockApi({ updateMedia });
    render(<App api={api} />);
    await waitFor(() => expect(api.getPost).toHaveBeenCalledWith(firstId));

    await openStudioMenu();
    fireEvent.click(screen.getByRole("button", { name: "Media" }));
    await waitFor(() => expect(api.listMedia).toHaveBeenCalledWith({ limit: 20 }));
    fireEvent.click(screen.getByRole("button", { name: "Select media hero.jpg" }));

    const alt = screen.getByRole("textbox", { name: "Alt text" }) as HTMLInputElement;
    fireEvent.change(alt, { target: { value: "Keep this alt" } });
    fireEvent.blur(alt);

    await waitFor(() => expect(updateMedia).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("conflict"));
    expect(alt.value).toBe("Keep this alt");
  });

  it("waits to insert until edited alt text is saved", async () => {
    let resolveUpdate: ((asset: MediaAsset) => void) | undefined;
    const updateMedia = vi.fn<EditorialApi["updateMedia"]>(
      () =>
        new Promise((resolve) => {
          resolveUpdate = resolve;
        }),
    );
    const api = createMockApi({ updateMedia });
    render(<App api={api} autosaveDelay={60_000} />);
    await waitFor(() => expect(api.getPost).toHaveBeenCalledWith(firstId));

    await openStudioMenu();
    fireEvent.click(screen.getByRole("button", { name: "Media" }));
    await waitFor(() => expect(api.listMedia).toHaveBeenCalledWith({ limit: 20 }));
    fireEvent.click(screen.getByRole("button", { name: "Select media hero.jpg" }));

    const alt = screen.getByRole("textbox", { name: "Alt text" });
    const insert = screen.getByRole("button", { name: "Insert image" }) as HTMLButtonElement;
    fireEvent.change(alt, { target: { value: "Saved before insertion" } });

    expect(insert.disabled).toBe(true);
    fireEvent.blur(alt);
    await waitFor(() => expect(updateMedia).toHaveBeenCalledTimes(1));
    expect(insert.disabled).toBe(true);

    resolveUpdate?.({ ...firstMedia, altText: "Saved before insertion", version: 2 });
    await waitFor(() => expect(insert.disabled).toBe(false));
  });

  it("inserts the selected asset as one canonical image at the editor boundary", async () => {
    const api = createMockApi();
    installJsdomGeometry();
    render(<App api={api} autosaveDelay={60_000} />);
    await waitFor(() => expect(api.getPost).toHaveBeenCalledWith(firstId));

    await openStudioMenu();
    fireEvent.click(screen.getByRole("button", { name: "Media" }));
    await waitFor(() => expect(api.listMedia).toHaveBeenCalledWith({ limit: 20 }));
    fireEvent.click(screen.getByRole("button", { name: "Select media hero.jpg" }));

    fireEvent.click(screen.getByRole("button", { name: "Insert image" }));

    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Body" }).querySelectorAll("figure")).toHaveLength(
        1,
      );
    });
    const image = screen.getByRole("textbox", { name: "Body" }).querySelector("figure img");
    expect(image?.getAttribute("src")).toBe(`/api/v1/admin/media/${firstMedia.id}/original`);
    expect(image?.getAttribute("alt")).toBe(firstMedia.altText);
    expect(screen.getByRole("textbox", { name: "Body" }).querySelector("figcaption")).toBeNull();
  });

  it("inserts the latest saved alt value after an optimistic media update", async () => {
    const saved = { ...firstMedia, altText: "Latest saved alt", version: 2 };
    const updateMedia = vi.fn<EditorialApi["updateMedia"]>(async () => saved);
    const api = createMockApi({ updateMedia });
    installJsdomGeometry();
    render(<App api={api} autosaveDelay={60_000} />);
    await waitFor(() => expect(api.getPost).toHaveBeenCalledWith(firstId));

    await openStudioMenu();
    fireEvent.click(screen.getByRole("button", { name: "Media" }));
    await waitFor(() => expect(api.listMedia).toHaveBeenCalledWith({ limit: 20 }));
    fireEvent.click(screen.getByRole("button", { name: "Select media hero.jpg" }));

    const alt = screen.getByRole("textbox", { name: "Alt text" }) as HTMLInputElement;
    fireEvent.change(alt, { target: { value: "Latest saved alt" } });
    fireEvent.blur(alt);
    await waitFor(() =>
      expect(updateMedia).toHaveBeenCalledWith(firstMedia.id, {
        expectedVersion: 1,
        altText: "Latest saved alt",
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Insert image" }));
    await waitFor(() =>
      expect(
        screen.getByRole("textbox", { name: "Body" }).querySelector("img")?.getAttribute("alt"),
      ).toBe("Latest saved alt"),
    );
  });

  it("trashes the selected media with its version and clears the selection", async () => {
    const deleteMedia = vi.fn<EditorialApi["deleteMedia"]>(async () => ({
      ...firstMedia,
      state: "trash",
    }));
    const api = createMockApi({ deleteMedia });
    render(<App api={api} />);
    await waitFor(() => expect(api.getPost).toHaveBeenCalledWith(firstId));

    await openStudioMenu();
    fireEvent.click(screen.getByRole("button", { name: "Media" }));
    await waitFor(() => expect(api.listMedia).toHaveBeenCalledWith({ limit: 20 }));
    fireEvent.click(screen.getByRole("button", { name: "Select media hero.jpg" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete media hero.jpg" }));

    await waitFor(() =>
      expect(deleteMedia).toHaveBeenCalledWith(firstMedia.id, { expectedVersion: 1 }),
    );
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Select media hero.jpg" })).toBeNull();
      expect(screen.queryByRole("textbox", { name: "Alt text" })).toBeNull();
    });
  });

  it("keeps selected media when trashing fails", async () => {
    const deleteMedia = vi.fn<EditorialApi["deleteMedia"]>(async () => {
      throw new EditorialApiError(409, ErrorCode.CONFLICT);
    });
    const api = createMockApi({ deleteMedia });
    render(<App api={api} />);
    await waitFor(() => expect(api.getPost).toHaveBeenCalledWith(firstId));

    await openStudioMenu();
    fireEvent.click(screen.getByRole("button", { name: "Media" }));
    await waitFor(() => expect(api.listMedia).toHaveBeenCalledWith({ limit: 20 }));
    fireEvent.click(screen.getByRole("button", { name: "Select media hero.jpg" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete media hero.jpg" }));

    await waitFor(() => expect(deleteMedia).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("conflict"));
    expect(
      screen.getByRole("button", { name: "Select media hero.jpg" }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(screen.getByRole("textbox", { name: "Alt text" })).toBeTruthy();
  });

  it("announces media loading and the empty ready state", async () => {
    let resolveMedia:
      | ((page: { items: MediaAsset[]; nextCursor: string | null }) => void)
      | undefined;
    const listMedia = vi.fn<EditorialApi["listMedia"]>(
      () =>
        new Promise((resolve) => {
          resolveMedia = resolve;
        }),
    );
    const api = createMockApi({ listMedia });
    render(<App api={api} />);
    await waitFor(() => expect(api.getPost).toHaveBeenCalledWith(firstId));

    await openStudioMenu();
    fireEvent.click(screen.getByRole("button", { name: "Media" }));
    await waitFor(() => expect(screen.getByRole("status", { name: "Loading media" })).toBeTruthy());

    resolveMedia?.({ items: [], nextCursor: null });
    await waitFor(() => expect(screen.getByRole("status", { name: "No media" })).toBeTruthy());
  });

  it("announces when the media list cannot be loaded", async () => {
    const listMedia = vi.fn<EditorialApi["listMedia"]>(async () => {
      throw new Error("media unavailable");
    });
    const api = createMockApi({ listMedia });
    render(<App api={api} />);
    await waitFor(() => expect(api.getPost).toHaveBeenCalledWith(firstId));

    await openStudioMenu();
    fireEvent.click(screen.getByRole("button", { name: "Media" }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("unavailable"));
  });

  it("prevents duplicate uploads while the first file is in flight", async () => {
    let resolveUpload: ((asset: MediaAsset) => void) | undefined;
    const uploadMedia = vi.fn<EditorialApi["uploadMedia"]>(
      () =>
        new Promise((resolve) => {
          resolveUpload = resolve;
        }),
    );
    const api = createMockApi({ uploadMedia });
    render(<App api={api} />);
    await waitFor(() => expect(api.getPost).toHaveBeenCalledWith(firstId));

    await openStudioMenu();
    fireEvent.click(screen.getByRole("button", { name: "Media" }));
    await waitFor(() => expect(api.listMedia).toHaveBeenCalledWith({ limit: 20 }));

    const input = screen.getByLabelText("Choose media file") as HTMLInputElement;
    const firstFile = new File(["first"], "first.png", { type: "image/png" });
    const secondFile = new File(["second"], "second.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [firstFile] } });
    fireEvent.change(input, { target: { files: [secondFile] } });

    await waitFor(() => expect(uploadMedia).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "Upload media" }).getAttribute("aria-busy")).toBe(
      "true",
    );
    expect(screen.getByRole("status", { name: "Uploading media" })).toBeTruthy();
    resolveUpload?.(mediaAsset("018f0e5d-6a25-7b01-8f4a-7d62a5d3e414", "first.png"));
    await waitFor(() =>
      expect(screen.queryByRole("status", { name: "Uploading media" })).toBeNull(),
    );
  });

  it("prevents duplicate alt saves while the first update is in flight", async () => {
    let resolveUpdate: ((asset: MediaAsset) => void) | undefined;
    const updateMedia = vi.fn<EditorialApi["updateMedia"]>(
      () =>
        new Promise((resolve) => {
          resolveUpdate = resolve;
        }),
    );
    const api = createMockApi({ updateMedia });
    render(<App api={api} />);
    await waitFor(() => expect(api.getPost).toHaveBeenCalledWith(firstId));

    await openStudioMenu();
    fireEvent.click(screen.getByRole("button", { name: "Media" }));
    await waitFor(() => expect(api.listMedia).toHaveBeenCalledWith({ limit: 20 }));
    fireEvent.click(screen.getByRole("button", { name: "Select media hero.jpg" }));

    const alt = screen.getByRole("textbox", { name: "Alt text" });
    fireEvent.change(alt, { target: { value: "Updated alt" } });
    fireEvent.blur(alt);
    await waitFor(() => expect(updateMedia).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Save alt text" }));
    fireEvent.click(screen.getByRole("button", { name: "Save alt text" }));

    expect(updateMedia).toHaveBeenCalledTimes(1);
    expect(updateMedia).toHaveBeenCalledWith(firstMedia.id, {
      expectedVersion: 1,
      altText: "Updated alt",
    });
    resolveUpdate?.({ ...firstMedia, altText: "Updated alt", version: 2 });
  });

  it("prevents duplicate trash requests while the first delete is in flight", async () => {
    let resolveDelete: ((asset: MediaAsset) => void) | undefined;
    const deleteMedia = vi.fn<EditorialApi["deleteMedia"]>(
      () =>
        new Promise((resolve) => {
          resolveDelete = resolve;
        }),
    );
    const api = createMockApi({ deleteMedia });
    render(<App api={api} />);
    await waitFor(() => expect(api.getPost).toHaveBeenCalledWith(firstId));

    await openStudioMenu();
    fireEvent.click(screen.getByRole("button", { name: "Media" }));
    await waitFor(() => expect(api.listMedia).toHaveBeenCalledWith({ limit: 20 }));
    fireEvent.click(screen.getByRole("button", { name: "Select media hero.jpg" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete media hero.jpg" }));
    await waitFor(() => expect(deleteMedia).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Delete media hero.jpg" }));

    expect(deleteMedia).toHaveBeenCalledTimes(1);
    expect(deleteMedia).toHaveBeenCalledWith(firstMedia.id, { expectedVersion: 1 });
    resolveDelete?.({ ...firstMedia, state: "trash" });
  });

  it("prevents duplicate image insertion from repeated activation", async () => {
    const api = createMockApi();
    installJsdomGeometry();
    render(<App api={api} autosaveDelay={60_000} />);
    await waitFor(() => expect(api.getPost).toHaveBeenCalledWith(firstId));

    await openStudioMenu();
    fireEvent.click(screen.getByRole("button", { name: "Media" }));
    await waitFor(() => expect(api.listMedia).toHaveBeenCalledWith({ limit: 20 }));
    fireEvent.click(screen.getByRole("button", { name: "Select media hero.jpg" }));
    const insert = screen.getByRole("button", { name: "Insert image" });
    fireEvent.click(insert);
    fireEvent.click(insert);

    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Body" }).querySelectorAll("figure")).toHaveLength(
        1,
      );
    });
  });

  it("loads the requested post or deterministic first post without creating one", async () => {
    window.history.replaceState({}, "", `/?postId=${secondId}`);
    const api = createMockApi();

    render(<App api={api} />);

    await waitFor(() => expect(api.getPost).toHaveBeenCalledWith(secondId));
    expect(api.createPost).not.toHaveBeenCalled();
    expect((screen.getByRole("textbox", { name: "Title" }) as HTMLInputElement).value).toBe(
      "Second post",
    );
    expect(screen.getByRole("textbox", { name: "Body" }).textContent).toContain("Second body");
  });

  it("keeps an empty writing surface and creates only after the explicit New action", async () => {
    const created = post("018f0e5d-6a25-7b01-8f4a-7d62a5d3e404", "", "");
    const api = createMockApi({
      createPost: vi.fn(async () => created),
      getPost: vi.fn(async () => created),
      listPosts: vi.fn(async () => ({ items: [], nextCursor: null })),
    });

    render(<App api={api} />);
    await waitFor(() => expect(api.listPosts).toHaveBeenCalledWith({ limit: 50 }));
    expect(api.createPost).not.toHaveBeenCalled();

    await openStudioMenu();
    const newPost = screen.getByRole("button", { name: "New post" }) as HTMLButtonElement;
    expect(newPost.disabled).toBe(false);
    fireEvent.click(newPost);

    await waitFor(() =>
      expect(api.createPost).toHaveBeenCalledWith({
        content: { content: [], type: "doc" },
        contentVersion: 1,
        title: "",
      }),
    );
    await waitFor(() => expect(api.getPost).toHaveBeenCalledWith(created.id));
  });

  it("keeps the initial editor locked until an empty post list is known", async () => {
    let resolvePosts:
      | ((page: { items: PostListItemDto[]; nextCursor: string | null }) => void)
      | undefined;
    const api = createMockApi({
      listPosts: vi.fn(
        () =>
          new Promise<{ items: PostListItemDto[]; nextCursor: string | null }>((resolve) => {
            resolvePosts = resolve;
          }),
      ),
    });
    render(<App api={api} />);

    await waitFor(() => {
      expect((screen.getByRole("textbox", { name: "Title" }) as HTMLInputElement).disabled).toBe(
        true,
      );
      expect(screen.getByRole("textbox", { name: "Body" }).getAttribute("contenteditable")).toBe(
        "false",
      );
    });
    resolvePosts?.({ items: [], nextCursor: null });
    await waitFor(() => {
      expect((screen.getByRole("textbox", { name: "Title" }) as HTMLInputElement).disabled).toBe(
        false,
      );
      expect(screen.getByRole("textbox", { name: "Body" }).getAttribute("contenteditable")).toBe(
        "true",
      );
      expect(screen.getByRole("status", { name: "Saved" })).toBeTruthy();
    });
  });

  it("shows a compact retry affordance for workspace load failures", async () => {
    const listPosts = vi
      .fn<EditorialApi["listPosts"]>()
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValueOnce({ items: [listItem(firstPost)], nextCursor: null });
    const api = createMockApi({ listPosts });
    render(<App api={api} />);

    await waitFor(() =>
      expect(screen.getByRole("status", { name: "Workspace unavailable" })).toBeTruthy(),
    );
    expect((screen.getByRole("textbox", { name: "Title" }) as HTMLInputElement).value).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Retry workspace" }));

    await waitFor(() => expect(listPosts).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(api.getPost).toHaveBeenCalledWith(firstId));
    await waitFor(() =>
      expect((screen.getByRole("textbox", { name: "Title" }) as HTMLInputElement).value).toBe(
        "First post",
      ),
    );
  });

  it("exits startup loading when a Strict Mode workspace request fails", async () => {
    const api = createMockApi({
      listPosts: vi.fn<EditorialApi["listPosts"]>(async () => {
        throw new Error("temporary failure");
      }),
    });
    render(
      <StrictMode>
        <App api={api} />
      </StrictMode>,
    );

    await waitFor(() =>
      expect(screen.getByRole("status", { name: "Workspace unavailable" })).toBeTruthy(),
    );
  });

  it("creates an empty-list draft from retained local title and body", async () => {
    const created = post("018f0e5d-6a25-7b01-8f4a-7d62a5d3e404", "Local title", "Local body");
    const createPost = vi.fn<EditorialApi["createPost"]>(async () => created);
    const api = createMockApi({
      createPost,
      getPost: vi.fn(async () => created),
      listPosts: vi.fn(async () => ({ items: [], nextCursor: null })),
    });
    const user = userEvent.setup();
    installJsdomGeometry();
    render(<App api={api} />);
    await waitFor(() => expect(api.listPosts).toHaveBeenCalledWith({ limit: 50 }));

    fireEvent.change(screen.getByRole("textbox", { name: "Title" }), {
      target: { value: "Local title" },
    });
    await user.type(screen.getByRole("textbox", { name: "Body" }), "Local body");
    await openStudioMenu();
    fireEvent.click(screen.getByRole("button", { name: "New post" }));

    await waitFor(() =>
      expect(createPost).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.objectContaining({
            content: expect.arrayContaining([
              expect.objectContaining({
                content: expect.arrayContaining([expect.objectContaining({ text: "Local body" })]),
              }),
            ]),
          }),
          contentVersion: 1,
          title: "Local title",
        }),
      ),
    );
    await waitFor(() => expect(api.getPost).toHaveBeenCalledWith(created.id));
    expect((screen.getByRole("textbox", { name: "Title" }) as HTMLInputElement).value).toBe(
      "Local title",
    );
    expect(screen.getByRole("textbox", { name: "Body" }).textContent).toContain("Local body");
  });

  it("selects another post from the compact Posts panel and hydrates its editor", async () => {
    const api = createMockApi();
    render(<App api={api} />);
    await waitFor(() => expect(api.getPost).toHaveBeenCalledWith(firstId));
    await openStudioMenu();

    fireEvent.click(screen.getByRole("button", { name: "Select post Second post" }));
    await waitFor(() => expect(api.getPost).toHaveBeenCalledWith(secondId));
    expect((screen.getByRole("textbox", { name: "Title" }) as HTMLInputElement).value).toBe(
      "Second post",
    );
    expect(screen.getByRole("textbox", { name: "Body" }).textContent).toContain("Second body");
  });

  it("flushes a dirty draft before switching posts", async () => {
    const api = createMockApi({
      saveDraft: vi.fn<EditorialApi["saveDraft"]>(async (postId, request) =>
        post(postId, request.title, "Saved body", request.expectedDraftVersion + 1),
      ),
    });
    render(<App api={api} autosaveDelay={60_000} />);
    await waitFor(() => expect(api.getPost).toHaveBeenCalledWith(firstId));
    fireEvent.change(screen.getByRole("textbox", { name: "Title" }), {
      target: { value: "Local title" },
    });
    await openStudioMenu();
    fireEvent.click(screen.getByRole("button", { name: "Select post Second post" }));

    await waitFor(() =>
      expect(api.saveDraft).toHaveBeenCalledWith(
        firstId,
        expect.objectContaining({ expectedDraftVersion: 1, title: "Local title" }),
      ),
    );
    await waitFor(() => expect(api.getPost).toHaveBeenCalledWith(secondId));
    expect((screen.getByRole("textbox", { name: "Title" }) as HTMLInputElement).value).toBe(
      "Second post",
    );
  });

  it.each([
    ["a conflict", new EditorialApiError(409, ErrorCode.CONFLICT)],
    ["a network error", new Error("network unavailable")],
  ])("keeps the current post when switching cannot flush %s", async (_label, failure) => {
    const api = createMockApi({
      saveDraft: vi.fn<EditorialApi["saveDraft"]>(async () => {
        throw failure;
      }),
    });
    render(<App api={api} autosaveDelay={60_000} />);
    await waitFor(() => expect(api.getPost).toHaveBeenCalledWith(firstId));
    fireEvent.change(screen.getByRole("textbox", { name: "Title" }), {
      target: { value: "Keep this title" },
    });
    await openStudioMenu();
    fireEvent.click(screen.getByRole("button", { name: "Select post Second post" }));

    await waitFor(() => expect(api.saveDraft).toHaveBeenCalledTimes(1));
    expect(api.getPost).toHaveBeenCalledTimes(1);
    expect((screen.getByRole("textbox", { name: "Title" }) as HTMLInputElement).value).toBe(
      "Keep this title",
    );
    expect(screen.getByRole("textbox", { name: "Body" }).textContent).toContain("First body");
  });

  it("makes the editor non-editable while a selected post is loading", async () => {
    let resolveSecond: ((value: PostDto) => void) | undefined;
    const api = createMockApi({
      getPost: vi.fn<EditorialApi["getPost"]>((postId) =>
        postId === secondId
          ? new Promise<PostDto>((resolve) => {
              resolveSecond = resolve;
            })
          : Promise.resolve(firstPost),
      ),
    });
    render(<App api={api} />);
    await waitFor(() => expect(api.getPost).toHaveBeenCalledWith(firstId));
    await openStudioMenu();
    fireEvent.click(screen.getByRole("button", { name: "Select post Second post" }));

    await waitFor(() => {
      expect((screen.getByRole("textbox", { name: "Title" }) as HTMLInputElement).disabled).toBe(
        true,
      );
      expect(screen.getByRole("textbox", { name: "Body" }).getAttribute("contenteditable")).toBe(
        "false",
      );
    });
    expect(screen.getByRole("textbox", { name: "Body" }).textContent).toContain("First body");
    resolveSecond?.(secondPost);
    await waitFor(() =>
      expect((screen.getByRole("textbox", { name: "Title" }) as HTMLInputElement).value).toBe(
        "Second post",
      ),
    );
  });

  it("does not show a stale history response after switching posts", async () => {
    let resolveFirstHistory:
      | ((page: { items: PostRevisionListItemDto[]; nextCursor: string | null }) => void)
      | undefined;
    const firstHistory = new Promise<{
      items: PostRevisionListItemDto[];
      nextCursor: string | null;
    }>((resolve) => {
      resolveFirstHistory = resolve;
    });
    const secondHistoryItem: PostRevisionListItemDto = {
      authorId: firstId,
      createdAt: "2026-08-26T00:00:00.000Z",
      excerpt: null,
      id: "018f0e5d-6a25-7b01-8f4a-7d62a5d3e406",
      postId: secondId,
      revisionVersion: 2,
      title: "Second",
    };
    const api = createMockApi({
      listRevisions: vi.fn<EditorialApi["listRevisions"]>(async (postId) =>
        postId === firstId ? firstHistory : { items: [secondHistoryItem], nextCursor: null },
      ),
    });
    render(<App api={api} />);
    await waitFor(() => expect(api.getPost).toHaveBeenCalledWith(firstId));
    await openStudioMenu();
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    await waitFor(() => expect(api.listRevisions).toHaveBeenCalledWith(firstId, { limit: 20 }));

    fireEvent.click(screen.getByRole("button", { name: "Posts" }));
    fireEvent.click(screen.getByRole("button", { name: "Select post Second post" }));
    await waitFor(() => expect(api.getPost).toHaveBeenCalledWith(secondId));
    resolveFirstHistory?.({
      items: [
        {
          authorId: firstId,
          createdAt: "2026-08-26T00:00:00.000Z",
          excerpt: null,
          id: firstRevisionId,
          postId: firstId,
          revisionVersion: 1,
          title: "First post",
        },
      ],
      nextCursor: null,
    });

    fireEvent.click(screen.getByRole("button", { name: "History" }));
    await waitFor(() => expect(api.listRevisions).toHaveBeenCalledWith(secondId, { limit: 20 }));
    expect(screen.getByRole("button", { name: "Restore revision 2" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Restore revision 1" })).toBeNull();
  });

  it("saves the current draft through the API and advances the optimistic version", async () => {
    const api = createMockApi();
    render(<App api={api} autosaveDelay={0} />);
    await waitFor(() => expect(api.getPost).toHaveBeenCalledWith(firstId));

    fireEvent.change(screen.getByRole("textbox", { name: "Title" }), {
      target: { value: "Edited title" },
    });
    await waitFor(() => expect(api.saveDraft).toHaveBeenCalledTimes(1));
    expect(api.saveDraft).toHaveBeenCalledWith(
      firstId,
      expect.objectContaining({ expectedDraftVersion: 1, title: "Edited title" }),
    );
    await waitFor(() =>
      expect(screen.getByRole("status").getAttribute("aria-label")).toBe("Saved"),
    );
  });

  it("retains local writing on network failure and exposes explicit conflict actions", async () => {
    const api = createMockApi({
      getPost: vi.fn(async (postId) =>
        postId === firstId ? firstPost : post("latest", "Remote", "Remote body", 3),
      ),
      saveDraft: vi.fn(async () => {
        throw new EditorialApiError(409, ErrorCode.CONFLICT);
      }),
    });
    render(<App api={api} autosaveDelay={0} />);
    await waitFor(() => expect(api.getPost).toHaveBeenCalledWith(firstId));
    fireEvent.change(screen.getByRole("textbox", { name: "Title" }), {
      target: { value: "Keep local title" },
    });
    await waitFor(() =>
      expect(screen.getByRole("status").getAttribute("aria-label")).toBe("Conflict"),
    );
    expect((screen.getByRole("textbox", { name: "Title" }) as HTMLInputElement).value).toBe(
      "Keep local title",
    );
    expect(screen.getByRole("button", { name: "Overwrite remote with local" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reload remote draft" })).toBeTruthy();
  });

  it("reloads remote writing only after the explicit reload action", async () => {
    const remote = post(firstId, "Remote title", "Remote body", 3, 2);
    const api = createMockApi({
      getPost: vi.fn(async () => remote),
      saveDraft: vi.fn(async () => {
        throw new EditorialApiError(409, ErrorCode.CONFLICT);
      }),
    });
    render(<App api={api} autosaveDelay={0} />);
    await waitFor(() => expect(api.getPost).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByRole("textbox", { name: "Title" }), {
      target: { value: "Local title" },
    });
    await waitFor(() =>
      expect(screen.getByRole("status").getAttribute("aria-label")).toBe("Conflict"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Reload remote draft" }));
    await waitFor(() => expect(api.getPost).toHaveBeenCalledTimes(2));
    expect((screen.getByRole("textbox", { name: "Title" }) as HTMLInputElement).value).toBe(
      "Remote title",
    );
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "Body" }).textContent).toContain("Remote body"),
    );
  });

  it("retries a retained local snapshot only after the explicit overwrite action", async () => {
    const latest = post(firstId, "Remote title", "Remote body", 4, 1);
    const saveDraft = vi
      .fn<EditorialApi["saveDraft"]>()
      .mockRejectedValueOnce(new EditorialApiError(409, ErrorCode.CONFLICT))
      .mockResolvedValueOnce(post(firstId, "Keep local title", "Saved body", 5, 1));
    const getPost = vi
      .fn<EditorialApi["getPost"]>()
      .mockResolvedValueOnce(firstPost)
      .mockResolvedValueOnce(latest);
    const api = createMockApi({ getPost, saveDraft });
    render(<App api={api} autosaveDelay={0} />);
    await waitFor(() => expect(getPost).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByRole("textbox", { name: "Title" }), {
      target: { value: "Keep local title" },
    });
    await waitFor(() =>
      expect(screen.getByRole("status").getAttribute("aria-label")).toBe("Conflict"),
    );

    fireEvent.click(screen.getByRole("button", { name: "Overwrite remote with local" }));
    await waitFor(() => expect(getPost).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(saveDraft).toHaveBeenCalledTimes(2));
    expect(saveDraft.mock.calls[1]).toEqual([
      firstId,
      expect.objectContaining({ expectedDraftVersion: 4, title: "Keep local title" }),
    ]);
    expect((screen.getByRole("textbox", { name: "Title" }) as HTMLInputElement).value).toBe(
      "Keep local title",
    );
  });

  it("flushes a dirty draft before restoring a revision and uses its new version", async () => {
    const saveDraft = vi.fn<EditorialApi["saveDraft"]>(async (postId, request) =>
      post(postId, request.title, "Saved body", request.expectedDraftVersion + 1, 1),
    );
    const api = createMockApi({ saveDraft });
    render(<App api={api} autosaveDelay={60_000} />);
    await waitFor(() => expect(api.getPost).toHaveBeenCalledWith(firstId));
    await openStudioMenu();
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    await waitFor(() => expect(api.listRevisions).toHaveBeenCalledWith(firstId, { limit: 20 }));
    fireEvent.change(screen.getByRole("textbox", { name: "Title" }), {
      target: { value: "Local title" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Restore revision 1" }));
    await waitFor(() =>
      expect(saveDraft).toHaveBeenCalledWith(
        firstId,
        expect.objectContaining({ expectedDraftVersion: 1, title: "Local title" }),
      ),
    );
    await waitFor(() =>
      expect(api.restoreRevision).toHaveBeenCalledWith(firstId, firstRevisionId, {
        expectedDraftVersion: 2,
        expectedRevisionVersion: 1,
      }),
    );
  });

  it("retains local writing and skips restore when its flush conflicts", async () => {
    const api = createMockApi({
      saveDraft: vi.fn<EditorialApi["saveDraft"]>(async () => {
        throw new EditorialApiError(409, ErrorCode.CONFLICT);
      }),
    });
    render(<App api={api} autosaveDelay={60_000} />);
    await waitFor(() => expect(api.getPost).toHaveBeenCalledWith(firstId));
    await openStudioMenu();
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    await waitFor(() => expect(api.listRevisions).toHaveBeenCalledWith(firstId, { limit: 20 }));
    fireEvent.change(screen.getByRole("textbox", { name: "Title" }), {
      target: { value: "Keep local title" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Restore revision 1" }));
    await waitFor(() => expect(api.saveDraft).toHaveBeenCalledTimes(1));
    expect(api.restoreRevision).not.toHaveBeenCalled();
    expect((screen.getByRole("textbox", { name: "Title" }) as HTMLInputElement).value).toBe(
      "Keep local title",
    );
    expect(screen.getByRole("textbox", { name: "Body" }).textContent).toContain("First body");
  });

  it("locks the editor while a restore request can replace its content", async () => {
    let resolveRestore:
      | ((result: Awaited<ReturnType<EditorialApi["restoreRevision"]>>) => void)
      | undefined;
    const api = createMockApi({
      restoreRevision: vi.fn<EditorialApi["restoreRevision"]>(
        () =>
          new Promise((resolve) => {
            resolveRestore = resolve;
          }),
      ),
    });
    render(<App api={api} autosaveDelay={60_000} />);
    await waitFor(() => expect(api.getPost).toHaveBeenCalledWith(firstId));
    await openStudioMenu();
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    await waitFor(() => expect(api.listRevisions).toHaveBeenCalledWith(firstId, { limit: 20 }));

    fireEvent.click(screen.getByRole("button", { name: "Restore revision 1" }));
    await waitFor(() => expect(api.restoreRevision).toHaveBeenCalled());
    expect((screen.getByRole("textbox", { name: "Title" }) as HTMLInputElement).disabled).toBe(
      true,
    );
    expect(screen.getByRole("textbox", { name: "Body" }).getAttribute("contenteditable")).toBe(
      "false",
    );
    resolveRestore?.({
      post: post(firstId, "Restored post", "Restored body", 2, 2),
      revision: revision(firstId, "018f0e5d-6a25-7b01-8f4a-7d62a5d3e405", "Restored post", 2),
    });
    await waitFor(() =>
      expect((screen.getByRole("textbox", { name: "Title" }) as HTMLInputElement).value).toBe(
        "Restored post",
      ),
    );
  });

  it("checkpoints after saving and restores a selected revision with both versions", async () => {
    const api = createMockApi();
    render(<App api={api} autosaveDelay={0} />);
    await waitFor(() => expect(api.getPost).toHaveBeenCalledWith(firstId));
    await openStudioMenu();
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    await waitFor(() => expect(api.listRevisions).toHaveBeenCalledWith(firstId, { limit: 20 }));
    fireEvent.change(screen.getByRole("textbox", { name: "Title" }), {
      target: { value: "Checkpoint title" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Create checkpoint" }));
    await waitFor(() =>
      expect(api.saveDraft).toHaveBeenCalledWith(
        firstId,
        expect.objectContaining({ expectedDraftVersion: 1, title: "Checkpoint title" }),
      ),
    );
    await waitFor(() =>
      expect(api.checkpointRevision).toHaveBeenCalledWith(firstId, {
        expectedDraftVersion: 2,
        expectedRevisionVersion: 1,
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Restore revision 2" }));
    await waitFor(() =>
      expect(api.restoreRevision).toHaveBeenCalledWith(firstId, firstRevisionId, {
        expectedDraftVersion: 2,
        expectedRevisionVersion: 2,
      }),
    );
    await waitFor(() =>
      expect((screen.getByRole("textbox", { name: "Title" }) as HTMLInputElement).value).toBe(
        "Restored post",
      ),
    );
    expect(screen.getByRole("textbox", { name: "Body" }).textContent).toContain("Restored body");
  });
});
