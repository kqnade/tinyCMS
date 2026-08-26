import { describe, expect, it } from "vitest";
import { errorResponse, successResponse } from "../src/index";

describe("HTTP response contracts", () => {
  it("includes the request ID in a successful response", () => {
    expect(successResponse({ status: "ok" }, "request-123")).toEqual({
      data: { status: "ok" },
      meta: { requestId: "request-123" },
    });
  });

  it("includes the request ID in an error response", () => {
    expect(errorResponse("NOT_FOUND", "Not found", "request-456")).toEqual({
      error: {
        code: "NOT_FOUND",
        message: "Not found",
        requestId: "request-456",
      },
    });
  });

  it("includes optional error details when provided", () => {
    expect(
      errorResponse("INVALID_REQUEST", "Invalid request", "request-789", {
        field: "title",
      }),
    ).toEqual({
      error: {
        code: "INVALID_REQUEST",
        message: "Invalid request",
        requestId: "request-789",
        details: { field: "title" },
      },
    });
  });
});
