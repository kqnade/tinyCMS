export const CONTENT_VERSION = 1 as const;

export type EditorDocument = {
  readonly type: "doc";
  readonly content: readonly EditorNode[];
};

export type EditorNode = {
  readonly type: string;
  readonly attrs?: Readonly<Record<string, unknown>>;
  readonly content?: readonly EditorNode[];
  readonly text?: string;
  readonly marks?: readonly EditorMark[];
};

export type EditorMark = {
  readonly type: string;
  readonly attrs?: Readonly<Record<string, unknown>>;
};

export type EditorTaskItemNode = {
  readonly type: "taskItem";
  readonly attrs: { readonly checked: boolean };
  readonly content: readonly EditorNode[];
};

export type EditorTaskListNode = {
  readonly type: "taskList";
  readonly content: readonly EditorTaskItemNode[];
};

export type EditorTableCellNode = {
  readonly type: "tableCell" | "tableHeader";
  readonly attrs: {
    readonly colspan: 1;
    readonly rowspan: 1;
    readonly colwidth: null;
  };
  readonly content: readonly [EditorNode];
};

export type EditorTableRowNode = {
  readonly type: "tableRow";
  readonly content: readonly EditorTableCellNode[];
};

export type EditorTableNode = {
  readonly type: "table";
  readonly content: readonly EditorTableRowNode[];
};

export type EditorContentEnvelope = {
  readonly contentVersion: typeof CONTENT_VERSION;
  readonly document: EditorDocument;
};

export type EditorContentValidationIssue = {
  readonly code: string;
  readonly message: string;
  readonly path: readonly (string | number)[];
};

export class EditorContentValidationError extends Error {
  readonly issues: readonly EditorContentValidationIssue[];

  constructor(issues: readonly EditorContentValidationIssue[]) {
    super("Studio editor content validation failed");
    this.name = "EditorContentValidationError";
    this.issues = issues.map((issue) => ({
      code: issue.code,
      message: issue.message,
      path: [...issue.path],
    }));
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export type EditorContentValidationResult =
  | { readonly ok: true; readonly value: EditorContentEnvelope }
  | { readonly ok: false; readonly error: EditorContentValidationError };

export function createEmptyEditorContent(): EditorContentEnvelope {
  return createEditorContent({ type: "doc", content: [] });
}

export function createEditorContent(document: EditorDocument): EditorContentEnvelope {
  return parseEditorContent({ contentVersion: CONTENT_VERSION, document });
}

export function cloneEditorContent(content: EditorContentEnvelope): EditorContentEnvelope {
  return parseEditorContent(content);
}

export function getEditorContent(content: EditorContentEnvelope): EditorContentEnvelope {
  return cloneEditorContent(content);
}

export function setEditorContent(
  _content: EditorContentEnvelope,
  document: EditorDocument,
): EditorContentEnvelope {
  return createEditorContent(document);
}

export function validateEditorContent(input: unknown): EditorContentValidationResult {
  const context = new ValidationContext();
  const value = parseEnvelope(input, context);

  if (value !== undefined && context.issues.length === 0) {
    return { ok: true, value };
  }

  return {
    ok: false,
    error: new EditorContentValidationError(context.issues),
  };
}

export function parseEditorContent(input: unknown): EditorContentEnvelope {
  const result = validateEditorContent(input);

  if (!result.ok) {
    throw result.error;
  }

  return result.value;
}

class ValidationContext {
  readonly issues: EditorContentValidationIssue[] = [];
  readonly activeValues = new WeakSet<object>();
  private valueCount = 0;
  private halted = false;

  get isHalted(): boolean {
    return this.halted;
  }

  add(path: readonly (string | number)[], code: string, message: string): void {
    if (this.halted || this.issues.length >= 64) {
      return;
    }
    this.issues.push({ code, message, path: [...path] });
    if (this.issues.length >= 64) {
      this.halted = true;
    }
  }

  stop(path: readonly (string | number)[], code: string, message: string): void {
    if (this.halted) {
      return;
    }
    this.add(path, code, message);
    this.halted = true;
  }

  enter(value: object, path: readonly (string | number)[]): boolean {
    if (this.halted) {
      return false;
    }
    this.valueCount += 1;
    if (this.valueCount > 1_000) {
      this.stop(path, "max_values", "Content contains too many values");
      return false;
    }
    if (path.length > 128) {
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

function parseEnvelope(
  input: unknown,
  context: ValidationContext,
): EditorContentEnvelope | undefined {
  return withRecord(input, [], context, (value) => {
    if (!checkKeys(value, ["contentVersion", "document"], [], context)) {
      return undefined;
    }

    if (value.contentVersion !== CONTENT_VERSION) {
      context.add(
        ["contentVersion"],
        "unsupported_version",
        "Content version must be the supported numeric version",
      );
    }

    const document = parseDocument(value.document, ["document"], context);
    if (document === undefined) {
      return undefined;
    }

    return { contentVersion: CONTENT_VERSION, document };
  });
}

function parseDocument(
  input: unknown,
  path: readonly (string | number)[],
  context: ValidationContext,
): EditorDocument | undefined {
  return withRecord(input, path, context, (value) => {
    if (!checkKeys(value, ["type", "content"], path, context)) {
      return undefined;
    }
    if (value.type !== "doc") {
      context.add([...path, "type"], "invalid_document_type", "Document type must be doc");
    }

    const content = parseChildren(value.content, [...path, "content"], context);
    if (content === undefined) {
      return undefined;
    }

    return { type: "doc", content };
  });
}

function parseNode(
  input: unknown,
  path: readonly (string | number)[],
  context: ValidationContext,
): EditorNode | undefined {
  return withRecord(input, path, context, (value) => {
    if (typeof value.type !== "string") {
      context.add([...path, "type"], "invalid_node_type", "Node type must be a string");
      return undefined;
    }

    switch (value.type) {
      case "taskList":
        return parseTaskList(value, path, context);
      case "taskItem":
        return parseTaskItem(value, path, context);
      case "table":
        return parseTable(value, path, context);
      case "tableRow":
        return parseTableRow(value, path, context);
      case "tableCell":
      case "tableHeader":
        return parseTableCell(value, path, context);
      case "text":
        return parseText(value, path, context);
      case "paragraph":
      case "heading":
      case "bulletList":
      case "orderedList":
      case "listItem":
      case "blockquote":
      case "codeBlock":
        return parseContainer(value, path, context);
      case "hardBreak":
      case "horizontalRule":
        return parseLeaf(value, path, context);
      default:
        context.add([...path, "type"], "unknown_node", "Unknown editor node type");
        return undefined;
    }
  });
}

function parseChildren(
  input: unknown,
  path: readonly (string | number)[],
  context: ValidationContext,
): EditorNode[] | undefined {
  return withArray(input, path, context, (values) => {
    const content: EditorNode[] = [];

    for (let index = 0; index < values.length && !context.isHalted; index += 1) {
      const value = values[index];
      const node = parseNode(value, [...path, index], context);
      if (node !== undefined) {
        content.push(node);
      }
    }

    return content;
  });
}

function parseTaskList(
  value: Record<string, unknown>,
  path: readonly (string | number)[],
  context: ValidationContext,
): EditorTaskListNode | undefined {
  if (!checkKeys(value, ["type", "content"], path, context)) {
    return undefined;
  }

  const content = parseChildren(value.content, [...path, "content"], context);
  if (content === undefined) {
    return undefined;
  }

  content.forEach((node, index) => {
    if (node.type !== "taskItem") {
      context.add(
        [...path, "content", index, "type"],
        "invalid_task_list_item",
        "Task lists may contain only task items",
      );
    }
  });

  return {
    type: "taskList",
    content: content.filter((node): node is EditorTaskItemNode => node.type === "taskItem"),
  };
}

function parseTaskItem(
  value: Record<string, unknown>,
  path: readonly (string | number)[],
  context: ValidationContext,
): EditorTaskItemNode | undefined {
  if (!checkKeys(value, ["type", "attrs", "content"], path, context)) {
    return undefined;
  }

  const attrs = withRecord(value.attrs, [...path, "attrs"], context, (rawAttrs) => {
    if (!checkKeys(rawAttrs, ["checked"], [...path, "attrs"], context)) {
      return undefined;
    }
    if (typeof rawAttrs.checked !== "boolean") {
      context.add(
        [...path, "attrs", "checked"],
        "invalid_task_item_checked",
        "Task item checked must be a boolean",
      );
      return undefined;
    }
    return { checked: rawAttrs.checked };
  });
  const content = parseChildren(value.content, [...path, "content"], context);

  if (attrs === undefined || content === undefined) {
    return undefined;
  }

  return { type: "taskItem", attrs, content };
}

function parseTable(
  value: Record<string, unknown>,
  path: readonly (string | number)[],
  context: ValidationContext,
): EditorTableNode | undefined {
  if (!checkKeys(value, ["type", "content"], path, context)) {
    return undefined;
  }

  const content = parseChildren(value.content, [...path, "content"], context);
  if (content === undefined) {
    return undefined;
  }
  if (content.length === 0) {
    context.add(
      [...path, "content"],
      "invalid_table_shape",
      "Tables must contain at least one row",
    );
  }
  content.forEach((node, index) => {
    if (node.type !== "tableRow") {
      context.add(
        [...path, "content", index, "type"],
        "invalid_table_row",
        "Tables may contain only table rows",
      );
    }
  });

  content.forEach((node, rowIndex) => {
    if (node.type !== "tableRow") {
      return;
    }
    const expectedType = rowIndex === 0 ? "tableHeader" : "tableCell";
    const row = node as EditorTableRowNode;
    row.content.forEach((cell, cellIndex) => {
      if (cell.type !== expectedType) {
        context.add(
          [...path, "content", rowIndex, "content", cellIndex, "type"],
          "invalid_table_cell_type",
          rowIndex === 0
            ? "The first table row must contain only table headers"
            : "Table data rows must contain only table cells",
        );
      }
    });
  });

  return {
    type: "table",
    content: content.filter((node): node is EditorTableRowNode => node.type === "tableRow"),
  };
}

function parseTableRow(
  value: Record<string, unknown>,
  path: readonly (string | number)[],
  context: ValidationContext,
): EditorTableRowNode | undefined {
  if (!checkKeys(value, ["type", "content"], path, context)) {
    return undefined;
  }

  const content = parseChildren(value.content, [...path, "content"], context);
  if (content === undefined) {
    return undefined;
  }
  if (content.length === 0) {
    context.add(
      [...path, "content"],
      "invalid_table_shape",
      "Table rows must contain at least one cell",
    );
  }
  content.forEach((node, index) => {
    if (node.type !== "tableCell" && node.type !== "tableHeader") {
      context.add(
        [...path, "content", index, "type"],
        "invalid_table_cell",
        "Table rows may contain only table cells or headers",
      );
    }
  });

  return {
    type: "tableRow",
    content: content.filter(
      (node): node is EditorTableCellNode =>
        node.type === "tableCell" || node.type === "tableHeader",
    ),
  };
}

function parseTableCell(
  value: Record<string, unknown>,
  path: readonly (string | number)[],
  context: ValidationContext,
): EditorTableCellNode | undefined {
  if (!checkKeys(value, ["type", "attrs", "content"], path, context)) {
    return undefined;
  }
  const attrs = parseTableCellAttrs(value.attrs, [...path, "attrs"], context);
  const content = parseChildren(value.content, [...path, "content"], context);
  if (
    attrs === undefined ||
    content === undefined ||
    (value.type !== "tableCell" && value.type !== "tableHeader")
  ) {
    return undefined;
  }

  if (content.length !== 1 || content[0]?.type !== "paragraph") {
    context.add(
      [...path, "content"],
      "invalid_table_cell_content",
      "Table cells must contain exactly one paragraph",
    );
    return undefined;
  }

  return { type: value.type, attrs, content: content as [EditorNode] };
}

function parseTableCellAttrs(
  input: unknown,
  path: readonly (string | number)[],
  context: ValidationContext,
): EditorTableCellNode["attrs"] | undefined {
  return withRecord(input, path, context, (value) => {
    const issueCount = context.issues.length;
    if (!checkKeys(value, ["colspan", "rowspan", "colwidth"], path, context)) {
      return undefined;
    }
    if (value.colspan !== 1) {
      context.add([...path, "colspan"], "invalid_table_cell_attr", "Table cell colspan must be 1");
    }
    if (value.rowspan !== 1) {
      context.add([...path, "rowspan"], "invalid_table_cell_attr", "Table cell rowspan must be 1");
    }
    if (value.colwidth !== null) {
      context.add(
        [...path, "colwidth"],
        "invalid_table_cell_attr",
        "Table cell colwidth must be null",
      );
    }
    if (context.issues.length > issueCount) {
      return undefined;
    }
    return { colspan: 1, rowspan: 1, colwidth: null };
  });
}

function parseText(
  value: Record<string, unknown>,
  path: readonly (string | number)[],
  context: ValidationContext,
): EditorNode | undefined {
  if (!checkKeys(value, ["type", "text", "marks"], path, context)) {
    return undefined;
  }
  if (typeof value.text !== "string") {
    context.add([...path, "text"], "invalid_text", "Text node text must be a string");
    return undefined;
  }

  const marks =
    value.marks === undefined ? undefined : parseMarks(value.marks, [...path, "marks"], context);
  if (value.marks !== undefined && marks === undefined) {
    return undefined;
  }

  const node: EditorNode = { type: "text", text: value.text };
  if (marks !== undefined) {
    return { ...node, marks };
  }
  return node;
}

function parseMarks(
  input: unknown,
  path: readonly (string | number)[],
  context: ValidationContext,
): EditorMark[] | undefined {
  return withArray(input, path, context, (values) => {
    const marks: EditorMark[] = [];
    for (let index = 0; index < values.length && !context.isHalted; index += 1) {
      const value = values[index];
      const mark = withRecord(value, [...path, index], context, (rawMark) => {
        if (!checkKeys(rawMark, ["type", "attrs"], [...path, index], context)) {
          return undefined;
        }
        if (typeof rawMark.type !== "string") {
          context.add([...path, index, "type"], "invalid_mark_type", "Mark type must be a string");
          return undefined;
        }
        const attrs =
          rawMark.attrs === undefined
            ? undefined
            : parseJsonRecord(rawMark.attrs, [...path, index, "attrs"], context);
        if (rawMark.attrs !== undefined && attrs === undefined) {
          return undefined;
        }
        const parsedMark: EditorMark = { type: rawMark.type };
        return attrs === undefined ? parsedMark : { ...parsedMark, attrs };
      });
      if (mark !== undefined) {
        marks.push(mark);
      }
    }
    return marks;
  });
}

function parseContainer(
  value: Record<string, unknown>,
  path: readonly (string | number)[],
  context: ValidationContext,
): EditorNode | undefined {
  if (!checkKeys(value, ["type", "attrs", "content"], path, context)) {
    return undefined;
  }

  const attrs =
    value.attrs === undefined
      ? undefined
      : parseJsonRecord(value.attrs, [...path, "attrs"], context);
  const content =
    value.content === undefined
      ? undefined
      : parseChildren(value.content, [...path, "content"], context);
  if (
    (value.attrs !== undefined && attrs === undefined) ||
    (value.content !== undefined && content === undefined)
  ) {
    return undefined;
  }

  return {
    type: value.type as string,
    ...(attrs === undefined ? {} : { attrs }),
    ...(content === undefined ? {} : { content }),
  };
}

function parseLeaf(
  value: Record<string, unknown>,
  path: readonly (string | number)[],
  context: ValidationContext,
): EditorNode | undefined {
  if (!checkKeys(value, ["type"], path, context)) {
    return undefined;
  }
  return { type: value.type as string };
}

function parseJsonRecord(
  input: unknown,
  path: readonly (string | number)[],
  context: ValidationContext,
): Readonly<Record<string, unknown>> | undefined {
  return withRecord(input, path, context, (value) => {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      if (context.isHalted) {
        break;
      }
      const parsed = parseJsonValue(value[key], [...path, key], context);
      if (parsed !== undefined) {
        result[key] = parsed;
      }
    }
    return result;
  });
}

function parseJsonValue(
  input: unknown,
  path: readonly (string | number)[],
  context: ValidationContext,
): unknown {
  if (input === null || typeof input === "string" || typeof input === "boolean") {
    return input;
  }
  if (typeof input === "number") {
    if (Number.isFinite(input)) {
      return input;
    }
    context.add(path, "invalid_json_value", "JSON numbers must be finite");
    return undefined;
  }
  if (Array.isArray(input)) {
    return withArray(input, path, context, (values) => {
      const result: unknown[] = [];
      for (let index = 0; index < values.length && !context.isHalted; index += 1) {
        result.push(parseJsonValue(values[index], [...path, index], context));
      }
      return result;
    });
  }
  if (isPlainRecord(input)) {
    return parseJsonRecord(input, path, context);
  }

  context.add(path, "invalid_json_value", "Value must be JSON-compatible");
  return undefined;
}

function checkKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
  path: readonly (string | number)[],
  context: ValidationContext,
): boolean {
  const allowed = new Set(allowedKeys);
  let valid = true;
  for (const key of Object.keys(value)) {
    if (context.isHalted) {
      break;
    }
    if (!allowed.has(key)) {
      context.add([...path, key], "unknown_key", "Unknown property is not allowed");
      valid = false;
    }
  }
  return valid;
}

function withRecord<T>(
  input: unknown,
  path: readonly (string | number)[],
  context: ValidationContext,
  callback: (value: Record<string, unknown>) => T | undefined,
): T | undefined {
  if (!isPlainRecord(input)) {
    context.add(path, "invalid_object", "Value must be an object");
    return undefined;
  }
  if (!context.enter(input, path)) {
    return undefined;
  }

  try {
    return callback(input);
  } finally {
    context.leave(input);
  }
}

function withArray<T>(
  input: unknown,
  path: readonly (string | number)[],
  context: ValidationContext,
  callback: (value: unknown[]) => T | undefined,
): T | undefined {
  if (!Array.isArray(input)) {
    context.add(path, "invalid_array", "Value must be an array");
    return undefined;
  }
  if (!context.enter(input, path)) {
    return undefined;
  }

  try {
    return callback(input);
  } finally {
    context.leave(input);
  }
}

function isPlainRecord(input: unknown): input is Record<string, unknown> {
  if (input === null || typeof input !== "object") {
    return false;
  }
  const prototype = Object.getPrototypeOf(input);
  return prototype === Object.prototype || prototype === null;
}
