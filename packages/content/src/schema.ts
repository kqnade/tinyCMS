export const CONTENT_VERSION = 1 as const;

const MAX_DEPTH = 64;
const MAX_NODES = 1_000;
const MAX_ISSUES = 64;
const MAX_TEXT_LENGTH = 1_000_000;
const MAX_TOTAL_TEXT_LENGTH = 1_000_000;
const MAX_TABLE_ROWS = 100;
const MAX_TABLE_COLUMNS = 20;
const MAX_TABLE_CELLS = 400;

const CODE_LANGUAGES = new Set([
  "bash",
  "c",
  "cpp",
  "csharp",
  "css",
  "diff",
  "go",
  "html",
  "java",
  "javascript",
  "json",
  "jsx",
  "kotlin",
  "markdown",
  "php",
  "plain",
  "plaintext",
  "python",
  "ruby",
  "rust",
  "shell",
  "sql",
  "swift",
  "toml",
  "tsx",
  "typescript",
  "xml",
  "yaml",
]);

const MARK_ORDER = ["bold", "italic", "strike", "code", "link"] as const;
const MARK_ORDER_INDEX = new Map(MARK_ORDER.map((type, index) => [type, index]));

export type ContentValidationIssue = {
  readonly code: string;
  readonly message: string;
  readonly path: readonly (string | number)[];
};

export class ContentValidationError extends Error {
  readonly issues: readonly ContentValidationIssue[];

  constructor(issues: readonly ContentValidationIssue[]) {
    super("Content document validation failed");
    this.name = "ContentValidationError";
    this.issues = issues.map((issue) => ({
      code: issue.code,
      message: issue.message,
      path: [...issue.path],
    }));
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export type ContentTextMark =
  | { readonly type: "bold" }
  | { readonly type: "italic" }
  | { readonly type: "strike" }
  | { readonly type: "code" }
  | { readonly type: "link"; readonly attrs: { readonly href: string } };

export type ContentTextNode = {
  readonly type: "text";
  readonly text: string;
  readonly marks?: readonly ContentTextMark[];
};

export type ContentHardBreakNode = { readonly type: "hardBreak" };

export type ContentInlineNode = ContentTextNode | ContentHardBreakNode;

export type ContentParagraphNode = {
  readonly type: "paragraph";
  readonly content?: readonly ContentInlineNode[];
};

export type ContentTableCellAttrs = {
  readonly colspan: 1;
  readonly rowspan: 1;
  readonly colwidth: null;
};

export type ContentTableHeaderNode = {
  readonly type: "tableHeader";
  readonly attrs: ContentTableCellAttrs;
  readonly content: readonly [ContentParagraphNode];
};

export type ContentTableCellNode = {
  readonly type: "tableCell";
  readonly attrs: ContentTableCellAttrs;
  readonly content: readonly [ContentParagraphNode];
};

export type ContentTableRowNode = {
  readonly type: "tableRow";
  readonly content: readonly (ContentTableHeaderNode | ContentTableCellNode)[];
};

export type ContentTableNode = {
  readonly type: "table";
  readonly content: readonly ContentTableRowNode[];
};

export type ContentHeadingNode = {
  readonly type: "heading";
  readonly attrs: { readonly level: 1 | 2 | 3 | 4 | 5 | 6 };
  readonly content?: readonly ContentInlineNode[];
};

export type ContentListItemNode = {
  readonly type: "listItem";
  readonly content: readonly ContentListItemChild[];
};

export type ContentBulletListNode = {
  readonly type: "bulletList";
  readonly content: readonly ContentListItemNode[];
};

export type ContentOrderedListNode = {
  readonly type: "orderedList";
  readonly attrs: { readonly start: number };
  readonly content: readonly ContentListItemNode[];
};

export type ContentListNode = ContentBulletListNode | ContentOrderedListNode;

export type ContentTaskItemNode = {
  readonly type: "taskItem";
  readonly attrs: { readonly checked: boolean };
  readonly content: readonly ContentTaskItemChild[];
};

export type ContentTaskListNode = {
  readonly type: "taskList";
  readonly content: readonly ContentTaskItemNode[];
};

export type ContentBlockquoteNode = {
  readonly type: "blockquote";
  readonly content: readonly ContentOrdinaryBlock[];
};

export type ContentCodeBlockNode = {
  readonly type: "codeBlock";
  readonly attrs: { readonly language: string | null };
  readonly content?: readonly ContentTextNode[];
};

export type ContentImageNode = {
  readonly type: "image";
  readonly attrs: {
    readonly mediaId: string;
    readonly alt: string;
    readonly caption: string | null;
  };
};

export type ContentBookmarkNode = {
  readonly type: "bookmark";
  readonly attrs: {
    readonly href: string;
    readonly title: string;
    readonly description: string | null;
  };
};

export type ContentYoutubeNode = {
  readonly type: "youtube";
  readonly attrs: { readonly videoId: string };
};

export type ContentBlueskyNode = {
  readonly type: "bluesky";
  readonly attrs: { readonly profile: string; readonly postId: string };
};

export type ContentXNode = {
  readonly type: "x";
  readonly attrs: { readonly username: string; readonly postId: string };
};

export type ContentCalloutNode = {
  readonly type: "callout";
  readonly attrs: { readonly kind: "info" | "success" | "warning" | "danger" };
  readonly content: readonly ContentParagraphNode[];
};

export type ContentHorizontalRuleNode = { readonly type: "horizontalRule" };

export type ContentOrdinaryBlock =
  | ContentParagraphNode
  | ContentHeadingNode
  | ContentListNode
  | ContentTaskListNode
  | ContentBlockquoteNode
  | ContentCodeBlockNode
  | ContentHorizontalRuleNode;

export type ContentListItemChild =
  | ContentParagraphNode
  | ContentListNode
  | ContentTaskListNode
  | ContentBlockquoteNode
  | ContentCodeBlockNode;

export type ContentTaskItemChild =
  | ContentParagraphNode
  | ContentListNode
  | ContentTaskListNode
  | ContentBlockquoteNode
  | ContentCodeBlockNode;

export type ContentBlock =
  | ContentOrdinaryBlock
  | ContentTableNode
  | ContentImageNode
  | ContentBookmarkNode
  | ContentYoutubeNode
  | ContentBlueskyNode
  | ContentXNode
  | ContentCalloutNode;

export type ContentDocument = {
  readonly type: "doc";
  readonly content: readonly ContentBlock[];
};

export type ContentValidationResult =
  | { readonly ok: true; readonly value: ContentDocument }
  | { readonly ok: false; readonly error: ContentValidationError };

type Path = readonly (string | number)[];
type RecordValue = Record<string, unknown>;

class ValidationContext {
  readonly issues: ContentValidationIssue[] = [];
  readonly activeNodes = new WeakSet<object>();
  nodeCount = 0;
  totalTextLength = 0;
  stopped = false;

  add(path: Path, code: string, message: string): void {
    if (this.stopped || this.issues.length >= MAX_ISSUES) {
      return;
    }
    this.issues.push({ code, message, path: [...path] });
    if (this.issues.length >= MAX_ISSUES) {
      this.stopped = true;
    }
  }

  stop(path: Path, code: string, message: string): void {
    if (this.stopped) {
      return;
    }
    this.add(path, code, message);
    this.stopped = true;
  }

  addTextLength(length: number, path: Path): boolean {
    if (this.stopped) {
      return false;
    }
    if (this.totalTextLength + length > MAX_TOTAL_TEXT_LENGTH) {
      this.stop(path, "max_total_text_length", "Total text content is too long");
      return false;
    }
    this.totalTextLength += length;
    return true;
  }

  enterNode(value: unknown, path: Path, depth: number): boolean {
    if (this.stopped) {
      return false;
    }
    this.nodeCount += 1;
    if (this.nodeCount > MAX_NODES) {
      this.stop(path, "max_nodes", "Document contains too many nodes");
      return false;
    }
    if (depth > MAX_DEPTH) {
      this.stop(path, "max_depth", "Document nesting is too deep");
      return false;
    }
    if (!isRecord(value)) {
      return true;
    }
    if (this.activeNodes.has(value)) {
      this.add(path, "cycle", "Document contains a cyclic node");
      return false;
    }
    this.activeNodes.add(value);
    return true;
  }

  leaveNode(value: unknown): void {
    if (isRecord(value)) {
      this.activeNodes.delete(value);
    }
  }
}

export function validateContentDocument(
  contentVersion: unknown,
  input: unknown,
): ContentValidationResult {
  const context = new ValidationContext();

  if (contentVersion !== CONTENT_VERSION) {
    context.add(
      ["contentVersion"],
      "unsupported_version",
      "Content version must be the supported numeric version",
    );
  } else {
    const document = parseDocument(input, context);
    if (document !== undefined && context.issues.length === 0) {
      return { ok: true, value: document };
    }
  }

  return {
    ok: false,
    error: new ContentValidationError(context.issues),
  };
}

export function parseContentDocument(contentVersion: unknown, input: unknown): ContentDocument {
  const result = validateContentDocument(contentVersion, input);
  if (!result.ok) {
    throw result.error;
  }
  return result.value;
}

function parseDocument(input: unknown, context: ValidationContext): ContentDocument | undefined {
  if (!isRecord(input)) {
    context.add([], "invalid_document", "Document must be an object");
    return undefined;
  }
  if (!hasExactKeys(input, ["type", "content"], [], context)) {
    return undefined;
  }
  if (input.type !== "doc") {
    context.add(["type"], "invalid_node_type", "Document type must be doc");
    return undefined;
  }
  if (!Array.isArray(input.content)) {
    context.add(["content"], "invalid_content", "Document content must be an array");
    return undefined;
  }

  const content: ContentBlock[] = [];
  for (let index = 0; index < input.content.length && !context.stopped; index += 1) {
    const node = parseBlock(input.content[index], ["content", index], context, 1);
    if (node !== undefined) {
      content.push(node);
    }
  }
  return context.issues.length === 0 ? { type: "doc", content } : undefined;
}

function parseBlock(
  input: unknown,
  path: Path,
  context: ValidationContext,
  depth: number,
): ContentBlock | undefined {
  if (!context.enterNode(input, path, depth)) {
    return undefined;
  }
  if (!isRecord(input)) {
    context.add(path, "invalid_node", "Node must be an object");
    return undefined;
  }
  let result: ContentBlock | undefined;
  switch (input.type) {
    case "paragraph":
      result = parseParagraph(input, path, context, depth);
      break;
    case "heading":
      result = parseHeading(input, path, context, depth);
      break;
    case "bulletList":
    case "orderedList":
      result = parseList(input, path, context, depth);
      break;
    case "taskList":
      result = parseTaskList(input, path, context, depth);
      break;
    case "table":
      result = parseTable(input, path, context, depth);
      break;
    case "blockquote":
      result = parseBlockquote(input, path, context, depth);
      break;
    case "codeBlock":
      result = parseCodeBlock(input, path, context, depth);
      break;
    case "image":
      result = parseImage(input, path, context);
      break;
    case "bookmark":
      result = parseBookmark(input, path, context);
      break;
    case "youtube":
      result = parseYoutube(input, path, context);
      break;
    case "bluesky":
      result = parseBluesky(input, path, context);
      break;
    case "x":
      result = parseX(input, path, context);
      break;
    case "callout":
      result = parseCallout(input, path, context, depth);
      break;
    case "horizontalRule":
      result = parseHorizontalRule(input, path, context);
      break;
    default:
      context.add([...path, "type"], "unknown_node", "Unknown content node type");
  }
  context.leaveNode(input);
  return result;
}

function parseOrdinaryBlock(
  input: unknown,
  path: Path,
  context: ValidationContext,
  depth: number,
): ContentOrdinaryBlock | undefined {
  if (!context.enterNode(input, path, depth)) {
    return undefined;
  }
  if (!isRecord(input)) {
    context.add(path, "invalid_node", "Node must be an object");
    return undefined;
  }
  try {
    if (input.type === "image" || input.type === "bookmark" || input.type === "youtube") {
      context.add([...path, "type"], "invalid_nesting", "Embedded blocks are not allowed here");
      return undefined;
    }
    if (input.type === "bluesky" || input.type === "x" || input.type === "callout") {
      context.add([...path, "type"], "invalid_nesting", "This node is not an ordinary block");
      return undefined;
    }
    if (input.type === "paragraph") {
      return parseParagraph(input, path, context, depth);
    }
    if (input.type === "heading") {
      return parseHeading(input, path, context, depth);
    }
    if (input.type === "bulletList" || input.type === "orderedList") {
      return parseList(input, path, context, depth);
    }
    if (input.type === "taskList") {
      return parseTaskList(input, path, context, depth);
    }
    if (input.type === "blockquote") {
      return parseBlockquote(input, path, context, depth);
    }
    if (input.type === "codeBlock") {
      return parseCodeBlock(input, path, context, depth);
    }
    if (input.type === "horizontalRule") {
      return parseHorizontalRule(input, path, context);
    }
    context.add([...path, "type"], "invalid_nesting", "Node is not an ordinary block");
    return undefined;
  } finally {
    context.leaveNode(input);
  }
}

function parseListItemChild(
  input: unknown,
  path: Path,
  context: ValidationContext,
  depth: number,
): ContentListItemChild | undefined {
  if (!context.enterNode(input, path, depth)) {
    return undefined;
  }
  if (!isRecord(input)) {
    context.add(path, "invalid_node", "Node must be an object");
    return undefined;
  }
  try {
    if (input.type === "paragraph") {
      return parseParagraph(input, path, context, depth);
    }
    if (input.type === "bulletList" || input.type === "orderedList") {
      return parseList(input, path, context, depth);
    }
    if (input.type === "taskList") {
      return parseTaskList(input, path, context, depth);
    }
    if (input.type === "blockquote") {
      return parseBlockquote(input, path, context, depth);
    }
    if (input.type === "codeBlock") {
      return parseCodeBlock(input, path, context, depth);
    }
    context.add([...path, "type"], "invalid_nesting", "Node is not allowed in a list item");
    return undefined;
  } finally {
    context.leaveNode(input);
  }
}

function parseParagraph(
  input: RecordValue,
  path: Path,
  context: ValidationContext,
  depth: number,
): ContentParagraphNode | undefined {
  if (!hasKeys(input, ["type"], ["content"], path, context)) {
    return undefined;
  }
  if (Object.hasOwn(input, "content") && !Array.isArray(input.content)) {
    context.add([...path, "content"], "invalid_content", "Paragraph content must be an array");
    return undefined;
  }
  const content: ContentInlineNode[] = [];
  if (Array.isArray(input.content)) {
    for (let index = 0; index < input.content.length && !context.stopped; index += 1) {
      const inline = parseInlineNode(
        input.content[index],
        [...path, "content", index],
        context,
        depth + 1,
        true,
        true,
      );
      if (inline !== undefined) {
        content.push(inline);
      }
    }
  }
  return content.length === (Array.isArray(input.content) ? input.content.length : 0)
    ? { type: "paragraph", ...(Object.hasOwn(input, "content") ? { content } : {}) }
    : undefined;
}

function parseHeading(
  input: RecordValue,
  path: Path,
  context: ValidationContext,
  depth: number,
): ContentHeadingNode | undefined {
  if (!hasKeys(input, ["type", "attrs"], ["content"], path, context)) {
    return undefined;
  }
  if (
    !isRecord(input.attrs) ||
    !hasExactKeys(input.attrs, ["level"], [...path, "attrs"], context)
  ) {
    return undefined;
  }
  if (!isSafeIntegerInRange(input.attrs.level, 1, 6)) {
    context.add(
      [...path, "attrs", "level"],
      "invalid_level",
      "Heading level must be an integer from 1 to 6",
    );
    return undefined;
  }
  const content = parseInlineContent(input, path, context, depth);
  const attrs = { level: input.attrs.level as 1 | 2 | 3 | 4 | 5 | 6 };
  if (Object.hasOwn(input, "content")) {
    if (content === undefined) {
      return undefined;
    }
    return { type: "heading", attrs, content };
  }
  return { type: "heading", attrs };
}

function parseList(
  input: RecordValue,
  path: Path,
  context: ValidationContext,
  depth: number,
): ContentListNode | undefined {
  if (
    !hasExactKeys(
      input,
      input.type === "bulletList" ? ["type", "content"] : ["type", "attrs", "content"],
      path,
      context,
    )
  ) {
    return undefined;
  }

  let start: number | undefined;
  if (input.type === "orderedList") {
    if (
      !isRecord(input.attrs) ||
      !hasExactKeys(input.attrs, ["start"], [...path, "attrs"], context)
    ) {
      return undefined;
    }
    if (!isSafeIntegerInRange(input.attrs.start, 1, Number.MAX_SAFE_INTEGER)) {
      context.add(
        [...path, "attrs", "start"],
        "invalid_start",
        "List start must be a positive integer",
      );
      return undefined;
    }
    start = input.attrs.start;
  }
  if (!Array.isArray(input.content) || input.content.length === 0) {
    context.add([...path, "content"], "invalid_content", "List content must be a nonempty array");
    return undefined;
  }
  const content: ContentListItemNode[] = [];
  for (let index = 0; index < input.content.length && !context.stopped; index += 1) {
    const item = parseListItem(
      input.content[index],
      [...path, "content", index],
      context,
      depth + 1,
    );
    if (item !== undefined) {
      content.push(item);
    }
  }
  return content.length === input.content.length
    ? input.type === "bulletList"
      ? { type: "bulletList", content }
      : { type: "orderedList", attrs: { start: start as number }, content }
    : undefined;
}

function parseListItem(
  input: unknown,
  path: Path,
  context: ValidationContext,
  depth: number,
): ContentListItemNode | undefined {
  if (!context.enterNode(input, path, depth)) {
    return undefined;
  }
  if (!isRecord(input)) {
    context.add(path, "invalid_node", "List item must be an object");
    return undefined;
  }
  if (!hasExactKeys(input, ["type", "content"], path, context)) {
    context.leaveNode(input);
    return undefined;
  }
  if (input.type !== "listItem") {
    context.add([...path, "type"], "invalid_node_type", "List content must contain listItem nodes");
    context.leaveNode(input);
    return undefined;
  }
  if (!Array.isArray(input.content) || input.content.length === 0) {
    context.add([...path, "content"], "invalid_content", "List item content must be nonempty");
    context.leaveNode(input);
    return undefined;
  }
  const content: ContentListItemChild[] = [];
  for (let index = 0; index < input.content.length && !context.stopped; index += 1) {
    const childPath = [...path, "content", index];
    const child = parseListItemChild(input.content[index], childPath, context, depth + 1);
    if (child !== undefined) {
      content.push(child);
    }
  }
  const first = input.content[0];
  if (!isRecord(first) || first.type !== "paragraph") {
    context.add(
      [...path, "content", 0],
      "invalid_nesting",
      "A list item must begin with a paragraph",
    );
  }
  context.leaveNode(input);
  return content.length === input.content.length && content[0]?.type === "paragraph"
    ? { type: "listItem", content }
    : undefined;
}

function parseTaskList(
  input: RecordValue,
  path: Path,
  context: ValidationContext,
  depth: number,
): ContentTaskListNode | undefined {
  if (!hasExactKeys(input, ["type", "content"], path, context)) {
    return undefined;
  }
  if (!Array.isArray(input.content) || input.content.length === 0) {
    context.add(
      [...path, "content"],
      "invalid_content",
      "Task list content must be a nonempty array",
    );
    return undefined;
  }
  const content: ContentTaskItemNode[] = [];
  for (let index = 0; index < input.content.length && !context.stopped; index += 1) {
    const item = parseTaskItem(
      input.content[index],
      [...path, "content", index],
      context,
      depth + 1,
    );
    if (item !== undefined) {
      content.push(item);
    }
  }
  return content.length === input.content.length ? { type: "taskList", content } : undefined;
}

function parseTaskItem(
  input: unknown,
  path: Path,
  context: ValidationContext,
  depth: number,
): ContentTaskItemNode | undefined {
  if (!context.enterNode(input, path, depth)) {
    return undefined;
  }
  if (!isRecord(input)) {
    context.add(path, "invalid_node", "Task item must be an object");
    return undefined;
  }
  if (!hasExactKeys(input, ["type", "attrs", "content"], path, context)) {
    context.leaveNode(input);
    return undefined;
  }
  if (input.type !== "taskItem") {
    context.add(
      [...path, "type"],
      "invalid_node_type",
      "Task list content must contain taskItem nodes",
    );
    context.leaveNode(input);
    return undefined;
  }
  if (
    !isRecord(input.attrs) ||
    !hasExactKeys(input.attrs, ["checked"], [...path, "attrs"], context)
  ) {
    context.leaveNode(input);
    return undefined;
  }
  if (typeof input.attrs.checked !== "boolean") {
    context.add(
      [...path, "attrs", "checked"],
      "invalid_attribute",
      "Task item checked must be a boolean",
    );
    context.leaveNode(input);
    return undefined;
  }
  if (!Array.isArray(input.content) || input.content.length === 0) {
    context.add([...path, "content"], "invalid_content", "Task item content must be nonempty");
    context.leaveNode(input);
    return undefined;
  }
  const content: ContentTaskItemChild[] = [];
  for (let index = 0; index < input.content.length && !context.stopped; index += 1) {
    const child = parseListItemChild(
      input.content[index],
      [...path, "content", index],
      context,
      depth + 1,
    );
    if (child !== undefined) {
      content.push(child);
    }
  }
  const first = input.content[0];
  if (!isRecord(first) || first.type !== "paragraph") {
    context.add(
      [...path, "content", 0],
      "invalid_nesting",
      "A task item must begin with a paragraph",
    );
  }
  context.leaveNode(input);
  return content.length === input.content.length && content[0]?.type === "paragraph"
    ? { type: "taskItem", attrs: { checked: input.attrs.checked }, content }
    : undefined;
}

function parseTable(
  input: RecordValue,
  path: Path,
  context: ValidationContext,
  depth: number,
): ContentTableNode | undefined {
  if (!hasExactKeys(input, ["type", "content"], path, context)) {
    return undefined;
  }
  if (!Array.isArray(input.content)) {
    context.add([...path, "content"], "invalid_content", "Table content must be an array");
    return undefined;
  }
  if (input.content.length < 2) {
    context.add([...path, "content"], "invalid_content", "Table must contain at least two rows");
    return undefined;
  }
  if (input.content.length > MAX_TABLE_ROWS) {
    context.stop([...path, "content"], "max_table_rows", "Table contains too many rows");
    return undefined;
  }

  const content: ContentTableRowNode[] = [];
  let columnCount: number | undefined;
  let cellCount = 0;
  for (let index = 0; index < input.content.length && !context.stopped; index += 1) {
    const rowPath = [...path, "content", index];
    const rowInput = input.content[index];
    if (isRecord(rowInput) && Array.isArray(rowInput.content)) {
      const rowColumnCount = rowInput.content.length;
      if (rowColumnCount > MAX_TABLE_COLUMNS) {
        context.stop(
          [...rowPath, "content"],
          "max_table_columns",
          "Table contains too many columns",
        );
        break;
      }
      if (columnCount === undefined && rowColumnCount > 0) {
        columnCount = rowColumnCount;
      } else if (
        columnCount !== undefined &&
        rowColumnCount > 0 &&
        rowColumnCount !== columnCount
      ) {
        context.add(
          [...rowPath, "content"],
          "invalid_content",
          "Table rows must contain the same number of cells",
        );
      }
      cellCount += rowColumnCount;
      if (cellCount > MAX_TABLE_CELLS) {
        context.stop([...rowPath, "content"], "max_table_cells", "Table contains too many cells");
        break;
      }
    }

    const expectedCellType = index === 0 ? "tableHeader" : "tableCell";
    const row = parseTableRow(rowInput, rowPath, context, depth + 1, expectedCellType);
    if (row !== undefined) {
      content.push(row);
    }
  }

  return content.length === input.content.length && context.issues.length === 0
    ? { type: "table", content }
    : undefined;
}

function parseTableRow(
  input: unknown,
  path: Path,
  context: ValidationContext,
  depth: number,
  expectedCellType: "tableHeader" | "tableCell",
): ContentTableRowNode | undefined {
  if (!context.enterNode(input, path, depth)) {
    return undefined;
  }
  try {
    if (!isRecord(input)) {
      context.add(path, "invalid_node", "Table row must be an object");
      return undefined;
    }
    if (!hasExactKeys(input, ["type", "content"], path, context)) {
      return undefined;
    }
    if (input.type !== "tableRow") {
      context.add(
        [...path, "type"],
        "invalid_node_type",
        "Table content must contain tableRow nodes",
      );
      return undefined;
    }
    if (!Array.isArray(input.content) || input.content.length === 0) {
      context.add(
        [...path, "content"],
        "invalid_content",
        "Table rows must contain at least one cell",
      );
      return undefined;
    }

    const content: (ContentTableHeaderNode | ContentTableCellNode)[] = [];
    for (let index = 0; index < input.content.length && !context.stopped; index += 1) {
      const cell = parseTableCell(
        input.content[index],
        [...path, "content", index],
        context,
        depth + 1,
        expectedCellType,
      );
      if (cell !== undefined) {
        content.push(cell);
      }
    }
    return content.length === input.content.length ? { type: "tableRow", content } : undefined;
  } finally {
    context.leaveNode(input);
  }
}

function parseTableCell(
  input: unknown,
  path: Path,
  context: ValidationContext,
  depth: number,
  expectedType: "tableHeader" | "tableCell",
): ContentTableHeaderNode | ContentTableCellNode | undefined {
  if (!context.enterNode(input, path, depth)) {
    return undefined;
  }
  try {
    if (!isRecord(input)) {
      context.add(path, "invalid_node", "Table cell must be an object");
      return undefined;
    }
    if (!hasExactKeys(input, ["type", "attrs", "content"], path, context)) {
      return undefined;
    }
    if (input.type !== expectedType) {
      context.add(
        [...path, "type"],
        "invalid_node_type",
        expectedType === "tableHeader"
          ? "The first table row must contain tableHeader nodes"
          : "Table body rows must contain tableCell nodes",
      );
      return undefined;
    }
    if (!isRecord(input.attrs)) {
      context.add([...path, "attrs"], "invalid_attribute", "Table cell attrs must be an object");
      return undefined;
    }
    if (
      !hasExactKeys(input.attrs, ["colspan", "rowspan", "colwidth"], [...path, "attrs"], context)
    ) {
      return undefined;
    }
    if (input.attrs.colspan !== 1) {
      context.add(
        [...path, "attrs", "colspan"],
        "invalid_attribute",
        "Table cell colspan must be 1",
      );
      return undefined;
    }
    if (input.attrs.rowspan !== 1) {
      context.add(
        [...path, "attrs", "rowspan"],
        "invalid_attribute",
        "Table cell rowspan must be 1",
      );
      return undefined;
    }
    if (input.attrs.colwidth !== null) {
      context.add(
        [...path, "attrs", "colwidth"],
        "invalid_attribute",
        "Table cell colwidth must be null",
      );
      return undefined;
    }
    if (!Array.isArray(input.content) || input.content.length !== 1) {
      context.add(
        [...path, "content"],
        "invalid_content",
        "Table cells must contain exactly one paragraph",
      );
      return undefined;
    }

    const paragraphInput = input.content[0];
    const paragraphPath = [...path, "content", 0];
    if (!context.enterNode(paragraphInput, paragraphPath, depth + 1)) {
      return undefined;
    }
    let paragraph: ContentParagraphNode | undefined;
    try {
      if (!isRecord(paragraphInput) || paragraphInput.type !== "paragraph") {
        context.add(
          [...paragraphPath, "type"],
          "invalid_node_type",
          "Table cells must contain a paragraph",
        );
      } else {
        paragraph = parseParagraph(paragraphInput, paragraphPath, context, depth + 1);
      }
    } finally {
      context.leaveNode(paragraphInput);
    }
    if (paragraph === undefined) {
      return undefined;
    }

    const attrs: ContentTableCellAttrs = { colspan: 1, rowspan: 1, colwidth: null };
    return input.type === "tableHeader"
      ? { type: "tableHeader", attrs, content: [paragraph] }
      : { type: "tableCell", attrs, content: [paragraph] };
  } finally {
    context.leaveNode(input);
  }
}

function parseBlockquote(
  input: RecordValue,
  path: Path,
  context: ValidationContext,
  depth: number,
): ContentBlockquoteNode | undefined {
  if (!hasExactKeys(input, ["type", "content"], path, context)) {
    return undefined;
  }
  if (!Array.isArray(input.content) || input.content.length === 0) {
    context.add([...path, "content"], "invalid_content", "Blockquote content must be nonempty");
    return undefined;
  }
  const content: ContentOrdinaryBlock[] = [];
  for (let index = 0; index < input.content.length && !context.stopped; index += 1) {
    const block = parseOrdinaryBlock(
      input.content[index],
      [...path, "content", index],
      context,
      depth + 1,
    );
    if (block !== undefined) {
      content.push(block);
    }
  }
  return content.length === input.content.length ? { type: "blockquote", content } : undefined;
}

function parseCodeBlock(
  input: RecordValue,
  path: Path,
  context: ValidationContext,
  depth: number,
): ContentCodeBlockNode | undefined {
  if (!hasKeys(input, ["type", "attrs"], ["content"], path, context)) {
    return undefined;
  }
  if (
    !isRecord(input.attrs) ||
    !hasExactKeys(input.attrs, ["language"], [...path, "attrs"], context)
  ) {
    return undefined;
  }
  const language = input.attrs.language;
  if (language !== null && (typeof language !== "string" || !CODE_LANGUAGES.has(language))) {
    context.add(
      [...path, "attrs", "language"],
      "invalid_language",
      "Code block language is not supported",
    );
    return undefined;
  }
  if (Object.hasOwn(input, "content") && !Array.isArray(input.content)) {
    context.add([...path, "content"], "invalid_content", "Code block content must be an array");
    return undefined;
  }
  const content: ContentTextNode[] = [];
  if (Array.isArray(input.content)) {
    for (let index = 0; index < input.content.length && !context.stopped; index += 1) {
      const inline = parseInlineNode(
        input.content[index],
        [...path, "content", index],
        context,
        depth + 1,
        false,
        false,
      );
      if (inline?.type === "text") {
        content.push(inline);
      }
    }
  }
  return content.length === (Array.isArray(input.content) ? input.content.length : 0)
    ? {
        type: "codeBlock",
        attrs: { language },
        ...(Object.hasOwn(input, "content") ? { content } : {}),
      }
    : undefined;
}

function parseImage(
  input: RecordValue,
  path: Path,
  context: ValidationContext,
): ContentImageNode | undefined {
  if (!hasExactKeys(input, ["type", "attrs"], path, context)) {
    return undefined;
  }
  if (
    !isRecord(input.attrs) ||
    !hasExactKeys(input.attrs, ["mediaId", "alt", "caption"], [...path, "attrs"], context)
  ) {
    return undefined;
  }
  if (typeof input.attrs.mediaId !== "string" || !UUIDV7_PATTERN.test(input.attrs.mediaId)) {
    context.add(
      [...path, "attrs", "mediaId"],
      "invalid_media_id",
      "Image mediaId must be a lowercase UUIDv7",
    );
    return undefined;
  }
  if (typeof input.attrs.alt !== "string") {
    context.add([...path, "attrs", "alt"], "invalid_attribute", "Image alt must be a string");
    return undefined;
  }
  if (input.attrs.caption !== null && typeof input.attrs.caption !== "string") {
    context.add(
      [...path, "attrs", "caption"],
      "invalid_attribute",
      "Image caption must be a string or null",
    );
    return undefined;
  }
  return {
    type: "image",
    attrs: {
      mediaId: input.attrs.mediaId,
      alt: input.attrs.alt,
      caption: input.attrs.caption,
    },
  };
}

function parseBookmark(
  input: RecordValue,
  path: Path,
  context: ValidationContext,
): ContentBookmarkNode | undefined {
  if (!hasExactKeys(input, ["type", "attrs"], path, context)) {
    return undefined;
  }
  if (
    !isRecord(input.attrs) ||
    !hasExactKeys(input.attrs, ["href", "title", "description"], [...path, "attrs"], context)
  ) {
    return undefined;
  }
  if (!isAbsoluteHttpUrl(input.attrs.href)) {
    context.add(
      [...path, "attrs", "href"],
      "invalid_url",
      "URL must be an absolute HTTP(S) URL without credentials",
    );
    return undefined;
  }
  if (typeof input.attrs.title !== "string") {
    context.add(
      [...path, "attrs", "title"],
      "invalid_attribute",
      "Bookmark title must be a string",
    );
    return undefined;
  }
  if (input.attrs.description !== null && typeof input.attrs.description !== "string") {
    context.add(
      [...path, "attrs", "description"],
      "invalid_attribute",
      "Bookmark description must be a string or null",
    );
    return undefined;
  }
  return {
    type: "bookmark",
    attrs: {
      href: input.attrs.href,
      title: input.attrs.title,
      description: input.attrs.description,
    },
  };
}

function parseYoutube(
  input: RecordValue,
  path: Path,
  context: ValidationContext,
): ContentYoutubeNode | undefined {
  if (!hasExactKeys(input, ["type", "attrs"], path, context)) {
    return undefined;
  }
  if (
    !isRecord(input.attrs) ||
    !hasExactKeys(input.attrs, ["videoId"], [...path, "attrs"], context)
  ) {
    return undefined;
  }
  if (typeof input.attrs.videoId !== "string" || !/^[A-Za-z0-9_-]{11}$/.test(input.attrs.videoId)) {
    context.add(
      [...path, "attrs", "videoId"],
      "invalid_provider_id",
      "YouTube videoId must be 11 URL-safe characters",
    );
    return undefined;
  }
  return { type: "youtube", attrs: { videoId: input.attrs.videoId } };
}

function parseBluesky(
  input: RecordValue,
  path: Path,
  context: ValidationContext,
): ContentBlueskyNode | undefined {
  if (!hasExactKeys(input, ["type", "attrs"], path, context)) {
    return undefined;
  }
  if (
    !isRecord(input.attrs) ||
    !hasExactKeys(input.attrs, ["profile", "postId"], [...path, "attrs"], context)
  ) {
    return undefined;
  }
  if (typeof input.attrs.profile !== "string" || !isBlueskyProfile(input.attrs.profile)) {
    context.add(
      [...path, "attrs", "profile"],
      "invalid_provider_id",
      "Bluesky profile must be a handle or did:plc identifier",
    );
    return undefined;
  }
  if (typeof input.attrs.postId !== "string" || !isRkey(input.attrs.postId)) {
    context.add(
      [...path, "attrs", "postId"],
      "invalid_provider_id",
      "Bluesky postId must be a valid record key",
    );
    return undefined;
  }
  return {
    type: "bluesky",
    attrs: { profile: input.attrs.profile, postId: input.attrs.postId },
  };
}

function parseX(
  input: RecordValue,
  path: Path,
  context: ValidationContext,
): ContentXNode | undefined {
  if (!hasExactKeys(input, ["type", "attrs"], path, context)) {
    return undefined;
  }
  if (
    !isRecord(input.attrs) ||
    !hasExactKeys(input.attrs, ["username", "postId"], [...path, "attrs"], context)
  ) {
    return undefined;
  }
  if (
    typeof input.attrs.username !== "string" ||
    !/^[A-Za-z0-9_]{1,15}$/.test(input.attrs.username)
  ) {
    context.add(
      [...path, "attrs", "username"],
      "invalid_provider_id",
      "X username must be 1 to 15 ASCII word characters",
    );
    return undefined;
  }
  if (typeof input.attrs.postId !== "string" || !/^\d{1,20}$/.test(input.attrs.postId)) {
    context.add(
      [...path, "attrs", "postId"],
      "invalid_provider_id",
      "X postId must contain 1 to 20 digits",
    );
    return undefined;
  }
  return { type: "x", attrs: { username: input.attrs.username, postId: input.attrs.postId } };
}

function parseCallout(
  input: RecordValue,
  path: Path,
  context: ValidationContext,
  depth: number,
): ContentCalloutNode | undefined {
  if (!hasExactKeys(input, ["type", "attrs", "content"], path, context)) {
    return undefined;
  }
  if (!isRecord(input.attrs) || !hasExactKeys(input.attrs, ["kind"], [...path, "attrs"], context)) {
    return undefined;
  }
  if (
    input.attrs.kind !== "info" &&
    input.attrs.kind !== "success" &&
    input.attrs.kind !== "warning" &&
    input.attrs.kind !== "danger"
  ) {
    context.add([...path, "attrs", "kind"], "invalid_kind", "Callout kind is not supported");
    return undefined;
  }
  if (!Array.isArray(input.content) || input.content.length === 0) {
    context.add([...path, "content"], "invalid_content", "Callout content must be nonempty");
    return undefined;
  }
  const content: ContentParagraphNode[] = [];
  for (let index = 0; index < input.content.length && !context.stopped; index += 1) {
    const paragraphPath = [...path, "content", index];
    const paragraph = input.content[index];
    if (!context.enterNode(paragraph, paragraphPath, depth + 1)) {
      continue;
    }
    if (!isRecord(paragraph) || paragraph.type !== "paragraph") {
      context.add(
        [...paragraphPath, "type"],
        "invalid_nesting",
        "Callout content must contain paragraphs",
      );
      context.leaveNode(paragraph);
      continue;
    }
    const parsed = parseParagraph(paragraph, paragraphPath, context, depth + 1);
    context.leaveNode(paragraph);
    if (parsed !== undefined) {
      content.push(parsed);
    }
  }
  return content.length === input.content.length
    ? {
        type: "callout",
        attrs: { kind: input.attrs.kind },
        content,
      }
    : undefined;
}

function parseHorizontalRule(
  input: RecordValue,
  path: Path,
  context: ValidationContext,
): ContentHorizontalRuleNode | undefined {
  return hasExactKeys(input, ["type"], path, context) ? { type: "horizontalRule" } : undefined;
}

function parseInlineContent(
  input: RecordValue,
  path: Path,
  context: ValidationContext,
  depth: number,
): ContentInlineNode[] | undefined {
  if (!Object.hasOwn(input, "content")) {
    return undefined;
  }
  if (!Array.isArray(input.content)) {
    context.add([...path, "content"], "invalid_content", "Inline content must be an array");
    return undefined;
  }
  const content: ContentInlineNode[] = [];
  for (let index = 0; index < input.content.length && !context.stopped; index += 1) {
    const inline = parseInlineNode(
      input.content[index],
      [...path, "content", index],
      context,
      depth + 1,
      true,
      true,
    );
    if (inline !== undefined) {
      content.push(inline);
    }
  }
  return content.length === input.content.length ? content : undefined;
}

function parseInlineNode(
  input: unknown,
  path: Path,
  context: ValidationContext,
  _depth: number,
  allowMarks: boolean,
  allowHardBreak: boolean,
): ContentInlineNode | undefined {
  if (!context.enterNode(input, path, _depth)) {
    return undefined;
  }
  if (!isRecord(input)) {
    context.add(path, "invalid_text", "Inline content must be a text node");
    return undefined;
  }
  try {
    if (input.type === "hardBreak") {
      if (!hasExactKeys(input, ["type"], path, context)) {
        return undefined;
      }
      if (!allowHardBreak) {
        context.add(
          [...path, "type"],
          "invalid_nesting",
          "Hard breaks are only allowed in text-capable blocks",
        );
        return undefined;
      }
      return { type: "hardBreak" };
    }
    if (!hasKeys(input, ["type", "text"], ["marks"], path, context)) {
      return undefined;
    }
    if (input.type !== "text") {
      context.add([...path, "type"], "invalid_node_type", "Inline content must be text");
      return undefined;
    }
    if (typeof input.text !== "string" || input.text.length === 0) {
      context.add([...path, "text"], "invalid_text", "Text content must be a nonempty string");
      return undefined;
    }
    if (input.text.length > MAX_TEXT_LENGTH) {
      context.stop([...path, "text"], "max_text_length", "Text content is too long");
      return undefined;
    }
    if (!allowMarks && Object.hasOwn(input, "marks")) {
      context.add([...path, "marks"], "marks_in_code", "Code blocks cannot contain marks");
      return undefined;
    }
    const marks = parseMarks(input.marks, [...path, "marks"], context, allowMarks);
    if (marks === undefined && Object.hasOwn(input, "marks")) {
      return undefined;
    }
    if (marks?.some((mark) => mark.type === "code") && /[\r\n]/u.test(input.text)) {
      context.add(
        [...path, "text"],
        "code_newline",
        "Code-marked text cannot contain carriage returns or line feeds",
      );
      return undefined;
    }
    const text = input.text.replaceAll("\r\n", "\n");
    if (!context.addTextLength(text.length, [...path, "text"])) {
      return undefined;
    }
    return {
      type: "text",
      text,
      ...(marks !== undefined && marks.length > 0 ? { marks } : {}),
    };
  } finally {
    context.leaveNode(input);
  }
}

function parseMarks(
  input: unknown,
  path: Path,
  context: ValidationContext,
  allowMarks: boolean,
): ContentTextMark[] | undefined {
  if (input === undefined) {
    return undefined;
  }
  if (!allowMarks) {
    context.add(path, "marks_in_code", "Code blocks cannot contain marks");
    return undefined;
  }
  if (!Array.isArray(input)) {
    context.add(path, "invalid_marks", "Text marks must be an array");
    return undefined;
  }
  const marks: ContentTextMark[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < input.length && !context.stopped; index += 1) {
    const markPath = [...path, index];
    const mark = input[index];
    if (!isRecord(mark) || typeof mark.type !== "string") {
      context.add(markPath, "invalid_mark", "Mark must have a string type");
      continue;
    }
    if (seen.has(mark.type)) {
      context.add([...markPath, "type"], "duplicate_mark", "Text marks cannot contain duplicates");
      continue;
    }
    seen.add(mark.type);
    switch (mark.type) {
      case "bold":
      case "italic":
      case "strike":
      case "code":
        if (hasExactKeys(mark, ["type"], markPath, context)) {
          marks.push({ type: mark.type });
        }
        break;
      case "link":
        if (!hasExactKeys(mark, ["type", "attrs"], markPath, context)) {
          break;
        }
        if (
          !isRecord(mark.attrs) ||
          !hasExactKeys(mark.attrs, ["href"], [...markPath, "attrs"], context)
        ) {
          break;
        }
        if (!isAbsoluteHttpUrl(mark.attrs.href)) {
          context.add(
            [...markPath, "attrs", "href"],
            "invalid_url",
            "URL must be an absolute HTTP(S) URL without credentials",
          );
          break;
        }
        marks.push({ type: "link", attrs: { href: mark.attrs.href } });
        break;
      default:
        context.add([...markPath, "type"], "unknown_mark", "Unknown text mark type");
    }
  }
  marks.sort(
    (left, right) =>
      (MARK_ORDER_INDEX.get(left.type) ?? MARK_ORDER.length) -
      (MARK_ORDER_INDEX.get(right.type) ?? MARK_ORDER.length),
  );
  return context.issues.length === 0 || marks.length === input.length ? marks : undefined;
}

function hasKeys(
  value: RecordValue,
  required: readonly string[],
  optional: readonly string[],
  path: Path,
  context: ValidationContext,
): boolean {
  return hasExactKeys(value, required, path, context, optional);
}

function hasExactKeys(
  value: RecordValue,
  required: readonly string[],
  path: Path,
  context: ValidationContext,
  optional: readonly string[] = [],
): boolean {
  const allowed = new Set([...required, ...optional]);
  let valid = true;
  for (const key in value) {
    if (context.stopped) {
      break;
    }
    if (Object.hasOwn(value, key) && !allowed.has(key)) {
      context.add([...path, key], "unknown_key", "Unknown property is not allowed");
      valid = false;
    }
  }
  for (const key of required) {
    if (context.stopped) {
      break;
    }
    if (!Object.hasOwn(value, key)) {
      context.add([...path, key], "missing_key", "Required property is missing");
      valid = false;
    }
  }
  return valid;
}

function isRecord(value: unknown): value is RecordValue {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isSafeIntegerInRange(value: unknown, minimum: number, maximum: number): value is number {
  return (
    typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum
  );
}

function isAbsoluteHttpUrl(value: unknown): value is string {
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

function isBlueskyProfile(value: string): boolean {
  if (/^did:plc:[a-z0-9]{24}$/.test(value)) {
    return true;
  }
  if (value.length === 0 || value.length > 253 || !/^[a-z0-9.-]+$/.test(value)) {
    return false;
  }
  const labels = value.split(".");
  return (
    labels.length >= 2 &&
    labels.every(
      (label) =>
        label.length > 0 && label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label),
    )
  );
}

function isRkey(value: string): boolean {
  return value.length >= 1 && value.length <= 512 && /^[A-Za-z0-9._~-]+$/.test(value);
}

const UUIDV7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
