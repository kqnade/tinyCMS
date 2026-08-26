import {
  type CheckpointPostRevisionRequest,
  type CreatePostRequest,
  EDITOR_CONTENT_VERSION,
  type JsonObject,
  type JsonValue,
  type PostListQuery,
  type PostRevisionListQuery,
  type PostRevisionRouteParams,
  type PostRouteParams,
  type RestorePostRevisionRequest,
  type SavePostDraftRequest,
  type UtcTimestamp,
  type UuidV7,
} from "./editorial";

export type ContractParseIssue = {
  readonly path: readonly (string | number)[];
  readonly code: string;
  readonly message: string;
};

export type ContractParseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly ContractParseIssue[] };

const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UTC_TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?Z$/;
const MAX_OBJECT_KEYS = 16;

export const MAX_CURSOR_LENGTH = 2048 as const;
export const MAX_LIST_LIMIT = 100 as const;
export const MAX_SLUG_LENGTH = 128 as const;
export const MAX_TITLE_LENGTH = 512 as const;
export const MAX_EXCERPT_LENGTH = 2048 as const;
export const MAX_METADATA_DEPTH = 16 as const;
export const MAX_METADATA_PROPERTIES = 1000 as const;
export const MAX_METADATA_KEY_LENGTH = 128 as const;
export const MAX_METADATA_STRING_LENGTH = 10000 as const;

const CREATE_POST_KEYS = ["slug", "title", "contentVersion", "content"] as const;
const SAVE_POST_DRAFT_KEYS = [
  "expectedDraftVersion",
  "title",
  "excerpt",
  "contentVersion",
  "content",
  "metadata",
] as const;
const EXPECTED_DRAFT_VERSION_KEYS = ["expectedDraftVersion"] as const;

export function parseUuidV7(input: unknown): ContractParseResult<UuidV7> {
  if (typeof input === "string" && UUID_V7_PATTERN.test(input)) {
    return { ok: true, value: input };
  }

  return {
    ok: false,
    issues: [
      {
        path: [],
        code: "invalid_uuid_v7",
        message: "Expected a canonical lowercase UUIDv7.",
      },
    ],
  };
}

export function parseUtcTimestamp(input: unknown): ContractParseResult<UtcTimestamp> {
  if (typeof input === "string" && input.length <= 30) {
    const match = UTC_TIMESTAMP_PATTERN.exec(input);
    if (match !== null) {
      const year = Number(match[1]);
      const month = Number(match[2]);
      const day = Number(match[3]);
      const hour = Number(match[4]);
      const minute = Number(match[5]);
      const second = Number(match[6]);

      if (
        month >= 1 &&
        month <= 12 &&
        day >= 1 &&
        day <= daysInMonth(year, month) &&
        hour >= 0 &&
        hour <= 23 &&
        minute >= 0 &&
        minute <= 59 &&
        second >= 0 &&
        second <= 59
      ) {
        return { ok: true, value: input as UtcTimestamp };
      }
    }
  }

  return {
    ok: false,
    issues: [
      {
        path: [],
        code: "invalid_utc_timestamp",
        message: "Expected a valid RFC3339 UTC timestamp ending in Z.",
      },
    ],
  };
}

export function parsePostRouteParams(input: unknown): ContractParseResult<PostRouteParams> {
  const inspection = inspectObject(input, ["postId"]);
  if (!("record" in inspection)) {
    return { ok: false, issues: inspection };
  }

  const issues = [...inspection.issues];
  const postId = parseRequiredUuid(inspection, "postId", issues);
  if (issues.length > 0) {
    return { ok: false, issues };
  }

  return { ok: true, value: { postId: postId as UuidV7 } };
}

export function parsePostRevisionRouteParams(
  input: unknown,
): ContractParseResult<PostRevisionRouteParams> {
  const inspection = inspectObject(input, ["postId", "revisionId"]);
  if (!("record" in inspection)) {
    return { ok: false, issues: inspection };
  }

  const issues = [...inspection.issues];
  const postId = parseRequiredUuid(inspection, "postId", issues);
  const revisionId = parseRequiredUuid(inspection, "revisionId", issues);
  if (issues.length > 0) {
    return { ok: false, issues };
  }

  return {
    ok: true,
    value: {
      postId: postId as UuidV7,
      revisionId: revisionId as UuidV7,
    },
  };
}

export function parseCreatePostRequest(input: unknown): ContractParseResult<CreatePostRequest> {
  const inspection = inspectObject(input, CREATE_POST_KEYS);
  if (!isObjectInspection(inspection)) {
    return { ok: false, issues: inspection };
  }

  const issues = [...inspection.issues];
  let slug: string | undefined;
  let title: string | undefined;
  let contentVersion: typeof EDITOR_CONTENT_VERSION | undefined;
  let content: unknown;
  let hasContent = false;

  if (inspection.keys.includes("slug")) {
    const read = readProperty(inspection.record, "slug");
    if (!read.ok) {
      issues.push(issue(["slug"], "invalid_value", "Property could not be read safely."));
    } else {
      const parsed = parseSlug(read.value);
      if (!parsed.ok) {
        appendIssues(issues, "slug", parsed.issues);
      } else {
        slug = parsed.value;
      }
    }
  }

  if (inspection.keys.includes("title")) {
    const read = readProperty(inspection.record, "title");
    if (!read.ok) {
      issues.push(issue(["title"], "invalid_value", "Property could not be read safely."));
    } else {
      const parsed = parseBoundedString(read.value, MAX_TITLE_LENGTH, "title");
      if (!parsed.ok) {
        appendIssues(issues, "title", parsed.issues);
      } else {
        title = parsed.value;
      }
    }
  }

  if (inspection.keys.includes("contentVersion")) {
    const read = readProperty(inspection.record, "contentVersion");
    if (!read.ok) {
      issues.push(issue(["contentVersion"], "invalid_value", "Property could not be read safely."));
    } else {
      const parsed = parseContentVersion(read.value);
      if (!parsed.ok) {
        appendIssues(issues, "contentVersion", parsed.issues);
      } else {
        contentVersion = parsed.value;
      }
    }
  }

  if (inspection.keys.includes("content")) {
    const read = readProperty(inspection.record, "content");
    if (!read.ok) {
      issues.push(issue(["content"], "invalid_value", "Property could not be read safely."));
    } else if (read.value === undefined) {
      issues.push(issue(["content"], "invalid_content", "Content must not be undefined."));
    } else {
      content = read.value;
      hasContent = true;
    }
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  const value: CreatePostRequest = {};
  if (slug !== undefined) {
    value.slug = slug;
  }
  if (title !== undefined) {
    value.title = title;
  }
  if (contentVersion !== undefined) {
    value.contentVersion = contentVersion;
  }
  if (hasContent) {
    value.content = content;
  }
  return { ok: true, value };
}

export function parseCheckpointPostRevisionRequest(
  input: unknown,
): ContractParseResult<CheckpointPostRevisionRequest> {
  return parseExpectedDraftVersionRequest<CheckpointPostRevisionRequest>(input);
}

export function parseRestorePostRevisionRequest(
  input: unknown,
): ContractParseResult<RestorePostRevisionRequest> {
  return parseExpectedDraftVersionRequest<RestorePostRevisionRequest>(input);
}

export function parseSavePostDraftRequest(
  input: unknown,
): ContractParseResult<SavePostDraftRequest> {
  const inspection = inspectObject(input, SAVE_POST_DRAFT_KEYS);
  if (!isObjectInspection(inspection)) {
    return { ok: false, issues: inspection };
  }

  const issues = [...inspection.issues];
  let expectedDraftVersion: number | undefined;
  let title: string | undefined;
  let excerpt: string | null | undefined;
  let hasExcerpt = false;
  let contentVersion: typeof EDITOR_CONTENT_VERSION | undefined;
  let content: unknown;
  let metadata: JsonObject | undefined;
  let hasMetadata = false;

  if (inspection.keys.includes("expectedDraftVersion")) {
    const read = readProperty(inspection.record, "expectedDraftVersion");
    if (!read.ok) {
      issues.push(
        issue(["expectedDraftVersion"], "invalid_value", "Property could not be read safely."),
      );
    } else {
      const parsed = parseExpectedDraftVersion(read.value);
      if (!parsed.ok) {
        appendIssues(issues, "expectedDraftVersion", parsed.issues);
      } else {
        expectedDraftVersion = parsed.value;
      }
    }
  } else {
    issues.push(issue(["expectedDraftVersion"], "missing_key", "Required property is missing."));
  }

  if (inspection.keys.includes("title")) {
    const read = readProperty(inspection.record, "title");
    if (!read.ok) {
      issues.push(issue(["title"], "invalid_value", "Property could not be read safely."));
    } else {
      const parsed = parseBoundedString(read.value, MAX_TITLE_LENGTH, "title");
      if (!parsed.ok) {
        appendIssues(issues, "title", parsed.issues);
      } else {
        title = parsed.value;
      }
    }
  } else {
    issues.push(issue(["title"], "missing_key", "Required property is missing."));
  }

  if (inspection.keys.includes("excerpt")) {
    hasExcerpt = true;
    const read = readProperty(inspection.record, "excerpt");
    if (!read.ok) {
      issues.push(issue(["excerpt"], "invalid_value", "Property could not be read safely."));
    } else if (read.value === null) {
      excerpt = null;
    } else {
      const parsed = parseBoundedString(read.value, MAX_EXCERPT_LENGTH, "excerpt");
      if (!parsed.ok) {
        appendIssues(issues, "excerpt", parsed.issues);
      } else {
        excerpt = parsed.value;
      }
    }
  }

  if (inspection.keys.includes("contentVersion")) {
    const read = readProperty(inspection.record, "contentVersion");
    if (!read.ok) {
      issues.push(issue(["contentVersion"], "invalid_value", "Property could not be read safely."));
    } else {
      const parsed = parseContentVersion(read.value);
      if (!parsed.ok) {
        appendIssues(issues, "contentVersion", parsed.issues);
      } else {
        contentVersion = parsed.value;
      }
    }
  } else {
    issues.push(issue(["contentVersion"], "missing_key", "Required property is missing."));
  }

  if (inspection.keys.includes("content")) {
    const read = readProperty(inspection.record, "content");
    if (!read.ok) {
      issues.push(issue(["content"], "invalid_value", "Property could not be read safely."));
    } else if (read.value === undefined) {
      issues.push(issue(["content"], "invalid_content", "Content must not be undefined."));
    } else {
      content = read.value;
    }
  } else {
    issues.push(issue(["content"], "missing_key", "Required property is missing."));
  }

  if (inspection.keys.includes("metadata")) {
    hasMetadata = true;
    const read = readProperty(inspection.record, "metadata");
    if (!read.ok) {
      issues.push(issue(["metadata"], "invalid_value", "Property could not be read safely."));
      hasMetadata = false;
    } else {
      const parsed = parseMetadata(read.value);
      if (!parsed.ok) {
        appendIssues(issues, "metadata", parsed.issues);
        hasMetadata = false;
      } else {
        metadata = parsed.value;
      }
    }
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  const value = {
    expectedDraftVersion: expectedDraftVersion as number,
    title: title as string,
  } as SavePostDraftRequest;
  if (hasExcerpt) {
    value.excerpt = excerpt as string | null;
  }
  value.contentVersion = contentVersion as typeof EDITOR_CONTENT_VERSION;
  value.content = content;
  if (hasMetadata) {
    value.metadata = metadata as JsonObject;
  }
  return { ok: true, value };
}

export function parsePostListQuery(input: unknown): ContractParseResult<PostListQuery> {
  return parseListQuery(input);
}

export function parsePostRevisionListQuery(
  input: unknown,
): ContractParseResult<PostRevisionListQuery> {
  return parseListQuery(input);
}

function parseListQuery(input: unknown): ContractParseResult<PostListQuery> {
  const inspection = inspectObject(input, ["cursor", "limit"]);
  if (!("record" in inspection)) {
    return { ok: false, issues: inspection };
  }

  const issues = [...inspection.issues];
  let cursor: string | undefined;
  let limit: number | undefined;

  if (inspection.keys.includes("cursor")) {
    const read = readProperty(inspection.record, "cursor");
    if (!read.ok) {
      issues.push(issue(["cursor"], "invalid_value", "Property could not be read safely."));
    } else if (typeof read.value !== "string") {
      issues.push(issue(["cursor"], "invalid_cursor", "Cursor must be a string."));
    } else if (read.value.length === 0) {
      issues.push(issue(["cursor"], "invalid_cursor", "Cursor must not be empty."));
    } else if (!hasAtMostCodePoints(read.value, MAX_CURSOR_LENGTH)) {
      issues.push(
        issue(
          ["cursor"],
          "cursor_too_long",
          `Cursor must be at most ${MAX_CURSOR_LENGTH} Unicode code points.`,
        ),
      );
    } else {
      cursor = read.value;
    }
  }

  if (inspection.keys.includes("limit")) {
    const read = readProperty(inspection.record, "limit");
    if (!read.ok) {
      issues.push(issue(["limit"], "invalid_value", "Property could not be read safely."));
    } else {
      const parsed = parseLimit(read.value);
      if (!parsed.ok) {
        for (const parseIssue of parsed.issues) {
          issues.push({
            path: ["limit", ...parseIssue.path],
            code: parseIssue.code,
            message: parseIssue.message,
          });
        }
      } else {
        limit = parsed.value;
      }
    }
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  const value: PostListQuery = {};
  if (cursor !== undefined) {
    value.cursor = cursor;
  }
  if (limit !== undefined) {
    value.limit = limit;
  }
  return { ok: true, value };
}

function parseLimit(input: unknown): ContractParseResult<number> {
  if (typeof input === "number") {
    if (!Number.isFinite(input) || !Number.isInteger(input)) {
      return {
        ok: false,
        issues: [issue([], "invalid_limit", "Limit must be an integer.")],
      };
    }
    if (input < 1 || input > MAX_LIST_LIMIT) {
      return {
        ok: false,
        issues: [issue([], "limit_out_of_range", `Limit must be between 1 and ${MAX_LIST_LIMIT}.`)],
      };
    }
    return { ok: true, value: input };
  }

  if (typeof input !== "string" || input.length === 0 || input.length > 3) {
    return {
      ok: false,
      issues: [issue([], "invalid_limit", "Limit must be a decimal integer string.")],
    };
  }

  if (!/^\d+$/.test(input)) {
    return {
      ok: false,
      issues: [issue([], "invalid_limit", "Limit must be a decimal integer string.")],
    };
  }

  const value = Number(input);
  if (value < 1 || value > MAX_LIST_LIMIT) {
    return {
      ok: false,
      issues: [issue([], "limit_out_of_range", `Limit must be between 1 and ${MAX_LIST_LIMIT}.`)],
    };
  }
  return { ok: true, value };
}

function parseSlug(input: unknown): ContractParseResult<string> {
  if (typeof input !== "string") {
    return {
      ok: false,
      issues: [issue([], "invalid_slug", "Slug must be a lowercase ASCII slug.")],
    };
  }

  if (!hasAtMostCodePoints(input, MAX_SLUG_LENGTH)) {
    return {
      ok: false,
      issues: [
        issue([], "slug_too_long", `Slug must be at most ${MAX_SLUG_LENGTH} Unicode code points.`),
      ],
    };
  }

  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(input)) {
    return {
      ok: false,
      issues: [issue([], "invalid_slug", "Slug must be a lowercase ASCII slug.")],
    };
  }

  return { ok: true, value: input };
}

function parseBoundedString(
  input: unknown,
  maximum: number,
  field: string,
): ContractParseResult<string> {
  if (typeof input !== "string") {
    return {
      ok: false,
      issues: [issue([], `invalid_${field}`, `${field} must be a string.`)],
    };
  }

  if (!hasAtMostCodePoints(input, maximum)) {
    return {
      ok: false,
      issues: [
        issue([], `${field}_too_long`, `${field} must be at most ${maximum} Unicode code points.`),
      ],
    };
  }

  return { ok: true, value: input };
}

function parseContentVersion(input: unknown): ContractParseResult<typeof EDITOR_CONTENT_VERSION> {
  if (typeof input === "number" && Number.isInteger(input) && input === EDITOR_CONTENT_VERSION) {
    return { ok: true, value: EDITOR_CONTENT_VERSION };
  }

  return {
    ok: false,
    issues: [
      issue(
        [],
        "invalid_content_version",
        `Content version must be the numeric literal ${EDITOR_CONTENT_VERSION}.`,
      ),
    ],
  };
}

function parseExpectedDraftVersionRequest<T extends { expectedDraftVersion: number }>(
  input: unknown,
): ContractParseResult<T> {
  const inspection = inspectObject(input, EXPECTED_DRAFT_VERSION_KEYS);
  if (!isObjectInspection(inspection)) {
    return { ok: false, issues: inspection };
  }

  const issues = [...inspection.issues];
  if (!inspection.keys.includes("expectedDraftVersion")) {
    issues.push(issue(["expectedDraftVersion"], "missing_key", "Required property is missing."));
  } else {
    const read = readProperty(inspection.record, "expectedDraftVersion");
    if (!read.ok) {
      issues.push(
        issue(["expectedDraftVersion"], "invalid_value", "Property could not be read safely."),
      );
    } else if (
      typeof read.value !== "number" ||
      !Number.isSafeInteger(read.value) ||
      read.value < 1
    ) {
      issues.push(
        issue(
          ["expectedDraftVersion"],
          "invalid_expected_draft_version",
          "Expected draft version must be a positive safe integer.",
        ),
      );
    } else if (issues.length === 0) {
      return {
        ok: true,
        value: { expectedDraftVersion: read.value } as T,
      };
    }
  }

  return { ok: false, issues };
}

function parseExpectedDraftVersion(input: unknown): ContractParseResult<number> {
  if (typeof input === "number" && Number.isSafeInteger(input) && input >= 1) {
    return { ok: true, value: input };
  }

  return {
    ok: false,
    issues: [
      issue(
        [],
        "invalid_expected_draft_version",
        "Expected draft version must be a positive safe integer.",
      ),
    ],
  };
}

type MetadataBudget = {
  entries: number;
};

type MetadataCloneResult =
  | { readonly ok: true; readonly value: JsonValue }
  | { readonly ok: false; readonly issues: readonly ContractParseIssue[] };

function parseMetadata(input: unknown): ContractParseResult<JsonObject> {
  if (typeof input !== "object" || input === null) {
    return {
      ok: false,
      issues: [metadataIssue([], "invalid_metadata", "Metadata must be a plain JSON object.")],
    };
  }

  let isArray: boolean;
  try {
    isArray = Array.isArray(input);
  } catch {
    return {
      ok: false,
      issues: [metadataIssue([], "invalid_metadata", "Metadata could not be read safely.")],
    };
  }
  if (isArray) {
    return {
      ok: false,
      issues: [metadataIssue([], "invalid_metadata", "Metadata must be a plain JSON object.")],
    };
  }

  const result = cloneMetadataValue(input, [], 0, { entries: 0 }, new WeakSet<object>());
  if (!result.ok) {
    return result;
  }
  if (typeof result.value !== "object" || result.value === null || Array.isArray(result.value)) {
    return {
      ok: false,
      issues: [metadataIssue([], "invalid_metadata", "Metadata must be a plain JSON object.")],
    };
  }
  return { ok: true, value: result.value as JsonObject };
}

function cloneMetadataValue(
  input: unknown,
  path: readonly (string | number)[],
  depth: number,
  budget: MetadataBudget,
  ancestors: WeakSet<object>,
): MetadataCloneResult {
  if (input === null) {
    return { ok: true, value: null };
  }
  if (typeof input === "string") {
    if (!hasAtMostCodePoints(input, MAX_METADATA_STRING_LENGTH)) {
      return {
        ok: false,
        issues: [
          metadataIssue(
            path,
            "metadata_string_too_long",
            `Metadata strings must be at most ${MAX_METADATA_STRING_LENGTH} Unicode code points.`,
          ),
        ],
      };
    }
    return { ok: true, value: input };
  }
  if (typeof input === "number") {
    if (!Number.isFinite(input)) {
      return {
        ok: false,
        issues: [
          metadataIssue(path, "invalid_metadata_number", "Metadata numbers must be finite."),
        ],
      };
    }
    return { ok: true, value: input };
  }
  if (typeof input === "boolean") {
    return { ok: true, value: input };
  }
  if (typeof input !== "object") {
    return {
      ok: false,
      issues: [
        metadataIssue(
          path,
          "invalid_metadata_value",
          "Metadata values must be JSON-compatible primitives, arrays, or objects.",
        ),
      ],
    };
  }
  if (depth > MAX_METADATA_DEPTH) {
    return {
      ok: false,
      issues: [
        metadataIssue(
          path,
          "metadata_too_deep",
          `Metadata nesting must be at most ${MAX_METADATA_DEPTH} levels.`,
        ),
      ],
    };
  }

  let isArray: boolean;
  try {
    isArray = Array.isArray(input);
  } catch {
    return {
      ok: false,
      issues: [metadataIssue(path, "invalid_metadata", "Metadata could not be read safely.")],
    };
  }
  if (ancestors.has(input)) {
    return {
      ok: false,
      issues: [metadataIssue(path, "metadata_cycle", "Metadata must not contain cycles.")],
    };
  }

  ancestors.add(input);
  try {
    return isArray
      ? cloneMetadataArray(input, path, depth, budget, ancestors)
      : cloneMetadataObject(input, path, depth, budget, ancestors);
  } finally {
    ancestors.delete(input);
  }
}

function cloneMetadataObject(
  input: object,
  path: readonly (string | number)[],
  depth: number,
  budget: MetadataBudget,
  ancestors: WeakSet<object>,
): MetadataCloneResult {
  try {
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) {
      return {
        ok: false,
        issues: [
          metadataIssue(path, "invalid_metadata_object", "Metadata objects must be plain objects."),
        ],
      };
    }

    const keys = Reflect.ownKeys(input);
    if (keys.length > MAX_METADATA_PROPERTIES - budget.entries) {
      return {
        ok: false,
        issues: [metadataIssue(path, "metadata_too_large", "Metadata contains too many values.")],
      };
    }

    const output: Record<string, unknown> = {};
    for (const key of keys) {
      if (typeof key !== "string") {
        return {
          ok: false,
          issues: [metadataIssue(path, "invalid_metadata_key", "Metadata keys must be strings.")],
        };
      }
      if (!hasAtMostCodePoints(key, MAX_METADATA_KEY_LENGTH)) {
        return {
          ok: false,
          issues: [
            metadataIssue(
              [...path, key],
              "metadata_key_too_long",
              `Metadata keys must be at most ${MAX_METADATA_KEY_LENGTH} Unicode code points.`,
            ),
          ],
        };
      }

      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (descriptor === undefined || descriptor.enumerable !== true) {
        return {
          ok: false,
          issues: [
            metadataIssue(
              [...path, key],
              "invalid_metadata_property",
              "Metadata properties must be enumerable and readable.",
            ),
          ],
        };
      }

      budget.entries += 1;
      if (budget.entries > MAX_METADATA_PROPERTIES) {
        return {
          ok: false,
          issues: [metadataIssue(path, "metadata_too_large", "Metadata contains too many values.")],
        };
      }

      const read = readProperty(input as RecordInput, key);
      if (!read.ok) {
        return {
          ok: false,
          issues: [
            metadataIssue(
              [...path, key],
              "invalid_metadata_property",
              "Metadata property could not be read safely.",
            ),
          ],
        };
      }
      const child = cloneMetadataValue(read.value, [...path, key], depth + 1, budget, ancestors);
      if (!child.ok) {
        return child;
      }
      Object.defineProperty(output, key, {
        configurable: true,
        enumerable: true,
        value: child.value,
        writable: true,
      });
    }
    return { ok: true, value: output as JsonObject };
  } catch {
    return {
      ok: false,
      issues: [metadataIssue(path, "invalid_metadata", "Metadata could not be read safely.")],
    };
  }
}

function cloneMetadataArray(
  input: object,
  path: readonly (string | number)[],
  depth: number,
  budget: MetadataBudget,
  ancestors: WeakSet<object>,
): MetadataCloneResult {
  try {
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Array.prototype && prototype !== null) {
      return {
        ok: false,
        issues: [
          metadataIssue(
            path,
            "invalid_metadata_object",
            "Metadata arrays must have a plain prototype.",
          ),
        ],
      };
    }

    const keys = Reflect.ownKeys(input);
    const length = Reflect.get(input, "length");
    if (
      typeof length !== "number" ||
      !Number.isSafeInteger(length) ||
      length < 0 ||
      length > MAX_METADATA_PROPERTIES - budget.entries
    ) {
      return {
        ok: false,
        issues: [metadataIssue(path, "metadata_too_large", "Metadata contains too many values.")],
      };
    }

    const indices = new Set<string>();
    for (const key of keys) {
      if (key === "length") {
        continue;
      }
      if (typeof key !== "string") {
        return {
          ok: false,
          issues: [metadataIssue(path, "invalid_metadata_key", "Metadata keys must be strings.")],
        };
      }
      if (!hasAtMostCodePoints(key, MAX_METADATA_KEY_LENGTH) || !isArrayIndexKey(key)) {
        return {
          ok: false,
          issues: [
            metadataIssue(
              [...path, key],
              "invalid_metadata_key",
              "Metadata arrays may only contain indexed values.",
            ),
          ],
        };
      }
      if (Number(key) >= length) {
        return {
          ok: false,
          issues: [
            metadataIssue(
              [...path, key],
              "invalid_metadata_key",
              "Metadata arrays may not contain out-of-range values.",
            ),
          ],
        };
      }
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (descriptor === undefined || descriptor.enumerable !== true) {
        return {
          ok: false,
          issues: [
            metadataIssue(
              [...path, key],
              "invalid_metadata_property",
              "Metadata values must be readable.",
            ),
          ],
        };
      }
      indices.add(key);
    }
    if (indices.size !== length) {
      return {
        ok: false,
        issues: [
          metadataIssue(path, "invalid_metadata_array", "Metadata arrays must not contain holes."),
        ],
      };
    }

    const output: JsonValue[] = [];
    for (let index = 0; index < length; index += 1) {
      const key = String(index);
      budget.entries += 1;
      if (budget.entries > MAX_METADATA_PROPERTIES) {
        return {
          ok: false,
          issues: [metadataIssue(path, "metadata_too_large", "Metadata contains too many values.")],
        };
      }
      const read = readProperty(input as RecordInput, key);
      if (!read.ok) {
        return {
          ok: false,
          issues: [
            metadataIssue(
              [...path, index],
              "invalid_metadata_property",
              "Metadata value could not be read safely.",
            ),
          ],
        };
      }
      const child = cloneMetadataValue(read.value, [...path, index], depth + 1, budget, ancestors);
      if (!child.ok) {
        return child;
      }
      output.push(child.value);
    }
    return { ok: true, value: output };
  } catch {
    return {
      ok: false,
      issues: [metadataIssue(path, "invalid_metadata", "Metadata could not be read safely.")],
    };
  }
}

function isArrayIndexKey(key: string): boolean {
  if (!/^(?:0|[1-9]\d*)$/.test(key)) {
    return false;
  }
  const value = Number(key);
  return Number.isSafeInteger(value) && value >= 0 && value < 2 ** 32 - 1;
}

function metadataIssue(
  path: readonly (string | number)[],
  code: string,
  message: string,
): ContractParseIssue {
  return issue(path, code, message);
}

function appendIssues(
  target: ContractParseIssue[],
  key: string,
  source: readonly ContractParseIssue[],
): void {
  for (const parseIssue of source) {
    target.push({
      path: [key, ...parseIssue.path],
      code: parseIssue.code,
      message: parseIssue.message,
    });
  }
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28;
  }

  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

type RecordInput = Record<string, unknown>;

type ObjectInspection = {
  readonly record: RecordInput;
  readonly keys: readonly PropertyKey[];
  readonly issues: readonly ContractParseIssue[];
};

function isObjectInspection(
  inspection: ObjectInspection | ContractParseIssue[],
): inspection is ObjectInspection {
  return !Array.isArray(inspection);
}

function inspectObject(
  input: unknown,
  allowedKeys: readonly string[],
): ObjectInspection | ContractParseIssue[] {
  if (typeof input !== "object" || input === null) {
    return [issue([], "invalid_object", "Expected a non-null object.")];
  }

  try {
    if (Array.isArray(input)) {
      return [issue([], "invalid_object", "Expected a non-null object.")];
    }

    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) {
      return [issue([], "invalid_object", "Expected a plain object.")];
    }

    const keys = Reflect.ownKeys(input);
    if (keys.length > MAX_OBJECT_KEYS) {
      return [issue([], "too_many_keys", "Object contains too many properties.")];
    }

    const issues: ContractParseIssue[] = [];
    for (const key of keys) {
      if (typeof key !== "string" || !allowedKeys.includes(key)) {
        issues.push(issue([String(key)], "unknown_key", "Unknown property is not allowed."));
      }
    }

    return { record: input as RecordInput, keys, issues };
  } catch {
    return [issue([], "invalid_object", "Object could not be read safely.")];
  }
}

function parseRequiredUuid(
  inspection: ObjectInspection,
  key: string,
  issues: ContractParseIssue[],
): UuidV7 | undefined {
  if (!inspection.keys.includes(key)) {
    issues.push(issue([key], "missing_key", "Required property is missing."));
    return undefined;
  }

  let value: unknown;
  try {
    value = Reflect.get(inspection.record, key);
  } catch {
    issues.push(issue([key], "invalid_value", "Property could not be read safely."));
    return undefined;
  }

  const parsed = parseUuidV7(value);
  if (!parsed.ok) {
    for (const parseIssue of parsed.issues) {
      issues.push({
        path: [key, ...parseIssue.path],
        code: parseIssue.code,
        message: parseIssue.message,
      });
    }
    return undefined;
  }

  return parsed.value;
}

type PropertyReadResult = { readonly ok: true; readonly value: unknown } | { readonly ok: false };

function readProperty(record: RecordInput, key: string): PropertyReadResult {
  try {
    return { ok: true, value: Reflect.get(record, key) };
  } catch {
    return { ok: false };
  }
}

function hasAtMostCodePoints(value: string, maximum: number): boolean {
  let count = 0;
  for (const _ of value) {
    count += 1;
    if (count > maximum) {
      return false;
    }
  }
  return true;
}

function issue(
  path: readonly (string | number)[],
  code: string,
  message: string,
): ContractParseIssue {
  return { path: [...path], code, message };
}
