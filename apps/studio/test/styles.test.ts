import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

function extractThemeTokens(block: string | undefined) {
  if (!block) {
    throw new Error("Theme token block is missing");
  }

  return Object.fromEntries(
    [...block.matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-f]{6})\s*;/gi)].map(([, name, value]) => [
      name,
      value,
    ]),
  ) as Record<string, string>;
}

function themeTokens() {
  return [...styles.matchAll(/:root\s*\{([\s\S]*?)\}/g)].map(([, block]) =>
    extractThemeTokens(block),
  );
}

function relativeLuminance(hex: string) {
  const toLinearChannel = (offset: number) => {
    const channel = Number.parseInt(hex.slice(offset + 1, offset + 3), 16) / 255;

    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  };

  return 0.2126 * toLinearChannel(0) + 0.7152 * toLinearChannel(2) + 0.0722 * toLinearChannel(4);
}

function contrastRatio(foreground: string, background: string) {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);

  return (lighter + 0.05) / (darker + 0.05);
}

function compositeHex(foreground: string, background: string, opacity: number) {
  const compositeChannel = (offset: number) => {
    const foregroundChannel = Number.parseInt(foreground.slice(offset, offset + 2), 16);
    const backgroundChannel = Number.parseInt(background.slice(offset, offset + 2), 16);

    return Math.round(foregroundChannel * opacity + backgroundChannel * (1 - opacity))
      .toString(16)
      .padStart(2, "0");
  };

  return `#${compositeChannel(1)}${compositeChannel(3)}${compositeChannel(5)}`;
}

function requiredToken(tokens: Record<string, string>, name: string) {
  const value = tokens[name];

  if (!value) {
    throw new Error(`Missing theme token: ${name}`);
  }

  return value;
}

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

  it("keeps active muted text at WCAG contrast on each theme surface", () => {
    const [light, dark] = themeTokens();

    if (!light || !dark) {
      throw new Error("Both light and dark theme token blocks are required");
    }

    for (const tokens of [light, dark]) {
      for (const surface of ["--surface", "--surface-muted"]) {
        expect(
          contrastRatio(
            requiredToken(tokens, "--muted-foreground"),
            requiredToken(tokens, surface),
          ),
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("keeps enabled input placeholders at WCAG contrast", () => {
    const placeholderRule = styles.match(/\.ui-input::placeholder\s*\{([\s\S]*?)\}/)?.[1];
    const colorToken = placeholderRule?.match(/color:\s*var\((--[\w-]+)\)/)?.[1];
    const opacityValue = placeholderRule?.match(/opacity:\s*([\d.]+)/)?.[1];
    const [light, dark] = themeTokens();

    if (!colorToken || !opacityValue || !light || !dark) {
      throw new Error("Placeholder color, opacity, and both theme token blocks are required");
    }

    const opacity = Number(opacityValue);

    expect(opacity).toBe(1);

    for (const tokens of [light, dark]) {
      const surface = requiredToken(tokens, "--surface");
      const effectivePlaceholder = compositeHex(
        requiredToken(tokens, colorToken),
        surface,
        opacity,
      );

      expect(contrastRatio(effectivePlaceholder, surface)).toBeGreaterThanOrEqual(4.5);
    }
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

  it("keeps media controls compact while preserving picker accessibility", () => {
    expect(styles).toContain(".studio-media-actions");
    expect(styles).toContain(".studio-media-file-input");
    expect(styles).toContain(".studio-media-selection");
    expect(styles).toContain(".studio-media-selection__actions");
    expect(styles).toMatch(/\.studio-media-file-input\s*\{[\s\S]*clip:\s*rect\(/);
    expect(styles).toMatch(/\.studio-media-selection__actions\s*\{[\s\S]*display:\s*flex/);
  });
});
