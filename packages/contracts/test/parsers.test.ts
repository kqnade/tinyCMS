import { describe, expect, it } from "vitest";
import {
  MAX_CURSOR_LENGTH,
  MAX_LIST_LIMIT,
  parsePostListQuery,
  parsePostRevisionListQuery,
  parsePostRevisionRouteParams,
  parsePostRouteParams,
  parseUtcTimestamp,
  parseUuidV7,
} from "../src/index";

describe("contract boundary parsers", () => {
  it("accepts only a canonical lowercase UUIDv7", () => {
    expect(parseUuidV7("0192f5a4-7b3c-7d1e-8f20-123456789abc")).toEqual({
      ok: true,
      value: "0192f5a4-7b3c-7d1e-8f20-123456789abc",
    });
  });

  it("accepts a UTC RFC3339 timestamp with bounded fractional precision", () => {
    expect(parseUtcTimestamp("2026-08-26T01:02:03.123456789Z")).toEqual({
      ok: true,
      value: "2026-08-26T01:02:03.123456789Z",
    });
  });

  it("parses post route parameters into a plain DTO", () => {
    expect(parsePostRouteParams({ postId: "0192f5a4-7b3c-7d1e-8f20-123456789abc" })).toEqual({
      ok: true,
      value: { postId: "0192f5a4-7b3c-7d1e-8f20-123456789abc" },
    });
  });

  it("parses post revision route parameters in contract order", () => {
    expect(
      parsePostRevisionRouteParams({
        revisionId: "0192f5a4-7b3c-7d1e-8f20-123456789abd",
        postId: "0192f5a4-7b3c-7d1e-8f20-123456789abc",
      }),
    ).toEqual({
      ok: true,
      value: {
        postId: "0192f5a4-7b3c-7d1e-8f20-123456789abc",
        revisionId: "0192f5a4-7b3c-7d1e-8f20-123456789abd",
      },
    });
  });

  it("normalizes a post list query while preserving its field order", () => {
    expect(parsePostListQuery({ cursor: "次へ", limit: "25" })).toEqual({
      ok: true,
      value: { cursor: "次へ", limit: 25 },
    });
  });

  it("rejects malformed route objects, unknown keys, and non-v7 UUIDs", () => {
    expect(parseUuidV7("0192f5a4-7b3c-7d1e-8f20-123456789ABC")).toMatchObject({ ok: false });
    expect(parseUuidV7("0192f5a4-7b3c-4d1e-8f20-123456789abc")).toMatchObject({ ok: false });
    expect(parsePostRouteParams(null)).toMatchObject({ ok: false });
    expect(parsePostRouteParams([])).toMatchObject({ ok: false });
    expect(parsePostRouteParams({})).toEqual({
      ok: false,
      issues: [
        {
          path: ["postId"],
          code: "missing_key",
          message: "Required property is missing.",
        },
      ],
    });
    expect(
      parsePostRouteParams({
        postId: "0192f5a4-7b3c-4d1e-8f20-123456789abc",
        extra: true,
      }),
    ).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ path: ["extra"], code: "unknown_key" }),
        expect.objectContaining({ path: ["postId"], code: "invalid_uuid_v7" }),
      ]),
    });
  });

  it("rejects non-UTC, impossible, and over-precise timestamps", () => {
    for (const value of [
      "2026-08-26T01:02:03+00:00",
      "2026-08-26T01:02:03+00:00Z",
      "2026-02-29T01:02:03Z",
      "2026-08-26T24:02:03Z",
      "2026-08-26T01:02:03.1234567890Z",
    ]) {
      expect(parseUtcTimestamp(value)).toMatchObject({ ok: false });
    }
  });

  it("bounds opaque cursors by Unicode code points and omits absent fields", () => {
    const atLimit = "🙂".repeat(MAX_CURSOR_LENGTH);
    expect(parsePostListQuery({ cursor: atLimit })).toEqual({
      ok: true,
      value: { cursor: atLimit },
    });
    expect(parsePostListQuery({ cursor: `${atLimit}🙂` })).toMatchObject({ ok: false });
    expect(parsePostListQuery({ cursor: "" })).toMatchObject({ ok: false });
    expect(parsePostListQuery({ cursor: 1 })).toMatchObject({ ok: false });
    expect(parsePostListQuery({})).toEqual({ ok: true, value: {} });
    expect(MAX_LIST_LIMIT).toBe(100);
  });

  it("accepts only integer limits from 1 through 100", () => {
    for (const input of [1, 100, "1", "100"]) {
      expect(parsePostListQuery({ limit: input })).toEqual({
        ok: true,
        value: { limit: Number(input) },
      });
    }

    for (const input of [
      0,
      101,
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      "0",
      "101",
      "+1",
      "-1",
      "1.5",
      "1e1",
      "Infinity",
      "9999",
      "",
    ] as unknown[]) {
      expect(parsePostListQuery({ limit: input })).toMatchObject({ ok: false });
    }
  });

  it("uses the same normalized query contract for post revisions", () => {
    expect(parsePostRevisionListQuery({ limit: 100, cursor: "revision-next" })).toEqual({
      ok: true,
      value: { cursor: "revision-next", limit: 100 },
    });
  });

  it("does not throw for arbitrary unknown values or hostile property access", () => {
    const throwingGetter = Object.defineProperty({}, "postId", {
      enumerable: true,
      get() {
        throw new Error("blocked");
      },
    });
    const throwingProxy = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error("blocked");
        },
      },
    );

    for (const input of [undefined, null, true, 1, Symbol("id"), throwingGetter, throwingProxy]) {
      expect(() => parsePostRouteParams(input)).not.toThrow();
      expect(() => parsePostListQuery(input)).not.toThrow();
    }
    expect(parsePostRouteParams(throwingGetter)).toMatchObject({ ok: false });
    expect(parsePostListQuery(throwingProxy)).toMatchObject({ ok: false });
  });

  it("rejects unknown query fields and missing revision route IDs", () => {
    expect(parsePostListQuery({ cursor: "next", extra: true })).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ path: ["extra"], code: "unknown_key" }),
      ]),
    });
    expect(parsePostRevisionListQuery(null)).toMatchObject({ ok: false });
    expect(
      parsePostRevisionRouteParams({
        postId: "0192f5a4-7b3c-7d1e-8f20-123456789abc",
      }),
    ).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ path: ["revisionId"], code: "missing_key" }),
      ]),
    });
  });
});
