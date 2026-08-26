import { describe, expect, it } from "vitest";
import { WRITE_BOUNDARY_HEADER, WRITE_BOUNDARY_VALUE } from "../src/index";

describe("write-boundary header contract", () => {
  it("exports the required header name and value", () => {
    expect(WRITE_BOUNDARY_HEADER).toBe("X-TinyCMS-Request");
    expect(WRITE_BOUNDARY_VALUE).toBe("1");
  });
});
