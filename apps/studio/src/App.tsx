import { Badge, Button, Card, Field, Input } from "./ui";

const statusId = "studio-status";

export function App() {
  return (
    <div className="studio-shell">
      <header className="studio-header">
        <a className="studio-brand" href="/">
          tinyCMS
        </a>
        <nav aria-label="Studio">
          <a aria-current="page" href="/">
            概要
          </a>
        </nav>
      </header>

      <main className="studio-main">
        <div className="studio-heading">
          <p className="studio-kicker">ワークスペース</p>
          <h1>tinyCMS Studio</h1>
          <p>文章を書き、公開するための静かな作業場所です。</p>
        </div>

        <div className="studio-workspace">
          <section className="studio-editor" aria-labelledby="workspace-heading">
            <div className="studio-section-heading">
              <div>
                <p className="studio-kicker">編集</p>
                <h2 id="workspace-heading">投稿を準備する</h2>
              </div>
              <Badge>下書き</Badge>
            </div>

            <div className="studio-fields">
              <Field id="search-posts" label="投稿を検索" helpText="検索機能は準備中です。">
                <Input type="search" disabled placeholder="タイトルやタグを検索" />
              </Field>
              <Field id="post-title" label="タイトル" helpText="編集機能は準備中です。">
                <Input disabled placeholder="タイトルを入力" />
              </Field>
              <Field id="post-body" label="本文" helpText="本文エディターは準備中です。">
                <Input disabled placeholder="本文を入力" />
              </Field>
            </div>

            <div className="studio-actions">
              <Button disabled aria-describedby={statusId}>
                下書きを保存
              </Button>
              <Button variant="primary" disabled aria-describedby={statusId}>
                公開する
              </Button>
            </div>
          </section>

          <aside className="studio-sidebar" aria-label="投稿ツール">
            <Card className="studio-status-card" as="section" role="status" id={statusId}>
              <div className="studio-card-heading">
                <h2>現在の状態</h2>
                <Badge tone="warning">準備中</Badge>
              </div>
              <p>保存、公開、検索、画像アップロード、AIアシストは準備中です。</p>
            </Card>

            <Card as="section" variant="subtle" aria-labelledby="assist-heading">
              <div className="studio-card-heading">
                <h2 id="assist-heading">AIアシスト</h2>
                <Badge tone="neutral">近日対応</Badge>
              </div>
              <p>文章の整理や推敲を手伝う機能です。</p>
              <Button disabled aria-describedby={statusId}>
                AIアシスト
              </Button>
            </Card>

            <Card as="section" variant="subtle" aria-labelledby="media-heading">
              <div className="studio-card-heading">
                <h2 id="media-heading">画像</h2>
                <Badge tone="neutral">近日対応</Badge>
              </div>
              <Field
                id="upload-image"
                label="画像をアップロード"
                helpText="アップロード機能は準備中です。"
              >
                <Input type="file" disabled />
              </Field>
            </Card>
          </aside>
        </div>
      </main>
    </div>
  );
}
