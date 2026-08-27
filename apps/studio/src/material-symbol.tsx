export type MaterialSymbolName =
  | "add"
  | "arrow_back"
  | "article"
  | "auto_awesome"
  | "close"
  | "code"
  | "dark_mode"
  | "format_bold"
  | "format_italic"
  | "history"
  | "image"
  | "light_mode"
  | "link"
  | "menu"
  | "refresh"
  | "replay"
  | "save"
  | "settings"
  | "strikethrough_s";

export function MaterialSymbol({
  className,
  name,
}: {
  readonly className?: string;
  readonly name: MaterialSymbolName;
}) {
  return (
    <span
      aria-hidden="true"
      className={["material-symbols-rounded", "material-symbol", className]
        .filter(Boolean)
        .join(" ")}
    >
      {name}
    </span>
  );
}
