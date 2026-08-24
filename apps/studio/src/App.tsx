export function App() {
  return (
    <div className="studio-shell">
      <header className="studio-header">
        <a className="studio-brand" href="/">
          tinyCMS
        </a>
        <nav aria-label="Studio">
          <a aria-current="page" href="/">
            Overview
          </a>
        </nav>
      </header>

      <main className="studio-main">
        <div className="studio-heading">
          <p className="studio-kicker">Workspace</p>
          <h1>tinyCMS Studio</h1>
          <p>A quiet place to write and publish.</p>
        </div>

        <section className="studio-panel" aria-labelledby="workspace-heading">
          <h2 id="workspace-heading">Posts</h2>
          <p>Your posts and publishing status will appear here.</p>
        </section>
      </main>
    </div>
  );
}
