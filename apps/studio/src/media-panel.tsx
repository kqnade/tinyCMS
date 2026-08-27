import { type ChangeEvent, type RefObject, useCallback, useEffect, useRef, useState } from "react";
import type { StudioEditorHandle } from "./editor";
import { type EditorialApi, isEditorialConflict, type MediaAsset } from "./editorial-api";
import { Button, Field, Input } from "./ui";

const MEDIA_PAGE_LIMIT = 20;
const MEDIA_UPLOAD_MAX_BYTES = 20 * 1024 * 1024;
const MEDIA_UPLOAD_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

type MediaPanelProps = {
  readonly api: EditorialApi;
  readonly editorDisabled?: boolean;
  readonly editorRef: RefObject<StudioEditorHandle | null>;
};

type MediaLoadState = "error" | "loading" | "ready";
type MediaActionState = "idle" | "loading";

function formatByteSize(byteSize: number): string {
  if (byteSize < 1024) return `${byteSize} B`;
  if (byteSize < 1024 * 1024) return `${(byteSize / 1024).toFixed(1)} KB`;
  if (byteSize < 1024 * 1024 * 1024) return `${(byteSize / (1024 * 1024)).toFixed(1)} MB`;
  return `${(byteSize / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function addMediaAssets(current: readonly MediaAsset[], next: readonly MediaAsset[]) {
  const byId = new Map(current.map((asset) => [asset.id, asset]));
  for (const asset of next) {
    if (asset.state === "ready") byId.set(asset.id, asset);
  }
  return [...byId.values()];
}

function replaceMediaAsset(current: readonly MediaAsset[], next: MediaAsset): MediaAsset[] {
  if (next.state !== "ready") return current.filter((asset) => asset.id !== next.id);
  return addMediaAssets(
    current.filter((asset) => asset.id !== next.id),
    [next],
  );
}

function uploadErrorFor(file: File): string | null {
  if (!MEDIA_UPLOAD_TYPES.has(file.type)) return "Choose a JPEG, PNG, or WebP image.";
  if (file.size > MEDIA_UPLOAD_MAX_BYTES) return "Image must be 20 MiB or smaller.";
  return null;
}

export function MediaPanel({ api, editorDisabled = false, editorRef }: MediaPanelProps) {
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [selectedMediaId, setSelectedMediaId] = useState<string | null>(null);
  const [altDrafts, setAltDrafts] = useState<Record<string, string>>({});
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<MediaLoadState>("loading");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadState, setUploadState] = useState<MediaActionState>("idle");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [altState, setAltState] = useState<MediaActionState>("idle");
  const [altError, setAltError] = useState<string | null>(null);
  const [deleteState, setDeleteState] = useState<MediaActionState>("idle");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [insertState, setInsertState] = useState<MediaActionState>("idle");
  const requestGeneration = useRef(0);
  const loadingRef = useRef(false);
  const uploadRef = useRef(false);
  const altRef = useRef(false);
  const deleteRef = useRef(false);
  const insertRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectedAsset = assets.find((asset) => asset.id === selectedMediaId) ?? null;
  const selectedAlt =
    selectedAsset === null ? "" : (altDrafts[selectedAsset.id] ?? selectedAsset.altText);

  const loadMedia = useCallback(
    async (cursor?: string) => {
      if (loadingRef.current) return;
      loadingRef.current = true;
      const generation = requestGeneration.current + 1;
      requestGeneration.current = generation;
      setLoadState("loading");
      try {
        const page = await api.listMedia(
          cursor === undefined ? { limit: MEDIA_PAGE_LIMIT } : { cursor, limit: MEDIA_PAGE_LIMIT },
        );
        if (generation !== requestGeneration.current) return;
        setAssets((current) =>
          cursor === undefined
            ? addMediaAssets([], page.items)
            : addMediaAssets(current, page.items),
        );
        setSelectedMediaId((current) => {
          if (current === null || page.items.some((asset) => asset.id === current)) return current;
          return cursor === undefined ? null : current;
        });
        setNextCursor(page.nextCursor);
        setLoadState("ready");
      } catch {
        if (generation === requestGeneration.current) setLoadState("error");
      } finally {
        if (generation === requestGeneration.current) loadingRef.current = false;
      }
    },
    [api],
  );

  useEffect(() => {
    void loadMedia();
  }, [loadMedia]);

  const selectAsset = useCallback((asset: MediaAsset) => {
    setSelectedMediaId(asset.id);
    setAltDrafts((current) =>
      current[asset.id] === undefined ? { ...current, [asset.id]: asset.altText } : current,
    );
    setAltError(null);
    setDeleteError(null);
  }, []);

  const uploadAsset = useCallback(
    async (file: File) => {
      if (uploadRef.current) return;
      const validationError = uploadErrorFor(file);
      if (validationError !== null) {
        setUploadError(validationError);
        return;
      }

      uploadRef.current = true;
      setUploadState("loading");
      setUploadError(null);
      try {
        const uploaded = await api.uploadMedia(file);
        if (uploaded.state === "ready") {
          setAssets((current) => addMediaAssets(current, [uploaded]));
          setSelectedMediaId(uploaded.id);
          setAltDrafts((current) => ({ ...current, [uploaded.id]: uploaded.altText }));
          setAltError(null);
          setDeleteError(null);
          setUploadFile(null);
          if (fileInputRef.current !== null) fileInputRef.current.value = "";
        } else {
          setUploadError("Uploaded media is not ready.");
        }
      } catch {
        setUploadError("Media upload failed.");
      } finally {
        uploadRef.current = false;
        setUploadState("idle");
      }
    },
    [api],
  );

  const handleFileChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.currentTarget.files?.[0];
      if (file === undefined) return;
      setUploadFile(file);
      void uploadAsset(file);
    },
    [uploadAsset],
  );

  const saveAlt = useCallback(
    async (nextAlt: string) => {
      if (selectedAsset === null || altRef.current || nextAlt === selectedAsset.altText) return;
      altRef.current = true;
      setAltState("loading");
      setAltError(null);
      try {
        const saved = await api.updateMedia(selectedAsset.id, {
          expectedVersion: selectedAsset.version,
          altText: nextAlt,
        });
        setAssets((current) => replaceMediaAsset(current, saved));
        if (saved.state === "ready") {
          setAltDrafts((current) => ({ ...current, [saved.id]: saved.altText }));
        } else {
          setSelectedMediaId(null);
        }
      } catch (error) {
        setAltError(
          isEditorialConflict(error) ? "Alt text conflict" : "Alt text could not be saved",
        );
      } finally {
        altRef.current = false;
        setAltState("idle");
      }
    },
    [api, selectedAsset],
  );

  const deleteAsset = useCallback(async () => {
    if (selectedAsset === null || deleteRef.current) return;
    deleteRef.current = true;
    setDeleteState("loading");
    setDeleteError(null);
    try {
      await api.deleteMedia(selectedAsset.id, { expectedVersion: selectedAsset.version });
      setAssets((current) => current.filter((asset) => asset.id !== selectedAsset.id));
      setSelectedMediaId(null);
      setAltError(null);
    } catch (error) {
      setDeleteError(
        isEditorialConflict(error) ? "Media delete conflict" : "Media could not be deleted",
      );
    } finally {
      deleteRef.current = false;
      setDeleteState("idle");
    }
  }, [api, selectedAsset]);

  const insertAsset = useCallback(() => {
    if (
      selectedAsset === null ||
      editorDisabled ||
      insertRef.current ||
      editorRef.current === null
    ) {
      return;
    }
    insertRef.current = true;
    setInsertState("loading");
    try {
      editorRef.current.insertImage({
        alt: selectedAsset.altText,
        caption: null,
        mediaId: selectedAsset.id,
      });
    } finally {
      queueMicrotask(() => {
        insertRef.current = false;
        setInsertState("idle");
      });
    }
  }, [editorDisabled, editorRef, selectedAsset]);

  const mediaBusy =
    uploadState === "loading" || altState === "loading" || deleteState === "loading";
  const selectedAltIsSaved = selectedAsset === null || selectedAlt === selectedAsset.altText;

  return (
    <div className="studio-media-panel">
      <div className="studio-media-actions">
        <Button
          aria-label="Upload media"
          disabled={uploadState === "loading"}
          loading={uploadState === "loading"}
          onClick={() => fileInputRef.current?.click()}
          title="Upload media"
          variant="secondary"
        >
          Upload
        </Button>
        <input
          accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
          aria-label="Choose media file"
          className="studio-media-file-input"
          disabled={uploadState === "loading"}
          onChange={handleFileChange}
          ref={fileInputRef}
          tabIndex={-1}
          type="file"
        />
        {uploadState === "loading" ? (
          <span aria-label="Uploading media" className="studio-media-status" role="status">
            Uploading media
          </span>
        ) : null}
        {uploadFile !== null ? (
          <span
            aria-label={`Selected file ${uploadFile.name}`}
            className="studio-media-file-name"
            role="status"
          >
            {uploadFile.name}
          </span>
        ) : null}
      </div>
      {uploadError !== null ? (
        <p className="studio-media-status studio-media-status--error" role="alert">
          {uploadError}
        </p>
      ) : null}
      {loadState === "loading" && assets.length === 0 ? (
        <p aria-label="Loading media" className="studio-media-status" role="status">
          Loading media
        </p>
      ) : null}
      {loadState === "error" ? (
        <p className="studio-media-status studio-media-status--error" role="alert">
          Media unavailable
        </p>
      ) : null}
      {loadState === "ready" && assets.length === 0 ? (
        <p aria-label="No media" className="studio-media-status" role="status">
          No media available
        </p>
      ) : null}
      {assets.length > 0 ? (
        <ul aria-label="Media assets" className="studio-media-list">
          {assets.map((asset) => (
            <li className="studio-media-list__item" key={asset.id}>
              <button
                aria-label={`Select media ${asset.filename}`}
                aria-pressed={asset.id === selectedMediaId}
                className="studio-media-card"
                disabled={mediaBusy}
                onClick={() => selectAsset(asset)}
                type="button"
              >
                <img
                  alt=""
                  className="studio-media-card__thumbnail"
                  src={api.getMediaOriginalUrl(asset.id)}
                />
                <span className="studio-media-card__details">
                  <span className="studio-media-card__filename">{asset.filename}</span>
                  <span className="studio-media-card__meta">
                    {asset.width.toLocaleString()} × {asset.height.toLocaleString()} ·{" "}
                    {formatByteSize(asset.byteSize)}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {nextCursor !== null ? (
        <button
          aria-label="Load more media"
          className="studio-media-load-more"
          disabled={loadState === "loading"}
          onClick={() => void loadMedia(nextCursor)}
          type="button"
        >
          Load more
        </button>
      ) : null}
      {selectedAsset !== null ? (
        <div className="studio-media-selection">
          <Field error={altError} id="studio-media-alt" label="Alt text">
            <Input
              aria-label="Alt text"
              disabled={mediaBusy}
              onBlur={(event) => void saveAlt(event.currentTarget.value)}
              onChange={(event) =>
                setAltDrafts((current) => ({ ...current, [selectedAsset.id]: event.target.value }))
              }
              value={selectedAlt}
            />
          </Field>
          <div className="studio-media-selection__actions">
            <Button
              aria-label="Save alt text"
              disabled={mediaBusy || selectedAltIsSaved}
              loading={altState === "loading"}
              onClick={() => void saveAlt(selectedAlt)}
              variant="secondary"
            >
              Save
            </Button>
            <Button
              aria-label="Insert image"
              disabled={
                mediaBusy || !selectedAltIsSaved || insertState === "loading" || editorDisabled
              }
              loading={insertState === "loading"}
              onClick={insertAsset}
              variant="primary"
            >
              Insert
            </Button>
            <Button
              aria-label={`Delete media ${selectedAsset.filename}`}
              disabled={mediaBusy}
              loading={deleteState === "loading"}
              onClick={() => void deleteAsset()}
              variant="ghost"
            >
              Trash
            </Button>
          </div>
          {deleteError !== null ? (
            <p className="studio-media-status studio-media-status--error" role="alert">
              {deleteError}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
