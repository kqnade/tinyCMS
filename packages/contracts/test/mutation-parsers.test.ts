import { describe, expect, it } from "vitest";
import {
  MAX_EXCERPT_LENGTH,
  MAX_METADATA_DEPTH,
  MAX_METADATA_KEY_LENGTH,
  MAX_METADATA_PROPERTIES,
  MAX_METADATA_STRING_LENGTH,
  MAX_SLUG_LENGTH,
  MAX_TITLE_LENGTH,
  parseCheckpointPostRevisionRequest,
  parseCreatePostRequest,
  parseRestorePostRevisionRequest,
  parseSavePostDraftRequest,
} from "../src/index";

describe("editor mutation body parsers", () => {
  it("accepts an empty create request", () => {
    expect(parseCreatePostRequest({})).toEqual({ ok: true, value: {} });
  });

  it("normalizes a complete create request in contract order", () => {
    const content = { arbitrary: ["content", { value: 1 }] };
    const input = {
      content,
      contentVersion: 1,
      title: "A title",
      slug: "hello-world",
    };

    const result = parseCreatePostRequest(input);

    expect(result).toEqual({
      ok: true,
      value: {
        slug: "hello-world",
        title: "A title",
        contentVersion: 1,
        content,
      },
    });
    expect(result.ok && result.value.content).toBe(content);
    expect(result.ok && JSON.stringify(result.value)).toBe(
      '{"slug":"hello-world","title":"A title","contentVersion":1,"content":{"arbitrary":["content",{"value":1}]}}',
    );
  });

  it("enforces create slug, title, version, and content rules", () => {
    expect(parseCreatePostRequest({ slug: "a-b9", title: "🙂".repeat(MAX_TITLE_LENGTH) })).toEqual({
      ok: true,
      value: { slug: "a-b9", title: "🙂".repeat(MAX_TITLE_LENGTH) },
    });
    expect(parseCreatePostRequest({ slug: "a".repeat(MAX_SLUG_LENGTH) })).toMatchObject({
      ok: true,
    });
    expect(parseCreatePostRequest({ slug: "a".repeat(MAX_SLUG_LENGTH + 1) })).toMatchObject({
      ok: false,
    });
    expect(parseCreatePostRequest({ slug: "-a" })).toMatchObject({ ok: false });
    expect(parseCreatePostRequest({ slug: "a-" })).toMatchObject({ ok: false });
    expect(parseCreatePostRequest({ slug: "a--b" })).toEqual({
      ok: true,
      value: { slug: "a--b" },
    });
    expect(parseCreatePostRequest({ slug: "A-b" })).toMatchObject({ ok: false });
    expect(parseCreatePostRequest({ slug: "日本語" })).toMatchObject({ ok: false });
    expect(parseCreatePostRequest({ title: "🙂".repeat(MAX_TITLE_LENGTH + 1) })).toMatchObject({
      ok: false,
    });
    expect(parseCreatePostRequest({ title: 1 })).toMatchObject({ ok: false });
    expect(parseCreatePostRequest({ contentVersion: 1 })).toEqual({
      ok: true,
      value: { contentVersion: 1 },
    });
    for (const contentVersion of ["1", 1.5, 0, Number.NaN, Number.POSITIVE_INFINITY, true]) {
      expect(parseCreatePostRequest({ contentVersion })).toMatchObject({ ok: false });
    }
    expect(parseCreatePostRequest({ content: null })).toEqual({
      ok: true,
      value: { content: null },
    });
    expect(parseCreatePostRequest({ content: undefined })).toMatchObject({ ok: false });
    expect(parseCreatePostRequest({ nope: true })).toMatchObject({ ok: false });
    expect(parseCreatePostRequest([])).toMatchObject({ ok: false });
    expect(parseCreatePostRequest(null)).toMatchObject({ ok: false });
  });

  it("does not throw for a revoked create-request proxy", () => {
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();

    expect(() => parseCreatePostRequest(proxy)).not.toThrow();
    expect(parseCreatePostRequest(proxy)).toMatchObject({ ok: false });
  });

  it("parses checkpoint and restore requests in their stable contract shape", () => {
    expect(parseCheckpointPostRevisionRequest({ expectedDraftVersion: 7 })).toEqual({
      ok: true,
      value: { expectedDraftVersion: 7 },
    });
    expect(parseRestorePostRevisionRequest({ expectedDraftVersion: 8 })).toEqual({
      ok: true,
      value: { expectedDraftVersion: 8 },
    });

    for (const expectedDraftVersion of [
      0,
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      2 ** 53,
    ]) {
      expect(parseCheckpointPostRevisionRequest({ expectedDraftVersion })).toMatchObject({
        ok: false,
      });
      expect(parseRestorePostRevisionRequest({ expectedDraftVersion })).toMatchObject({
        ok: false,
      });
    }
    expect(parseCheckpointPostRevisionRequest({})).toMatchObject({ ok: false });
    expect(parseRestorePostRevisionRequest({ expectedDraftVersion: 1, extra: true })).toMatchObject(
      {
        ok: false,
      },
    );
    expect(parseCheckpointPostRevisionRequest([])).toMatchObject({ ok: false });
  });

  it("parses a complete draft save without validating arbitrary content", () => {
    const content = new Proxy(
      { type: "future" },
      {
        get() {
          throw new Error("content must not be traversed");
        },
      },
    );
    const metadata = {
      seo: { description: "A description", tags: ["one", "two"] },
      flags: { featured: true },
    };

    const result = parseSavePostDraftRequest({
      metadata,
      content,
      contentVersion: 1,
      excerpt: null,
      title: "Draft title",
      expectedDraftVersion: 3,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.expectedDraftVersion).toBe(3);
      expect(result.value.title).toBe("Draft title");
      expect(result.value.excerpt).toBe(null);
      expect(result.value.contentVersion).toBe(1);
      expect(result.value.content).toBe(content);
      expect(result.value.metadata).toEqual(metadata);
    }

    const serializable = parseSavePostDraftRequest({
      expectedDraftVersion: 3,
      title: "Draft title",
      excerpt: null,
      contentVersion: 1,
      content: { arbitrary: true },
      metadata,
    });
    expect(serializable.ok && JSON.stringify(serializable.value)).toBe(
      '{"expectedDraftVersion":3,"title":"Draft title","excerpt":null,"contentVersion":1,"content":{"arbitrary":true},"metadata":{"seo":{"description":"A description","tags":["one","two"]},"flags":{"featured":true}}}',
    );
  });

  it("bounds draft excerpts and JSON metadata by code points and traversal", () => {
    const nestedAtLimit: Record<string, unknown> = {};
    let nestedCursor = nestedAtLimit;
    for (let depth = 0; depth < MAX_METADATA_DEPTH - 1; depth += 1) {
      const next: Record<string, unknown> = {};
      nestedCursor.value = next;
      nestedCursor = next;
    }
    nestedCursor.value = true;

    expect(
      parseSavePostDraftRequest({
        expectedDraftVersion: 1,
        title: "",
        excerpt: "🙂".repeat(MAX_EXCERPT_LENGTH),
        contentVersion: 1,
        content: false,
        metadata: {
          ["🙂".repeat(MAX_METADATA_KEY_LENGTH)]: "🙂".repeat(MAX_METADATA_STRING_LENGTH),
          nested: nestedAtLimit,
        },
      }),
    ).toMatchObject({ ok: true });

    const nestedBeyondLimit: Record<string, unknown> = {};
    let beyondCursor = nestedBeyondLimit;
    for (let depth = 0; depth < MAX_METADATA_DEPTH; depth += 1) {
      const next: Record<string, unknown> = {};
      beyondCursor.value = next;
      beyondCursor = next;
    }
    beyondCursor.value = true;
    expect(
      parseSavePostDraftRequest({
        expectedDraftVersion: 1,
        title: "",
        contentVersion: 1,
        content: false,
        metadata: { nested: nestedBeyondLimit },
      }),
    ).toMatchObject({ ok: false });

    expect(
      parseSavePostDraftRequest({
        expectedDraftVersion: 1,
        title: "",
        excerpt: "🙂".repeat(MAX_EXCERPT_LENGTH + 1),
        contentVersion: 1,
        content: false,
        metadata: {},
      }),
    ).toMatchObject({ ok: false });
    expect(
      parseSavePostDraftRequest({
        expectedDraftVersion: 1,
        title: "",
        contentVersion: 1,
        content: false,
        metadata: {
          ["🙂".repeat(MAX_METADATA_KEY_LENGTH + 1)]: true,
        },
      }),
    ).toMatchObject({ ok: false });
    expect(
      parseSavePostDraftRequest({
        expectedDraftVersion: 1,
        title: "",
        contentVersion: 1,
        content: false,
        metadata: { value: "🙂".repeat(MAX_METADATA_STRING_LENGTH + 1) },
      }),
    ).toMatchObject({ ok: false });

    const tooManyProperties = Object.fromEntries(
      Array.from({ length: MAX_METADATA_PROPERTIES + 1 }, (_, index) => [`key${index}`, index]),
    );
    expect(
      parseSavePostDraftRequest({
        expectedDraftVersion: 1,
        title: "",
        contentVersion: 1,
        content: false,
        metadata: tooManyProperties,
      }),
    ).toMatchObject({ ok: false });
  });

  it("rejects missing, malformed, and unknown draft save fields", () => {
    const complete = {
      expectedDraftVersion: 1,
      title: "",
      contentVersion: 1,
      content: null,
    };
    for (const key of ["expectedDraftVersion", "title", "contentVersion", "content"]) {
      const input = { ...complete } as Record<string, unknown>;
      delete input[key];
      expect(parseSavePostDraftRequest(input)).toMatchObject({ ok: false });
    }
    for (const input of [
      { ...complete, expectedDraftVersion: "1" },
      { ...complete, expectedDraftVersion: 1.1 },
      { ...complete, expectedDraftVersion: 0 },
      { ...complete, expectedDraftVersion: Number.MAX_SAFE_INTEGER + 1 },
      { ...complete, title: "🙂".repeat(MAX_TITLE_LENGTH + 1) },
      { ...complete, title: 1 },
      { ...complete, excerpt: undefined },
      { ...complete, excerpt: 1 },
      { ...complete, contentVersion: "1" },
      { ...complete, contentVersion: 2 },
      { ...complete, content: undefined },
      { ...complete, metadata: undefined },
      { ...complete, metadata: [] },
      { ...complete, unknown: true },
    ] as unknown[]) {
      expect(parseSavePostDraftRequest(input)).toMatchObject({ ok: false });
    }

    const symbolKey = Symbol("unknown");
    const withSymbol = { ...complete, [symbolKey]: true };
    expect(parseSavePostDraftRequest(withSymbol)).toMatchObject({ ok: false });
    expect(parseSavePostDraftRequest(null)).toMatchObject({ ok: false });
    expect(parseSavePostDraftRequest([])).toMatchObject({ ok: false });
    expect(parseSavePostDraftRequest(1)).toMatchObject({ ok: false });
  });

  it("accepts JSON metadata and rejects unsafe values, prototypes, cycles, and access", () => {
    const base = {
      expectedDraftVersion: 1,
      title: "",
      contentVersion: 1,
      content: null,
    };
    expect(
      parseSavePostDraftRequest({ ...base, metadata: { array: [null, true, 1, "text"] } }),
    ).toMatchObject({
      ok: true,
    });
    expect(parseSavePostDraftRequest({ ...base, metadata: Object.create(null) })).toMatchObject({
      ok: true,
    });

    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const symbolKey = Symbol("metadata");
    const throwingGetter = Object.defineProperty({}, "value", {
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
    const exotic = Object.create({ inherited: true });
    exotic.value = true;
    const sparse = [] as unknown[];
    sparse.length = 1;
    const customArray = [] as unknown[];
    customArray.push(true);
    Object.defineProperty(customArray, "extra", { enumerable: true, value: true });

    for (const metadata of [
      [],
      { value: undefined },
      { value: 1n },
      { value: () => true },
      { value: Symbol("value") },
      { value: Number.NaN },
      { value: Number.POSITIVE_INFINITY },
      { value: new Date() },
      cyclic,
      { [symbolKey]: true },
      throwingGetter,
      throwingProxy,
      exotic,
      sparse,
      customArray,
    ] as unknown[]) {
      expect(() => parseSavePostDraftRequest({ ...base, metadata })).not.toThrow();
      expect(parseSavePostDraftRequest({ ...base, metadata })).toMatchObject({ ok: false });
    }
  });

  it("does not throw when mutation fields or object traps cannot be read", () => {
    const throwingGetter = Object.defineProperty(
      {
        expectedDraftVersion: 1,
        title: "",
        contentVersion: 1,
        content: null,
      },
      "title",
      {
        enumerable: true,
        get() {
          throw new Error("blocked");
        },
      },
    );
    const { proxy: revoked, revoke } = Proxy.revocable({}, {});
    revoke();
    for (const parser of [
      parseCreatePostRequest,
      parseSavePostDraftRequest,
      parseCheckpointPostRevisionRequest,
      parseRestorePostRevisionRequest,
    ]) {
      for (const input of [throwingGetter, revoked]) {
        expect(() => parser(input)).not.toThrow();
        expect(parser(input)).toMatchObject({ ok: false });
      }
    }
  });
});
