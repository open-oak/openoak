"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useTransition } from "react";
import {
  createFolder,
  createNote,
  deleteFolder,
  deleteNote,
  getNote,
  loadNotesPage,
  moveNoteToFolder,
  renameFolder,
  reorderNotes,
  updateNote,
  updateSettings,
} from "@/app/actions";
import { useVisualViewport } from "@/hooks/use-visual-viewport";
import {
  excerptFromNoteBody,
  mergeServerNote,
  moveNoteAmongVisible,
  moveNoteToTarget,
  sortNotes,
  type SavePatch,
  type SaveState,
} from "@/lib/notes-view";
import { cn } from "@/lib/utils";
import { folderMoveRemainsVisible } from "@/lib/folder-view";
import { folderNameKey } from "@/lib/folder-validation";
import type { FolderItem, NoteItem, NotesPage, NotesSettings } from "@/lib/types";
import { NotesPageCache, notesPageKey } from "@/lib/notes-page-cache";
import { Background } from "./notes/background";
import { ConfirmDeleteDialog } from "./notes/confirm-delete-dialog";
import { ConfirmDeleteFolderDialog } from "./notes/confirm-delete-folder-dialog";
import { COLOR_MODE_STORAGE_KEY, SIDEBAR_STORAGE_KEY, getWallpaperImage } from "./notes/constants";
import { AppearancePicker } from "./notes/appearance-picker";
import { DesktopNoteActions } from "./notes/desktop-note-actions";
import { Editor } from "./notes/editor";
import { MobileOverlay } from "./notes/mobile-overlay";
import { MobileTopBar } from "./notes/mobile-top-bar";
import { NotesSidebar } from "./notes/notes-sidebar";
import { SettingsMenu } from "./notes/settings-menu";
import { useNoteSaving } from "./notes/use-note-saving";

export function NotesApp({
  name,
  email,
  initialNotes,
  initialSelectedNote,
  initialTotalCount,
  initialNextCursor,
  pageSize,
  initialSettings,
  initialFolders,
  initialUnfiledCount,
  accountUrl,
  initialSelectedId,
}: {
  name: string | null;
  email: string | null;
  initialNotes: NoteItem[];
  initialSelectedNote: NoteItem | null;
  initialTotalCount: number;
  initialNextCursor: string | null;
  pageSize: number;
  initialSettings: NotesSettings;
  initialFolders: FolderItem[];
  initialUnfiledCount: number;
  accountUrl: string;
  initialSelectedId?: string;
}) {
  useVisualViewport();
  const [, startTransition] = useTransition();
  const [notes, setNotes] = useState(() => sortNotes(initialNotes));
  const [folders, setFolders] = useState(initialFolders);
  const [unfiledCount, setUnfiledCount] = useState(initialUnfiledCount);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null | undefined>(
    initialSelectedNote?.folderId ?? null,
  );
  const [activeNote, setActiveNote] = useState(initialSelectedNote);
  const [totalCount, setTotalCount] = useState(initialTotalCount);
  const [allNotesCount, setAllNotesCount] = useState(() => initialUnfiledCount + initialFolders.reduce((count, folder) => count + folder.noteCount, 0));
  const [nextCursor, setNextCursor] = useState(initialNextCursor);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageCursors, setPageCursors] = useState<Array<string | undefined>>([undefined]);
  const [listLoading, setListLoading] = useState(false);
  const [pageCache] = useState(() => {
    const cache = new NotesPageCache();
    cache.write(notesPageKey(undefined, "", initialSelectedNote?.folderId ?? null), {
      items: initialNotes, totalCount: initialTotalCount, nextCursor: initialNextCursor,
      folders: initialFolders, unfiledCount: initialUnfiledCount,
      allNotesCount: initialUnfiledCount + initialFolders.reduce((count, folder) => count + folder.noteCount, 0),
    });
    return cache;
  });
  const [noteErrorId, setNoteErrorId] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [settings, setSettings] = useState(initialSettings);
  const [selectedId, setSelectedId] = useState(
    initialSelectedId ?? initialSelectedNote?.id ?? initialNotes[0]?.id ?? null,
  );
  const [query, setQuery] = useState("");
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [appearanceAnchor, setAppearanceAnchor] = useState<{ top: number; right: number } | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [message, setMessage] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<NoteItem | null>(null);
  const [folderDeleteTarget, setFolderDeleteTarget] = useState<FolderItem | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [autoFocusTitleFor, setAutoFocusTitleFor] = useState<string | null>(null);
  const [desktopActionsInside, setDesktopActionsInside] = useState(false);

  const notesRef = useRef(notes);
  const foldersRef = useRef(folders);
  const selectedFolderIdRef = useRef<string | null | undefined>(selectedFolderId);
  const activeNoteRef = useRef(activeNote);
  const pageRequestRef = useRef(0);
  const noteRequestRef = useRef(0);
  const searchReadyRef = useRef(false);
  const settingsSaveVersionRef = useRef(0);
  const sidebarStorageReadyRef = useRef(false);
  const createInFlightRef = useRef(false);
  const overlayReturnFocusRef = useRef<HTMLElement | null>(null);
  const mainShellRef = useRef<HTMLDivElement>(null);
  const editorPanelRef = useRef<HTMLElement>(null);
  const floatingActionsRef = useRef<HTMLDivElement>(null);
  // Kept so a failed save can be retried instead of silently losing the text.
  const failedSaveRef = useRef<{ id: string; patch: SavePatch } | null>(null);

  useEffect(() => {
    notesRef.current = notes;
  }, [notes]);

  useEffect(() => {
    foldersRef.current = folders;
  }, [folders]);

  useEffect(() => {
    selectedFolderIdRef.current = selectedFolderId;
  }, [selectedFolderId]);

  useEffect(() => {
    activeNoteRef.current = activeNote;
  }, [activeNote]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = settings.colorMode === "dark" || (settings.colorMode === "auto" && media.matches);
      document.documentElement.classList.toggle("dark", dark);
      document.documentElement.classList.toggle("light", !dark);
    };
    apply();
    // The pre-paint script in the root layout reads this on the next load.
    try {
      window.localStorage.setItem(COLOR_MODE_STORAGE_KEY, settings.colorMode);
    } catch {
      // Storage can be unavailable; the server setting still applies after hydration.
    }
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [settings.colorMode]);

  useEffect(() => {
    const currentTheme = settings.wallpaper === "none" && settings.accentColor !== "default"
      ? settings.accentColor
      : null;
    if (currentTheme) document.documentElement.setAttribute("data-current-theme", currentTheme);
    else document.documentElement.removeAttribute("data-current-theme");
    return () => document.documentElement.removeAttribute("data-current-theme");
  }, [settings.accentColor, settings.wallpaper]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const stored = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);
      sidebarStorageReadyRef.current = true;
      setSidebarCollapsed(stored === "true");
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!sidebarStorageReadyRef.current) return;
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(sidebarCollapsed));
  }, [sidebarCollapsed]);

  useLayoutEffect(() => {
    const shell = mainShellRef.current;
    const panel = editorPanelRef.current;
    const floating = floatingActionsRef.current;
    if (!panel || !floating) return;

    let frame = 0;
    const measure = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        if (!window.matchMedia("(min-width: 768px)").matches) {
          setDesktopActionsInside(false);
          return;
        }
        const panelRect = panel.getBoundingClientRect();
        const floatingRect = floating.getBoundingClientRect();
        const shouldMoveInside = floatingRect.left < panelRect.right + 8;
        setDesktopActionsInside((current) => current === shouldMoveInside ? current : shouldMoveInside);
      });
    };

    const observer = new ResizeObserver(measure);
    observer.observe(panel);
    observer.observe(floating);
    shell?.addEventListener("transitionend", measure);
    window.addEventListener("resize", measure);
    measure();

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      shell?.removeEventListener("transitionend", measure);
      window.removeEventListener("resize", measure);
    };
  }, []);

  const selectedFolderIsEmpty = folders.some((folder) => folder.id === selectedFolderId && folder.noteCount === 0);
  const selectedNote = selectedFolderIsEmpty
    ? null
    : activeNote?.id === selectedId ? activeNote : null;
  const noteLoading = !selectedFolderIsEmpty && Boolean(
    selectedId && activeNote?.id !== selectedId && noteErrorId !== selectedId,
  );
  const visibleNotesRef = useRef(notes);

  useEffect(() => {
    visibleNotesRef.current = notes;
  }, [notes]);

  const wallpaperImage = getWallpaperImage(settings.wallpaper, settings.wallpaperBlur);

  const rememberOverlayTrigger = useCallback(() => {
    if (document.activeElement instanceof HTMLElement) overlayReturnFocusRef.current = document.activeElement;
  }, []);

  const restoreOverlayTrigger = useCallback(() => {
    requestAnimationFrame(() => {
      const target = overlayReturnFocusRef.current;
      if (target?.isConnected) target.focus();
      else document.querySelector<HTMLElement>('[aria-label="Open OpenOutline navigation"]')?.focus();
    });
  }, []);

  const handleOpenAppearance = useCallback((anchor: { top: number; right: number } | null) => {
    rememberOverlayTrigger();
    setAppearanceAnchor(anchor);
    setAppearanceOpen(true);
  }, [rememberOverlayTrigger]);

  const setError = useCallback((error: string) => {
    setSaveState("error");
    setMessage(error);
  }, []);

  const fetchNotesPage = useCallback(
    async (
      cursor: string | undefined,
      index: number,
      search: string,
      folderId: string | null | undefined,
      resetHistory = false,
    ) => {
      const request = ++pageRequestRef.current;
      const key = notesPageKey(cursor, search, folderId);
      const applyPage = (data: NotesPage) => {
        setNotes(sortNotes(data.items));
        setTotalCount(data.totalCount);
        setAllNotesCount(data.allNotesCount);
        setUnfiledCount(data.unfiledCount);
        setFolders(data.folders);
        foldersRef.current = data.folders;
        setNextCursor(data.nextCursor);
        setPageIndex(index);
        setPageCursors((current) => {
          if (resetHistory) return [undefined];
          const next = current.slice(0, index + 1);
          next[index] = cursor;
          return next;
        });
      };
      const cached = pageCache.read(key);
      if (cached) {
        setListLoading(false);
        setPageError(null);
        applyPage(cached);
        return;
      }
      const version = pageCache.version;
      setListLoading(true);
      setPageError(null);
      let result;
      try {
        result = await loadNotesPage({
          cursor,
          query: search.trim() || undefined,
          folderId,
        });
      } catch (error) {
        console.error("loadNotesPage request failed:", error);
        if (request === pageRequestRef.current) {
          setListLoading(false);
          setPageError("Could not load notes. Check your connection and try again.");
        }
        return;
      }
      if (request !== pageRequestRef.current) return;

      setListLoading(false);
      if (!result.ok) {
        setPageError(result.error);
        return;
      }

      pageCache.write(key, result.data, version);
      applyPage(result.data);
    },
    [pageCache],
  );

  useEffect(() => {
    if (!searchReadyRef.current) {
      searchReadyRef.current = true;
      return;
    }
    const timeout = window.setTimeout(() => {
      void fetchNotesPage(undefined, 0, query, selectedFolderIdRef.current, true);
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [fetchNotesPage, query]);

  useEffect(() => {
    if (!selectedId) return;
    if (activeNote?.id === selectedId && activeNote.body !== null) return;

    const request = ++noteRequestRef.current;
    void getNote(selectedId)
      .then((result) => {
        if (request !== noteRequestRef.current) return;
        if (!result.ok) {
          setNoteErrorId(selectedId);
          setPageError(result.error);
          return;
        }
        setNoteErrorId(null);
        setActiveNote(result.data);
      })
      .catch((error) => {
        console.error("getNote request failed:", error);
        if (request === noteRequestRef.current) {
          setNoteErrorId(selectedId);
          setPageError("Could not load this note. Check your connection and try again.");
        }
      });
  }, [activeNote?.body, activeNote?.id, selectedId]);

  const handleSelectNote = useCallback((id: string) => {
    setNoteErrorId(null);
    setActiveNote((current) => (current?.id === id ? current : null));
    setSelectedId(id);
  }, []);

  const showNextPage = useCallback(() => {
    if (!nextCursor || listLoading) return;
    void fetchNotesPage(nextCursor, pageIndex + 1, query, selectedFolderId);
  }, [fetchNotesPage, listLoading, nextCursor, pageIndex, query, selectedFolderId]);

  const showPreviousPage = useCallback(() => {
    if (pageIndex === 0 || listLoading) return;
    const previousIndex = pageIndex - 1;
    void fetchNotesPage(pageCursors[previousIndex], previousIndex, query, selectedFolderId);
  }, [fetchNotesPage, listLoading, pageCursors, pageIndex, query, selectedFolderId]);

  const persistNotePatch = useCallback(
    async (id: string, patch: SavePatch) => {
      setSaveState("saving");
      const result = await pageCache.mutate(() => updateNote({ id, ...patch }));
      if (!result.ok) {
        failedSaveRef.current = { id, patch };
        setError(result.error);
        return;
      }

      failedSaveRef.current = null;

      setActiveNote((current) =>
        current?.id === id ? mergeServerNote(current, result.data, patch) : current,
      );
      setNotes((current) =>
        current.map((note) =>
          note.id === id
            ? {
                ...note,
                title: result.data.title,
                excerpt: result.data.excerpt,
                color: result.data.color,
                sortOrder: result.data.sortOrder,
                updatedAt: result.data.updatedAt,
              }
            : note,
        ),
      );
      setSaveState("saved");
      setMessage(null);
    },
    [pageCache, setError]
  );

  const { queuePatch, flushNote, cancelNote } = useNoteSaving({ save: persistNotePatch });

  const retryFailedSave = useCallback(() => {
    const failed = failedSaveRef.current;
    if (!failed) {
      setSaveState("saved");
      setMessage(null);
      return;
    }
    // The note may have been deleted since the failure.
    if (
      activeNoteRef.current?.id !== failed.id &&
      !notesRef.current.some((note) => note.id === failed.id)
    ) {
      failedSaveRef.current = null;
      setSaveState("saved");
      setMessage(null);
      return;
    }
    startTransition(() => {
      void persistNotePatch(failed.id, failed.patch);
    });
  }, [persistNotePatch, startTransition]);

  const queueNoteSave = useCallback(
    (id: string, patch: SavePatch) => {
      setSaveState("saving");
      queuePatch(id, patch);
    },
    [queuePatch]
  );

  const patchNote = useCallback(
    (id: string, patch: SavePatch) => {
      pageCache.invalidate();
      setActiveNote((current) =>
        current?.id === id
          ? {
              ...current,
              ...patch,
              ...(patch.body !== undefined ? { excerpt: excerptFromNoteBody(patch.body) } : {}),
              updatedAt: new Date().toISOString(),
            }
          : current,
      );
      setNotes((current) =>
        current.map((note) =>
          note.id === id
            ? {
                ...note,
                ...(patch.title !== undefined ? { title: patch.title } : {}),
                ...(patch.body !== undefined ? { excerpt: excerptFromNoteBody(patch.body) } : {}),
                ...(patch.color !== undefined ? { color: patch.color } : {}),
                updatedAt: new Date().toISOString(),
              }
            : note
        )
      );
      queueNoteSave(id, patch);
    },
    [pageCache, queueNoteSave]
  );

  const persistOrder = useCallback(
    (ordered: NoteItem[]) => {
      setSaveState("saving");
      const ids = ordered.map((note) => note.id);
      startTransition(async () => {
        const result = await pageCache.mutate(() => reorderNotes(ids));
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setNotes(result.data);
        const activeSummary = result.data.find(
          (note) => note.id === activeNoteRef.current?.id,
        );
        if (activeSummary) {
          setActiveNote((current) =>
            current
              ? {
                  ...current,
                  sortOrder: activeSummary.sortOrder,
                  updatedAt: activeSummary.updatedAt,
                }
              : current,
          );
        }
        setSaveState("saved");
        setMessage(null);
      });
    },
    [pageCache, setError, startTransition]
  );

  const adjustFolderCount = useCallback((folderId: string | null, delta: number) => {
    if (folderId === null) {
      setUnfiledCount((current) => Math.max(0, current + delta));
      return;
    }
    setFolders((current) => current.map((folder) =>
      folder.id === folderId
        ? { ...folder, noteCount: Math.max(0, folder.noteCount + delta) }
        : folder,
    ));
  }, []);

  const handleSelectFolder = useCallback((folderId: string | null | undefined) => {
    setSelectedFolderId(folderId);
    selectedFolderIdRef.current = folderId;
    if (query.trim()) {
      setQuery("");
      return;
    }
    void fetchNotesPage(undefined, 0, "", folderId, true);
  }, [fetchNotesPage, query]);

  const handleCreateFolder = useCallback(async (name: string) => {
    const result = await pageCache.mutate(() => createFolder(name));
    if (!result.ok) return result.error;
    setFolders((current) => [...current, result.data]
      .sort((a, b) => folderNameKey(a.name).localeCompare(folderNameKey(b.name))));
    handleSelectFolder(result.data.id);
    return null;
  }, [handleSelectFolder, pageCache]);

  const handleRenameFolder = useCallback(async (id: string, name: string) => {
    const result = await pageCache.mutate(() => renameFolder({ id, name }));
    if (!result.ok) return result.error;
    setFolders((current) => current
      .map((folder) => folder.id === id ? result.data : folder)
      .sort((a, b) => folderNameKey(a.name).localeCompare(folderNameKey(b.name))));
    setNotes((current) => current.map((note) => note.folderId === id ? { ...note, folderName: result.data.name } : note));
    setActiveNote((current) => current?.folderId === id ? { ...current, folderName: result.data.name } : current);
    return null;
  }, [pageCache]);

  const handleCreateNote = useCallback(() => {
    if (createInFlightRef.current) return;
    createInFlightRef.current = true;
    setSaveState("saving");
    setMessage(null);

    void (async () => {
      try {
        const folderId = typeof selectedFolderId === "string" ? selectedFolderId : null;
        const result = await pageCache.mutate(() => createNote({ title: "Untitled note", color: settings.accentColor, folderId }));
        if (!result.ok) {
          setError(result.error);
          return;
        }

        setNotes((current) => {
          const summary = { ...result.data, body: null };
          const next =
            query.trim() === "" && current.length < pageSize
              ? sortNotes([...current, summary])
              : current;
          notesRef.current = next;
          return next;
        });
        if (query.trim() === "") setTotalCount((current) => current + 1);
        setAllNotesCount((current) => current + 1);
        adjustFolderCount(result.data.folderId, 1);
        setActiveNote(result.data);
        setSelectedId(result.data.id);
        setAutoFocusTitleFor(result.data.id);
        setSaveState("saved");
      } catch (error) {
        console.error("createNote request failed:", error);
        setError("Could not create note. Check your connection and try again.");
      } finally {
        createInFlightRef.current = false;
      }
    })();
  }, [adjustFolderCount, pageCache, pageSize, query, selectedFolderId, setError, settings.accentColor]);

  const handleDelete = useCallback(
    (note: NoteItem) => {
      // Include the latest local text in the recovery snapshot before canceling
      // its save timer. Other notes keep their queued edits.
      const latest = activeNoteRef.current?.id === note.id ? activeNoteRef.current : note;
      const draft = typeof latest.body === "string" ? { title: latest.title, body: latest.body } : undefined;
      cancelNote(note.id);
      const previous = notesRef.current;
      const next = previous.filter((item) => item.id !== note.id);
      setDeleteTarget(null);
      setNotes(next);
      setActiveNote(null);
      setSelectedId(next[0]?.id ?? null);
      setTotalCount((current) => Math.max(0, current - 1));
      setAllNotesCount((current) => Math.max(0, current - 1));
      adjustFolderCount(note.folderId, -1);
      setSaveState("saving");

      startTransition(async () => {
        const result = await pageCache.mutate(() => deleteNote(note.id, draft));
        if (!result.ok) {
          setNotes(previous);
          setActiveNote(note);
          setSelectedId(note.id);
          setTotalCount((current) => current + 1);
          setAllNotesCount((current) => current + 1);
          adjustFolderCount(note.folderId, 1);
          setError(result.error);
          return;
        }
        setSaveState("saved");
        setMessage(null);
        void fetchNotesPage(pageCursors[pageIndex], pageIndex, query, selectedFolderId);
      });
    },
    [
      cancelNote,
      pageCache,
      adjustFolderCount,
      fetchNotesPage,
      pageCursors,
      pageIndex,
      query,
      selectedFolderId,
      setError,
      startTransition,
    ]
  );

  const moveNote = useCallback(
    (id: string, direction: -1 | 1) => {
      const current = notesRef.current;
      // Move past the neighbour the user can actually see: with a search
      // filter active the sidebar shows a subset of the notes.
      const ordered = moveNoteAmongVisible(current, visibleNotesRef.current, id, direction);
      if (ordered === current) return;
      setNotes(ordered);
      persistOrder(ordered);
    },
    [persistOrder]
  );

  const handleDropOnNote = useCallback(
    (targetId: string) => {
      if (!draggingId) return;
      const current = notesRef.current;
      const ordered = moveNoteToTarget(current, draggingId, targetId);
      setDraggingId(null);
      if (ordered === current) return;
      setNotes(ordered);
      persistOrder(ordered);
    },
    [draggingId, persistOrder]
  );

  const handleMoveNoteToFolder = useCallback(async (noteId: string, folderId: string | null) => {
    const local = activeNoteRef.current?.id === noteId
      ? activeNoteRef.current
      : notesRef.current.find((note) => note.id === noteId);
    if (!local || local.folderId === folderId) {
      setDraggingId(null);
      return;
    }

    const previousNotes = notesRef.current;
    const previousTotal = totalCount;
    const folderName = folderId ? foldersRef.current.find((folder) => folder.id === folderId)?.name ?? null : null;
    const moved = { ...local, folderId, folderName };
    const remainsVisible = folderMoveRemainsVisible(query, selectedFolderId, folderId);

    // Keep folder counts stable until the move succeeds, so moving the last
    // note does not unmount its editor while text is still being typed.
    setNotes((current) => {
      if (!remainsVisible) return current.filter((note) => note.id !== noteId);
      if (current.some((note) => note.id === noteId)) {
        return current.map((note) => note.id === noteId ? { ...note, folderId, folderName } : note);
      }
      return query.trim() === "" && current.length < pageSize
        ? sortNotes([...current, { ...moved, body: null }])
        : current;
    });
    if (!remainsVisible) setTotalCount((current) => Math.max(0, current - 1));
    setActiveNote((current) => current?.id === noteId ? { ...current, folderId, folderName } : current);
    setDraggingId(null);
    setSaveState("saving");

    try {
      const result = await pageCache.mutate(() => moveNoteToFolder({ noteId, folderId }));
      if (!result.ok) {
        setNotes(previousNotes);
        setActiveNote((current) => current?.id === noteId ? { ...current, folderId: local.folderId, folderName: local.folderName } : current);
        setTotalCount(previousTotal);
        setError(result.error);
        return;
      }
      setNotes((current) => current.map((note) => note.id === noteId
        ? { ...note, folderId: result.data.folderId, folderName: result.data.folderName, updatedAt: result.data.updatedAt }
        : note));
      // The request only changed location. Never restore the captured title/body
      // over edits made while awaiting its response.
      setActiveNote((current) => current?.id === noteId ? { ...current, folderId: result.data.folderId, folderName: result.data.folderName, updatedAt: result.data.updatedAt } : current);
      adjustFolderCount(local.folderId, -1);
      adjustFolderCount(folderId, 1);
      setSaveState("saved");
      setMessage(null);
      if (!remainsVisible) {
        if (activeNoteRef.current?.id === noteId && selectedFolderIdRef.current === selectedFolderId) handleSelectFolder(folderId);
        else void fetchNotesPage(pageCursors[pageIndex], pageIndex, query, selectedFolderIdRef.current);
      }
    } catch (error) {
      console.error("moveNoteToFolder request failed:", error);
      setNotes(previousNotes);
      setActiveNote((current) => current?.id === noteId ? { ...current, folderId: local.folderId, folderName: local.folderName } : current);
      setTotalCount(previousTotal);
      setError("Could not move note. Check your connection and try again.");
    }
  }, [adjustFolderCount, fetchNotesPage, handleSelectFolder, pageCache, pageCursors, pageIndex, pageSize, query, selectedFolderId, setError, totalCount]);

  const handleDropOnFolder = useCallback((folderId: string | null) => {
    if (!draggingId) return;
    void handleMoveNoteToFolder(draggingId, folderId);
  }, [draggingId, handleMoveNoteToFolder]);

  const handleDeleteFolder = useCallback((folder: FolderItem) => {
    setFolderDeleteTarget(null);
    setSaveState("saving");
    startTransition(async () => {
      const result = await pageCache.mutate(() => deleteFolder(folder.id));
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setFolders((current) => current.filter((item) => item.id !== folder.id));
      setUnfiledCount((current) => current + result.data.movedNoteCount);
      setNotes((current) => current.map((note) => note.folderId === folder.id
        ? { ...note, folderId: null, folderName: null }
        : note));
      setActiveNote((current) => current?.folderId === folder.id
        ? { ...current, folderId: null, folderName: null }
        : current);
      if (selectedFolderId === folder.id || (selectedFolderId === undefined && foldersRef.current.length === 1)) {
        handleSelectFolder(null);
      }
      setSaveState("saved");
      setMessage(null);
    });
  }, [handleSelectFolder, pageCache, selectedFolderId, setError, startTransition]);

  const patchSettings = useCallback(
    (patch: Partial<NotesSettings>) => {
      const version = ++settingsSaveVersionRef.current;
      setSettings((current) => ({ ...current, ...patch }));
      setSaveState("saving");
      startTransition(async () => {
        const result = await updateSettings(patch);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        if (version === settingsSaveVersionRef.current) {
          setSettings((current) => ({ ...current, ...result.data, ...patch }));
          setSaveState("saved");
          setMessage(null);
        }
      });
    },
    [setError, startTransition]
  );

  const reorderEnabled =
    selectedFolderId === undefined && query.trim() === "" && pageIndex === 0 && totalCount === notes.length;
  const actionsInside = desktopActionsInside && Boolean(selectedNote);

  return (
    <main
      className={cn(
        "notes-root relative overflow-hidden text-foreground",
        !settings.glassEnabled && "notes-no-glass"
      )}
      data-accent={settings.accentColor}
    >
      <Background theme={settings.accentColor} wallpaperImage={wallpaperImage} />

      <div
        ref={mainShellRef}
        className={cn(
          "notes-main-shell relative z-10 grid h-full min-h-0 md:transition-[grid-template-columns] md:duration-[180ms] md:ease-[ease]",
          mobileSidebarOpen && "notes-mobile-sidebar-open",
          sidebarCollapsed
            ? "md:grid-cols-[74px_minmax(0,1fr)]"
            : "md:grid-cols-[304px_minmax(0,1fr)]"
        )}
      >
        <aside className="hidden min-h-0 md:flex">
          <NotesSidebar
            folders={folders}
            allNotesCount={allNotesCount}
            unfiledCount={unfiledCount}
            selectedFolderId={selectedFolderId}
            notes={notes}
            totalCount={totalCount}
            pageIndex={pageIndex}
            selectedId={selectedId}
            query={query}
            loading={listLoading}
            error={pageError}
            hasPrevious={pageIndex > 0}
            hasNext={Boolean(nextCursor)}
            reorderEnabled={reorderEnabled}
            glass={settings.glassEnabled}
            collapsed={sidebarCollapsed}
            onQueryChange={setQuery}
            onSelect={handleSelectNote}
            onPreviousPage={showPreviousPage}
            onNextPage={showNextPage}
            onCreate={handleCreateNote}
            onCreateFolder={handleCreateFolder}
            onRenameFolder={handleRenameFolder}
            onDeleteFolderRequest={(folder) => { rememberOverlayTrigger(); setFolderDeleteTarget(folder); }}
            onSelectFolder={handleSelectFolder}
            onMove={moveNote}
            draggingId={draggingId}
            onDragStart={setDraggingId}
            onDropOnNote={handleDropOnNote}
            onDropOnFolder={handleDropOnFolder}
            onOpenSettings={() => { rememberOverlayTrigger(); setSettingsOpen(true); }}
            onToggleCollapsed={() => setSidebarCollapsed((current) => !current)}
          />
        </aside>

        <section
          ref={editorPanelRef}
          className={cn(
            "animate-surface-in flex min-h-0 w-full max-w-4xl justify-self-center flex-col overflow-hidden",
            !selectedFolderIsEmpty && "notes-panel notes-editor-panel",
          )}
        >
          <MobileTopBar
            selectedNote={selectedNote}
            folders={folders}
            saveState={saveState}
            onOpenSidebar={() => { rememberOverlayTrigger(); setMobileSidebarOpen(true); }}
            onOpenAppearance={handleOpenAppearance}
            onMoveToFolder={handleMoveNoteToFolder}
          />
          <Editor
            key={selectedNote?.id ?? "empty"}
            note={selectedNote}
            loading={noteLoading}
            saveState={saveState}
            message={message}
            autoFocusTitleFor={autoFocusTitleFor}
            onChange={patchNote}
            onFlush={flushNote}
            onCreate={handleCreateNote}
            createFolderName={folders.find((folder) => folder.id === selectedFolderId)?.name}
            onDeleteRequest={(note) => { rememberOverlayTrigger(); setDeleteTarget(note); }}
            onRetry={retryFailedSave}
            onTitleFocused={() => setAutoFocusTitleFor(null)}
            onOpenAppearance={handleOpenAppearance}
            folders={folders}
            onMoveToFolder={handleMoveNoteToFolder}
            desktopActionsInside={actionsInside}
          />
        </section>

        <div
          ref={floatingActionsRef}
          aria-hidden={actionsInside ? true : undefined}
          className={cn("absolute right-4 top-4 z-20 hidden md:block", actionsInside && "invisible")}
        >
          <DesktopNoteActions
            saveState={saveState}
            showSaveStatus={Boolean(selectedNote)}
            note={selectedNote}
            folders={folders}
            onOpenAppearance={handleOpenAppearance}
            onMoveToFolder={handleMoveNoteToFolder}
          />
        </div>
      </div>

      {mobileSidebarOpen && (
        <MobileOverlay onClose={() => { setMobileSidebarOpen(false); if (!settingsOpen) restoreOverlayTrigger(); }}>
          {(requestClose) => (
           <NotesSidebar
             folders={folders}
             allNotesCount={allNotesCount}
             unfiledCount={unfiledCount}
             selectedFolderId={selectedFolderId}
             notes={notes}
              totalCount={totalCount}
              pageIndex={pageIndex}
              selectedId={selectedId}
              query={query}
              loading={listLoading}
              error={pageError}
              hasPrevious={pageIndex > 0}
              hasNext={Boolean(nextCursor)}
              reorderEnabled={reorderEnabled}
              glass={settings.glassEnabled}
              collapsed={false}
              onQueryChange={setQuery}
              onSelect={(id) => {
                handleSelectNote(id);
                requestClose();
              }}
              onPreviousPage={showPreviousPage}
              onNextPage={showNextPage}
              onCreate={() => {
                handleCreateNote();
                requestClose();
              }}
              onCreateFolder={handleCreateFolder}
              onRenameFolder={handleRenameFolder}
              onDeleteFolderRequest={(folder) => {
                rememberOverlayTrigger();
                requestClose();
                setFolderDeleteTarget(folder);
              }}
              onSelectFolder={handleSelectFolder}
              onMove={moveNote}
              draggingId={draggingId}
              onDragStart={setDraggingId}
              onDropOnNote={handleDropOnNote}
              onDropOnFolder={handleDropOnFolder}
              onOpenSettings={() => {
                rememberOverlayTrigger();
                requestClose();
                setSettingsOpen(true);
              }}
            />
          )}
        </MobileOverlay>
      )}

      {settingsOpen && (
        <SettingsMenu
          name={name}
          email={email}
          accountUrl={accountUrl}
          onRestore={() => { pageCache.invalidate(); void fetchNotesPage(pageCursors[pageIndex], pageIndex, query, selectedFolderId); }}
          onClose={() => { setSettingsOpen(false); restoreOverlayTrigger(); }}
        />
      )}

      <AppearancePicker
        settings={settings}
        open={appearanceOpen}
        onOpenChange={(open) => { setAppearanceOpen(open); if (!open) restoreOverlayTrigger(); }}
        onPatch={patchSettings}
        anchor={appearanceAnchor}
      />

      {deleteTarget && (
        <ConfirmDeleteDialog
          note={deleteTarget}
          onCancel={() => { setDeleteTarget(null); restoreOverlayTrigger(); }}
          onConfirm={() => { handleDelete(deleteTarget); restoreOverlayTrigger(); }}
        />
      )}

      {folderDeleteTarget && (
        <ConfirmDeleteFolderDialog
          folder={folderDeleteTarget}
          onCancel={() => { setFolderDeleteTarget(null); restoreOverlayTrigger(); }}
          onConfirm={() => { handleDeleteFolder(folderDeleteTarget); restoreOverlayTrigger(); }}
        />
      )}
    </main>
  );
}
