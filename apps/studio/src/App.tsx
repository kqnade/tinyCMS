import type {
  CheckpointPostRevisionRequest,
  JsonObject as ContractJsonObject,
  PostDto,
  PostListItemDto,
  PostRevisionDto,
  PostRevisionListItemDto,
  PreviewPostRequest,
  SavePostDraftRequest,
} from "@tinycms/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type DraftPersistence,
  type DraftSaveRequest,
  type DraftSaveState,
  type DraftSessionOptions,
  type DraftSnapshot,
  useDraftSession,
} from "./draft-session";
import { StudioEditor, type StudioEditorHandle } from "./editor";
import { createEmptyEditorContent, parseEditorContent } from "./editor-content";
import { type EditorialApi, isEditorialConflict } from "./editorial-api";
import { MaterialSymbol } from "./material-symbol";
import { MediaPanel } from "./media-panel";
import { ThemeToggle } from "./theme-toggle";
import { Button } from "./ui";

export type AppProps = DraftSessionOptions & {
  readonly api?: EditorialApi;
};

type WorkspaceState = "error" | "idle" | "loading" | "ready";
type WorkspaceAction =
  | "checkpoint"
  | "create"
  | "load"
  | "preview"
  | "publish"
  | "reload"
  | "restore"
  | "retry";
type Panel = "history" | "media" | "posts";
type PublicationStatus = "error" | "idle" | "published";
type PreviewState =
  | { readonly status: "error" }
  | { readonly status: "loading" }
  | { readonly html: string; readonly status: "ready" };

const previewDocumentStyles = `
:root { color-scheme: light dark; }
body {
  max-width: 44rem;
  margin: 0 auto;
  padding: 0 1rem 4rem;
  color: CanvasText;
  background: Canvas;
  font-family: "Zen Kaku Gothic Antique", sans-serif;
  font-size: 1.125rem;
  line-height: 1.85;
}
h1 { margin: 0 0 1rem; font-size: clamp(2.25rem, 5vw, 3.25rem); font-weight: 400; letter-spacing: -0.045em; line-height: 1.1; overflow-wrap: anywhere; }
h2, h3, blockquote, pre, ul, ol, table { margin-block: 1.1em; }
p { margin-block: 0; }
.preview-excerpt { margin-bottom: 2rem; color: GrayText; }
ul, ol { padding-inline-start: 1.5em; }
blockquote { margin-inline: 0; padding-inline-start: 1rem; border-inline-start: 3px solid GrayText; color: GrayText; }
pre { overflow-x: auto; padding: 0.75rem 1rem; background: Field; font-family: monospace; font-size: 0.9rem; line-height: 1.7; }
code { font-family: monospace; font-size: 0.9em; }
:not(pre) > code { padding: 0.1em 0.3em; border-radius: 0.25rem; background: Field; }
img { max-width: 100%; height: auto; }
`;

function previewDocument(html: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${previewDocumentStyles}</style></head><body>${html}</body></html>`;
}

const statusLabels: Record<DraftSaveState, string> = {
  conflict: "Conflict",
  dirty: "Dirty",
  error: "Error",
  saved: "Saved",
  saving: "Saving",
};

function postToSnapshot(post: PostDto): DraftSnapshot {
  return {
    content: parseEditorContent({ contentVersion: post.contentVersion, content: post.content }),
    draftVersion: post.draftVersion,
    excerpt: post.excerpt,
    metadata: post.metadata,
    title: post.title,
  };
}

function postToListItem(post: PostDto): PostListItemDto {
  return {
    createdAt: post.createdAt,
    createdByAuthorId: post.createdByAuthorId,
    currentRevisionVersion: post.currentRevisionVersion,
    draftVersion: post.draftVersion,
    excerpt: post.excerpt,
    id: post.id,
    lifecycle: post.lifecycle,
    slug: post.slug,
    title: post.title,
    updatedAt: post.updatedAt,
    updatedByAuthorId: post.updatedByAuthorId,
  };
}

function revisionToListItem(revision: PostRevisionDto): PostRevisionListItemDto {
  return {
    authorId: revision.authorId,
    createdAt: revision.createdAt,
    excerpt: revision.excerpt,
    id: revision.id,
    postId: revision.postId,
    revisionVersion: revision.revisionVersion,
    title: revision.title,
  };
}

function updatePostList(posts: readonly PostListItemDto[], post: PostDto): PostListItemDto[] {
  const next = postToListItem(post);
  const index = posts.findIndex((item) => item.id === post.id);
  if (index < 0) return [next, ...posts];
  return posts.map((item, itemIndex) => (itemIndex === index ? next : item));
}

function saveRequestFromSnapshot(
  snapshot: DraftSnapshot,
  expectedDraftVersion = snapshot.draftVersion,
): SavePostDraftRequest {
  return {
    content: snapshot.content.content,
    contentVersion: snapshot.content.contentVersion,
    expectedDraftVersion,
    ...(snapshot.excerpt === undefined ? {} : { excerpt: snapshot.excerpt }),
    ...(snapshot.metadata === undefined
      ? {}
      : { metadata: snapshot.metadata as unknown as ContractJsonObject }),
    title: snapshot.title,
  };
}

function toApiSaveRequest(request: DraftSaveRequest): SavePostDraftRequest {
  return {
    content: request.content,
    contentVersion: request.contentVersion,
    expectedDraftVersion: request.expectedDraftVersion,
    ...(request.excerpt === undefined ? {} : { excerpt: request.excerpt }),
    ...(request.metadata === undefined
      ? {}
      : { metadata: request.metadata as unknown as ContractJsonObject }),
    title: request.title,
  };
}

function requestedPostId(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const value = new URLSearchParams(window.location.search).get("postId");
  return value === null || value.length === 0 ? undefined : value;
}

export function App({ api, persistence: initialPersistence, ...sessionOptions }: AppProps) {
  const [panelOpen, setPanelOpen] = useState(false);
  const [activePanel, setActivePanel] = useState<Panel>("posts");
  const [posts, setPosts] = useState<PostListItemDto[]>([]);
  const [selectedPost, setSelectedPost] = useState<PostDto | null>(null);
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const [workspaceState, setWorkspaceState] = useState<WorkspaceState>(api ? "loading" : "ready");
  const [workspaceAction, setWorkspaceAction] = useState<WorkspaceAction | null>(null);
  const [loadingPostId, setLoadingPostId] = useState<string | null>(null);
  const [revisions, setRevisions] = useState<PostRevisionListItemDto[]>([]);
  const [revisionCursor, setRevisionCursor] = useState<string | null>(null);
  const [historyState, setHistoryState] = useState<WorkspaceState>("idle");
  const [editorVersion, setEditorVersion] = useState(0);
  const [previewState, setPreviewState] = useState<PreviewState | null>(null);
  const [publicationStatus, setPublicationStatus] = useState<PublicationStatus>("idle");
  const selectedPostIdRef = useRef<string | null>(null);
  const loadGenerationRef = useRef(0);
  const startedApiRef = useRef<EditorialApi | null>(null);
  const historyLoadedForRef = useRef<string | null>(null);
  const historyGenerationRef = useRef(0);
  const editorRef = useRef<StudioEditorHandle | null>(null);
  const mediaToggleRef = useRef<HTMLButtonElement | null>(null);
  const mediaSectionRef = useRef<HTMLElement | null>(null);
  const previewButtonRef = useRef<HTMLButtonElement | null>(null);
  const previewCloseButtonRef = useRef<HTMLButtonElement | null>(null);

  selectedPostIdRef.current = selectedPostId;

  const apiPersistence = useMemo<DraftPersistence | undefined>(() => {
    if (api === undefined || selectedPostId === null || loadingPostId !== null) return undefined;
    const postId = selectedPostId;
    return {
      saveDraft: async (request) => {
        try {
          const post = await api.saveDraft(postId, toApiSaveRequest(request));
          if (selectedPostIdRef.current === postId) {
            setSelectedPost(post);
            setPosts((current) => updatePostList(current, post));
          }
          return { draftVersion: post.draftVersion, ok: true as const };
        } catch (error) {
          return {
            code: isEditorialConflict(error) ? ("CONFLICT" as const) : ("ERROR" as const),
            ok: false as const,
          };
        }
      },
    };
  }, [api, loadingPostId, selectedPostId]);

  const persistence = api === undefined ? initialPersistence : apiPersistence;
  const session = useDraftSession({
    ...sessionOptions,
    ...(persistence === undefined ? {} : { persistence }),
  });
  const saveDraftSession = session.save;
  const getDraftSaveState = session.getSaveState;

  const applyPost = useCallback(
    (post: PostDto) => {
      const snapshot = postToSnapshot(post);
      setSelectedPost(post);
      setSelectedPostId(post.id);
      setPosts((current) => updatePostList(current, post));
      setWorkspaceState("ready");
      session.hydrate(snapshot);
      setEditorVersion((version) => version + 1);
      historyGenerationRef.current += 1;
      historyLoadedForRef.current = null;
      setRevisions([]);
      setRevisionCursor(null);
      setHistoryState("idle");
    },
    [session.hydrate],
  );

  const loadPost = useCallback(
    async (postId: string) => {
      if (api === undefined) return;
      const generation = loadGenerationRef.current + 1;
      loadGenerationRef.current = generation;
      historyGenerationRef.current += 1;
      setRevisions([]);
      setRevisionCursor(null);
      setLoadingPostId(postId);
      setWorkspaceState("loading");
      try {
        const post = await api.getPost(postId);
        if (generation !== loadGenerationRef.current) return;
        applyPost(post);
      } catch {
        if (generation === loadGenerationRef.current) setWorkspaceState("error");
      } finally {
        if (generation === loadGenerationRef.current) setLoadingPostId(null);
      }
    },
    [api, applyPost],
  );

  const loadWorkspace = useCallback(
    async (preserveCurrent = false) => {
      if (api === undefined) return;
      setWorkspaceState("loading");
      const page = await api.listPosts({ limit: 50 });
      setPosts(page.items);

      const currentPostId = selectedPostIdRef.current;
      if (preserveCurrent && currentPostId !== null) {
        const current = page.items.find((item) => item.id === currentPostId);
        if (current === undefined) {
          setWorkspaceState("ready");
          return;
        }
        await saveDraftSession();
        if (getDraftSaveState() !== "saved") {
          setWorkspaceState("ready");
          return;
        }
        await loadPost(current.id);
        return;
      }

      if (preserveCurrent && getDraftSaveState() !== "saved") {
        setWorkspaceState("ready");
        return;
      }

      const requested = requestedPostId();
      const selected =
        (requested === undefined ? undefined : page.items.find((item) => item.id === requested)) ??
        page.items[0];
      if (selected === undefined) {
        setWorkspaceState("ready");
        return;
      }
      await loadPost(selected.id);
    },
    [api, getDraftSaveState, loadPost, saveDraftSession],
  );

  useEffect(() => {
    if (api === undefined || startedApiRef.current === api) return;
    startedApiRef.current = api;
    let active = true;
    void loadWorkspace().catch(() => {
      if (active) setWorkspaceState("error");
    });
    return () => {
      active = false;
      if (startedApiRef.current === api) startedApiRef.current = null;
    };
  }, [api, loadWorkspace]);

  useEffect(() => {
    if (!panelOpen) return;

    const closeFromEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (mediaSectionRef.current?.contains(document.activeElement)) {
        mediaToggleRef.current?.focus();
      }
      setPanelOpen(false);
    };

    window.addEventListener("keydown", closeFromEscape);
    return () => window.removeEventListener("keydown", closeFromEscape);
  }, [panelOpen]);

  const retryWorkspace = useCallback(async () => {
    if (api === undefined || workspaceAction !== null) return;
    setWorkspaceAction("retry");
    try {
      await loadWorkspace(true);
    } catch {
      setWorkspaceState("error");
    } finally {
      setWorkspaceAction(null);
    }
  }, [api, loadWorkspace, workspaceAction]);

  const createPost = useCallback(async () => {
    if (api === undefined || workspaceAction !== null) return;
    setWorkspaceAction("create");
    try {
      const hasSelectedPost = selectedPostId !== null;
      if (hasSelectedPost) {
        await session.save();
        if (session.getSaveState() !== "saved") return;
      }
      const snapshot = session.getSnapshot();
      const content = hasSelectedPost ? createEmptyEditorContent() : snapshot.content;
      const post = await api.createPost({
        content: content.content,
        contentVersion: content.contentVersion,
        title: hasSelectedPost ? "" : snapshot.title,
      });
      setPosts((current) => updatePostList(current, post));
      await loadPost(post.id);
    } catch {
      setWorkspaceState("error");
    } finally {
      setWorkspaceAction(null);
    }
  }, [api, loadPost, selectedPostId, session, workspaceAction]);

  const switchPost = useCallback(
    async (postId: string) => {
      if (postId === selectedPostId || workspaceAction !== null) return;
      setWorkspaceAction("load");
      try {
        await session.save();
        if (session.getSaveState() !== "saved") return;
        await loadPost(postId);
      } finally {
        setWorkspaceAction(null);
      }
    },
    [loadPost, selectedPostId, session, workspaceAction],
  );

  const loadRevisions = useCallback(
    async (cursor?: string) => {
      if (api === undefined || selectedPostId === null || historyState === "loading") return;
      const postId = selectedPostId;
      const generation = historyGenerationRef.current;
      setHistoryState("loading");
      try {
        const page = await api.listRevisions(
          postId,
          cursor === undefined ? { limit: 20 } : { cursor, limit: 20 },
        );
        if (generation !== historyGenerationRef.current || selectedPostIdRef.current !== postId) {
          return;
        }
        setRevisions((current) =>
          cursor === undefined ? page.items : [...current, ...page.items],
        );
        setRevisionCursor(page.nextCursor);
        historyLoadedForRef.current = postId;
        setHistoryState("ready");
      } catch {
        if (generation === historyGenerationRef.current && selectedPostIdRef.current === postId) {
          setHistoryState("error");
        }
      }
    },
    [api, historyState, selectedPostId],
  );

  const openHistory = useCallback(() => {
    setActivePanel("history");
    setPanelOpen(true);
    if (selectedPostId !== null && historyLoadedForRef.current !== selectedPostId) {
      void loadRevisions();
    }
  }, [loadRevisions, selectedPostId]);

  const createCheckpoint = useCallback(async () => {
    if (api === undefined || selectedPost === null || workspaceAction !== null) return;
    setWorkspaceAction("checkpoint");
    try {
      await session.save();
      if (session.getSaveState() !== "saved") return;
      const snapshot = session.getSnapshot();
      const request: CheckpointPostRevisionRequest = {
        expectedDraftVersion: snapshot.draftVersion,
        expectedRevisionVersion: selectedPost.currentRevisionVersion ?? 0,
      };
      const result = await api.checkpointRevision(selectedPost.id, request);
      applyPost(result.post);
      setRevisions((current) => [revisionToListItem(result.revision), ...current]);
      historyLoadedForRef.current = selectedPost.id;
    } catch (error) {
      session.markSaveState(isEditorialConflict(error) ? "conflict" : "error");
    } finally {
      setWorkspaceAction(null);
    }
  }, [api, applyPost, selectedPost, session, workspaceAction]);

  const restoreRevision = useCallback(
    async (revision: PostRevisionListItemDto) => {
      if (api === undefined || selectedPost === null || workspaceAction !== null) return;
      setWorkspaceAction("restore");
      try {
        await session.save();
        if (session.getSaveState() !== "saved") return;
        const snapshot = session.getSnapshot();
        const result = await api.restoreRevision(selectedPost.id, revision.id, {
          expectedDraftVersion: snapshot.draftVersion,
          expectedRevisionVersion: selectedPost.currentRevisionVersion ?? 0,
        });
        applyPost(result.post);
        setRevisions((current) => [revisionToListItem(result.revision), ...current]);
      } catch (error) {
        session.markSaveState(isEditorialConflict(error) ? "conflict" : "error");
      } finally {
        setWorkspaceAction(null);
      }
    },
    [api, applyPost, selectedPost, session, workspaceAction],
  );

  const retryConflict = useCallback(async () => {
    if (api === undefined || selectedPostId === null || workspaceAction !== null) return;
    setWorkspaceAction("retry");
    const localSnapshot = session.getSnapshot();
    try {
      const latest = await api.getPost(selectedPostId);
      const saved = await api.saveDraft(
        selectedPostId,
        saveRequestFromSnapshot(localSnapshot, latest.draftVersion),
      );
      applyPost(saved);
    } catch (error) {
      session.markSaveState(isEditorialConflict(error) ? "conflict" : "error");
    } finally {
      setWorkspaceAction(null);
    }
  }, [api, applyPost, selectedPostId, session, workspaceAction]);

  const reloadRemote = useCallback(async () => {
    if (selectedPostId === null || workspaceAction !== null) return;
    setWorkspaceAction("reload");
    await loadPost(selectedPostId);
    setWorkspaceAction(null);
  }, [loadPost, selectedPostId, workspaceAction]);

  const previewPost = useCallback(async () => {
    if (api === undefined || selectedPost === null || workspaceAction !== null) return;
    setWorkspaceAction("preview");
    setPreviewState({ status: "loading" });
    const snapshot = session.getSnapshot();
    const request: PreviewPostRequest = {
      content: snapshot.content.content,
      contentVersion: snapshot.content.contentVersion,
      ...(snapshot.excerpt === undefined ? {} : { excerpt: snapshot.excerpt }),
      ...(snapshot.metadata === undefined
        ? {}
        : { metadata: snapshot.metadata as unknown as ContractJsonObject }),
      title: snapshot.title,
    };
    try {
      const result = await api.previewPost(selectedPost.id, request);
      setPreviewState({ html: result.html, status: "ready" });
    } catch {
      setPreviewState({ status: "error" });
    } finally {
      setWorkspaceAction(null);
    }
  }, [api, selectedPost, session, workspaceAction]);

  const publishPost = useCallback(async () => {
    if (api === undefined || selectedPost === null || workspaceAction !== null) return;
    setWorkspaceAction("publish");
    setPublicationStatus("idle");
    try {
      await session.save();
      if (session.getSaveState() !== "saved") return;
      const snapshot = session.getSnapshot();
      const result = await api.publishPost(selectedPost.id, {
        expectedDraftVersion: snapshot.draftVersion,
        expectedRevisionVersion: selectedPost.currentRevisionVersion ?? 0,
        idempotencyKey: `studio:${selectedPost.id}:${snapshot.draftVersion}:${Date.now()}`,
      });
      applyPost(result.post);
      setRevisions([revisionToListItem(result.revision)]);
      historyLoadedForRef.current = selectedPost.id;
      setPublicationStatus("published");
    } catch (error) {
      if (isEditorialConflict(error)) {
        session.markSaveState("conflict");
      }
      setPublicationStatus("error");
    } finally {
      setWorkspaceAction(null);
    }
  }, [api, applyPost, selectedPost, session, workspaceAction]);

  const previewOpen = previewState !== null;

  useEffect(() => {
    if (!previewOpen) return;
    previewCloseButtonRef.current?.focus();
    const closeFromEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setPreviewState(null);
    };
    window.addEventListener("keydown", closeFromEscape);
    return () => {
      window.removeEventListener("keydown", closeFromEscape);
      previewButtonRef.current?.focus();
    };
  }, [previewOpen]);

  const canSave =
    Boolean(persistence) &&
    (session.saveState === "dirty" ||
      session.saveState === "conflict" ||
      session.saveState === "error");
  const statusLabel = statusLabels[session.saveState];
  const editorBusy =
    workspaceAction !== null || workspaceState === "loading" || loadingPostId !== null;

  return (
    <div className="studio-shell" data-panel-open={panelOpen}>
      <header className="studio-header">
        <div className="studio-header__inner">
          <div className="studio-header__identity">
            <Button
              aria-label={panelOpen ? "Close menu" : "Open menu"}
              aria-controls="studio-side-panel"
              aria-expanded={panelOpen}
              aria-pressed={panelOpen}
              className={`studio-icon-button studio-menu-button${panelOpen ? " studio-menu-button--open" : ""}`}
              onClick={() => setPanelOpen((open) => !open)}
              variant="ghost"
            >
              <MaterialSymbol name={panelOpen ? "close" : "menu"} />
            </Button>
            <span className="studio-brand">tinyCMS</span>
          </div>

          <div className="studio-document-actions">
            <span
              aria-label={statusLabel}
              className="studio-save-status"
              data-save-state={session.saveState}
              role="status"
            >
              <span
                aria-hidden="true"
                className={`studio-status-dot studio-status-dot--${session.saveState}`}
              />
              <span aria-hidden="true" className="studio-save-status__label">
                {statusLabel}
              </span>
            </span>
            {session.saveState === "conflict" && api !== undefined ? (
              <>
                <Button
                  aria-label="Overwrite remote with local"
                  className="studio-icon-button"
                  disabled={workspaceAction !== null}
                  onClick={() => void retryConflict()}
                  variant="ghost"
                >
                  <MaterialSymbol name="replay" />
                </Button>
                <Button
                  aria-label="Reload remote draft"
                  className="studio-icon-button"
                  disabled={workspaceAction !== null}
                  onClick={() => void reloadRemote()}
                  variant="ghost"
                >
                  <MaterialSymbol name="refresh" />
                </Button>
              </>
            ) : null}
            <Button
              aria-label="Save"
              className="studio-icon-button"
              disabled={!canSave || workspaceAction !== null}
              onClick={() => void session.save()}
              variant="ghost"
            >
              <MaterialSymbol name="save" />
            </Button>
            <Button
              aria-label="Preview"
              className="studio-preview-button"
              disabled={api === undefined || selectedPost === null || workspaceAction !== null}
              onClick={() => void previewPost()}
              ref={previewButtonRef}
              variant="secondary"
            >
              Preview
            </Button>
            {publicationStatus === "published" ? (
              <span aria-label="Published" className="studio-publish-status" role="status">
                Published
              </span>
            ) : null}
            {publicationStatus === "error" ? (
              <span className="studio-publish-status studio-publish-status--error" role="alert">
                Publish failed
              </span>
            ) : null}
            <Button
              aria-label="Publish"
              className="studio-publish-button"
              disabled={api === undefined || selectedPost === null || workspaceAction !== null}
              onClick={() => void publishPost()}
              variant="primary"
            >
              {workspaceAction === "publish" ? "Publishing…" : "Publish"}
            </Button>
          </div>
        </div>
      </header>

      <button
        aria-label="Dismiss menu"
        className="studio-menu-backdrop"
        hidden={!panelOpen}
        onClick={() => setPanelOpen(false)}
        tabIndex={-1}
        type="button"
      />

      <aside
        aria-label="Menu"
        className="studio-side-panel"
        hidden={!panelOpen}
        id="studio-side-panel"
      >
        <nav aria-label="Studio">
          <Button
            aria-label="Posts"
            aria-pressed={activePanel === "posts"}
            className="studio-icon-button"
            disabled={api === undefined}
            onClick={() => {
              setActivePanel("posts");
              setPanelOpen(true);
            }}
            variant="ghost"
          >
            <MaterialSymbol name="article" />
          </Button>
          <Button
            aria-label="History"
            aria-pressed={activePanel === "history"}
            className="studio-icon-button"
            disabled={api === undefined || selectedPost === null}
            onClick={openHistory}
            variant="ghost"
          >
            <MaterialSymbol name="history" />
          </Button>
          <Button
            aria-label="Media"
            aria-pressed={panelOpen && activePanel === "media"}
            className="studio-icon-button"
            disabled={api === undefined}
            onClick={(event) => {
              mediaToggleRef.current = event.currentTarget;
              if (panelOpen && activePanel === "media") {
                setPanelOpen(false);
                return;
              }
              setActivePanel("media");
              setPanelOpen(true);
            }}
            title="Media"
            variant="ghost"
          >
            <MaterialSymbol name="image" />
          </Button>
          <Button aria-label="AI assist" className="studio-icon-button" disabled variant="ghost">
            <MaterialSymbol name="auto_awesome" />
          </Button>
          <Button aria-label="Settings" className="studio-icon-button" disabled variant="ghost">
            <MaterialSymbol name="settings" />
          </Button>
        </nav>

        {api !== undefined && activePanel === "posts" ? (
          <section aria-label="Posts" className="studio-side-panel__content">
            <Button
              aria-label="New post"
              className="studio-icon-button"
              disabled={workspaceAction !== null || editorBusy}
              onClick={() => void createPost()}
              variant="ghost"
            >
              <MaterialSymbol name="add" />
            </Button>
            <div className="studio-post-list">
              {posts.map((post) => (
                <button
                  aria-current={post.id === selectedPostId ? "true" : undefined}
                  aria-label={`Select post ${post.title || post.slug}`}
                  className="studio-post-list__item"
                  key={post.id}
                  onClick={() => void switchPost(post.id)}
                  type="button"
                >
                  <span>{post.title || post.slug}</span>
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {api !== undefined && activePanel === "history" && selectedPost !== null ? (
          <section aria-label="History" className="studio-side-panel__content">
            <div className="studio-history-actions">
              <Button
                aria-label="Create checkpoint"
                className="studio-icon-button"
                disabled={workspaceAction !== null}
                onClick={() => void createCheckpoint()}
                variant="ghost"
              >
                <MaterialSymbol name="save" />
              </Button>
              {revisionCursor !== null ? (
                <Button
                  aria-label="Load more history"
                  className="studio-icon-button"
                  disabled={historyState === "loading"}
                  onClick={() => void loadRevisions(revisionCursor)}
                  variant="ghost"
                >
                  <MaterialSymbol name="arrow_back" />
                </Button>
              ) : null}
            </div>
            <div className="studio-history-list">
              {revisions.map((revision) => (
                <button
                  aria-label={`Restore revision ${revision.revisionVersion}`}
                  className="studio-history-list__item"
                  disabled={workspaceAction !== null}
                  key={revision.id}
                  onClick={() => void restoreRevision(revision)}
                  type="button"
                >
                  <span>{revision.title || `Revision ${revision.revisionVersion}`}</span>
                  <time dateTime={revision.createdAt}>{revision.createdAt.slice(0, 10)}</time>
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {api !== undefined && activePanel === "media" ? (
          <section ref={mediaSectionRef} aria-label="Media" className="studio-side-panel__content">
            <MediaPanel api={api} editorDisabled={editorBusy} editorRef={editorRef} />
          </section>
        ) : null}
      </aside>

      <main className="studio-main">
        <section className="studio-editor" aria-label="Editor">
          <textarea
            aria-label="Title"
            className="studio-title-input"
            disabled={editorBusy}
            onChange={(event) => {
              setPublicationStatus("idle");
              session.setTitle(event.target.value.replace(/[\r\n]+/g, " "));
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.preventDefault();
            }}
            placeholder="Title"
            rows={1}
            value={session.title}
          />
          <StudioEditor
            aria-label="Body"
            className="studio-body-editor"
            editable={!editorBusy}
            initialContent={session.content}
            key={`${selectedPostId ?? "empty"}-${editorVersion}`}
            onChange={(content) => {
              setPublicationStatus("idle");
              session.setContent(content);
            }}
            ref={editorRef}
          />
          <div
            className={`studio-workspace-indicator studio-workspace-indicator--${workspaceState}`}
            data-state={workspaceState}
          >
            {workspaceState === "loading" ? (
              <span
                aria-label="Loading workspace"
                className="studio-workspace-indicator__dot"
                role="status"
              />
            ) : null}
            {workspaceState === "error" ? (
              <>
                <span
                  aria-label="Workspace unavailable"
                  className="studio-workspace-indicator__dot"
                  role="status"
                />
                <Button
                  aria-label="Retry workspace"
                  className="studio-icon-button"
                  disabled={workspaceAction !== null}
                  onClick={() => void retryWorkspace()}
                  variant="ghost"
                >
                  <MaterialSymbol name="refresh" />
                </Button>
              </>
            ) : null}
          </div>
        </section>
      </main>
      {previewState !== null ? (
        <div aria-label="Preview" aria-modal="true" className="studio-preview" role="dialog">
          <div className="studio-preview__inner">
            <div className="studio-preview__header">
              <h2 className="studio-preview__title">Preview</h2>
              <Button
                aria-label="Close preview"
                className="studio-icon-button"
                onClick={() => setPreviewState(null)}
                ref={previewCloseButtonRef}
                variant="ghost"
              >
                <MaterialSymbol name="close" />
              </Button>
            </div>
            {previewState.status === "loading" ? (
              <p aria-label="Loading preview" className="studio-preview__status" role="status">
                Loading preview…
              </p>
            ) : previewState.status === "error" ? (
              <p className="studio-preview__status studio-preview__status--error" role="alert">
                Preview unavailable. Try again.
              </p>
            ) : (
              <iframe
                className="studio-preview__frame"
                sandbox=""
                srcDoc={previewDocument(previewState.html)}
                title="Post preview"
              />
            )}
          </div>
        </div>
      ) : null}
      <ThemeToggle />
    </div>
  );
}
