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

  it("keeps semantic landmarks and readable Japanese headings", () => {
    const markup = renderToStaticMarkup(<App />);

    expect(markup).toContain("<header");
    expect(markup).toContain('<nav aria-label="Studio">');
    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain("<section");
    expect(markup).toContain("ワークスペース");
    expect(markup).toContain("投稿");
  });

  it("does not advertise an unimplemented posts destination", () => {
    const markup = renderToStaticMarkup(<App />);

    expect(markup).not.toContain('href="/posts"');
  });

  it("shows unavailable actions as native disabled controls with an honest status", () => {
    const markup = renderToStaticMarkup(<App />);

    expect(markup).toMatch(/<button[^>]+disabled=""[^>]*>下書きを保存<\/button>/);
    expect(markup).toMatch(/<button[^>]+disabled=""[^>]*>公開する<\/button>/);
    expect(markup).toMatch(/<button[^>]+disabled=""[^>]*>AIアシスト<\/button>/);
    expect(markup).toMatch(/<input[^>]+type="search"[^>]+disabled=""/);
    expect(markup).toMatch(/<input[^>]+type="file"[^>]+disabled=""/);
    expect(markup).toContain("保存、公開、検索、画像アップロード、AIアシストは準備中です。");
  });
});
