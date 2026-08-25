export const CONTENT_VERSION = 1 as const;

const MAX_DEPTH = 64;
const MAX_NODES = 1_000;
const MAX_TEXT_LENGTH = 1_000_000;

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

export type ContentParagraphNode = {
  readonly type: "paragraph";
  readonly content?: readonly ContentTextNode[];
};

export type ContentHeadingNode = {
  readonly type: "heading";
  readonly attrs: { readonly level: 1 | 2 | 3 | 4 | 5 | 6 };
  readonly content?: readonly ContentTextNode[];
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
  | ContentBlockquoteNode
  | ContentCodeBlockNode
  | ContentHorizontalRuleNode;

export type ContentListItemChild =
  | ContentParagraphNode
  | ContentListNode
  | ContentBlockquoteNode
  | ContentCodeBlockNode;

export type ContentBlock =
  | ContentOrdinaryBlock
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

  add(path: Path, code: string, message: string): void {
    this.issues.push({ code, message, path: [...path] });
  }

  enterNode(value: object, path: Path, depth: number): boolean {
    if (depth > MAX_DEPTH) {
      this.add(path, "max_depth", "Document nesting is too deep");
      return false;
    }
    this.nodeCount += 1;
    if (this.nodeCount > MAX_NODES) {
      this.add(path, "max_nodes", "Document contains too many nodes");
      return false;
    }
    if (this.activeNodes.has(value)) {
      this.add(path, "cycle", "Document contains a cyclic node");
      return false;
    }
    this.activeNodes.add(value);
    return true;
  }

  leaveNode(value: object): void {
    this.activeNodes.delete(value);
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
  for (let index = 0; index < input.content.length; index += 1) {
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
  if (!isRecord(input)) {
    context.add(path, "invalid_node", "Node must be an object");
    return undefined;
  }
  if (!context.enterNode(input, path, depth)) {
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
  if (!isRecord(input)) {
    context.add(path, "invalid_node", "Node must be an object");
    return undefined;
  }
  if (!context.enterNode(input, path, depth)) {
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
  if (!isRecord(input)) {
    context.add(path, "invalid_node", "Node must be an object");
    return undefined;
  }
  if (!context.enterNode(input, path, depth)) {
    return undefined;
  }
  try {
    if (input.type === "paragraph") {
      return parseParagraph(input, path, context, depth);
    }
    if (input.type === "bulletList" || input.type === "orderedList") {
      return parseList(input, path, context, depth);
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
  const content: ContentTextNode[] = [];
  if (Array.isArray(input.content)) {
    for (let index = 0; index < input.content.length; index += 1) {
      const text = parseText(
        input.content[index],
        [...path, "content", index],
        context,
        depth + 1,
        true,
      );
      if (text !== undefined) {
        content.push(text);
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
  for (let index = 0; index < input.content.length; index += 1) {
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
  if (!isRecord(input)) {
    context.add(path, "invalid_node", "List item must be an object");
    return undefined;
  }
  if (!context.enterNode(input, path, depth)) {
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
  for (let index = 0; index < input.content.length; index += 1) {
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
  for (let index = 0; index < input.content.length; index += 1) {
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
    for (let index = 0; index < input.content.length; index += 1) {
      const text = parseText(
        input.content[index],
        [...path, "content", index],
        context,
        depth + 1,
        false,
      );
      if (text !== undefined) {
        content.push(text);
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
  for (let index = 0; index < input.content.length; index += 1) {
    const paragraphPath = [...path, "content", index];
    const paragraph = input.content[index];
    if (!isRecord(paragraph) || paragraph.type !== "paragraph") {
      context.add(
        [...paragraphPath, "type"],
        "invalid_nesting",
        "Callout content must contain paragraphs",
      );
      continue;
    }
    if (!context.enterNode(paragraph, paragraphPath, depth + 1)) {
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
): ContentTextNode[] | undefined {
  if (!Object.hasOwn(input, "content")) {
    return undefined;
  }
  if (!Array.isArray(input.content)) {
    context.add([...path, "content"], "invalid_content", "Inline content must be an array");
    return undefined;
  }
  const content: ContentTextNode[] = [];
  for (let index = 0; index < input.content.length; index += 1) {
    const text = parseText(
      input.content[index],
      [...path, "content", index],
      context,
      depth + 1,
      true,
    );
    if (text !== undefined) {
      content.push(text);
    }
  }
  return content.length === input.content.length ? content : undefined;
}

function parseText(
  input: unknown,
  path: Path,
  context: ValidationContext,
  _depth: number,
  allowMarks: boolean,
): ContentTextNode | undefined {
  if (!isRecord(input)) {
    context.add(path, "invalid_text", "Inline content must be a text node");
    return undefined;
  }
  if (!context.enterNode(input, path, _depth)) {
    return undefined;
  }
  try {
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
      context.add([...path, "text"], "max_text_length", "Text content is too long");
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
    return {
      type: "text",
      text: input.text.replaceAll("\r\n", "\n"),
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
  for (let index = 0; index < input.length; index += 1) {
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
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      context.add([...path, key], "unknown_key", "Unknown property is not allowed");
      valid = false;
    }
  }
  for (const key of required) {
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
