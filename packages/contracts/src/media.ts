import type { CursorPage, UtcTimestamp, UuidV7 } from "./editorial";
import type { SuccessResponse } from "./http";

export type MediaAssetState = "pending" | "ready" | "failed" | "trash";

export type MediaVariantFormat = "avif" | "webp";

export type MediaVariant = {
  name: string;
  width: number;
  height: number;
  format: MediaVariantFormat;
  byteSize: number;
  url: string;
};

export type MediaAsset = {
  id: UuidV7;
  filename: string;
  mediaType: string;
  byteSize: number;
  width: number;
  height: number;
  altText: string;
  contentHash: string;
  state: MediaAssetState;
  version: number;
  variants: MediaVariant[];
  createdBy: UuidV7;
  createdAt: UtcTimestamp;
  updatedAt: UtcTimestamp;
};

export type MediaListQuery = {
  cursor?: string;
  limit?: number;
};

export type MediaRouteParams = {
  mediaId: UuidV7;
};

export type UpdateMediaRequest = {
  expectedVersion: number;
  altText: string;
};

export type DeleteMediaRequest = {
  expectedVersion: number;
};

export type MediaResponse = SuccessResponse<MediaAsset>;

export type MediaListResponse = SuccessResponse<CursorPage<MediaAsset>>;
