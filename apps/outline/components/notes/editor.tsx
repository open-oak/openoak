"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Editor as TiptapEditor } from "@tiptap/core";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import Placeholder from "@tiptap/extension-placeholder";
import {
  AlertTriangle,
  Bold,
  Heading2,
  Italic,
  Link,
  List,
  ListChecks,
  ListOrdered,
  ListTree,
  Plus,
  Redo2,
  RotateCcw,
  Trash2,
  Underline,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  displayTitle,
  formatDate,
  statisticTextFromNoteBody,
  wordCount,
  type SavePatch,
  type SaveState,
} from "@/lib/notes-view";
import {
  createNoteEditorExtensions,
  noteBodyToEditorContent,
} from "@/lib/note-markdown";
import type { FolderItem, NoteItem } from "@/lib/types";
import { DesktopNoteActions } from "./desktop-note-actions";

export function Editor({
  note,
  loading,
  saveState,
  message,
  autoFocusTitleFor,
  onChange,
  onFlush,
  onCreate,
  createFolderName,
  onDeleteRequest,
  onRetry,
  onTitleFocused,
  onOpenAppearance,
  folders,
  onMoveToFolder,
  desktopActionsInside,
}: {
  note: NoteItem | null;
  loading: boolean;
  saveState: SaveState;
  message: string | null;
  /** Id of a note whose title should take focus once — set for a note just created. */
  autoFocusTitleFor: string | null;
  onChange: (id: string, patch: SavePatch) => void;
  onFlush: (id: string) => void;
  onCreate: () => void;
  createFolderName?: string;
  onDeleteRequest: (note: NoteItem) => void;
  onRetry: () => void;
  onTitleFocused: () => void;
  onOpenAppearance: (anchor: { top: number; right: number } | null) => void;
  folders: FolderItem[];
  onMoveToFolder: (noteId: string, folderId: string | null) => void | Promise<void>;
  desktopActionsInside: boolean;
}) {
  const desktopTitleRef = useRef<HTMLInputElement>(null);
  const mobileTitleRef = useRef<HTMLInputElement>(null);
  const activeNoteRef = useRef(note);
  const onChangeRef = useRef(onChange);
  const onFlushRef = useRef(onFlush);
  const pendingBodyEditorRef = useRef<TiptapEditor | null>(null);
  const bodyUpdateTimerRef = useRef<number | null>(null);
  const [copyMessage, setCopyMessage] = useState("");
  const noteId = note?.id ?? null;
  const noteBody = note?.body ?? "";
  const editorContent = noteBodyToEditorContent(noteBody);

  useEffect(() => {
    activeNoteRef.current = note;
    onChangeRef.current = onChange;
    onFlushRef.current = onFlush;
  }, [note, onChange, onFlush]);

  const commitPendingBody = useCallback((editor: TiptapEditor) => {
    if (bodyUpdateTimerRef.current !== null) {
      window.clearTimeout(bodyUpdateTimerRef.current);
      bodyUpdateTimerRef.current = null;
    }
    pendingBodyEditorRef.current = null;
    if (editor.isDestroyed) return;
    const currentNote = activeNoteRef.current;
    if (!currentNote) return;
    onChangeRef.current(currentNote.id, { body: editor.getMarkdown() });
  }, []);

  const richEditor = useEditor(
    {
      extensions: [
        ...createNoteEditorExtensions(),
        Placeholder.configure({ placeholder: "Start outlining..." }),
      ],
      content: editorContent.content,
      contentType: editorContent.contentType,
      immediatelyRender: false,
      editorProps: {
        attributes: {
          class: "notes-editor-content text-[17px] leading-8 outline-none md:text-lg",
          "aria-label": "Note text",
        },
      },
      onUpdate: ({ editor }) => {
        pendingBodyEditorRef.current = editor;
        if (bodyUpdateTimerRef.current !== null) return;
        bodyUpdateTimerRef.current = window.setTimeout(() => commitPendingBody(editor), 120);
      },
      onBlur: ({ editor }) => {
        commitPendingBody(editor);
        const currentNote = activeNoteRef.current;
        if (currentNote) onFlushRef.current(currentNote.id);
      },
    },
    [commitPendingBody, noteId]
  );

  useEffect(() => {
    const commitBeforeBackgrounding = () => {
      if (document.visibilityState !== "hidden") return;
      const pendingEditor = pendingBodyEditorRef.current;
      if (pendingEditor) commitPendingBody(pendingEditor);
    };

    document.addEventListener("visibilitychange", commitBeforeBackgrounding);
    return () => {
      document.removeEventListener("visibilitychange", commitBeforeBackgrounding);
      const pendingEditor = pendingBodyEditorRef.current;
      if (pendingEditor) commitPendingBody(pendingEditor);
    };
  }, [commitPendingBody, noteId]);

  useEffect(() => {
    if (!noteId || autoFocusTitleFor !== noteId) return;
    const target = [desktopTitleRef.current, mobileTitleRef.current].find((input) => input && input.offsetParent !== null);
    target?.focus({ preventScroll: true });
    target?.select();
    onTitleFocused();
  }, [autoFocusTitleFor, noteId, onTitleFocused]);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport || !richEditor) return;

    let firstFrame: number | null = null;
    let secondFrame: number | null = null;
    const keepSelectionVisible = () => {
      if (firstFrame !== null) window.cancelAnimationFrame(firstFrame);
      if (secondFrame !== null) window.cancelAnimationFrame(secondFrame);
      firstFrame = window.requestAnimationFrame(() => {
        firstFrame = null;
        secondFrame = window.requestAnimationFrame(() => {
          secondFrame = null;
          if (!richEditor.isDestroyed && richEditor.isFocused) richEditor.commands.scrollIntoView();
        });
      });
    };

    viewport.addEventListener("resize", keepSelectionVisible);
    return () => {
      viewport.removeEventListener("resize", keepSelectionVisible);
      if (firstFrame !== null) window.cancelAnimationFrame(firstFrame);
      if (secondFrame !== null) window.cancelAnimationFrame(secondFrame);
    };
  }, [richEditor]);

  if (!note && loading) {
    return <div className="flex flex-1" aria-busy="true" />;
  }

  if (!note) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
        <div className="flex size-16 items-center justify-center rounded-[28%] bg-[var(--notes-accent)] text-[var(--notes-accent-text)] shadow-lg">
          <ListTree className="size-8" />
        </div>
        <h2 className="mt-5 text-2xl font-bold">{createFolderName ? `No notes in ${createFolderName} yet` : "No note selected"}</h2>
        <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
          Create a note or pick one from the sidebar to start structuring your work.
        </p>
        {saveState === "error" && (
          <p role="alert" className="mt-4 max-w-sm text-sm leading-6 text-red-700 dark:text-red-200">
            {message ?? "Could not create note. Please try again."}
          </p>
        )}
        <button type="button" className="notes-primary-button mt-6" onClick={onCreate}>
          <Plus className="size-4" />
          {createFolderName ? `New note in ${createFolderName}` : "Create a note"}
        </button>
      </div>
    );
  }

  async function copyNote() {
    if (!note || !richEditor || richEditor.isDestroyed) return;
    const markdown = richEditor.getMarkdown().trimEnd();
    const text = [displayTitle(note), markdown].filter(Boolean).join("\n\n");
    setCopyMessage("");
    try {
      await navigator.clipboard.writeText(text);
      setCopyMessage("Note copied.");
    } catch {
      setCopyMessage("Could not copy note.");
    }
  }

  const copyButton = (
    <button type="button" className="notes-secondary-button shrink-0" disabled={!richEditor} onClick={copyNote}>
      Copy note
    </button>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <header className="hidden border-b border-border/60 px-5 py-4 md:block">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <input
              ref={desktopTitleRef}
              value={note.title}
              onChange={(event) => onChange(note.id, { title: event.target.value })}
              onBlur={() => onFlush(note.id)}
              className="w-full bg-transparent text-2xl font-bold leading-tight outline-none placeholder:text-muted-foreground lg:text-3xl"
              placeholder="Untitled note"
              aria-label="Note title"
            />
          </div>
          {copyButton}
          {desktopActionsInside && (
            <DesktopNoteActions saveState={saveState} note={note} folders={folders} onOpenAppearance={onOpenAppearance} onMoveToFolder={onMoveToFolder} />
          )}
        </div>
        <FormattingToolbar className="mt-3" editor={richEditor} />
      </header>

      <p role="status" className={cn("text-sm", copyMessage && "px-4 pt-2 md:px-5")}>
        {copyMessage}
      </p>

      {saveState === "error" && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 border-b border-red-500/25 bg-red-500/10 px-5 py-3 text-sm text-red-700 dark:text-red-200"
        >
          <AlertTriangle className="size-4 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">{message ?? "This note could not be saved."}</span>
          <button type="button" className="notes-secondary-button" onClick={onRetry}>
            <RotateCcw className="size-4" />
            Try again
          </button>
        </div>
      )}

      <div className="notes-editor-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain scroll-pb-24 [overflow-anchor:none] md:scroll-pb-8">
        <div className="mx-auto flex min-h-full w-full max-w-4xl flex-col px-4 py-4 md:px-8 md:py-8">
          <div className="mb-4 flex items-center gap-3 md:hidden">
            <input
              ref={mobileTitleRef}
              value={note.title}
              onChange={(event) => onChange(note.id, { title: event.target.value })}
              onBlur={() => onFlush(note.id)}
              className="min-w-0 flex-1 bg-transparent text-3xl font-bold leading-tight outline-none placeholder:text-muted-foreground"
              placeholder="Untitled note"
              aria-label="Note title"
              enterKeyHint="done"
            />
            {copyButton}
          </div>
          <FormattingToolbar className="mb-4 md:hidden" editor={richEditor} />
          <EditorContent editor={richEditor} className="notes-rich-editor min-h-64 min-w-0 max-w-full flex-1 md:min-h-[calc(100dvh-25rem)]" />
          <EditorFooter note={note} onDeleteRequest={onDeleteRequest} />
        </div>
      </div>
    </div>
  );
}

interface ToolbarAction {
  id: string;
  label: string;
  shortcut?: string;
  icon: LucideIcon;
  active?: boolean;
  disabled?: boolean;
  divider?: boolean;
  run: () => void;
}

function FormattingToolbar({ className, editor }: { className?: string; editor: TiptapEditor | null }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      bold: current?.isActive("bold") ?? false,
      italic: current?.isActive("italic") ?? false,
      underline: current?.isActive("underline") ?? false,
      heading: current?.isActive("heading", { level: 2 }) ?? false,
      bulletList: current?.isActive("bulletList") ?? false,
      orderedList: current?.isActive("orderedList") ?? false,
      taskList: current?.isActive("taskList") ?? false,
      link: current?.isActive("link") ?? false,
      canUndo: current?.can().chain().undo().run() ?? false,
      canRedo: current?.can().chain().redo().run() ?? false,
    }),
  });

  function setLink() {
    if (!editor) return;
    if (editor.isActive("link")) {
      editor.chain().focus().unsetLink().run();
      return;
    }
    const previous = editor.getAttributes("link").href as string | undefined;
    const href = window.prompt("Link URL", previous || "https://");
    if (href === null) return;
    if (!href.trim()) {
      editor.chain().focus().unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: href.trim() }).run();
  }

  const actions: ToolbarAction[] = [
    { id: "bold", label: "Bold", shortcut: "Ctrl+B", icon: Bold, active: state?.bold, run: () => editor?.chain().focus().toggleBold().run() },
    { id: "italic", label: "Italic", shortcut: "Ctrl+I", icon: Italic, active: state?.italic, run: () => editor?.chain().focus().toggleItalic().run() },
    { id: "underline", label: "Underline", shortcut: "Ctrl+U", icon: Underline, active: state?.underline, run: () => editor?.chain().focus().toggleUnderline().run() },
    { id: "heading", label: "Heading", icon: Heading2, active: state?.heading, divider: true, run: () => editor?.chain().focus().toggleHeading({ level: 2 }).run() },
    { id: "bullet-list", label: "Bulleted list", icon: List, active: state?.bulletList, run: () => editor?.chain().focus().toggleBulletList().run() },
    { id: "numbered-list", label: "Numbered list", icon: ListOrdered, active: state?.orderedList, run: () => editor?.chain().focus().toggleOrderedList().run() },
    { id: "checklist", label: "Checklist", icon: ListChecks, active: state?.taskList, run: () => editor?.chain().focus().toggleTaskList().run() },
    { id: "link", label: "Link", shortcut: "Ctrl+K", icon: Link, active: state?.link, divider: true, run: setLink },
    { id: "undo", label: "Undo", shortcut: "Ctrl+Z", icon: Undo2, disabled: !state?.canUndo, divider: true, run: () => editor?.chain().focus().undo().run() },
    { id: "redo", label: "Redo", shortcut: "Ctrl+Shift+Z", icon: Redo2, disabled: !state?.canRedo, run: () => editor?.chain().focus().redo().run() },
  ];

  return (
    <div className={cn("notes-format-toolbar flex max-w-full items-center gap-1 overflow-x-auto", className)} role="toolbar" aria-label="Text formatting">
      {actions.map(({ id, label, shortcut, icon: Icon, active, disabled, divider, run }) => (
        <div key={id} className={cn("flex shrink-0 items-center", divider && "ml-1 border-l border-border/70 pl-2")}>
          <button
            type="button"
            className={cn(
              "flex size-11 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-35 md:size-8 md:rounded-lg",
              active && "bg-[var(--notes-accent)] text-[var(--notes-accent-text)] hover:bg-[var(--notes-accent)] hover:text-[var(--notes-accent-text)]"
            )}
            onMouseDown={(event) => event.preventDefault()}
            onClick={run}
            disabled={!editor || disabled}
            aria-label={label}
            aria-keyshortcuts={shortcut}
            aria-pressed={active || undefined}
            title={shortcut ? `${label} (${shortcut})` : label}
          >
            <Icon className="size-4" aria-hidden />
          </button>
        </div>
      ))}
    </div>
  );
}

export function EditorFooter({ note, onDeleteRequest }: { note: NoteItem; onDeleteRequest: (note: NoteItem) => void }) {
  const body = note.body ?? "";
  const plainText = statisticTextFromNoteBody(body);
  const words = wordCount(body);

  return (
    <footer className="-mx-4 mt-8 border-t border-border/60 px-4 pt-4 md:-mx-8 md:px-8 md:pt-3">
      <div className="grid grid-cols-2 items-center gap-x-3 gap-y-4 text-xs sm:grid-cols-[repeat(4,minmax(0,1fr))_2.75rem] sm:gap-1 sm:whitespace-nowrap sm:text-[13px] md:grid-cols-[repeat(4,minmax(0,1fr))_2rem]">
        <Stat label="Words" value={String(words)} />
        <Stat label="Characters" value={String(plainText.length)} />
        <Stat label="Created" value={formatDate(note.createdAt)} />
        <Stat label="Updated" value={formatDate(note.updatedAt)} />
        <button
          className="col-span-2 flex h-11 w-full items-center justify-center gap-2 justify-self-end rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:col-span-1 sm:size-11 md:size-8 md:rounded-md"
          type="button"
          onClick={() => onDeleteRequest(note)}
          aria-label="Delete note"
          title="Delete note"
        >
          <Trash2 className="size-4" />
          <span className="sm:sr-only">Delete note</span>
        </button>
      </div>
    </footer>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col items-center gap-0.5 pb-0.5 text-center leading-[1.35] text-muted-foreground">
      <span>{label}</span>
      <span className="font-semibold text-foreground">{value}</span>
    </div>
  );
}
