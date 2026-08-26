import { describe, expect, it } from "vitest";
import {
  ADMIN_POST_DRAFT_ROUTE,
  ADMIN_POST_REVISION_RESTORE_ROUTE,
  ADMIN_POST_REVISIONS_ROUTE,
  ADMIN_POST_ROUTE,
  ADMIN_POSTS_ROUTE,
} from "../src/index";

describe("admin route contracts", () => {
  it("exports the exact admin post route templates", () => {
    expect({
      posts: ADMIN_POSTS_ROUTE,
      post: ADMIN_POST_ROUTE,
      draft: ADMIN_POST_DRAFT_ROUTE,
      revisions: ADMIN_POST_REVISIONS_ROUTE,
      restore: ADMIN_POST_REVISION_RESTORE_ROUTE,
    }).toEqual({
      posts: "/api/v1/admin/posts",
      post: "/api/v1/admin/posts/:postId",
      draft: "/api/v1/admin/posts/:postId/draft",
      revisions: "/api/v1/admin/posts/:postId/revisions",
      restore: "/api/v1/admin/posts/:postId/revisions/:revisionId/restore",
    });
  });
});
