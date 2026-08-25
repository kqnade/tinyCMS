import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

describe("Studio styles", () => {
  it("defines calm themes with visible focus, reduced motion, and responsive rules", () => {
    expect(styles).toContain("--background");
    expect(styles).toContain("--foreground");
    expect(styles).toContain("--surface-muted");
    expect(styles).toContain("--border");
    expect(styles).toContain("--focus");
    expect(styles).toContain(":focus-visible");
    expect(styles).toContain("@media (prefers-color-scheme: dark)");
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
    expect(styles).toContain("@media (max-width: 48rem)");
    expect(styles).toContain("min-width: 320px");
  });

  it("keeps a high-contrast outline on focused inputs", () => {
    const focusRule = styles.match(/\.ui-input:focus-visible\s*\{([\s\S]*?)\}/)?.[1] ?? "";

    expect(focusRule).not.toMatch(/outline:\s*none/);
    expect(focusRule).toContain("outline: 3px solid var(--focus)");
  });

  it("defines and consumes a bounded typography scale", () => {
    const tokens = [
      "--font-size-xs",
      "--font-size-sm",
      "--font-size-md",
      "--font-size-base",
      "--font-size-lg",
      "--font-size-display",
      "--line-height-tight",
      "--line-height-snug",
      "--line-height-normal",
      "--line-height-relaxed",
      "--font-weight-regular",
      "--font-weight-semibold",
      "--font-weight-bold",
    ];

    for (const token of tokens) {
      expect(styles).toMatch(new RegExp(`${token}\\s*:`));
    }

    expect(styles).toContain("font-size: var(--font-size-md)");
    expect(styles).toContain("line-height: var(--line-height-normal)");
    expect(styles).toContain("font-weight: var(--font-weight-semibold)");
  });
});
