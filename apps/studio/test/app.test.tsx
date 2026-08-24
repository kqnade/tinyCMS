import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { App } from "../src/App";

describe("Studio shell", () => {
  it("renders identifiable navigation and main content landmarks", () => {
    const markup = renderToStaticMarkup(<App />);

    expect(markup).toContain("<nav");
    expect(markup).toContain('aria-label="Studio"');
    expect(markup).toContain("<main");
    expect(markup).toContain("tinyCMS Studio");
  });
});
