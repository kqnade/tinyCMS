export type SuccessResponse<T> = {
  data: T;
  meta: {
    requestId: string;
  };
};

export type ErrorResponse = {
  error: {
    code: string;
    message: string;
    requestId: string;
    details?: unknown;
  };
};

export function successResponse<T>(data: T, requestId: string): SuccessResponse<T> {
  return {
    data,
    meta: { requestId },
  };
}

export function errorResponse(
  code: string,
  message: string,
  requestId: string,
  details?: unknown,
): ErrorResponse {
  if (details !== undefined) {
    return {
      error: { code, message, requestId, details },
    };
  }

  return {
    error: { code, message, requestId },
  };
}
