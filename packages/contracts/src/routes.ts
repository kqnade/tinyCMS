export const ADMIN_POSTS_ROUTE = "/api/v1/admin/posts" as const;
export const ADMIN_POST_ROUTE = `${ADMIN_POSTS_ROUTE}/:postId` as const;
export const ADMIN_POST_DRAFT_ROUTE = `${ADMIN_POST_ROUTE}/draft` as const;
export const ADMIN_POST_REVISIONS_ROUTE = `${ADMIN_POST_ROUTE}/revisions` as const;
export const ADMIN_POST_REVISION_RESTORE_ROUTE =
  `${ADMIN_POST_REVISIONS_ROUTE}/:revisionId/restore` as const;

export const ADMIN_MEDIA_ROUTE = "/api/v1/admin/media" as const;
export const ADMIN_MEDIA_ITEM_ROUTE = `${ADMIN_MEDIA_ROUTE}/:mediaId` as const;
export const ADMIN_MEDIA_ORIGINAL_ROUTE = `${ADMIN_MEDIA_ITEM_ROUTE}/original` as const;
