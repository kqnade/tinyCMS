import {
  type ContentBlock,
  type ContentListItemNode,
  type ContentListNode,
  type ContentTableNode,
  type ContentTableRowNode,
  type ContentTaskItemNode,
  type ContentTaskListNode,
  type ContentTextNode,
  parseContentDocument,
} from "./schema";

export type MediaUrlResolver = (mediaId: string) => string | null;

export type HtmlRenderOptions = {
  readonly resolveMediaUrl: MediaUrlResolver;
};

const UNSAFE_MEDIA_URL_MESSAGE = "Media URL resolver returned an unsafe URL";

type RenderContext = {
  readonly resolveMediaUrl: MediaUrlResolver;
  readonly mediaUrls: Map<string, string | null>;
};

export function renderHtml(
  contentVersion: unknown,
  input: unknown,
  options: HtmlRenderOptions,
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
  return renderBlocks(document.content, context);
}

function renderBlocks(blocks: readonly ContentBlock[], context: RenderContext): string {
  return blocks.map((block) => renderBlock(block, context)).join("\n");
}

function renderBlock(block: ContentBlock, context: RenderContext): string {
  switch (block.type) {
    case "paragraph":
      return `<p>${renderInline(block.content)}</p>`;
    case "heading":
      return `<h${block.attrs.level}>${renderInline(block.content)}</h${block.attrs.level}>`;
    case "bulletList":
    case "orderedList":
      return renderList(block, context);
    case "taskList":
      return renderTaskList(block, context);
    case "table":
      return renderTable(block);
    case "blockquote":
      return `<blockquote>${renderBlocks(block.content, context)}</blockquote>`;
    case "codeBlock":
      return renderCodeBlock(block);
    case "image":
      return renderImage(block, context);
    case "bookmark":
      return renderBookmark(block);
    case "youtube":
      return renderProviderLink(
        "provider-youtube",
        `https://www.youtube.com/watch?v=${encodeURIComponent(block.attrs.videoId)}`,
        "YouTube video",
      );
    case "bluesky":
      return renderProviderLink(
        "provider-bluesky",
        `https://bsky.app/profile/${encodeURIComponent(block.attrs.profile)}/post/${encodeURIComponent(block.attrs.postId)}`,
        "Bluesky post",
      );
    case "x":
      return renderProviderLink(
        "provider-x",
        `https://x.com/${encodeURIComponent(block.attrs.username)}/status/${encodeURIComponent(block.attrs.postId)}`,
        "X post",
      );
    case "callout":
      return `<aside class="callout callout-${block.attrs.kind}" role="note">${renderBlocks(block.content, context)}</aside>`;
    case "horizontalRule":
      return "<hr>";
  }
}

function renderList(block: ContentListNode, context: RenderContext): string {
  const tag = block.type === "bulletList" ? "ul" : "ol";
  const start = block.type === "orderedList" ? ` start="${block.attrs.start}"` : "";
  const items = block.content.map((item) => renderListItem(item, context)).join("\n");
  return `<${tag}${start}>${items}</${tag}>`;
}

function renderListItem(item: ContentListItemNode, context: RenderContext): string {
  return `<li>${renderBlocks(item.content, context)}</li>`;
}

function renderTaskList(block: ContentTaskListNode, context: RenderContext): string {
  const items = block.content.map((item) => renderTaskItem(item, context)).join("\n");
  return `<ul class="task-list">${items}</ul>`;
}

function renderTaskItem(item: ContentTaskItemNode, context: RenderContext): string {
  const checked = item.attrs.checked;
  const checkbox = checked
    ? '<input type="checkbox" checked disabled aria-label="Completed task">'
    : '<input type="checkbox" disabled aria-label="Incomplete task">';
  return `<li class="task-item" data-checked="${checked}">${checkbox}<div class="task-item-content">${renderBlocks(item.content, context)}</div></li>`;
}

function renderTable(block: ContentTableNode): string {
  const [headerRow, ...bodyRows] = block.content;
  if (headerRow === undefined) {
    throw new Error("Table must contain a header row");
  }
  const header = renderTableRow(headerRow, true);
  const body = bodyRows.map((row) => renderTableRow(row, false)).join("\n");
  return `<table><thead>${header}</thead><tbody>${body}</tbody></table>`;
}

function renderTableRow(row: ContentTableRowNode, header: boolean): string {
  const cells = row.content
    .map((cell) => {
      const paragraph = cell.content[0];
      const content = renderInline(paragraph.content);
      return header ? `<th scope="col"><p>${content}</p></th>` : `<td><p>${content}</p></td>`;
    })
    .join("");
  return `<tr>${cells}</tr>`;
}

function renderCodeBlock(block: Extract<ContentBlock, { type: "codeBlock" }>): string {
  const className =
    block.attrs.language === null ? "" : ` class="language-${block.attrs.language}"`;
  const content = (block.content ?? []).map((node) => escapeHtml(node.text)).join("");
  return `<pre><code${className}>${content}</code></pre>`;
}

function renderImage(
  block: Extract<ContentBlock, { type: "image" }>,
  context: RenderContext,
): string {
  const { mediaId, alt, caption } = block.attrs;
  const mediaUrl = resolveMediaUrl(mediaId, context);
  const captionMarkup = caption === null ? "" : `<figcaption>${escapeHtml(caption)}</figcaption>`;
  if (mediaUrl === null) {
    return `<figure class="media-unavailable"><div class="media-placeholder" role="img" aria-label="${escapeHtml(alt)}">Image unavailable</div>${captionMarkup}</figure>`;
  }
  return `<figure><img src="${escapeHtml(mediaUrl)}" alt="${escapeHtml(alt)}" loading="lazy" decoding="async">${captionMarkup}</figure>`;
}

function renderBookmark(block: Extract<ContentBlock, { type: "bookmark" }>): string {
  const { href, title, description } = block.attrs;
  const descriptionMarkup =
    description === null
      ? ""
      : `<span class="link-card-description">${escapeHtml(description)}</span>`;
  return `<a class="link-card" href="${escapeHtml(href)}" rel="noopener noreferrer"><span class="link-card-title">${escapeHtml(title)}</span>${descriptionMarkup}</a>`;
}

function renderProviderLink(className: string, href: string, title: string): string {
  return `<a class="link-card ${className}" href="${escapeHtml(href)}" rel="noopener noreferrer"><span class="link-card-title">${title}</span></a>`;
}

function renderInline(content: readonly ContentTextNode[] | undefined): string {
  return (content ?? []).map(renderText).join("");
}

function renderText(node: ContentTextNode): string {
  let result = escapeHtml(node.text);
  const marks = node.marks ?? [];
  for (let index = marks.length - 1; index >= 0; index -= 1) {
    const mark = marks[index];
    if (mark === undefined) {
      continue;
    }
    switch (mark.type) {
      case "bold":
        result = `<strong>${result}</strong>`;
        break;
      case "italic":
        result = `<em>${result}</em>`;
        break;
      case "strike":
        result = `<s>${result}</s>`;
        break;
      case "code":
        result = `<code>${result}</code>`;
        break;
      case "link":
        result = `<a href="${escapeHtml(mark.attrs.href)}" rel="noopener noreferrer">${result}</a>`;
        break;
    }
  }
  return result;
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

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
