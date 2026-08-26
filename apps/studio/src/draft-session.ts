import { useCallback, useEffect, useRef, useState } from "react";
import {
  cloneEditorContent,
  createEmptyEditorContent,
  type EditorContentEnvelope,
  parseEditorContent,
} from "./editor-content";

export type DraftSaveRequest = {
  readonly title: string;
  readonly content: EditorContentEnvelope;
  readonly expectedDraftVersion: number;
};

export type DraftSaveResult =
  | { readonly ok: true; readonly draftVersion: number }
  | { readonly ok: false; readonly code: "CONFLICT" | "ERROR" };

export type DraftPersistence = {
  saveDraft: (request: DraftSaveRequest) => Promise<DraftSaveResult>;
};

export type DraftSnapshot = {
  readonly title: string;
  readonly content: EditorContentEnvelope;
  readonly draftVersion: number;
};

export type DraftSaveState = "dirty" | "saving" | "saved" | "conflict" | "error";

export type DraftSessionOptions = {
  readonly autosaveDelay?: number;
  readonly initialContent?: EditorContentEnvelope;
  readonly initialDraftVersion?: number;
  readonly initialTitle?: string;
  readonly persistence?: DraftPersistence;
};

export type DraftSession = {
  readonly content: EditorContentEnvelope;
  readonly draftVersion: number;
  readonly save: () => Promise<void>;
  readonly saveState: DraftSaveState;
  readonly setContent: (content: EditorContentEnvelope) => void;
  readonly setTitle: (title: string) => void;
  readonly title: string;
};

const defaultAutosaveDelay = 500;

function assertDraftVersion(draftVersion: number): number {
  if (!Number.isSafeInteger(draftVersion) || draftVersion < 1) {
    throw new RangeError("Initial draftVersion must be a positive integer");
  }

  return draftVersion;
}

function snapshotsEqual(left: DraftSnapshot, right: DraftSnapshot): boolean {
  return (
    left.title === right.title &&
    JSON.stringify(left.content) === JSON.stringify(right.content) &&
    left.draftVersion === right.draftVersion
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

  return {
    content,
    draftVersion: assertDraftVersion(options.initialDraftVersion ?? 1),
    title: options.initialTitle ?? "",
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
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
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

    const currentState = saveStateRef.current;
    const pendingSave = pendingSaveRef.current;
    if (pendingSave) return pendingSave;
    if (currentState !== "dirty" && currentState !== "conflict" && currentState !== "error") {
      return;
    }

    const snapshotAtRequest = snapshotRef.current;
    const request: DraftSaveRequest = {
      content: cloneEditorContent(snapshotAtRequest.content),
      expectedDraftVersion: snapshotAtRequest.draftVersion,
      title: snapshotAtRequest.title,
    };
    updateState("saving");

    const pending = Promise.resolve()
      .then(() => persistence.saveDraft(request))
      .then((result) => {
        if (autosaveTimerRef.current) {
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
        if (autosaveTimerRef.current) {
          clearTimeout(autosaveTimerRef.current);
          autosaveTimerRef.current = null;
        }
        const unchanged = snapshotsEqual(snapshotRef.current, snapshotAtRequest);
        updateState(unchanged ? "error" : "dirty");
        if (!unchanged) scheduleAutosave();
      })
      .finally(() => {
        pendingSaveRef.current = null;
      });

    pendingSaveRef.current = pending;
    return pending;
  }, [scheduleAutosave, updateSnapshot, updateState]);

  saveRef.current = save;

  useEffect(
    () => () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
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
    (content: EditorContentEnvelope) => {
      updateSnapshot({ ...snapshotRef.current, content: cloneEditorContent(content) });
      updateState("dirty");
      scheduleAutosave();
    },
    [scheduleAutosave, updateSnapshot, updateState],
  );

  return {
    content: snapshot.content,
    draftVersion: snapshot.draftVersion,
    save,
    saveState,
    setContent,
    setTitle,
    title: snapshot.title,
  };
}
