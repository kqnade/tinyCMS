export const CONTENT_VERSION = 1 as const;

const MAX_DEPTH = 128;
const MAX_VALUES = 1_000;
const MAX_ISSUES = 64;
const UUIDV7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

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

export type StudioImageAttrs = {
  readonly mediaId: string;
  readonly alt: string;
  readonly caption: string | null;
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

export function isAbsoluteHttpUrl(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.trim() !== value ||
    hasUrlControlCharacter(value)
  ) {
    return false;
  }
  try {
    const urlConstructor = (globalThis as unknown as { URL?: UrlConstructor }).URL;
    if (urlConstructor === undefined) {
      return false;
    }
    const url = new urlConstructor(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.hostname.length > 0 &&
      url.username.length === 0 &&
      url.password.length === 0 &&
      !/^[a-z][a-z\d+.-]*:\/\/[^/?#]*@/i.test(value)
    );
  } catch {
    return false;
  }
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

    const content = normalizeChildren(value.content, [...path, "content"], context, "doc");
    if (content === undefined) return undefined;
    return { type: "doc", content } satisfies RawTiptapDoc;
  });
}

function normalizeChildren(
  input: unknown,
  path: Path,
  context: NormalizationContext,
  parentType: string,
) {
  return withArray(input, path, context, (values) => {
    const content: RawTiptapNode[] = [];
    for (let index = 0; index < values.length && !context.isHalted; index += 1) {
      const node = normalizeNode(values[index], [...path, index], context, parentType);
      if (node === undefined) return undefined;
      content.push(node);
    }
    return content;
  });
}

function normalizeNode(
  input: unknown,
  path: Path,
  context: NormalizationContext,
  parentType: string,
) {
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

    if (value.type === "image") {
      return normalizeImageNode(value, path, context, parentType);
    }

    const hasAttrs = hasOwn(value, "attrs");
    const attrs =
      value.type === "tableCell" || value.type === "tableHeader"
        ? normalizeTableCellAttrs(value.attrs, [...path, "attrs"], context)
        : value.type === "orderedList"
          ? normalizeOrderedListAttrs(value.attrs, [...path, "attrs"], context)
          : value.type === "taskItem" && hasAttrs
            ? normalizeTaskItemAttrs(value.attrs, [...path, "attrs"], context)
            : hasAttrs
              ? normalizeJsonRecord(value.attrs, [...path, "attrs"], context)
              : undefined;
    const content = hasOwn(value, "content")
      ? normalizeChildren(value.content, [...path, "content"], context, value.type)
      : undefined;
    const text = hasOwn(value, "text")
      ? normalizeText(value.text, [...path, "text"], context)
      : undefined;
    const marks = hasOwn(value, "marks")
      ? normalizeMarks(value.marks, [...path, "marks"], context)
      : undefined;

    if (
      ((hasAttrs || value.type === "orderedList") && attrs === undefined) ||
      (hasOwn(value, "content") && content === undefined) ||
      (hasOwn(value, "text") && text === undefined) ||
      (hasOwn(value, "marks") && marks === undefined)
    ) {
      return undefined;
    }

    if ((value.type === "table" || value.type === "tableRow") && hasAttrs) {
      context.add(
        [...path, "attrs"],
        "invalid_table_attrs",
        "Tables and table rows do not accept attributes",
      );
      return undefined;
    }

    if (!validateTableStructure(value.type, parentType, content, path, context)) {
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

function normalizeImageNode(
  value: Record<string, unknown>,
  path: Path,
  context: NormalizationContext,
  parentType: string,
): RawTiptapNode | undefined {
  if (!hasOnlyKeys(value, ["type", "attrs"], path, context)) return undefined;
  if (parentType !== "doc") {
    context.add(
      [...path, "type"],
      "invalid_image_nesting",
      "Images are only allowed as top-level document blocks",
    );
    return undefined;
  }

  const attrs = normalizeImageAttrs(value.attrs, [...path, "attrs"], context);
  if (attrs === undefined) return undefined;
  return { type: "image", attrs };
}

function normalizeImageAttrs(
  input: unknown,
  path: Path,
  context: NormalizationContext,
): StudioImageAttrs | undefined {
  const attrs = normalizeJsonRecord(input, path, context);
  if (attrs === undefined || !hasOnlyKeys(attrs, ["mediaId", "alt", "caption"], path, context)) {
    return undefined;
  }

  if (typeof attrs.mediaId !== "string" || !UUIDV7_PATTERN.test(attrs.mediaId)) {
    context.add(
      [...path, "mediaId"],
      "invalid_media_id",
      "Image mediaId must be a lowercase UUIDv7",
    );
    return undefined;
  }
  if (typeof attrs.alt !== "string") {
    context.add([...path, "alt"], "invalid_image_alt", "Image alt must be a string");
    return undefined;
  }
  if (attrs.caption !== null && typeof attrs.caption !== "string") {
    context.add(
      [...path, "caption"],
      "invalid_image_caption",
      "Image caption must be a string or null",
    );
    return undefined;
  }

  return {
    mediaId: attrs.mediaId,
    alt: attrs.alt,
    caption: attrs.caption,
  };
}

function validateTableStructure(
  type: string,
  parentType: string,
  content: readonly RawTiptapNode[] | undefined,
  path: Path,
  context: NormalizationContext,
): boolean {
  if (type === "table" && parentType !== "doc") {
    context.add(
      [...path, "type"],
      "invalid_table_nesting",
      "Tables are only allowed as top-level document blocks",
    );
    return false;
  }

  if (type === "tableRow" && parentType !== "table") {
    context.add(
      [...path, "type"],
      "invalid_table_nesting",
      "Table rows are only allowed inside tables",
    );
    return false;
  }

  if ((type === "tableCell" || type === "tableHeader") && parentType !== "tableRow") {
    context.add(
      [...path, "type"],
      "invalid_table_nesting",
      "Table cells are only allowed inside table rows",
    );
    return false;
  }

  if (type === "table") {
    if (content === undefined || content.length < 2) {
      context.add(
        [...path, "content"],
        "invalid_table_content",
        "Tables must contain at least two rows",
      );
      return false;
    }
    if (content.length > 100) {
      context.add(
        [...path, "content"],
        "invalid_table_content",
        "Tables must contain no more than 100 rows",
      );
      return false;
    }
    if (content.some((child) => child.type !== "tableRow")) {
      context.add(
        [...path, "content"],
        "invalid_table_content",
        "Table content must contain tableRow nodes",
      );
      return false;
    }

    const columnCount = content[0]?.content?.length;
    if (columnCount === undefined || columnCount > 20) {
      context.add(
        [...path, "content", 0, "content"],
        "invalid_table_content",
        "Tables must contain no more than 20 columns",
      );
      return false;
    }
    if (content.reduce((count, row) => count + (row.content?.length ?? 0), 0) > 400) {
      context.add(
        [...path, "content"],
        "invalid_table_content",
        "Tables must contain no more than 400 cells",
      );
      return false;
    }
    for (const [index, row] of content.entries()) {
      if (columnCount !== row.content?.length) {
        context.add(
          [...path, "content", index, "content"],
          "invalid_table_content",
          "Table rows must contain the same number of cells",
        );
        return false;
      }
      const expectedCellType = index === 0 ? "tableHeader" : "tableCell";
      if (row.content?.some((cell) => cell.type !== expectedCellType)) {
        context.add(
          [...path, "content", index, "content"],
          "invalid_table_content",
          index === 0
            ? "The first table row must contain tableHeader nodes"
            : "Table body rows must contain tableCell nodes",
        );
        return false;
      }
    }
  }

  if (type === "tableRow") {
    if (content === undefined || content.length === 0) {
      context.add(
        [...path, "content"],
        "invalid_table_content",
        "Table rows must contain at least one cell",
      );
      return false;
    }
    if (content.some((child) => child.type !== "tableCell" && child.type !== "tableHeader")) {
      context.add(
        [...path, "content"],
        "invalid_table_content",
        "Table rows must contain table cells",
      );
      return false;
    }
  }

  if (type === "tableCell" || type === "tableHeader") {
    if (content === undefined || content.length !== 1 || content[0]?.type !== "paragraph") {
      context.add(
        [...path, "content"],
        "invalid_table_cell_content",
        "Table cells must contain exactly one paragraph",
      );
      return false;
    }
  }

  return true;
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

function normalizeOrderedListAttrs(input: unknown, path: Path, context: NormalizationContext) {
  const attrs = normalizeJsonRecord(input, path, context);
  if (attrs === undefined) return undefined;
  if (!hasOnlyKeys(attrs, ["start", "type"], path, context)) return undefined;

  const start = attrs.start;
  if (typeof start !== "number" || !Number.isSafeInteger(start) || start < 1) {
    context.add(
      [...path, "start"],
      "invalid_start",
      "Ordered list start must be a positive safe integer",
    );
    return undefined;
  }

  if (hasOwn(attrs, "type") && attrs.type !== null && attrs.type !== "1") {
    context.add(
      [...path, "type"],
      "invalid_ordered_list_type",
      "Ordered list type must be decimal",
    );
    return undefined;
  }

  return { start };
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
      if (!isAbsoluteHttpUrl(attrs.href)) {
        context.add(
          [...path, "attrs", "href"],
          "invalid_link_href",
          "Link mark href must be an absolute HTTP(S) URL without credentials",
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

type UrlConstructor = new (
  value: string,
) => {
  readonly protocol: string;
  readonly hostname: string;
  readonly username: string;
  readonly password: string;
};

function hasUrlControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 0x20 || code === 0x7f) {
      return true;
    }
  }
  return false;
}
