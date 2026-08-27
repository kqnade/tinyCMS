export const ApplicationErrorCode = {
  INVALID_REQUEST: "INVALID_REQUEST",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

export type ApplicationErrorCodeValue =
  (typeof ApplicationErrorCode)[keyof typeof ApplicationErrorCode];

export class ApplicationError extends Error {
  readonly code: ApplicationErrorCodeValue;
  readonly details?: unknown;

  constructor(code: ApplicationErrorCodeValue, message: string, details?: unknown) {
    super(message);
    this.name = "ApplicationError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}
