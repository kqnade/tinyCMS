import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Badge, Button, Card, Field, Input } from "../src/ui";

describe("Button", () => {
  it("uses native button semantics and exposes a disabled busy state", () => {
    const markup = renderToStaticMarkup(
      <Button loading variant="primary">
        保存
      </Button>,
    );

    expect(markup).toContain('<button type="button"');
    expect(markup).toContain('disabled=""');
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain("ui-button--primary");
  });
});

describe("Field", () => {
  it("associates its label and validation descriptions with the input", () => {
    const markup = renderToStaticMarkup(
      <Field
        id="post-title"
        label="タイトル"
        helpText="短いタイトルにします。"
        error="入力が必要です。"
      >
        <Input placeholder="タイトルを入力" />
      </Field>,
    );

    expect(markup).toMatch(/<label[^>]+for="post-title">タイトル<\/label>/);
    expect(markup).toContain('id="post-title"');
    expect(markup).toContain('aria-describedby="post-title-help post-title-error"');
    expect(markup).toContain('aria-invalid="true"');
    expect(markup).toContain('id="post-title-help"');
    expect(markup).toContain('id="post-title-error"');
  });
});

describe("Card and Badge", () => {
  it("composes a semantic card with a named status tone", () => {
    const markup = renderToStaticMarkup(
      <Card as="section" variant="subtle">
        <Badge tone="success">公開済み</Badge>
      </Card>,
    );

    expect(markup).toContain('<section class="ui-card ui-card--subtle">');
    expect(markup).toContain('<span class="ui-badge ui-badge--success">公開済み</span>');
  });
});
