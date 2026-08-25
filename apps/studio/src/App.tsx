import { type ReactNode, useState } from "react";
import { Button } from "./ui";

type IconName = "document" | "image" | "menu" | "publish" | "save" | "settings" | "sparkle";

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    document: (
      <>
        <path d="M6 3h9l3 3v15H6z" />
        <path d="M15 3v4h4M9 12h6M9 16h6" />
      </>
    ),
    image: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <circle cx="9" cy="9" r="1.5" />
        <path d="m4 17 5-5 4 4 2-2 5 5" />
      </>
    ),
    menu: <path d="M4 7h16M4 12h16M4 17h16" />,
    publish: (
      <>
        <path d="M12 19V5" />
        <path d="m7 10 5-5 5 5" />
      </>
    ),
    save: (
      <>
        <path d="M5 4h12l2 2v14H5z" />
        <path d="M8 4v6h8V4M8 20v-6h8v6" />
      </>
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.4 1a7 7 0 0 0-1.7-1L14.5 3h-5L9 6.1a7 7 0 0 0-1.7 1l-2.4-1-2 3.4L5 11a7 7 0 0 0 0 2l-2.1 1.5 2 3.4 2.4-1a7 7 0 0 0 1.7 1l.5 3.1h5l.5-3.1a7 7 0 0 0 1.7-1l2.4 1 2-3.4L19 13a7 7 0 0 0 0-1Z" />
      </>
    ),
    sparkle: (
      <path d="m12 3 1.4 4.6L18 9l-4.6 1.4L12 15l-1.4-4.6L6 9l4.6-1.4zM18 15l.7 2.3L21 18l-2.3.7L18 21l-.7-2.3L15 18l2.3-.7z" />
    ),
  };

  return (
    <svg
      aria-hidden="true"
      className="studio-icon"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.7"
    >
      {paths[name]}
    </svg>
  );
}

export function App() {
  const [panelOpen, setPanelOpen] = useState(false);

  return (
    <div className="studio-shell" data-panel-open={panelOpen}>
      <header className="studio-header">
        <Button
          aria-label={panelOpen ? "Close menu" : "Open menu"}
          aria-controls="studio-side-panel"
          aria-expanded={panelOpen}
          className="studio-icon-button"
          onClick={() => setPanelOpen((open) => !open)}
          variant="ghost"
        >
          <Icon name="menu" />
        </Button>

        <div className="studio-document-actions">
          <span aria-label="Draft" className="studio-status-dot" role="status" />
          <Button aria-label="Save" className="studio-icon-button" disabled variant="ghost">
            <Icon name="save" />
          </Button>
          <Button aria-label="Publish" className="studio-icon-button" disabled variant="ghost">
            <Icon name="publish" />
          </Button>
        </div>
      </header>

      <aside
        aria-label="Menu"
        className="studio-side-panel"
        hidden={!panelOpen}
        id="studio-side-panel"
      >
        <nav aria-label="Studio">
          <Button aria-label="Posts" className="studio-icon-button" disabled variant="ghost">
            <Icon name="document" />
          </Button>
          <Button aria-label="Media" className="studio-icon-button" disabled variant="ghost">
            <Icon name="image" />
          </Button>
          <Button aria-label="AI assist" className="studio-icon-button" disabled variant="ghost">
            <Icon name="sparkle" />
          </Button>
          <Button aria-label="Settings" className="studio-icon-button" disabled variant="ghost">
            <Icon name="settings" />
          </Button>
        </nav>
      </aside>

      <main className="studio-main">
        <section className="studio-editor" aria-label="Editor">
          <input aria-label="Title" className="studio-title-input" disabled type="text" />
          <textarea aria-label="Body" className="studio-body-input" disabled rows={24} />
        </section>
      </main>
    </div>
  );
}
