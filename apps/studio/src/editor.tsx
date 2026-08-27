import {
  Extension,
  type JSONContent,
  Node,
  type Editor as TiptapEditorInstance,
  wrappingInputRule,
} from "@tiptap/core";
import { BulletList, ListItem, ListKit, OrderedList, TaskItem } from "@tiptap/extension-list";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import type { DOMOutputSpec, Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin } from "@tiptap/pm/state";
import { EditorContent as TiptapEditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  forwardRef,
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  cloneEditorContent,
  createEditorContent,
  createEmptyEditorContent,
  type EditorContent,
  isAbsoluteHttpUrl,
  parseEditorContent,
  type RawTiptapDoc,
  type RawTiptapNode,
  type StudioImageAttrs,
} from "./editor-content";
import { MaterialSymbol, type MaterialSymbolName } from "./material-symbol";

export type StudioEditorHandle = {
  getContent: () => EditorContent;
  insertImage: (attrs: StudioImageAttrs) => void;
  setContent: (content: EditorContent) => void;
  focus: () => void;
};

export type StudioEditorProps = {
  "aria-label"?: string;
  className?: string;
  content?: EditorContent;
  editable?: boolean;
  initialContent?: EditorContent;
  onChange?: (content: EditorContent) => void;
};

const StudioDocument = Node.create({
  name: "doc",
  topNode: true,
  content: "(block | tableBlock)+",
});

const StudioTable = Table.extend({
  content: "tableRow{2,}",
  group: "tableBlock",
});

const StudioTableCell = TableCell.extend({
  content: "paragraph",
});

const StudioTableHeader = TableHeader.extend({
  content: "paragraph",
});

const StudioTableRow = TableRow.extend({
  content: "(tableCell | tableHeader)+",
});

const StudioImage = Node.create({
  name: "image",
  group: "block",
  inline: false,
  atom: true,
  addAttributes() {
    return {
      mediaId: { default: null },
      alt: { default: "" },
      caption: { default: null },
    };
  },
  renderHTML({ node }): DOMOutputSpec {
    const attrs = node.attrs as StudioImageAttrs;
    const children: DOMOutputSpec[] = [
      [
        "img",
        {
          src: `/api/v1/admin/media/${encodeURIComponent(attrs.mediaId)}/original`,
          alt: attrs.alt,
        },
      ],
    ];
    if (attrs.caption !== null) {
      children.push(["figcaption", {}, attrs.caption]);
    }
    return ["figure", {}, ...children];
  },
});

function hasSupportedTableStructure(document: ProseMirrorNode): boolean {
  let valid = true;

  document.descendants((node, _pos, parent) => {
    if (!valid) return false;

    if (node.type.name === "table") {
      if (parent?.type.name !== "doc" || node.childCount < 2) {
        valid = false;
        return false;
      }
      const firstRow = node.child(0);
      const columnCount = firstRow.childCount;
      if (columnCount === 0 || columnCount > 20 || node.childCount > 100) {
        valid = false;
        return false;
      }
      let cellCount = 0;
      node.forEach((row, rowIndex) => {
        if (row.type.name !== "tableRow" || row.childCount !== columnCount) {
          valid = false;
          return;
        }
        row.forEach((cell) => {
          const expectedType = rowIndex === 0 ? "tableHeader" : "tableCell";
          if (
            cell.type.name !== expectedType ||
            cell.childCount !== 1 ||
            cell.firstChild?.type.name !== "paragraph" ||
            cell.attrs.colspan !== 1 ||
            cell.attrs.rowspan !== 1 ||
            cell.attrs.colwidth !== null ||
            (cell.attrs.align !== null && cell.attrs.align !== undefined)
          ) {
            valid = false;
          }
          cellCount += 1;
        });
      });
      if (cellCount > 400) valid = false;
    }

    if (
      (node.type.name === "tableRow" && parent?.type.name !== "table") ||
      ((node.type.name === "tableCell" || node.type.name === "tableHeader") &&
        parent?.type.name !== "tableRow")
    ) {
      valid = false;
      return false;
    }

    return true;
  });

  return valid;
}

const StudioTableStructureGuard = Extension.create({
  name: "studioTableStructureGuard",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        filterTransaction: (transaction) => hasSupportedTableStructure(transaction.doc),
      }),
    ];
  },
});

const editorExtensions = [
  StarterKit.configure({
    bulletList: false,
    document: false,
    listItem: false,
    listKeymap: false,
    orderedList: false,
    trailingNode: false,
    underline: false,
    heading: { levels: [1, 2, 3] },
    link: {
      isAllowedUri: (url) => isAbsoluteHttpUrl(url),
      shouldAutoLink: (url) => isAbsoluteHttpUrl(url),
    },
  }),
  ListKit.configure({
    bulletList: false,
    listItem: false,
    listKeymap: false,
    orderedList: false,
    taskItem: false,
    taskList: { itemTypeName: "taskItem" },
  }),
  BulletList.extend({
    addInputRules() {
      return [
        wrappingInputRule({
          find: /^\s*([+*])\s$/,
          type: this.type,
        }),
      ];
    },
  }),
  OrderedList,
  ListItem,
  TaskItem.extend({
    addInputRules() {
      const markdownTaskRule = wrappingInputRule({
        find: /^\s*-\s+\[([ x])\]\s$/i,
        getAttributes: (match) => ({ checked: match[1]?.toLowerCase() === "x" }),
        type: this.type,
      });
      const parentRules = this.parent?.() ?? [];

      return [markdownTaskRule, ...parentRules];
    },
  }),
  StudioDocument,
  StudioTable.configure({
    lastColumnResizable: false,
    renderWrapper: false,
    resizable: false,
  }),
  StudioTableCell,
  StudioTableHeader,
  StudioTableRow,
  StudioImage,
  StudioTableStructureGuard,
];

function toRawTiptapDoc(value: JSONContent): RawTiptapDoc {
  const content = Array.isArray(value.content) ? value.content : [];

  return {
    type: "doc",
    content: content.map(toRawTiptapNode),
  };
}

function toRawTiptapNode(value: JSONContent): RawTiptapNode {
  const attrs =
    value.type === "tableCell" || value.type === "tableHeader"
      ? { colspan: 1, rowspan: 1, colwidth: null }
      : value.attrs;
  const content = Array.isArray(value.content) ? value.content.map(toRawTiptapNode) : undefined;

  return {
    type: value.type ?? "paragraph",
    ...(attrs === undefined ? {} : { attrs }),
    ...(content === undefined ? {} : { content }),
    ...(value.text === undefined ? {} : { text: value.text }),
    ...(value.marks === undefined ? {} : { marks: value.marks }),
  };
}

function getCanonicalContent(editor: TiptapEditorInstance): EditorContent {
  return createEditorContent(toRawTiptapDoc(editor.getJSON()));
}

function getTopLevelInsertionPosition(editor: TiptapEditorInstance): number {
  const { $from } = editor.state.selection;
  if ($from.depth > 0) return $from.after(1);

  const topLevelIndex = $from.index(0);
  return topLevelIndex < editor.state.doc.childCount
    ? $from.pos + editor.state.doc.child(topLevelIndex).nodeSize
    : editor.state.doc.content.size;
}

type FormatName = "bold" | "code" | "italic" | "link" | "strike";

type SlashCommandName =
  | "blockquote"
  | "bulletList"
  | "codeBlock"
  | "heading1"
  | "heading2"
  | "heading3"
  | "horizontalRule"
  | "orderedList"
  | "paragraph"
  | "table"
  | "taskList";

type SlashCommand = {
  readonly keywords: readonly string[];
  readonly label: string;
  readonly name: SlashCommandName;
};

type SlashState = {
  readonly from: number;
  readonly query: string;
  readonly to: number;
};

type SlashMenuPosition = {
  readonly left: number;
  readonly top: number;
};

const slashCommands: readonly SlashCommand[] = [
  { keywords: ["p"], label: "Paragraph", name: "paragraph" },
  { keywords: ["h1", "title"], label: "Heading 1", name: "heading1" },
  { keywords: ["h2", "subtitle"], label: "Heading 2", name: "heading2" },
  { keywords: ["h3"], label: "Heading 3", name: "heading3" },
  { keywords: ["ul", "list"], label: "Bullet list", name: "bulletList" },
  { keywords: ["ol", "numbered"], label: "Ordered list", name: "orderedList" },
  { keywords: ["todo", "check"], label: "Task list", name: "taskList" },
  { keywords: ["blockquote"], label: "Quote", name: "blockquote" },
  { keywords: ["pre", "fenced"], label: "Code block", name: "codeBlock" },
  { keywords: ["hr", "rule"], label: "Horizontal rule", name: "horizontalRule" },
  { keywords: ["grid"], label: "Table", name: "table" },
];

const formatButtons: readonly {
  readonly label: string;
  readonly name: FormatName;
}[] = [
  { label: "Bold", name: "bold" },
  { label: "Italic", name: "italic" },
  { label: "Strike", name: "strike" },
  { label: "Inline code", name: "code" },
  { label: "Link", name: "link" },
];

const formatSymbolNames: Record<FormatName, MaterialSymbolName> = {
  bold: "format_bold",
  code: "code",
  italic: "format_italic",
  link: "link",
  strike: "strikethrough_s",
};

function FormatButtonIcon({ name }: { name: FormatName }) {
  return <MaterialSymbol className="studio-editor-format-icon" name={formatSymbolNames[name]} />;
}

function toTiptapDocument(document: RawTiptapDoc): JSONContent {
  return {
    type: "doc",
    content: document.content as JSONContent[],
  };
}

function findSlashState(editor: TiptapEditorInstance): SlashState | null {
  const { selection } = editor.state;
  if (!selection.empty || !selection.$from.parent.isTextblock) return null;

  const textBeforeCursor = selection.$from.parent.textBetween(
    0,
    selection.$from.parentOffset,
    "\n",
    "\ufffc",
  );
  const match = textBeforeCursor.match(/(^|\s)\/([^\n]*)$/);
  if (!match) return null;

  const prefix = match[1] ?? "";
  const query = match[2] ?? "";
  const from = selection.$from.start() + textBeforeCursor.length - match[0].length + prefix.length;

  return { from, query, to: selection.from };
}

function canInsertTableAtSelection(editor: TiptapEditorInstance): boolean {
  const { $from } = editor.state.selection;
  return $from.depth === 1 && $from.parent.isTextblock && $from.parent.type.name !== "codeBlock";
}

function getSlashCommands(query: string, tableAvailable: boolean): readonly SlashCommand[] {
  const normalizedQuery = query.trim().toLowerCase();
  const commands = normalizedQuery
    ? slashCommands.filter(
        ({ keywords, label }) =>
          label.toLowerCase().startsWith(normalizedQuery) ||
          keywords.some((keyword) => keyword.startsWith(normalizedQuery)),
      )
    : slashCommands;

  return tableAvailable ? commands : commands.filter(({ name }) => name !== "table");
}

export const StudioEditor = forwardRef<StudioEditorHandle, StudioEditorProps>(function StudioEditor(
  {
    "aria-label": ariaLabel = "Editor",
    className,
    content,
    editable = true,
    initialContent,
    onChange,
  },
  ref,
) {
  const emptyContent = useMemo(() => createEmptyEditorContent(), []);
  const resolvedContent = useMemo(
    () => parseEditorContent(content ?? initialContent ?? emptyContent),
    [content, initialContent, emptyContent],
  );
  const initialDocument = useRef(resolvedContent.content);
  const editableRef = useRef(editable);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState({ from: 0, to: 0 });
  const [slashState, setSlashState] = useState<SlashState | null>(null);
  const [slashIndex, setSlashIndex] = useState(0);
  const [slashMenuPosition, setSlashMenuPosition] = useState<SlashMenuPosition | null>(null);

  const updateSlashState = (changedEditor: TiptapEditorInstance) => {
    setSlashState(findSlashState(changedEditor));
    setSlashIndex(0);
  };

  const editor = useEditor(
    {
      editorProps: {
        attributes: { "aria-label": ariaLabel, role: "textbox" },
      },
      extensions: editorExtensions,
      content: toTiptapDocument(initialDocument.current),
      editable,
      immediatelyRender: false,
      onUpdate: ({ editor: changedEditor }) => {
        updateSlashState(changedEditor);
        if (!changedEditor.isEditable) return;
        onChangeRef.current?.(cloneEditorContent(getCanonicalContent(changedEditor)));
      },
      onSelectionUpdate: ({ editor: changedEditor }) => {
        setSelection({
          from: changedEditor.state.selection.from,
          to: changedEditor.state.selection.to,
        });
        updateSlashState(changedEditor);
      },
    },
    [],
  );

  useEffect(() => {
    if (!editor || content === undefined) return;

    const nextContent = cloneEditorContent(resolvedContent);
    if (JSON.stringify(getCanonicalContent(editor)) === JSON.stringify(nextContent)) return;

    editor.commands.setContent(toTiptapDocument(nextContent.content), { emitUpdate: false });
    setSlashState(null);
    setSlashIndex(0);
  }, [content, editor, resolvedContent]);

  useEffect(() => {
    if (editableRef.current === editable) return;
    editableRef.current = editable;
    editor?.setEditable(editable, false);
  }, [editable, editor]);

  useLayoutEffect(() => {
    const container = editorContainerRef.current;
    if (!editor || !slashState || !container) {
      setSlashMenuPosition(null);
      return;
    }

    const containerRect = container.getBoundingClientRect();
    const cursorRect = editor.view.coordsAtPos(slashState.to);
    const menuWidth = 12 * 16;
    const maxLeft = Math.max(0, containerRect.width - menuWidth);

    setSlashMenuPosition({
      left: Math.min(Math.max(0, cursorRect.left - containerRect.left), maxLeft),
      top: cursorRect.bottom - containerRect.top + 8,
    });
  }, [editor, slashState]);

  useImperativeHandle(
    ref,
    () => ({
      focus: () => {
        editor?.commands.focus();
      },
      getContent: () =>
        editor
          ? cloneEditorContent(getCanonicalContent(editor))
          : cloneEditorContent(resolvedContent),
      insertImage: (attrs) => {
        if (!editor?.isEditable) return;

        const imageContent = createEditorContent({
          type: "doc",
          content: [{ type: "image", attrs }],
        }).content.content[0];
        if (imageContent?.type !== "image" || imageContent.attrs === undefined) return;

        const imageType = editor.state.schema.nodes.image;
        if (imageType === undefined) {
          throw new Error("Studio image node is not registered");
        }
        const imageNode = imageType.create(imageContent.attrs);
        editor.view.dispatch(
          editor.state.tr.insert(getTopLevelInsertionPosition(editor), imageNode).scrollIntoView(),
        );
      },
      setContent: (nextContent) => {
        const parsedContent = parseEditorContent(nextContent);
        editor?.commands.setContent(toTiptapDocument(parsedContent.content), {
          emitUpdate: false,
        });
        onChangeRef.current?.(cloneEditorContent(parsedContent));
      },
    }),
    [editor, resolvedContent],
  );

  const runFormat = (name: FormatName) => {
    if (!editor) return;

    const chain = editor.chain().focus();
    if (name === "bold") chain.toggleBold();
    if (name === "italic") chain.toggleItalic();
    if (name === "strike") chain.toggleStrike();
    if (name === "code") chain.toggleCode();
    if (name === "link") {
      if (editor.isActive("link")) {
        chain.unsetLink();
      } else {
        let href: string | null = null;
        try {
          href = window.prompt("Link URL");
        } catch {
          return;
        }
        if (!isAbsoluteHttpUrl(href)) return;
        chain.setLink({ href });
      }
    }
    chain.run();
  };

  const visibleSlashCommands = slashState
    ? getSlashCommands(slashState.query, Boolean(editor && canInsertTableAtSelection(editor)))
    : [];
  const activeSlashIndex = visibleSlashCommands.length
    ? Math.min(slashIndex, visibleSlashCommands.length - 1)
    : 0;

  const runSlashCommand = (command: SlashCommand) => {
    if (!editor || !slashState) return;
    if (command.name === "table" && !canInsertTableAtSelection(editor)) return;

    const chain = editor.chain().focus().deleteRange({
      from: slashState.from,
      to: slashState.to,
    });
    if (command.name === "paragraph") chain.setParagraph();
    if (command.name === "heading1") chain.setHeading({ level: 1 });
    if (command.name === "heading2") chain.setHeading({ level: 2 });
    if (command.name === "heading3") chain.setHeading({ level: 3 });
    if (command.name === "bulletList") chain.toggleBulletList();
    if (command.name === "orderedList") chain.toggleOrderedList();
    if (command.name === "taskList") chain.toggleTaskList();
    if (command.name === "blockquote") chain.toggleBlockquote();
    if (command.name === "codeBlock") chain.toggleCodeBlock();
    if (command.name === "horizontalRule") chain.setHorizontalRule();
    if (command.name === "table") {
      chain.insertTable({ cols: 2, rows: 2, withHeaderRow: true });
    }
    chain.run();
    setSlashState(null);
    setSlashIndex(0);
  };

  const handleEditorKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!slashState || visibleSlashCommands.length === 0) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSlashIndex((index) => (index + 1) % visibleSlashCommands.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSlashIndex(
        (index) => (index - 1 + visibleSlashCommands.length) % visibleSlashCommands.length,
      );
    } else if (event.key === "Enter") {
      event.preventDefault();
      const command = visibleSlashCommands[activeSlashIndex];
      if (command) runSlashCommand(command);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setSlashState(null);
      setSlashIndex(0);
    }
  };

  return (
    <div
      className={className ? `studio-editor-input ${className}` : "studio-editor-input"}
      onKeyDownCapture={handleEditorKeyDown}
      ref={editorContainerRef}
      style={{ position: "relative" }}
    >
      {editor && selection.from !== selection.to ? (
        <div aria-label="Formatting" className="studio-editor-formatting" role="toolbar">
          {formatButtons.map(({ label, name }) => (
            <button
              aria-label={label}
              aria-pressed={editor.isActive(name)}
              className="studio-editor-format-button"
              key={name}
              onClick={() => runFormat(name)}
              onMouseDown={(event) => event.preventDefault()}
              type="button"
            >
              <FormatButtonIcon name={name} />
            </button>
          ))}
        </div>
      ) : null}
      {slashState && slashMenuPosition && visibleSlashCommands.length > 0 ? (
        <div
          aria-activedescendant={`studio-editor-slash-${visibleSlashCommands[activeSlashIndex]?.name ?? ""}`}
          aria-label="Insert block"
          className="studio-editor-slash-menu"
          role="listbox"
          style={{ ...slashMenuPosition, position: "absolute", zIndex: 10 }}
          tabIndex={0}
        >
          {visibleSlashCommands.map((command, index) => (
            <div
              aria-selected={index === activeSlashIndex}
              className="studio-editor-slash-option"
              id={`studio-editor-slash-${command.name}`}
              key={command.name}
              onClick={() => runSlashCommand(command)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  runSlashCommand(command);
                }
              }}
              onMouseDown={(event) => event.preventDefault()}
              role="option"
              tabIndex={-1}
            >
              {command.label}
            </div>
          ))}
        </div>
      ) : null}
      <TiptapEditorContent editor={editor} />
    </div>
  );
});

export const TiptapEditor = StudioEditor;
export const Editor = StudioEditor;
