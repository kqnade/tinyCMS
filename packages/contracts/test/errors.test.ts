import { describe, expect, it } from "vitest";
import { ErrorCode, HTTP_STATUS_BY_ERROR_CODE } from "../src/index";

describe("HTTP error contracts", () => {
  it("exports the stable error codes and HTTP statuses", () => {
    expect(ErrorCode).toEqual({
      INVALID_REQUEST: "INVALID_REQUEST",
      AUTH_REQUIRED: "AUTH_REQUIRED",
      AUTH_INVALID: "AUTH_INVALID",
      NOT_FOUND: "NOT_FOUND",
      CONFLICT: "CONFLICT",
      INTERNAL_ERROR: "INTERNAL_ERROR",
    });

    expect(HTTP_STATUS_BY_ERROR_CODE).toEqual({
      INVALID_REQUEST: 400,
      AUTH_REQUIRED: 401,
      AUTH_INVALID: 401,
      NOT_FOUND: 404,
      CONFLICT: 409,
      INTERNAL_ERROR: 500,
    });
  });
});
