import { ApplicationError, ApplicationErrorCode } from "./errors";

export const MAX_MEDIA_BYTES = 20 * 1024 * 1024;
export const MAX_MEDIA_FILENAME_LENGTH = 255;
export const MAX_MEDIA_ALT_TEXT_LENGTH = 1000;
export const MAX_MEDIA_DIMENSION = 12_000;

export type MediaMimeType = "image/jpeg" | "image/png" | "image/webp";

export type MediaStructuralInspection = {
  format: string;
  fileSize: number;
  width: number;
  height: number;
};

export type MediaStructuralInspector = (bytes: Uint8Array) => Promise<MediaStructuralInspection>;

export type MediaUploadInput = {
  filename: string;
  mediaType: string;
  bytes: Uint8Array;
  altText?: string;
};

export type MediaDerivativeSize = { width: number; height: number };

export type VerifiedMediaUpload = {
  filename: string;
  mediaType: MediaMimeType;
  bytes: Uint8Array;
  byteSize: number;
  width: number;
  height: number;
  altText: string;
  contentHash: string;
  derivativeSizes: MediaDerivativeSize[];
};

const allowedMediaTypes = new Set<MediaMimeType>(["image/jpeg", "image/png", "image/webp"]);

function invalidMedia(): ApplicationError {
  return new ApplicationError(ApplicationErrorCode.INVALID_REQUEST, "Invalid media upload");
}

function codePointLength(value: string): number {
  return [...value].length;
}

function matchesContainer(mediaType: MediaMimeType, bytes: Uint8Array): boolean {
  if (mediaType === "image/jpeg") {
    return (
      bytes.length >= 4 &&
      bytes[0] === 0xff &&
      bytes[1] === 0xd8 &&
      bytes.at(-2) === 0xff &&
      bytes.at(-1) === 0xd9
    );
  }
  if (mediaType === "image/png") {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    if (bytes.length < 20 || !signature.every((value, index) => bytes[index] === value))
      return false;
    let offset = 8;
    let sawHeader = false;
    while (offset + 12 <= bytes.length) {
      const length = new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0);
      const end = offset + 12 + length;
      if (end > bytes.length) return false;
      const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
      if (!sawHeader) {
        if (type !== "IHDR" || length !== 13) return false;
        sawHeader = true;
      }
      if (type === "IEND") return length === 0 && end === bytes.length;
      offset = end;
    }
    return false;
  }
  if (bytes.length < 12) return false;
  const ascii = (start: number) => String.fromCharCode(...bytes.subarray(start, start + 4));
  const declaredSize = new DataView(bytes.buffer, bytes.byteOffset + 4, 4).getUint32(0, true) + 8;
  return ascii(0) === "RIFF" && ascii(8) === "WEBP" && declaredSize === bytes.length;
}

function derivativeSizes(width: number, height: number): MediaDerivativeSize[] {
  const widths = width < 480 ? [width] : [480, 960, 1440].filter((target) => target <= width);
  return widths.map((target) => ({
    width: target,
    height: Math.max(1, Math.round((height * target) / width)),
  }));
}

export async function verifyMediaUpload(
  input: MediaUploadInput,
  inspect: MediaStructuralInspector,
): Promise<VerifiedMediaUpload> {
  const { bytes } = input;
  const altText = input.altText ?? "";
  if (
    codePointLength(input.filename) > MAX_MEDIA_FILENAME_LENGTH ||
    codePointLength(altText) > MAX_MEDIA_ALT_TEXT_LENGTH ||
    bytes.byteLength === 0 ||
    bytes.byteLength > MAX_MEDIA_BYTES ||
    !allowedMediaTypes.has(input.mediaType as MediaMimeType)
  ) {
    throw invalidMedia();
  }
  const mediaType = input.mediaType as MediaMimeType;
  if (!matchesContainer(mediaType, bytes)) throw invalidMedia();

  let inspection: MediaStructuralInspection;
  try {
    inspection = await inspect(bytes);
  } catch {
    throw invalidMedia();
  }
  if (
    inspection.format !== mediaType ||
    inspection.fileSize !== bytes.byteLength ||
    !Number.isSafeInteger(inspection.width) ||
    !Number.isSafeInteger(inspection.height) ||
    inspection.width < 1 ||
    inspection.height < 1 ||
    inspection.width > MAX_MEDIA_DIMENSION ||
    inspection.height > MAX_MEDIA_DIMENSION
  ) {
    throw invalidMedia();
  }

  const digest = await crypto.subtle.digest("SHA-256", bytes.slice().buffer as ArrayBuffer);
  const contentHash = [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  return {
    filename: input.filename,
    mediaType,
    bytes,
    byteSize: bytes.byteLength,
    width: inspection.width,
    height: inspection.height,
    altText,
    contentHash,
    derivativeSizes: derivativeSizes(inspection.width, inspection.height),
  };
}
