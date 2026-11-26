"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileText,
  Files,
  Folder,
  FolderOpen,
  FolderPlus,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  Search,
  Settings,
  Trash2,
  X,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { displayTitle, dropEdgeFor, isTempNote, noteExcerpt } from "@/lib/notes-view";
import type { FolderItem, NoteItem } from "@/lib/types";

type FolderEdit =
  | { mode: "create"; value: string }
  | { mode: "rename"; id: string; value: string };

export function NotesSidebar({
  folders,
  allNotesCount,
  unfiledCount,
  selectedFolderId,
  notes,
  totalCount,
  pageIndex,
  selectedId,
  query,
  loading,
  error,
  hasPrevious,
  hasNext,
  reorderEnabled,
  glass,
  collapsed,
  draggingId,
  onQueryChange,
  onSelect,
  onSelectFolder,
  onPreviousPage,
  onNextPage,
  onCreate,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolderRequest,
  onMove,
  onDragStart,
  onDropOnNote,
  onDropOnFolder,
  onOpenSettings,
  onToggleCollapsed,
}: {
  folders: FolderItem[];
  allNotesCount: number;
  unfiledCount: number;
  /** Undefined means All Notes, null means Unsorted Notes, and a string is a custom folder. */
  selectedFolderId: string | null | undefined;
  notes: NoteItem[];
  totalCount: number;
  pageIndex: number;
  selectedId: string | null;
  query: string;
  loading: boolean;
  error: string | null;
  hasPrevious: boolean;
  hasNext: boolean;
  reorderEnabled: boolean;
  glass: boolean;
  collapsed: boolean;
  draggingId: string | null;
  onQueryChange: (value: string) => void;
  onSelect: (id: string) => void;
  onSelectFolder: (folderId: string | null | undefined) => void;
  onPreviousPage: () => void;
  onNextPage: () => void;
  onCreate: () => void;
  onCreateFolder: (name: string) => Promise<string | null>;
  onRenameFolder: (id: string, name: string) => Promise<string | null>;
  onDeleteFolderRequest: (folder: FolderItem) => void;
  onMove: (id: string, direction: -1 | 1) => void;
  onDragStart: (id: string | null) => void;
  onDropOnNote: (id: string) => void;
  onDropOnFolder: (folderId: string | null) => void;
  onOpenSettings: () => void;
  onToggleCollapsed?: () => void;
}) {
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [dropFolderKey, setDropFolderKey] = useState<string | null>(null);
  const [folderEdit, setFolderEdit] = useState<FolderEdit | null>(null);
  const [folderEditError, setFolderEditError] = useState<string | null>(null);
  const [folderEditSaving, setFolderEditSaving] = useState(false);
  const [closedFolder, setClosedFolder] = useState<{ id: string | null; noteId: string | null } | null>(null);
  const [showLoading, setShowLoading] = useState(false);
  const contentsId = useId();
  const searchInputId = useId();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const filtering = query.trim().length > 0;
  const visibleNotes = filtering || selectedFolderId === undefined
    ? notes
    : notes.filter((note) => note.folderId === selectedFolderId);

  useEffect(() => {
    if (!loading) return;
    const timer = window.setTimeout(() => setShowLoading(true), 250);
    return () => {
      window.clearTimeout(timer);
      setShowLoading(false);
    };
  }, [loading]);

  function folderExpanded(folderId: string | null) {
    return !collapsed && !filtering && selectedFolderId === folderId && !(closedFolder?.id === folderId && closedFolder.noteId === selectedId);
  }

  function selectFolder(folderId: string | null | undefined) {
    if (folderId !== undefined && selectedFolderId === folderId && !filtering && !collapsed) {
      setClosedFolder(folderExpanded(folderId) ? { id: folderId, noteId: selectedId } : null);
      return;
    }
    setClosedFolder(null);
    onSelectFolder(folderId);
  }

  function folderContents(folderId: string | null, name: string) {
    return (
      <div id={`${contentsId}-${folderId ?? "unfiled"}`} role="region" aria-label={`Notes in ${name}`}
        hidden={!folderExpanded(folderId)} className="ml-5">
        {folderExpanded(folderId) && renderNotes(true)}
      </div>
    );
  }

  useEffect(() => {
    if (!folderEdit) return;
    folderInputRef.current?.focus();
    if (folderEdit.mode === "rename") folderInputRef.current?.select();
  }, [folderEdit]);

  function noteKeyDown(event: React.KeyboardEvent, id: string) {
    if (!event.altKey || !reorderEnabled) return;
    const direction = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
    if (!direction) return;
    event.preventDefault();
    onMove(id, direction);
  }

  function noteDragProps(note: NoteItem) {
    return {
      draggable: !isTempNote(note.id),
      onDragStart: (event: React.DragEvent) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", note.id);
        onDragStart(note.id);
      },
      onDragOver: (event: React.DragEvent) => {
        if (!reorderEnabled) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        if (draggingId && draggingId !== note.id) setDropTargetId(note.id);
      },
      onDragLeave: () => setDropTargetId((current) => (current === note.id ? null : current)),
      onDrop: (event: React.DragEvent) => {
        if (!reorderEnabled) return;
        event.preventDefault();
        event.stopPropagation();
        setDropTargetId(null);
        onDropOnNote(note.id);
      },
      onDragEnd: () => {
        setDropTargetId(null);
        setDropFolderKey(null);
        onDragStart(null);
      },
    };
  }

  function folderDropProps(key: string, folderId: string | null) {
    return {
      onDragOver: (event: React.DragEvent) => {
        if (!draggingId) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setDropFolderKey(key);
      },
      onDragLeave: () => setDropFolderKey((current) => current === key ? null : current),
      onDrop: (event: React.DragEvent) => {
        if (!draggingId) return;
        event.preventDefault();
        setDropFolderKey(null);
        onDropOnFolder(folderId);
      },
    };
  }

  function dropEdge(noteId: string) {
    if (!draggingId || dropTargetId !== noteId || !reorderEnabled) return null;
    return dropEdgeFor(notes, draggingId, noteId);
  }

  function openCollapsedSearch() {
    if (!onToggleCollapsed) return;
    onToggleCollapsed();
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => searchInputRef.current?.focus());
    });
  }

  async function submitFolderEdit() {
    if (!folderEdit || folderEditSaving) return;
    setFolderEditSaving(true);
    setFolderEditError(null);
    const edit = folderEdit;
    const editError = edit.mode === "create"
      ? await onCreateFolder(edit.value)
      : await onRenameFolder(edit.id, edit.value);
    setFolderEditSaving(false);
    if (editError) {
      setFolderEditError(editError);
      return;
    }
    setFolderEdit(null);
  }

  function startFolderCreate() {
    if (collapsed && onToggleCollapsed) onToggleCollapsed();
    setFolderEditError(null);
    setFolderEdit({ mode: "create", value: "" });
  }

  function sectionLabel(label: string) {
    return (
      <div className="mb-2 flex h-8 items-center px-2">
        {collapsed ? (
          <div className="h-[3px] w-full rounded-full bg-foreground/35" aria-hidden="true" />
        ) : (
          <span className="text-[11px] font-bold uppercase tracking-[0.15em] text-foreground/60 dark:text-foreground/70">{label}</span>
        )}
      </div>
    );
  }

  function builtInFolderRow({ label, count, folderId, icon: Icon, acceptsDrop }: {
    label: string;
    count: number;
    folderId: string | null | undefined;
    icon: typeof Folder;
    acceptsDrop: boolean;
  }) {
    const active = selectedFolderId === folderId;
    const key = folderId === undefined ? "all" : "unfiled";
    const dropProps = acceptsDrop ? folderDropProps(key, folderId as string | null) : {};
    return (
      <div
        key={key}
        {...dropProps}
        className={cn(
          "rounded-2xl transition",
          dropFolderKey === key && "bg-[var(--notes-accent)]/18 ring-2 ring-inset ring-[var(--notes-accent)]",
        )}
      >
        <button
          type="button"
          className={cn(
            collapsed
              ? "notes-icon-button !size-8 rounded-2xl"
              : "flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-sm font-semibold transition hover:bg-muted/70",
            active && "bg-[var(--notes-accent)] text-[var(--notes-accent-text)] shadow-sm ring-1 ring-border/70",
          )}
          onClick={() => selectFolder(folderId)}
          aria-current={active ? "true" : undefined}
          aria-expanded={folderId === undefined || collapsed || filtering ? undefined : folderExpanded(folderId)}
          aria-controls={folderId === undefined ? undefined : `${contentsId}-unfiled`}
          aria-label={label}
          title={collapsed ? label : undefined}
        >
          {!collapsed && folderId !== undefined && (folderExpanded(folderId) ? <ChevronDown className="size-3.5 shrink-0" aria-hidden /> : <ChevronRight className="size-3.5 shrink-0" aria-hidden />)}
          <Icon className="size-4.5 shrink-0" />
          {!collapsed && <><span className="min-w-0 flex-1 truncate">{label}</span><span className={cn("text-xs tabular-nums", active ? "text-current/75" : "text-muted-foreground")}>{count}</span></>}
        </button>
        {folderId !== undefined && folderContents(folderId, label)}
      </div>
    );
  }

  function customFolderRow(folder: FolderItem) {
    const active = selectedFolderId === folder.id;
    const editing = folderEdit?.mode === "rename" && folderEdit.id === folder.id;
    if (editing && !collapsed) {
      return (
        <form key={folder.id} className="rounded-2xl bg-muted/60 p-2 ring-1 ring-border/70" onSubmit={(event) => { event.preventDefault(); void submitFolderEdit(); }}>
          <div className="flex items-center gap-1.5">
            <Folder className="ml-1 size-4 shrink-0 text-muted-foreground" />
            <input
              ref={folderInputRef}
              value={folderEdit.value}
              maxLength={80}
              onChange={(event) => setFolderEdit({ ...folderEdit, value: event.target.value })}
              onKeyDown={(event) => { if (event.key === "Escape") { setFolderEdit(null); setFolderEditError(null); } }}
              className="min-w-0 flex-1 rounded-lg bg-background px-2 py-1.5 text-sm outline-none ring-1 ring-border focus:ring-[var(--notes-accent)]"
              aria-label="Folder name"
              disabled={folderEditSaving}
            />
            <button className="notes-mini-button" type="submit" aria-label="Save folder name" disabled={folderEditSaving}><Check className="size-3.5" /></button>
            <button className="notes-mini-button" type="button" aria-label="Cancel rename" onClick={() => { setFolderEdit(null); setFolderEditError(null); }}><X className="size-3.5" /></button>
          </div>
          {folderEditError && <p className="mt-1.5 px-1 text-xs text-red-700 dark:text-red-200" role="alert">{folderEditError}</p>}
        </form>
      );
    }

    return (
      <div
        key={folder.id}
        {...folderDropProps(folder.id, folder.id)}
        className={cn(
          "flex items-center rounded-2xl transition",
          collapsed && "justify-center",
          !active && "hover:bg-muted/70",
          dropFolderKey === folder.id && "bg-[var(--notes-accent)]/18 ring-2 ring-inset ring-[var(--notes-accent)]",
          active && !collapsed && "bg-[var(--notes-accent)] text-[var(--notes-accent-text)] shadow-sm ring-1 ring-border/70",
        )}
      >
        <button
          type="button"
          className={cn(
            collapsed ? "notes-icon-button !size-8 rounded-2xl" : "flex min-w-0 flex-1 items-center gap-3 rounded-2xl py-2.5 pl-3 pr-1 text-left text-sm font-semibold transition",
            active && collapsed && "!bg-[var(--notes-accent)] !text-[var(--notes-accent-text)] shadow-sm ring-1 ring-border/70",
          )}
          onClick={() => selectFolder(folder.id)}
          aria-current={active ? "true" : undefined}
          aria-expanded={collapsed || filtering ? undefined : folderExpanded(folder.id)}
          aria-controls={`${contentsId}-${folder.id}`}
          aria-label={folder.name}
          title={collapsed ? folder.name : undefined}
        >
          {!collapsed && (folderExpanded(folder.id) ? <ChevronDown className="size-3.5 shrink-0" aria-hidden /> : <ChevronRight className="size-3.5 shrink-0" aria-hidden />)}
          {active ? <FolderOpen className="size-4.5 shrink-0" /> : <Folder className="size-4.5 shrink-0" />}
          {!collapsed && <span className="min-w-0 flex-1 truncate">{folder.name}</span>}
        </button>
        {!collapsed && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className={cn("notes-mini-button shrink-0", active && "text-current hover:bg-white/15")} aria-label={`${folder.name} options`}>
                <MoreHorizontal className="size-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => { setFolderEditError(null); setFolderEdit({ mode: "rename", id: folder.id, value: folder.name }); }}>
                <Pencil className="size-4" /> Rename
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onSelect={() => onDeleteFolderRequest(folder)}>
                <Trash2 className="size-4" /> Delete folder
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {!collapsed && <span className={cn("w-8 shrink-0 pr-3 text-right text-xs tabular-nums", active ? "text-current/75" : "text-muted-foreground")}>{folder.noteCount}</span>}
      </div>
    );
  }

  function renderNotes(nested = false) {
    return (
        <div className={nested ? "pb-1" : "py-1"}>
          {loading ? <div className="min-h-[72px]" aria-busy="true">{showLoading && <p className="px-3 py-2 text-xs text-muted-foreground" role="status">Loading notes…</p>}</div> : visibleNotes.length === 0 ? (
            <div className={cn(collapsed ? "sr-only" : "m-2 rounded-2xl border border-dashed border-border p-5 text-center text-sm text-muted-foreground")}>
              {filtering ? <><p>No notes match &quot;{query.trim()}&quot;.</p><button type="button" className="notes-secondary-button mt-3" onClick={() => onQueryChange("")}>Clear search</button></> : <p>No notes here yet.</p>}
            </div>
          ) : (
            <div className={cn(collapsed ? "flex flex-col items-center gap-1" : nested ? "notes-folder-list" : "space-y-1")} role="list" aria-label="Notes">
              {visibleNotes.map((note) => {
                const active = note.id === selectedId;
                const edge = dropEdge(note.id);
                const excerpt = filtering && note.folderName ? `${note.folderName} · ${noteExcerpt(note)}` : noteExcerpt(note);
                return (
                  <article key={note.id} role="listitem" {...noteDragProps(note)} className={cn("notes-list-item", nested ? "notes-folder-child" : "rounded-2xl", draggingId === note.id && "opacity-45", edge === "before" && "notes-drop-before", edge === "after" && "notes-drop-after")}>
                    {nested && <span className="notes-folder-connector" aria-hidden="true">
                      <svg viewBox="0 0 16 8" fill="none" focusable="false">
                        <path d="M0.5 0 V2 A6 6 0 0 0 6.5 8 H16" stroke="currentColor" strokeWidth="1" />
                      </svg>
                    </span>}
                    {collapsed ? (
                      <button type="button" onClick={() => onSelect(note.id)} onKeyDown={(event) => noteKeyDown(event, note.id)} className={cn("notes-icon-button !size-8 rounded-2xl", active ? "!bg-[var(--notes-accent)] !text-[var(--notes-accent-text)] shadow-sm ring-1 ring-border/70" : "!bg-transparent")} aria-label={displayTitle(note)} aria-current={active ? "true" : undefined} title={displayTitle(note)}><FileText className="size-4.5" /></button>
                    ) : (
                      <div className={cn("flex w-full items-stretch gap-1 rounded-2xl transition", nested && "ring-1 ring-inset ring-border/70", active ? "bg-[var(--notes-accent)] text-[var(--notes-accent-text)] shadow-sm ring-1 ring-border/70" : "hover:bg-muted/70")}>
                        <button type="button" onClick={() => onSelect(note.id)} onKeyDown={(event) => noteKeyDown(event, note.id)} aria-current={active ? "true" : undefined} className="flex min-w-0 flex-1 items-start gap-3 rounded-2xl px-3 py-3 text-left outline-none">
                          <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{displayTitle(note)}</span><span className={cn("mt-1 block truncate text-xs leading-5", active ? "text-current/76" : "text-muted-foreground")}>{excerpt}</span></span>
                        </button>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}

          {!collapsed && (hasPrevious || hasNext || totalCount > visibleNotes.length) && (
            <div className="mt-3 flex items-center justify-between gap-2 border-t border-border/60 px-2 pt-3">
              <button type="button" className="notes-mini-button" onClick={onPreviousPage} disabled={!hasPrevious || loading} aria-label="Previous notes page"><ChevronLeft className="size-3.5" /></button>
              <span className="text-center text-[11px] text-muted-foreground">Page {pageIndex + 1} · {visibleNotes.length} of {totalCount}</span>
              <button type="button" className="notes-mini-button" onClick={onNextPage} disabled={!hasNext || loading} aria-label="Next notes page"><ChevronRight className="size-3.5" /></button>
            </div>
          )}
          {!collapsed && !reorderEnabled && selectedFolderId === undefined && !filtering && totalCount > 1 && <p className="mt-2 px-2 text-[11px] leading-4 text-muted-foreground">Reordering is available when all notes fit on one page.</p>}
        </div>
    );
  }

  return (
    <div className={cn("notes-panel flex min-h-0 w-full flex-col overflow-hidden", !glass && "notes-panel-solid")}>
      <div className="relative flex min-h-[54px] w-full shrink-0 items-start justify-center px-4 pt-4 pb-2">
        {collapsed ? <span className="flex size-[30px] items-center justify-center text-xl leading-none" aria-hidden="true">📝</span> : <h1 className="flex h-[30px] items-center whitespace-nowrap text-[19px] font-bold text-foreground max-md:text-[22px]">OpenOutline</h1>}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2">
        <div className="p-2 pb-3">
          {collapsed ? (
            <div className="flex justify-center">
              <button type="button" className="notes-icon-button !size-8 rounded-2xl !bg-transparent" onClick={openCollapsedSearch} aria-label="Search notes" title="Search notes"><Search className="size-4.5" /></button>
            </div>
          ) : (
            <div className="notes-search flex items-center gap-2">
              <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <label className="sr-only" htmlFor={searchInputId}>Search notes</label>
              <input ref={searchInputRef} id={searchInputId} type="search" value={query} onChange={(event) => onQueryChange(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape" && query) { event.preventDefault(); event.stopPropagation(); onQueryChange(""); } }} placeholder="Search notes" className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
              {filtering && <button type="button" className="notes-mini-button shrink-0" onClick={() => onQueryChange("")} aria-label="Clear search" title="Clear search"><X className="size-3.5" /></button>}
            </div>
          )}
          <div className={cn("mt-3", collapsed ? "flex flex-col items-center gap-2" : "flex gap-2")}>
            <button
              type="button"
              className={cn(
                collapsed
                  ? "notes-icon-button !size-9 rounded-2xl !bg-transparent ring-1 ring-inset ring-border shadow-sm"
                  : "flex h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-2xl bg-transparent px-4 text-sm font-semibold outline-none ring-1 ring-inset ring-border shadow-sm transition hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-[var(--notes-accent)]",
              )}
              onClick={onCreate}
              aria-label="New note"
              title={collapsed ? "New note" : undefined}
            >
              <Plus className="size-4.5" />
              {!collapsed && <span>New note</span>}
            </button>
            <button
              type="button"
              className={cn(
                collapsed
                  ? "notes-icon-button !size-8 rounded-2xl !bg-transparent ring-1 ring-inset ring-border shadow-sm"
                  : "flex size-11 shrink-0 items-center justify-center rounded-2xl bg-transparent text-foreground outline-none ring-1 ring-inset ring-border shadow-sm transition hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-[var(--notes-accent)]",
              )}
              onClick={startFolderCreate}
              aria-label="New folder"
              title="New folder"
            >
              <FolderPlus className="size-4.5" />
            </button>
          </div>
          {!collapsed && folderEdit?.mode === "create" && (
            <form className="mt-2 rounded-2xl bg-muted/60 p-2 ring-1 ring-border" onSubmit={(event) => { event.preventDefault(); void submitFolderEdit(); }}>
              <div className="flex items-center gap-1.5">
                <FolderPlus className="ml-1 size-4 shrink-0 text-muted-foreground" />
                <input ref={folderInputRef} value={folderEdit.value} maxLength={80} onChange={(event) => setFolderEdit({ mode: "create", value: event.target.value })} onKeyDown={(event) => { if (event.key === "Escape") { setFolderEdit(null); setFolderEditError(null); } }} placeholder="Folder name" className="min-w-0 flex-1 rounded-lg bg-background px-2 py-1.5 text-sm outline-none ring-1 ring-border focus:ring-[var(--notes-accent)]" aria-label="New folder name" disabled={folderEditSaving} />
                <button className="notes-mini-button" type="submit" aria-label="Create folder" disabled={folderEditSaving}><Check className="size-3.5" /></button>
                <button className="notes-mini-button" type="button" aria-label="Cancel new folder" onClick={() => { setFolderEdit(null); setFolderEditError(null); }}><X className="size-3.5" /></button>
              </div>
              {folderEditError && <p className="mt-1.5 px-1 text-xs text-red-700 dark:text-red-200" role="alert">{folderEditError}</p>}
            </form>
          )}
          {!collapsed && filtering && <p className="mt-2 text-xs text-muted-foreground" role="status" aria-live="polite">{totalCount} {totalCount === 1 ? "match" : "matches"} across all notes</p>}
          {!collapsed && error && <p className="mt-2 text-xs text-red-700 dark:text-red-200" role="alert">{error}</p>}
        </div>

        <div className="p-2 pt-1">
          {sectionLabel("Folders")}
          <div className={cn(collapsed ? "flex flex-col items-center gap-1" : "space-y-1")}>
            {folders.length > 0 && builtInFolderRow({ label: "All Notes", count: allNotesCount, folderId: undefined, icon: FileText, acceptsDrop: false })}
            {unfiledCount > 0 && builtInFolderRow({ label: "Unsorted Notes", count: unfiledCount, folderId: null, icon: Files, acceptsDrop: true })}
            {folders.map((folder) => <div key={folder.id}>{customFolderRow(folder)}{folderContents(folder.id, folder.name)}</div>)}
          </div>
        </div>

        {(filtering || selectedFolderId === undefined || collapsed) && (
          <div className="p-2 pt-4">
            {sectionLabel(filtering ? "Search results" : "All Notes")}
            {renderNotes()}
          </div>
        )}
      </div>

      <div className={cn("flex shrink-0 flex-col gap-2 px-4 pb-4", collapsed && "items-center")}>
        {onToggleCollapsed && <button type="button" className={cn(collapsed ? "notes-icon-button !size-8 rounded-2xl !bg-transparent" : "notes-sidebar-button hidden md:flex")} onClick={onToggleCollapsed} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} title={collapsed ? "Expand sidebar" : "Collapse sidebar"}>{collapsed ? <PanelLeftOpen className="size-4.5" /> : <PanelLeftClose className="size-4.5" />}{!collapsed && <span>Collapse Sidebar</span>}</button>}
        <button type="button" className={cn(collapsed ? "notes-icon-button !size-8 rounded-2xl !bg-transparent" : "notes-sidebar-button")} onClick={onOpenSettings} aria-label="Settings" title={collapsed ? "Settings" : undefined}><Settings className="size-4.5" />{!collapsed && <span>Settings</span>}</button>
      </div>
    </div>
  );
}
