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
  };
};

export function successResponse<T>(data: T, requestId: string): SuccessResponse<T> {
  return {
    data,
    meta: { requestId },
  };
}

export function errorResponse(code: string, message: string, requestId: string): ErrorResponse {
  return {
    error: { code, message, requestId },
  };
}
