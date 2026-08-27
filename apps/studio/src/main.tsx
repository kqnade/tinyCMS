import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/zen-kaku-gothic-antique/japanese-400.css";
import "@fontsource/zen-kaku-gothic-antique/japanese-700.css";
import "@fontsource/zen-kaku-gothic-antique/latin-400.css";
import "@fontsource/zen-kaku-gothic-antique/latin-700.css";
import "@material-symbols/font-400/rounded.css";
import { App } from "./App";
import { createEditorialApi } from "./editorial-api";
import "./styles.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Studio root element was not found");
}

const api = createEditorialApi();

createRoot(rootElement).render(
  <StrictMode>
    <App api={api} />
  </StrictMode>,
);
