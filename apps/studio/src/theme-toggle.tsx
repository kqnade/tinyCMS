import { useEffect, useState } from "react";
import { MaterialSymbol } from "./material-symbol";
import { Button } from "./ui";

type Theme = "dark" | "light";

const themeStorageKey = "tinycms-theme";

function isTheme(value: string | undefined | null): value is Theme {
  return value === "dark" || value === "light";
}

function readStoredTheme(): Theme | undefined {
  try {
    const storedTheme = window.localStorage.getItem(themeStorageKey);
    return isTheme(storedTheme) ? storedTheme : undefined;
  } catch (error) {
    console.warn("Could not read the Studio theme preference", error);
    return undefined;
  }
}

function getInitialTheme(): Theme {
  if (typeof window === "undefined") return "light";

  const storedTheme = readStoredTheme();
  if (storedTheme !== undefined) return storedTheme;

  const documentTheme = document.documentElement.dataset.theme;
  if (isTheme(documentTheme)) return documentTheme;

  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function storeTheme(theme: Theme) {
  try {
    window.localStorage.setItem(themeStorageKey, theme);
  } catch (error) {
    console.warn("Could not save the Studio theme preference", error);
  }
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(getInitialTheme);
  const nextTheme: Theme = theme === "light" ? "dark" : "light";

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return (
    <Button
      aria-label={`Switch to ${nextTheme} theme`}
      className="studio-theme-toggle"
      onClick={() => {
        setTheme(nextTheme);
        storeTheme(nextTheme);
      }}
      title={`Switch to ${nextTheme} theme`}
      variant="ghost"
    >
      <MaterialSymbol name={theme === "light" ? "dark_mode" : "light_mode"} />
    </Button>
  );
}
