import type {
  PostListQuery,
  PostRevisionListQuery,
  PostRevisionRouteParams,
  PostRouteParams,
  UtcTimestamp,
  UuidV7,
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

function inspectObject(
  input: unknown,
  allowedKeys: readonly string[],
): ObjectInspection | ContractParseIssue[] {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return [issue([], "invalid_object", "Expected a non-null object.")];
  }

  try {
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
