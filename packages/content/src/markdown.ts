import type { MediaUrlResolver } from "./html";
import {
  type ContentBlock,
  type ContentBlockquoteNode,
  type ContentCodeBlockNode,
  type ContentListItemChild,
  type ContentListNode,
  type ContentTableNode,
  type ContentTableRowNode,
  type ContentTaskListNode,
  type ContentTextNode,
  parseContentDocument,
} from "./schema";

export type MarkdownRenderOptions = {
  readonly resolveMediaUrl: MediaUrlResolver;
};

const UNSAFE_MEDIA_URL_MESSAGE = "Media URL resolver returned an unsafe URL";

type RenderContext = {
  readonly resolveMediaUrl: MediaUrlResolver;
  readonly mediaUrls: Map<string, string | null>;
};

export function renderMarkdown(
  contentVersion: unknown,
  input: unknown,
  options: MarkdownRenderOptions,
): string {
  const document = parseContentDocument(contentVersion, input);
  const resolveMediaUrl = options?.resolveMediaUrl;
  if (typeof resolveMediaUrl !== "function") {
    throw new TypeError("resolveMediaUrl must be a function");
  }

  const context: RenderContext = {
    resolveMediaUrl,
    mediaUrls: new Map(),
  };
  return trimTrailingNewlines(renderBlocks(document.content, context));
}

function renderBlocks(blocks: readonly ContentBlock[], context: RenderContext): string {
  return blocks.map((block) => trimTrailingNewlines(renderBlock(block, context))).join("\n\n");
}

function renderBlock(block: ContentBlock, context: RenderContext): string {
  switch (block.type) {
    case "paragraph":
      return renderInline(block.content);
    case "heading":
      return `${"#".repeat(block.attrs.level)} ${renderInline(block.content)}`;
    case "bulletList":
    case "orderedList":
      return renderList(block, context);
    case "taskList":
      return renderTaskList(block, context);
    case "table":
      return renderTable(block);
    case "blockquote":
      return renderBlockquote(block, context);
    case "codeBlock":
      return renderCodeBlock(block);
    case "image":
      return renderImage(block, context);
    case "bookmark":
      return renderBookmark(block);
    case "youtube":
      return renderProviderLink(
        "YouTube video",
        `https://www.youtube.com/watch?v=${encodeURIComponent(block.attrs.videoId)}`,
      );
    case "bluesky":
      return renderProviderLink(
        "Bluesky post",
        `https://bsky.app/profile/${encodeURIComponent(block.attrs.profile)}/post/${encodeURIComponent(block.attrs.postId)}`,
      );
    case "x":
      return renderProviderLink(
        "X post",
        `https://x.com/${encodeURIComponent(block.attrs.username)}/status/${encodeURIComponent(block.attrs.postId)}`,
      );
    case "callout":
      return renderCallout(block, context);
    case "horizontalRule":
      return "---";
  }
}

function renderList(block: ContentListNode, context: RenderContext): string {
  return block.content
    .map((item, index) => {
      const markerText = block.type === "bulletList" ? "-" : `${block.attrs.start + index}.`;
      const marker = `${markerText} `;
      const continuation = " ".repeat(marker.length);
      const firstChild = item.content[0];
      if (firstChild === undefined) {
        return marker.trimEnd();
      }

      const first = renderListItemChild(firstChild, context);
      const itemLines = first
        .split("\n")
        .map((line, lineIndex) =>
          lineIndex === 0 ? `${marker}${line}` : `${continuation}${line}`,
        );
      for (const child of item.content.slice(1)) {
        itemLines.push("");
        const renderedChild = renderListItemChild(child, context);
        itemLines.push(
          ...renderedChild
            .split("\n")
            .map((line) => (line.length === 0 ? line : `${continuation}${line}`)),
        );
      }
      return itemLines.join("\n");
    })
    .join("\n");
}

function renderListItemChild(child: ContentListItemChild, context: RenderContext): string {
  return renderBlock(child, context);
}

function renderTaskList(block: ContentTaskListNode, context: RenderContext): string {
  return block.content
    .map((item) => {
      const marker = item.attrs.checked ? "- [x] " : "- [ ] ";
      const continuation = " ".repeat(marker.length);
      const firstChild = item.content[0];
      if (firstChild === undefined) {
        return marker.trimEnd();
      }

      const first = renderBlock(firstChild, context);
      const itemLines = first
        .split("\n")
        .map((line, lineIndex) =>
          lineIndex === 0 ? `${marker}${line}` : `${continuation}${line}`,
        );
      for (const child of item.content.slice(1)) {
        itemLines.push("");
        const renderedChild = renderBlock(child, context);
        itemLines.push(
          ...renderedChild
            .split("\n")
            .map((line) => (line.length === 0 ? line : `${continuation}${line}`)),
        );
      }
      return itemLines.join("\n");
    })
    .join("\n");
}

function renderTable(block: ContentTableNode): string {
  const header = block.content[0];
  const body = block.content.slice(1);
  const headerCells = header?.content ?? [];
  const lines = [renderTableRow(headerCells), renderTableDelimiter(headerCells.length)];
  lines.push(...body.map((row) => renderTableRow(row.content)));
  return lines.join("\n");
}

function renderTableRow(cells: ContentTableRowNode["content"]): string {
  return `| ${cells
    .map((cell) =>
      renderInline(cell.content[0]?.content, { tableCell: true }).replaceAll("\n", "<br>"),
    )
    .join(" | ")} |`;
}

function renderTableDelimiter(columnCount: number): string {
  return `| ${Array.from({ length: columnCount }, () => "---").join(" | ")} |`;
}

function renderBlockquote(block: ContentBlockquoteNode, context: RenderContext): string {
  return prefixBlockquote(renderBlocks(block.content, context));
}

function prefixBlockquote(value: string): string {
  return value
    .split("\n")
    .map((line) => (line.length === 0 ? ">" : `> ${line}`))
    .join("\n");
}

function renderCodeBlock(block: ContentCodeBlockNode): string {
  const payload = (block.content ?? []).map((node) => node.text).join("");
  const fence = "`".repeat(Math.max(3, longestBacktickRun(payload) + 1));
  const language = block.attrs.language ?? "";
  const body = payload.length === 0 || payload.endsWith("\n") ? payload : `${payload}\n`;
  return `${fence}${language}\n${body}${fence}`;
}

function renderImage(
  block: Extract<ContentBlock, { type: "image" }>,
  context: RenderContext,
): string {
  const { mediaId, alt, caption } = block.attrs;
  const mediaUrl = resolveMediaUrl(mediaId, context);
  if (mediaUrl === null) {
    const captionText = caption === null ? "" : ` — ${escapeMarkdownText(caption)}`;
    return `Image unavailable: ${escapeMarkdownText(alt)}${captionText}`;
  }

  const title = caption === null ? "" : ` "${escapeMarkdownTitle(caption)}"`;
  return `![${escapeMarkdownText(alt)}](${escapeLinkDestination(mediaUrl)}${title})`;
}

function renderBookmark(block: Extract<ContentBlock, { type: "bookmark" }>): string {
  const link = `[${escapeMarkdownText(block.attrs.title)}](${escapeLinkDestination(block.attrs.href)})`;
  return block.attrs.description === null
    ? link
    : `${link} — ${escapeMarkdownText(block.attrs.description)}`;
}

function renderProviderLink(label: string, href: string): string {
  return `[${label}](${escapeLinkDestination(href)})`;
}

function renderCallout(
  block: Extract<ContentBlock, { type: "callout" }>,
  context: RenderContext,
): string {
  const label = `${block.attrs.kind[0]?.toUpperCase() ?? ""}${block.attrs.kind.slice(1)}`;
  const body = renderBlocks(block.content, context);
  return prefixBlockquote(`**${label}**${body.length === 0 ? "" : `\n\n${body}`}`);
}

type InlineRenderOptions = {
  readonly tableCell?: boolean;
};

function renderInline(
  content: readonly ContentTextNode[] | undefined,
  options: InlineRenderOptions = {},
): string {
  return (content ?? []).map((node) => renderText(node, options)).join("");
}

function renderText(node: ContentTextNode, options: InlineRenderOptions = {}): string {
  const marks = node.marks ?? [];
  const codeMark = marks.find((mark) => mark.type === "code");
  const value =
    codeMark === undefined
      ? splitBoundaryWhitespace(node.text)
      : { leading: "", content: node.text, trailing: "" };
  if (codeMark === undefined && value.content.length === 0) {
    return value.leading;
  }
  let result =
    codeMark === undefined
      ? escapeMarkdownText(value.content)
      : renderCodeSpan(value.content, options.tableCell === true);

  const linkMark = marks.find((mark) => mark.type === "link");
  if (linkMark?.type === "link") {
    result = `[${result}](${escapeLinkDestination(linkMark.attrs.href, options.tableCell === true)})`;
  }

  for (let index = marks.length - 1; index >= 0; index -= 1) {
    const mark = marks[index];
    if (mark === undefined || mark.type === "code" || mark.type === "link") {
      continue;
    }
    switch (mark.type) {
      case "bold":
        result = `**${result}**`;
        break;
      case "italic":
        result = `*${result}*`;
        break;
      case "strike":
        result = `~~${result}~~`;
        break;
    }
  }
  return `${value.leading}${result}${value.trailing}`;
}

function splitBoundaryWhitespace(value: string): {
  readonly leading: string;
  readonly content: string;
  readonly trailing: string;
} {
  const leading = value.match(/^\s+/u)?.[0] ?? "";
  const trailing = value.match(/\s+$/u)?.[0] ?? "";
  if (leading.length + trailing.length >= value.length) {
    return { leading: value, content: "", trailing: "" };
  }
  return {
    leading,
    content: value.slice(leading.length, value.length - trailing.length),
    trailing,
  };
}

function renderCodeSpan(value: string, tableCell = false): string {
  const delimiter = "`".repeat(Math.max(1, longestBacktickRun(value) + 1));
  const needsPadding =
    !/^ +$/u.test(value) &&
    (value.startsWith(" ") || value.endsWith(" ") || value.startsWith("`") || value.endsWith("`"));
  const payload = needsPadding ? ` ${value} ` : value;
  const escapedPayload = tableCell ? escapeTablePipe(payload) : payload;
  return `${delimiter}${escapedPayload}${delimiter}`;
}

function longestBacktickRun(value: string): number {
  let longest = 0;
  let current = 0;
  for (const character of value) {
    if (character === "`") {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }
  return longest;
}

function resolveMediaUrl(mediaId: string, context: RenderContext): string | null {
  if (context.mediaUrls.has(mediaId)) {
    return context.mediaUrls.get(mediaId) ?? null;
  }
  const mediaUrl = context.resolveMediaUrl(mediaId);
  if (mediaUrl !== null && !isSafeMediaUrl(mediaUrl)) {
    throw new Error(UNSAFE_MEDIA_URL_MESSAGE);
  }
  context.mediaUrls.set(mediaId, mediaUrl);
  return mediaUrl;
}

function isSafeMediaUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || hasControlOrWhitespace(value)) {
    return false;
  }
  if (value.startsWith("/")) {
    return !value.startsWith("//") && !value.startsWith("/\\");
  }
  if (value.includes("\\")) {
    return false;
  }
  const urlConstructor = (globalThis as unknown as { URL?: UrlConstructor }).URL;
  if (urlConstructor === undefined) {
    return false;
  }
  try {
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

function hasControlOrWhitespace(value: string): boolean {
  for (const character of value) {
    if (/\s/u.test(character)) {
      return true;
    }
    const code = character.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }
  return false;
}

const MARKDOWN_ESCAPE_CHARACTERS = new Set([
  "\\",
  "`",
  "*",
  "_",
  "[",
  "]",
  "{",
  "}",
  "(",
  ")",
  "#",
  "+",
  "-",
  ".",
  "!",
  "|",
  "~",
  "=",
]);

function escapeMarkdownText(value: string): string {
  let escaped = "";
  for (const character of value) {
    if (character === "&") {
      escaped += "&amp;";
    } else if (character === "<") {
      escaped += "&lt;";
    } else if (character === ">") {
      escaped += "&gt;";
    } else {
      escaped += MARKDOWN_ESCAPE_CHARACTERS.has(character) ? `\\${character}` : character;
    }
  }
  return escaped;
}

function escapeMarkdownTitle(value: string): string {
  return escapeMarkdownText(value).replaceAll('"', '\\"').replaceAll("\n", " ");
}

function escapeLinkDestination(value: string, tableCell = false): string {
  const escaped = value
    .replaceAll("\\", "\\\\")
    .replaceAll("<", "%3C")
    .replaceAll(">", "%3E")
    .replaceAll("(", "\\(")
    .replaceAll(")", "\\)")
    .replaceAll("[", "\\[")
    .replaceAll("]", "\\]");
  return tableCell ? escapeTablePipe(escaped) : escaped;
}

function escapeTablePipe(value: string): string {
  return value.replaceAll("|", "\\|");
}

function trimTrailingNewlines(value: string): string {
  return value.replace(/\n+$/u, "");
}
