import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { App } from "../src/App";

describe("Studio writing surface", () => {
  it("declares English as the Studio document language", () => {
    const document = readFileSync(new URL("../index.html", import.meta.url), "utf8");

    expect(document).toMatch(/<html\s+lang="en">/);
  });

  it("exposes the document title and body as the primary editing controls", () => {
    const markup = renderToStaticMarkup(<App />);

    expect(markup).toContain("<main");
    expect(markup).toContain('<section class="studio-editor" aria-label="Editor">');
    expect(markup).toMatch(/<input[^>]+aria-label="Title"[^>]+disabled=""/);
    expect(markup).toMatch(/<textarea[^>]+aria-label="Body"[^>]+disabled=""/);
  });

  it("exposes a collapsed side menu with an operable disclosure control", () => {
    const markup = renderToStaticMarkup(<App />);
    const menuButton = markup.match(
      /<button[^>]+aria-label="Open menu"[^>]+aria-controls="studio-side-panel"[^>]+aria-expanded="false"[^>]*>/,
    )?.[0];

    expect(menuButton).toBeDefined();
    expect(menuButton).not.toContain("disabled");
    expect(markup).toMatch(/<aside[^>]+aria-label="Menu"[^>]+hidden=""[^>]+id="studio-side-panel"/);
    expect(markup).toContain('<nav aria-label="Studio">');
  });

  it("names icon-only controls and keeps unavailable mutations disabled", () => {
    const markup = renderToStaticMarkup(<App />);
    const buttonContents = [...markup.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)].map(
      ([, content]) => content,
    );

    expect(markup).toMatch(/<button[^>]+aria-label="Save"[^>]+disabled=""/);
    expect(markup).toMatch(/<button[^>]+aria-label="Publish"[^>]+disabled=""/);
    for (const label of ["Posts", "Media", "AI assist", "Settings"]) {
      expect(markup).toMatch(new RegExp(`<button[^>]+aria-label="${label}"[^>]+disabled=""`));
    }
    expect(buttonContents.length).toBeGreaterThan(0);
    expect(buttonContents.every((content) => /^<svg\b[\s\S]*<\/svg>$/.test(content ?? ""))).toBe(
      true,
    );
  });
});
