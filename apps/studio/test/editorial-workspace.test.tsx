// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  ErrorCode,
  type PostDto,
  type PostListItemDto,
  type PostRevisionDto,
  type PostRevisionListItemDto,
} from "@tinycms/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { type EditorialApi, EditorialApiError } from "../src/editorial-api";

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
