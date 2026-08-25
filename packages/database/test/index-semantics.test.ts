import { getTableConfig } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import { auditEvents, media, postRevisions, posts } from "../src/schema";

const sqlText = (value: unknown): string => {
  if (typeof value !== "object" || value === null) {
    return "";
  }
  if ("queryChunks" in value && Array.isArray(value.queryChunks)) {
    return value.queryChunks.map(sqlText).join("");
  }
  if ("value" in value && Array.isArray(value.value)) {
    return value.value.filter((part): part is string => typeof part === "string").join("");
  }
  return "";
};

describe("Drizzle index semantics", () => {
  it("matches the partial and descending SQL index definitions", () => {
    const scheduledAtIndex = getTableConfig(posts).indexes.find(
      ({ config }) => config.name === "posts_scheduled_at_idx",
    );
    expect(scheduledAtIndex).toBeDefined();
    if (!scheduledAtIndex) throw new Error("posts_scheduled_at_idx is not defined");
    expect(sqlText(scheduledAtIndex.config.where)).toContain("IS NOT NULL");

    const revisionIndex = getTableConfig(postRevisions).indexes.find(
      ({ config }) => config.name === "post_revisions_post_created_at_idx",
    );
    expect(revisionIndex).toBeDefined();
    if (!revisionIndex) throw new Error("post_revisions_post_created_at_idx is not defined");
    expect(sqlText(revisionIndex.config.columns[1])).toContain("desc");

    const mediaIndex = getTableConfig(media).indexes.find(
      ({ config }) => config.name === "media_state_idx",
    );
    expect(mediaIndex).toBeDefined();
    if (!mediaIndex) throw new Error("media_state_idx is not defined");
    expect(sqlText(mediaIndex.config.columns[1])).toContain("desc");

    const auditIndex = getTableConfig(auditEvents).indexes.find(
      ({ config }) => config.name === "audit_events_entity_idx",
    );
    expect(auditIndex).toBeDefined();
    if (!auditIndex) throw new Error("audit_events_entity_idx is not defined");
    expect(sqlText(auditIndex.config.columns[2])).toContain("desc");
  });
});
