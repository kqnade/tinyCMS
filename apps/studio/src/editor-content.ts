export const CONTENT_VERSION = 1 as const;

const MAX_DEPTH = 128;
const MAX_VALUES = 1_000;
const MAX_ISSUES = 64;

type Path = readonly (string | number)[];
type JsonRecord = Readonly<Record<string, unknown>>;

export type RawTiptapMark = {
  readonly type: string;
  readonly attrs?: JsonRecord;
};

export type RawTiptapNode = {
  readonly type: string;
  readonly attrs?: JsonRecord;
  readonly content?: readonly RawTiptapNode[];
  readonly text?: string;
  readonly marks?: readonly RawTiptapMark[];
};

export type RawTiptapDoc = {
  readonly type: "doc";
  readonly content: readonly RawTiptapNode[];
};

export type EditorContent = {
  readonly contentVersion: typeof CONTENT_VERSION;
  readonly content: RawTiptapDoc;
};

export type EditorContentNormalizationIssue = {
  readonly code: string;
  readonly message: string;
  readonly path: Path;
};

export class EditorContentNormalizationError extends Error {
  readonly issues: readonly EditorContentNormalizationIssue[];

  constructor(issues: readonly EditorContentNormalizationIssue[]) {
    super("Studio editor content normalization failed");
    this.name = "EditorContentNormalizationError";
    this.issues = issues.map((issue) => ({
      code: issue.code,
      message: issue.message,
      path: [...issue.path],
    }));
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export type EditorContentNormalizationResult =
  | { readonly ok: true; readonly value: EditorContent }
  | { readonly ok: false; readonly error: EditorContentNormalizationError };

export function createEmptyEditorContent(): EditorContent {
  return createEditorContent({ type: "doc", content: [] });
}

export function createEditorContent(content: RawTiptapDoc): EditorContent {
  return parseEditorContent({ contentVersion: CONTENT_VERSION, content });
}

export function cloneEditorContent(content: EditorContent): EditorContent {
  return parseEditorContent(content);
}

export function getEditorContent(content: EditorContent): EditorContent {
  return cloneEditorContent(content);
}

export function setEditorContent(_content: EditorContent, content: RawTiptapDoc): EditorContent {
  return createEditorContent(content);
}

export function normalizeEditorContent(input: unknown): EditorContentNormalizationResult {
  const context = new NormalizationContext();
  let value: EditorContent | undefined;

  try {
    value = normalizeEnvelope(input, [], context);
  } catch {
    context.add([], "invalid_value", "Content could not be read safely");
  }

  if (value !== undefined && context.issues.length === 0) {
    return { ok: true, value };
  }

  return {
    ok: false,
    error: new EditorContentNormalizationError(context.issues),
  };
}

export function parseEditorContent(input: unknown): EditorContent {
  const result = normalizeEditorContent(input);
  if (!result.ok) {
    throw result.error;
  }
  return result.value;
}

class NormalizationContext {
  readonly issues: EditorContentNormalizationIssue[] = [];
  readonly activeValues = new WeakSet<object>();
  private valueCount = 0;
  private halted = false;

  get isHalted(): boolean {
    return this.halted;
  }

  add(path: Path, code: string, message: string): void {
    if (this.halted || this.issues.length >= MAX_ISSUES) return;

    this.issues.push({ code, message, path: [...path] });
    if (this.issues.length >= MAX_ISSUES) this.halted = true;
  }

  stop(path: Path, code: string, message: string): void {
    if (this.halted) return;
    this.add(path, code, message);
    this.halted = true;
  }

  enter(value: object, path: Path): boolean {
    if (this.halted) return false;
    this.valueCount += 1;
    if (this.valueCount > MAX_VALUES) {
      this.stop(path, "max_values", "Content contains too many values");
      return false;
    }
    if (path.length > MAX_DEPTH) {
      this.stop(path, "max_depth", "Content nesting is too deep");
      return false;
    }
    if (this.activeValues.has(value)) {
      this.add(path, "cycle", "Content cannot contain cyclic values");
      return false;
    }
    this.activeValues.add(value);
    return true;
  }

  leave(value: object): void {
    this.activeValues.delete(value);
  }
}

function normalizeEnvelope(input: unknown, path: Path, context: NormalizationContext) {
  return withRecord(input, path, context, (value) => {
    if (!hasOnlyKeys(value, ["contentVersion", "content"], path, context)) return undefined;
    if (value.contentVersion !== CONTENT_VERSION) {
      context.add(
        [...path, "contentVersion"],
        "unsupported_version",
        "Content version must be the supported numeric version",
      );
    }

    const content = normalizeDocument(value.content, [...path, "content"], context);
    if (content === undefined) return undefined;
    return { contentVersion: CONTENT_VERSION, content } satisfies EditorContent;
  });
}

function normalizeDocument(input: unknown, path: Path, context: NormalizationContext) {
  return withRecord(input, path, context, (value) => {
    if (!hasOnlyKeys(value, ["type", "content"], path, context)) return undefined;
    if (value.type !== "doc") {
      context.add([...path, "type"], "invalid_document_type", "Document type must be doc");
    }

    const content = normalizeChildren(value.content, [...path, "content"], context);
    if (content === undefined) return undefined;
    return { type: "doc", content } satisfies RawTiptapDoc;
  });
}

function normalizeChildren(input: unknown, path: Path, context: NormalizationContext) {
  return withArray(input, path, context, (values) => {
    const content: RawTiptapNode[] = [];
    for (let index = 0; index < values.length && !context.isHalted; index += 1) {
      const node = normalizeNode(values[index], [...path, index], context);
      if (node === undefined) return undefined;
      content.push(node);
    }
    return content;
  });
}

function normalizeNode(input: unknown, path: Path, context: NormalizationContext) {
  return withRecord(input, path, context, (value) => {
    if (!hasOnlyKeys(value, ["type", "attrs", "content", "text", "marks"], path, context)) {
      return undefined;
    }
    if (typeof value.type !== "string") {
      context.add([...path, "type"], "invalid_node_type", "Node type must be a string");
      return undefined;
    }
    if (value.type === "html") {
      context.add(
        [...path, "type"],
        "raw_html_not_allowed",
        "Raw HTML nodes are not supported by the Studio editor",
      );
      return undefined;
    }

    const hasAttrs = hasOwn(value, "attrs");
    const attrs =
      value.type === "tableCell" || value.type === "tableHeader"
        ? normalizeTableCellAttrs(value.attrs, [...path, "attrs"], context)
        : value.type === "taskItem" && hasAttrs
          ? normalizeTaskItemAttrs(value.attrs, [...path, "attrs"], context)
          : hasAttrs
            ? normalizeJsonRecord(value.attrs, [...path, "attrs"], context)
            : undefined;
    const content = hasOwn(value, "content")
      ? normalizeChildren(value.content, [...path, "content"], context)
      : undefined;
    const text = hasOwn(value, "text")
      ? normalizeText(value.text, [...path, "text"], context)
      : undefined;
    const marks = hasOwn(value, "marks")
      ? normalizeMarks(value.marks, [...path, "marks"], context)
      : undefined;

    if (
      (hasAttrs && attrs === undefined) ||
      (hasOwn(value, "content") && content === undefined) ||
      (hasOwn(value, "text") && text === undefined) ||
      (hasOwn(value, "marks") && marks === undefined)
    ) {
      return undefined;
    }

    return {
      type: value.type,
      ...(attrs === undefined ? {} : { attrs }),
      ...(content === undefined ? {} : { content }),
      ...(text === undefined ? {} : { text }),
      ...(marks === undefined ? {} : { marks }),
    } satisfies RawTiptapNode;
  });
}

function normalizeTaskItemAttrs(input: unknown, path: Path, context: NormalizationContext) {
  const attrs = normalizeJsonRecord(input, path, context);
  if (attrs === undefined) return undefined;
  if (typeof attrs.checked !== "boolean") {
    context.add(
      [...path, "checked"],
      "invalid_task_item_checked",
      "Task item checked must be a boolean",
    );
    return undefined;
  }
  return { checked: attrs.checked };
}

function normalizeTableCellAttrs(input: unknown, path: Path, context: NormalizationContext) {
  if (input !== undefined && normalizeJsonRecord(input, path, context) === undefined) {
    return undefined;
  }
  return { colspan: 1, rowspan: 1, colwidth: null } as const;
}

function normalizeText(input: unknown, path: Path, context: NormalizationContext) {
  if (typeof input !== "string") {
    context.add(path, "invalid_text", "Text node text must be a string");
    return undefined;
  }
  return input;
}

function normalizeMarks(input: unknown, path: Path, context: NormalizationContext) {
  return withArray(input, path, context, (values) => {
    const marks: RawTiptapMark[] = [];
    for (let index = 0; index < values.length && !context.isHalted; index += 1) {
      const mark = normalizeMark(values[index], [...path, index], context);
      if (mark === undefined) return undefined;
      marks.push(mark);
    }
    return marks;
  });
}

function normalizeMark(input: unknown, path: Path, context: NormalizationContext) {
  return withRecord(input, path, context, (value) => {
    if (!hasOnlyKeys(value, ["type", "attrs"], path, context)) return undefined;
    if (typeof value.type !== "string") {
      context.add([...path, "type"], "invalid_mark_type", "Mark type must be a string");
      return undefined;
    }

    const hasAttrs = hasOwn(value, "attrs");
    const attrs = hasAttrs
      ? normalizeJsonRecord(value.attrs, [...path, "attrs"], context)
      : undefined;
    if (hasAttrs && attrs === undefined) return undefined;

    if (value.type === "link") {
      if (typeof attrs?.href !== "string") {
        context.add(
          [...path, "attrs", "href"],
          "invalid_link_href",
          "Link mark href must be a string",
        );
        return undefined;
      }
      return { type: "link", attrs: { href: attrs.href } } satisfies RawTiptapMark;
    }

    return {
      type: value.type,
      ...(attrs === undefined ? {} : { attrs }),
    } satisfies RawTiptapMark;
  });
}

function normalizeJsonRecord(input: unknown, path: Path, context: NormalizationContext) {
  return withRecord(input, path, context, (value) => {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      const parsed = normalizeJsonValue(value[key], [...path, key], context);
      if (parsed === undefined) return undefined;
      result[key] = parsed;
    }
    return result as JsonRecord;
  });
}

function normalizeJsonValue(input: unknown, path: Path, context: NormalizationContext): unknown {
  if (input === null || typeof input === "string" || typeof input === "boolean") return input;
  if (typeof input === "number") {
    if (Number.isFinite(input)) return input;
    context.add(path, "invalid_json_value", "JSON numbers must be finite");
    return undefined;
  }
  if (Array.isArray(input)) {
    return withArray(input, path, context, (values) => {
      const result: unknown[] = [];
      for (let index = 0; index < values.length && !context.isHalted; index += 1) {
        const parsed = normalizeJsonValue(values[index], [...path, index], context);
        if (parsed === undefined) return undefined;
        result.push(parsed);
      }
      return result;
    });
  }
  if (isPlainRecord(input)) return normalizeJsonRecord(input, path, context);

  context.add(path, "invalid_json_value", "Value must be JSON-compatible");
  return undefined;
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
  path: Path,
  context: NormalizationContext,
) {
  const allowed = new Set(allowedKeys);
  let valid = true;
  for (const key of Object.keys(value)) {
    if (context.isHalted) break;
    if (!allowed.has(key)) {
      context.add([...path, key], "unknown_key", "Unknown property is not allowed");
      valid = false;
    }
  }
  return valid;
}

function withRecord<T>(
  input: unknown,
  path: Path,
  context: NormalizationContext,
  callback: (value: Record<string, unknown>) => T | undefined,
): T | undefined {
  if (!isPlainRecord(input)) {
    context.add(path, "invalid_object", "Value must be an object");
    return undefined;
  }
  if (!context.enter(input, path)) return undefined;

  try {
    return callback(input);
  } finally {
    context.leave(input);
  }
}

function withArray<T>(
  input: unknown,
  path: Path,
  context: NormalizationContext,
  callback: (value: unknown[]) => T | undefined,
): T | undefined {
  if (!Array.isArray(input)) {
    context.add(path, "invalid_array", "Value must be an array");
    return undefined;
  }
  if (!context.enter(input, path)) return undefined;

  try {
    return callback(input);
  } finally {
    context.leave(input);
  }
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.hasOwn(value, key);
}

function isPlainRecord(input: unknown): input is Record<string, unknown> {
  if (input === null || typeof input !== "object") return false;
  const prototype = Object.getPrototypeOf(input);
  return prototype === Object.prototype || prototype === null;
}
