import { useCallback, useEffect, useRef, useState } from "react";
import {
  cloneEditorContent,
  createEmptyEditorContent,
  type EditorContent,
  parseEditorContent,
  type RawTiptapDoc,
} from "./editor-content";

export type JsonValue = null | boolean | number | string | readonly JsonValue[] | JsonObject;

export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export type DraftSaveRequest = {
  readonly expectedDraftVersion: number;
  readonly title: string;
  readonly contentVersion: 1;
  readonly content: RawTiptapDoc;
  readonly excerpt?: string | null;
  readonly metadata?: JsonObject;
};

export type DraftSaveResult =
  | { readonly ok: true; readonly draftVersion: number }
  | { readonly ok: false; readonly code: "CONFLICT" | "ERROR" };

export type DraftPersistence = {
  saveDraft: (request: DraftSaveRequest) => Promise<DraftSaveResult>;
};

export type DraftSnapshot = {
  readonly title: string;
  readonly content: EditorContent;
  readonly draftVersion: number;
  readonly excerpt?: string | null;
  readonly metadata?: JsonObject;
};

export type DraftSaveState = "dirty" | "saving" | "saved" | "conflict" | "error";

export type DraftSessionOptions = {
  readonly autosaveDelay?: number;
  readonly initialContent?: EditorContent;
  readonly initialDraftVersion?: number;
  readonly initialTitle?: string;
  readonly initialExcerpt?: string | null;
  readonly initialMetadata?: JsonObject;
  readonly persistence?: DraftPersistence;
};

export type DraftSession = {
  readonly content: EditorContent;
  readonly draftVersion: number;
  readonly getSnapshot: () => DraftSnapshot;
  readonly getSaveState: () => DraftSaveState;
  readonly hydrate: (snapshot: DraftSnapshot) => void;
  readonly markSaveState: (state: DraftSaveState) => void;
  readonly save: () => Promise<void>;
  readonly saveState: DraftSaveState;
  readonly setContent: (content: EditorContent) => void;
  readonly setTitle: (title: string) => void;
  readonly title: string;
};

const defaultAutosaveDelay = 2_000;

function assertDraftVersion(draftVersion: number): number {
  if (!Number.isSafeInteger(draftVersion) || draftVersion < 1) {
    throw new RangeError("Initial draftVersion must be a positive integer");
  }

  return draftVersion;
}

function cloneJsonValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(cloneJsonValue);
  if (value !== null && typeof value === "object") {
    const clone: Record<string, JsonValue> = {};
    for (const [key, child] of Object.entries(value)) {
      clone[key] = cloneJsonValue(child);
    }
    return clone;
  }
  return value;
}

function cloneJsonObject(value: JsonObject): JsonObject {
  return cloneJsonValue(value) as JsonObject;
}

function snapshotsEqual(left: DraftSnapshot, right: DraftSnapshot): boolean {
  return (
    left.title === right.title &&
    JSON.stringify(left.content) === JSON.stringify(right.content) &&
    left.draftVersion === right.draftVersion &&
    left.excerpt === right.excerpt &&
    JSON.stringify(left.metadata) === JSON.stringify(right.metadata)
  );
}

function normalizeSaveResult(
  result: DraftSaveResult,
):
  | { readonly kind: "success"; readonly draftVersion: number }
  | { readonly kind: "conflict" }
  | { readonly kind: "error" } {
  if (result.ok === true) {
    return { draftVersion: result.draftVersion, kind: "success" };
  }

  if (result.ok === false && result.code === "CONFLICT") {
    return { kind: "conflict" };
  }

  return { kind: "error" };
}

function createInitialSnapshot(options: DraftSessionOptions): DraftSnapshot {
  const content = options.initialContent
    ? parseEditorContent(options.initialContent)
    : createEmptyEditorContent();
  const metadata =
    options.initialMetadata === undefined ? undefined : cloneJsonObject(options.initialMetadata);

  return {
    content,
    draftVersion: assertDraftVersion(options.initialDraftVersion ?? 1),
    title: options.initialTitle ?? "",
    ...(options.initialExcerpt === undefined ? {} : { excerpt: options.initialExcerpt }),
    ...(metadata === undefined ? {} : { metadata }),
  };
}

export function useDraftSession(options: DraftSessionOptions = {}): DraftSession {
  const initialSnapshotRef = useRef<DraftSnapshot | null>(null);
  if (initialSnapshotRef.current === null) {
    initialSnapshotRef.current = createInitialSnapshot(options);
  }
  const initialSnapshot = initialSnapshotRef.current;
  const [snapshot, setSnapshot] = useState<DraftSnapshot>(initialSnapshot);
  const [saveState, setSaveState] = useState<DraftSaveState>("saved");
  const snapshotRef = useRef(snapshot);
  const saveStateRef = useRef(saveState);
  const persistenceRef = useRef(options.persistence);
  const pendingSaveRef = useRef<Promise<void> | null>(null);
  const saveGenerationRef = useRef(0);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const autosaveDelay = options.autosaveDelay ?? defaultAutosaveDelay;

  snapshotRef.current = snapshot;
  saveStateRef.current = saveState;
  persistenceRef.current = options.persistence;

  const updateState = useCallback((nextState: DraftSaveState) => {
    saveStateRef.current = nextState;
    setSaveState(nextState);
  }, []);

  const updateSnapshot = useCallback((nextSnapshot: DraftSnapshot) => {
    snapshotRef.current = nextSnapshot;
    setSnapshot(nextSnapshot);
  }, []);

  const scheduleAutosave = useCallback(() => {
    if (!persistenceRef.current) return;
    if (autosaveTimerRef.current !== null) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(
      () => {
        autosaveTimerRef.current = null;
        void saveRef.current();
      },
      Math.max(0, autosaveDelay),
    );
  }, [autosaveDelay]);

  const save = useCallback(async (): Promise<void> => {
    const persistence = persistenceRef.current;
    if (!persistence) return;

    if (autosaveTimerRef.current !== null) {
      clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
    const currentState = saveStateRef.current;
    const pendingSave = pendingSaveRef.current;
    if (pendingSave) return pendingSave;
    if (currentState !== "dirty" && currentState !== "conflict" && currentState !== "error") {
      return;
    }

    const snapshotAtRequest = snapshotRef.current;
    const generationAtRequest = saveGenerationRef.current;
    const requestContent = cloneEditorContent(snapshotAtRequest.content);
    const request: DraftSaveRequest = {
      expectedDraftVersion: snapshotAtRequest.draftVersion,
      title: snapshotAtRequest.title,
      contentVersion: requestContent.contentVersion,
      content: requestContent.content,
      ...(snapshotAtRequest.excerpt === undefined ? {} : { excerpt: snapshotAtRequest.excerpt }),
      ...(snapshotAtRequest.metadata === undefined
        ? {}
        : { metadata: cloneJsonObject(snapshotAtRequest.metadata) }),
    };
    updateState("saving");

    const pending = Promise.resolve()
      .then(() => persistence.saveDraft(request))
      .then((result) => {
        if (generationAtRequest !== saveGenerationRef.current) return;
        if (autosaveTimerRef.current !== null) {
          clearTimeout(autosaveTimerRef.current);
          autosaveTimerRef.current = null;
        }
        const normalized = normalizeSaveResult(result);
        const latestSnapshot = snapshotRef.current;
        const unchanged = snapshotsEqual(latestSnapshot, snapshotAtRequest);

        if (normalized.kind === "success") {
          if (
            Number.isSafeInteger(normalized.draftVersion) &&
            normalized.draftVersion === request.expectedDraftVersion + 1
          ) {
            updateSnapshot({
              ...latestSnapshot,
              draftVersion: normalized.draftVersion,
            });
            updateState(unchanged ? "saved" : "dirty");
            if (!unchanged) scheduleAutosave();
          } else {
            updateState("error");
          }
          return;
        }

        if (normalized.kind === "conflict") {
          updateState("conflict");
          return;
        }

        updateState(unchanged ? "error" : "dirty");
        if (!unchanged) scheduleAutosave();
      })
      .catch(() => {
        if (generationAtRequest !== saveGenerationRef.current) return;
        if (autosaveTimerRef.current !== null) {
          clearTimeout(autosaveTimerRef.current);
          autosaveTimerRef.current = null;
        }
        const unchanged = snapshotsEqual(snapshotRef.current, snapshotAtRequest);
        updateState(unchanged ? "error" : "dirty");
        if (!unchanged) scheduleAutosave();
      })
      .finally(() => {
        if (generationAtRequest === saveGenerationRef.current) {
          pendingSaveRef.current = null;
        }
      });

    pendingSaveRef.current = pending;
    return pending;
  }, [scheduleAutosave, updateSnapshot, updateState]);

  saveRef.current = save;

  useEffect(
    () => () => {
      if (autosaveTimerRef.current !== null) clearTimeout(autosaveTimerRef.current);
    },
    [],
  );

  const setTitle = useCallback(
    (title: string) => {
      updateSnapshot({ ...snapshotRef.current, title });
      updateState("dirty");
      scheduleAutosave();
    },
    [scheduleAutosave, updateSnapshot, updateState],
  );

  const setContent = useCallback(
    (content: EditorContent) => {
      updateSnapshot({ ...snapshotRef.current, content: cloneEditorContent(content) });
      updateState("dirty");
      scheduleAutosave();
    },
    [scheduleAutosave, updateSnapshot, updateState],
  );

  const getSnapshot = useCallback((): DraftSnapshot => {
    const current = snapshotRef.current;
    return {
      content: cloneEditorContent(current.content),
      draftVersion: current.draftVersion,
      title: current.title,
      ...(current.excerpt === undefined ? {} : { excerpt: current.excerpt }),
      ...(current.metadata === undefined ? {} : { metadata: cloneJsonObject(current.metadata) }),
    };
  }, []);

  const hydrate = useCallback(
    (nextSnapshot: DraftSnapshot) => {
      const hydrated: DraftSnapshot = {
        content: cloneEditorContent(nextSnapshot.content),
        draftVersion: assertDraftVersion(nextSnapshot.draftVersion),
        title: nextSnapshot.title,
        ...(nextSnapshot.excerpt === undefined ? {} : { excerpt: nextSnapshot.excerpt }),
        ...(nextSnapshot.metadata === undefined
          ? {}
          : { metadata: cloneJsonObject(nextSnapshot.metadata) }),
      };
      saveGenerationRef.current += 1;
      if (autosaveTimerRef.current !== null) {
        clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
      pendingSaveRef.current = null;
      updateSnapshot(hydrated);
      updateState("saved");
    },
    [updateSnapshot, updateState],
  );

  const markSaveState = useCallback(
    (nextState: DraftSaveState) => {
      updateState(nextState);
    },
    [updateState],
  );

  const getSaveState = useCallback(() => saveStateRef.current, []);

  return {
    content: snapshot.content,
    draftVersion: snapshot.draftVersion,
    getSnapshot,
    getSaveState,
    hydrate,
    markSaveState,
    save,
    saveState,
    setContent,
    setTitle,
    title: snapshot.title,
  };
}
