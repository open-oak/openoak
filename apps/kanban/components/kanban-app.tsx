"use client";

import { AlertTriangle, CloudOff, Download, Menu, MoreVertical, Pencil, Plus, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { CardArchiveDialog } from "./kanban/card-archive-dialog";
import { ActionNotice } from "./kanban/action-notice";
import { createKanbanBackup, parseKanbanBackup, MAX_BACKUP_BYTES } from "@/lib/kanban-backup";
import { describeTaskPosition, shiftTaskAcrossLists, shiftTaskWithinList, taskPosition } from "@/lib/kanban-board";
import {
  cleanBoards,
  defaultBoardAppearance,
  defaultLists,
  legacyCardsToTasks,
  starterBoards,
  starterTasks,
  tasksForList,
  type Board,
} from "@/lib/kanban-data";
import { resolveDropTarget } from "@/lib/kanban-drag";
import { activeBoardOf, boardReducer, type BoardState, type BoardAction } from "@/lib/kanban-reducer";
import { getBrowserStorage, readJsonStorage, readStorageChoice, readStorageValue, writeStorageValue } from "@/lib/kanban-storage";
import { cn } from "@/lib/utils";
import { useVisualViewport } from "@/hooks/use-visual-viewport";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import { BoardColumn, type ColumnDropTarget } from "./kanban/board-column";
import { BoardBackground } from "./kanban/board-background";
import { BoardSharingDialog } from "./kanban/board-sharing-dialog";
import { BoardMenu } from "./kanban/board-menu";
import { BoardSidebar } from "./kanban/board-sidebar";
import { ConfirmDialog } from "./kanban/confirm-dialog";
import {
  ACTIVE_BOARD_KEY,
  BOARDS_KEY,
  GLASS_KEY,
  LEGACY_STORAGE_KEY,
  MODE_KEY,
  SIDEBAR_KEY,
  THEME_KEY,
  WALLPAPER_BLUR_KEY,
  WALLPAPER_KEY,
  listColors,
  themeIds,
  wallpaperIds,
  type ColorMode,
} from "./kanban/constants";
import { AppearancePicker } from "./kanban/appearance-popover";
import { ListIcon, SyncBadge } from "./kanban/primitives";
import { SettingsPanel } from "./kanban/settings-panel";
import { TaskDetailDialog } from "./kanban/task-detail-dialog";
import { dropPositionFor, type TaskDragHandlers } from "./kanban/task-card";
import { useBoardSync, type HydratedState } from "./kanban/use-board-sync";
import { useModularSync } from "./kanban/use-modular-sync";

const TASK_DRAG_TYPE = "application/open-kanban-task";
const LIST_DRAG_TYPE = "application/open-kanban-list";
/** Hold this long on a touch screen before a card starts dragging instead of scrolling. */
const TOUCH_DRAG_HOLD_MS = 400;
/** How long after a touch drop a synthesised click is ignored. */
const CARD_CLICK_SUPPRESS_MS = 400;

function createId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function initialBoardState(): BoardState {
  return { boards: starterBoards, activeBoardId: starterBoards[0].id };
}

export function KanbanApp({
  accountId = "",
  modular = false,
  name,
  email,
  initialBoardId,
  initialCardId,
}: {
  accountId?: string;
  modular?: boolean;
  name?: string | null;
  email?: string | null;
  initialBoardId?: string;
  initialCardId?: string;
}) {
  useVisualViewport();
  const [boardState, rawDispatch] = useReducer(boardReducer, undefined, initialBoardState);
  const [newBoardName, setNewBoardName] = useState("");
  const [newListName, setNewListName] = useState("");
  const [newTaskTitles, setNewTaskTitles] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<ColorMode>("auto");
  const [glass, setGlass] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sharingOpen, setSharingOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  const [draggingListId, setDraggingListId] = useState<string | null>(null);
  const [dragOverListId, setDragOverListId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<ColumnDropTarget | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const taskReturnFocusRef = useRef<HTMLElement | null>(null);
  const [editingBoardTitle, setEditingBoardTitle] = useState(false);
  const [boardTitleDraft, setBoardTitleDraft] = useState("");
  const [openListStyleMenuId, setOpenListStyleMenuId] = useState<string | null>(null);
  const [boardMenuOpen, setBoardMenuOpen] = useState<"mobile" | "desktop" | null>(null);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [appearanceAnchor, setAppearanceAnchor] = useState<{ top: number; right: number } | null>(null);
  const [deleteBoardDialogOpen, setDeleteBoardDialogOpen] = useState(false);
  const [deleteListTargetId, setDeleteListTargetId] = useState<string | null>(null);
  const [storageWarning, setStorageWarning] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [undoCards, setUndoCards] = useState<{boardId: string; id: string}[]>([]);
  const [undoBusy, setUndoBusy] = useState(false);
  const [dataNotice, setDataNotice] = useState<{ tone: "success" | "error"; message: string; undo?: boolean } | null>(null);
  const dismissNotice = useCallback(() => { setDataNotice(null); setUndoCards([]); }, []);
  const [pendingImport, setPendingImport] = useState<{ boards: Board[]; activeBoardId: string; fileName: string } | null>(null);
  const [mobileVisibleListId, setMobileVisibleListId] = useState<string | null>(null);
  const [moveAnnouncement, setMoveAnnouncement] = useState("");
  const pointerDragRef = useRef<{ taskId: string; startX: number; startY: number; dragging: boolean; holdTimer: number | null } | null>(null);
  /**
   * A touch drag ends with `pointerup`, and the browser then synthesises a
   * `click` on the card that held the pointer capture. Without this, dropping a
   * card immediately opens its detail dialog on top of the board.
   */
  const suppressCardClickUntilRef = useRef(0);
  const importInputRef = useRef<HTMLInputElement>(null);
  const boardGridRef = useRef<HTMLDivElement>(null);
  const mobileListTabsRef = useRef<HTMLElement>(null);
  const mobileScrollFrameRef = useRef<number | null>(null);
  const hydratedStateRef = useRef<HydratedState | null>(null);
  const deepLinkRef = useRef({ boardId: initialBoardId, cardId: initialCardId });
  const deepLinkApplied = useRef(false);
  const skipBoardTitleCommitRef = useRef(false);
  const mobileBoardMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const desktopBoardMenuTriggerRef = useRef<HTMLButtonElement>(null);

  const boards = boardState.boards;
  const activeBoard = useMemo(() => activeBoardOf(boardState), [boardState]);

  const selectedTask = activeBoard.tasks.find((task) => task.id === selectedTaskId) || null;
  const selectedTaskPosition = selectedTaskId ? taskPosition(activeBoard, selectedTaskId) : null;
  const mobileActiveListId = activeBoard.lists.some((list) => list.id === mobileVisibleListId)
    ? mobileVisibleListId
    : activeBoard.lists[0]?.id || null;

  const boardCounts = useMemo(() => {
    return boards.reduce<Record<string, number>>((result, board) => {
      result[board.id] = board.tasks.length;
      return result;
    }, {});
  }, [boards]);

  const listCounts = useMemo(() => {
    return activeBoard.lists.reduce<Record<string, number>>((result, list) => {
      result[list.id] = activeBoard.tasks.filter((task) => task.listId === list.id).length;
      return result;
    }, {});
  }, [activeBoard.lists, activeBoard.tasks]);

  const listedTasks = useMemo(() => {
    return activeBoard.lists.reduce<Record<string, ReturnType<typeof tasksForList>>>((result, list) => {
      result[list.id] = tasksForList(activeBoard.tasks, list.id);
      return result;
    }, {});
  }, [activeBoard.lists, activeBoard.tasks]);

  const onDocumentLoaded = useCallback((nextBoards: Board[], nextActiveBoardId: string) => {
    const linkedBoard = nextBoards.find((board) => board.id === deepLinkRef.current.boardId);
    const activeId = linkedBoard?.id ?? nextActiveBoardId;
    rawDispatch({ type: "replaceState", boards: nextBoards, activeBoardId: deepLinkApplied.current ? nextActiveBoardId : activeId });
    if (!deepLinkApplied.current && linkedBoard?.tasks.some((task) => task.id === deepLinkRef.current.cardId)) {
      setSelectedTaskId(deepLinkRef.current.cardId ?? null);
    }
    // A cached catalog may contain the linked board before its cards load.
    // Consume the link only once that board's data is available.
    if (!deepLinkRef.current.boardId || linkedBoard?.lists.length) deepLinkApplied.current = true;
  }, []);

  const legacySync = useBoardSync({
    mounted: mounted && !modular,
    boards,
    activeBoardId: activeBoard.id,
    hydratedStateRef,
    onDocumentLoaded,
  });
  const modularSync = useModularSync({ enabled: mounted && modular, accountId, initialBoardId, onDocumentLoaded });
  const activeSummary = modularSync.summaries.find((board) => board.id === activeBoard.id);
  const ownedBoardCount = modular ? modularSync.summaries.filter((board) => board.accessLevel !== "editor").length : boards.length;
  const canDeleteBoard = !modular || activeSummary?.accessLevel !== "editor";
  const sync = modular ? modularSync : legacySync;
  const dispatch = (action: BoardAction) => {
    if (modular) return modularSync.dispatch(action);
    rawDispatch(action);
    return true;
  };

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;

      const storage = getBrowserStorage();
      setStorageWarning(storage === null);
      const appearanceFallback = {
        theme: readStorageChoice(storage, THEME_KEY, themeIds, defaultBoardAppearance.theme),
        wallpaper: readStorageChoice(storage, WALLPAPER_KEY, wallpaperIds, defaultBoardAppearance.wallpaper),
        wallpaperBlur: readStorageValue(storage, WALLPAPER_BLUR_KEY) === "true",
      };
      const savedBoards = modular ? [] : cleanBoards(readJsonStorage(storage, BOARDS_KEY), appearanceFallback);
      const legacyTasks = modular ? [] : legacyCardsToTasks(readJsonStorage(storage, LEGACY_STORAGE_KEY), defaultLists);
      const nextBoards = savedBoards.length
        ? savedBoards
        : [
            {
              id: "main",
              name: "Main board",
              lists: defaultLists,
              tasks: legacyTasks.length ? legacyTasks : starterTasks,
              ...appearanceFallback,
            },
          ];
      const savedActiveBoardId = readStorageValue(storage, ACTIVE_BOARD_KEY);
      const nextActiveBoardId = nextBoards.some((board) => board.id === savedActiveBoardId)
        ? savedActiveBoardId || nextBoards[0].id
        : nextBoards[0].id;

      hydratedStateRef.current = {
        boards: nextBoards,
        activeBoardId: nextActiveBoardId,
        hadStoredBoards: savedBoards.length > 0 || legacyTasks.length > 0,
        appearanceFallback,
      };
      const linkedBoard = nextBoards.find((board) => board.id === deepLinkRef.current.boardId);
      rawDispatch({ type: "replaceState", boards: nextBoards, activeBoardId: linkedBoard?.id ?? nextActiveBoardId });
      if (linkedBoard?.tasks.some((task) => task.id === deepLinkRef.current.cardId)) {
        setSelectedTaskId(deepLinkRef.current.cardId ?? null);
      }
      setMode(readStorageChoice<ColorMode>(storage, MODE_KEY, ["auto", "light", "dark"], "auto"));
      setGlass(readStorageValue(storage, GLASS_KEY) === "true");
      setSidebarCollapsed(readStorageValue(storage, SIDEBAR_KEY) === "collapsed");
      setMounted(true);
    });
    return () => {
      active = false;
    };
  }, [modular]);

  useEffect(() => {
    // Until the saved mode is read, keep the class the pre-paint script set.
    // Applying the initial "auto" here would flash the wrong mode.
    if (!mounted) return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const applyMode = () => {
      const dark = mode === "dark" || (mode === "auto" && media.matches);
      document.documentElement.classList.toggle("dark", dark);
      document.documentElement.classList.toggle("light", !dark);
    };
    applyMode();
    if (activeBoard.wallpaper === "none" && activeBoard.theme !== "default") {
      document.documentElement.setAttribute("data-current-theme", activeBoard.theme);
    } else {
      document.documentElement.removeAttribute("data-current-theme");
    }
    media.addEventListener("change", applyMode);
    return () => media.removeEventListener("change", applyMode);
  }, [activeBoard.theme, activeBoard.wallpaper, mode, mounted]);

  useEffect(() => {
    if (!mounted) return;
    const storage = getBrowserStorage();
    const everythingSaved = [
      modular || writeStorageValue(storage, BOARDS_KEY, JSON.stringify(boards)),
      modular || writeStorageValue(storage, ACTIVE_BOARD_KEY, activeBoard.id),
      writeStorageValue(storage, MODE_KEY, mode),
      writeStorageValue(storage, GLASS_KEY, String(glass)),
      writeStorageValue(storage, SIDEBAR_KEY, sidebarCollapsed ? "collapsed" : "expanded"),
    ].every(Boolean);

    let active = true;
    queueMicrotask(() => {
      if (active) setStorageWarning(!everythingSaved);
    });
    return () => {
      active = false;
    };
  }, [activeBoard.id, boards, glass, mode, mounted, sidebarCollapsed, modular]);

  useEffect(() => {
    document.body.toggleAttribute("data-card-dragging", draggingTaskId !== null);
  }, [draggingTaskId]);

  function announceMove(message: string) {
    setMoveAnnouncement(message);
  }

  function deleteActiveBoard() {
    dispatch({ type: "deleteActiveBoard", replacementId: createId() });
    setSelectedTaskId(null);
    setOpenListStyleMenuId(null);
    setDeleteBoardDialogOpen(false);
    setSettingsOpen(false);
    setEditingBoardTitle(false);
  }

  function requestDeleteActiveBoard() {
    setBoardMenuOpen(null);
    setDeleteBoardDialogOpen(true);
  }

  function createBoard(event: React.FormEvent) {
    event.preventDefault();
    const cleanName = newBoardName.trim();
    if (!cleanName) return;
    dispatch({ type: "createBoard", id: createId(), name: cleanName });
    setNewBoardName("");
    setMobileMenuOpen(false);
    setEditingBoardTitle(false);
  }

  function createQuickBoard() {
    dispatch({ type: "createBoard", id: createId(), name: `Board ${boards.length + 1}` });
  }

  function createList(event: React.FormEvent) {
    event.preventDefault();
    const cleanName = newListName.trim();
    if (!cleanName) return;
    const id = createId();
    dispatch({
      type: "createList",
      id,
      name: cleanName,
      color: listColors[activeBoard.lists.length % listColors.length].id,
    });
    setNewListName("");
    // Put the caret in the new list's name so it can be renamed straight away,
    // the same handoff a new task gets from the composer it was typed in.
    window.requestAnimationFrame(() => {
      const field = document.getElementById(`${id}-title`) as HTMLInputElement | null;
      field?.focus({ preventScroll: true });
      field?.select();
    });
  }

  function addTask(listId: string, event: React.FormEvent) {
    event.preventDefault();
    const cleanTitle = (newTaskTitles[listId] || "").trim();
    if (!cleanTitle) {
      createDetailedTask(listId);
      return;
    }
    dispatch({ type: "addTask", listId, id: createId(), title: cleanTitle });
    setNewTaskTitles((current) => ({ ...current, [listId]: "" }));
  }

  function createDetailedTask(listId: string) {
    const id = createId();
    dispatch({ type: "addTask", listId, id, title: "" });
    setNewTaskTitles((current) => ({ ...current, [listId]: "" }));
    setSelectedTaskId(id);
  }

  /** Keyboard reordering: Alt+Up/Down within a list, Alt+Left/Right across lists. */
  function moveTaskByKeyboard(taskId: string, axis: "vertical" | "horizontal", offset: number) {
    const next = axis === "vertical" ? shiftTaskWithinList(activeBoard, taskId, offset) : shiftTaskAcrossLists(activeBoard, taskId, offset);
    if (next === activeBoard) {
      announceMove(axis === "vertical" ? "Already at the end of the list" : "No list in that direction");
      return;
    }

    dispatch(axis === "vertical" ? { type: "shiftTaskWithinList", taskId, offset } : { type: "shiftTaskAcrossLists", taskId, offset });
    announceMove(`Moved ${describeTaskPosition(next, taskId)}`);
  }

  function moveSelectedTaskWithinList(taskId: string, offset: number) {
    moveTaskByKeyboard(taskId, "vertical", offset);
  }

  async function exportBoards(boardId?: string) {
    try {
      const source = modular ? await modularSync.exportBoards(boardId) : { boards, activeBoardId: activeBoard.id };
      const backup = createKanbanBackup(source.boards, source.activeBoardId);
      const blob = new Blob([backup], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `openkanban-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setDataNotice({ tone: "success", message: "Backup downloaded. Active and archived cards are included." });
    } catch (error) {
      setDataNotice({ tone: "error", message: error instanceof Error ? error.message : "Could not create a backup file." });
    }
  }

  async function selectImportFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > MAX_BACKUP_BYTES) { setDataNotice({ tone: "error", message: "Choose an OpenKanban export under 10 MiB." }); return; }

    try {
      const payload = parseKanbanBackup(await file.text());
      if (!payload) {
        setDataNotice({ tone: "error", message: "This file has invalid or unsupported board data, duplicate IDs, or a board larger than 2 MiB. Choose a valid OpenKanban export." });
        return;
      }

      if (!modular && payload.boards.some((board) => board.archivedTasks?.length)) {
        setDataNotice({ tone: "error", message: "This account cannot import archived cards yet. Keep this backup and update OpenKanban before importing it." });
        return;
      }
      const importedBoards = payload.boards;
      if (!importedBoards.length) {
        setDataNotice({ tone: "error", message: "That backup contains no boards." });
        return;
      }

      const importedActiveBoardId = importedBoards.some((board) => board.id === payload.activeBoardId)
        ? payload.activeBoardId || importedBoards[0].id
        : importedBoards[0].id;

      setPendingImport({ boards: importedBoards, activeBoardId: importedActiveBoardId, fileName: file.name });
    } catch {
      setDataNotice({ tone: "error", message: "Could not read that backup file." });
    }
  }

  function confirmImport() {
    if (!pendingImport) return;
    try {
      if (modular) modularSync.importBoards(pendingImport.boards);
      else dispatch({ type: "replaceState", boards: pendingImport.boards, activeBoardId: pendingImport.activeBoardId });
    } catch (error) {
      setDataNotice({ tone: "error", message: error instanceof Error ? error.message : "Unable to import." }); return;
    }
    setSelectedTaskId(null);
    setMobileVisibleListId(null);
    setSettingsOpen(false);
    setDataNotice({
      tone: "success",
      message: modular ? "Board copies saved on this device and queued for import." : `Imported ${pendingImport.boards.length} ${pendingImport.boards.length === 1 ? "board" : "boards"} from ${pendingImport.fileName}.`,
    });
    setPendingImport(null);
  }

  function jumpToList(listId: string) {
    setMobileMenuOpen(false);
    setMobileVisibleListId(listId);

    // Keep list navigation scoped to the horizontal board scroller. Using
    // scrollIntoView() here also scrolls ancestor containers on Android and its
    // smooth intermediate positions make the scroll listener briefly select
    // neighbouring lists before it reaches the requested one.
    const grid = boardGridRef.current;
    const target = Array.from(grid?.querySelectorAll<HTMLElement>("[data-list-id]") || []).find(
      (list) => list.dataset.listId === listId
    );
    if (!grid || !target) return;

    const targetLeft = target.getBoundingClientRect().left - grid.getBoundingClientRect().left + grid.scrollLeft;
    grid.scrollTo({ left: targetLeft, behavior: "auto" });
  }

  function selectBoard(boardId: string) {
    dispatch({ type: "selectBoard", boardId });
    setMobileVisibleListId(null);
    setMobileMenuOpen(false);
    clearDragState();
    setSelectedTaskId(null);
    setOpenListStyleMenuId(null);
    setBoardMenuOpen(null);
    setEditingBoardTitle(false);
  }

  function beginBoardTitleEdit() {
    skipBoardTitleCommitRef.current = false;
    setBoardTitleDraft(activeBoard.name);
    setEditingBoardTitle(true);
  }

  function commitBoardTitleEdit() {
    if (skipBoardTitleCommitRef.current) {
      skipBoardTitleCommitRef.current = false;
      setEditingBoardTitle(false);
      return;
    }
    const name = boardTitleDraft.trim();
    if (name && name !== activeBoard.name) {
      dispatch({ type: "renameActiveBoard", name });
    }
    setEditingBoardTitle(false);
  }

  function onBoardTitleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.blur();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      skipBoardTitleCommitRef.current = true;
      event.currentTarget.blur();
    }
  }

  function clearDragState() {
    setDraggingTaskId(null);
    setDraggingListId(null);
    setDragOverListId(null);
    setDropTarget(null);
  }

  function onTaskDragStart(event: React.DragEvent<HTMLElement>, taskId: string) {
    event.stopPropagation();
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(TASK_DRAG_TYPE, taskId);
    setDraggingTaskId(taskId);
  }

  function onListDragStart(event: React.DragEvent<HTMLElement>, listId: string) {
    const target = event.target as HTMLElement;
    if (target.closest("button, input, select, textarea, .task-card")) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(LIST_DRAG_TYPE, listId);
    setDraggingListId(listId);
  }

  function onListDragOver(event: React.DragEvent<HTMLElement>, listId: string) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDragOverListId(listId);
  }

  function onListDragLeave(event: React.DragEvent<HTMLElement>) {
    if (!event.currentTarget.contains(event.relatedTarget as Node)) {
      setDragOverListId(null);
      setDropTarget(null);
    }
  }

  /** Hovering a card: mark the slot above or below it as the drop position. */
  function onDragOverCard(event: React.DragEvent<HTMLElement>, taskId: string) {
    if (draggingListId) return;
    const task = activeBoard.tasks.find((entry) => entry.id === taskId);
    if (!task) return;

    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    setDragOverListId(task.listId);
    setDropTarget({ listId: task.listId, taskId, position: dropPositionFor(event) });
  }

  function onDropOnCard(event: React.DragEvent<HTMLElement>, taskId: string) {
    const dragTaskId = event.dataTransfer.getData(TASK_DRAG_TYPE) || draggingTaskId;
    if (!dragTaskId || draggingListId) return;

    event.preventDefault();
    event.stopPropagation();
    const position = dropPositionFor(event);
    dispatch({ type: "moveTaskRelativeToTask", taskId: dragTaskId, targetTaskId: taskId, position });
    clearDragState();
  }

  /** Hovering the empty space of a list queues an append at the end. */
  function onDragOverListBody(event: React.DragEvent<HTMLElement>, listId: string) {
    if (draggingListId || !draggingTaskId) return;
    event.preventDefault();
    setDropTarget({ listId, taskId: null, position: "after" });
  }

  function onListDrop(event: React.DragEvent<HTMLElement>, listId: string) {
    event.preventDefault();
    const listDragId = event.dataTransfer.getData(LIST_DRAG_TYPE) || draggingListId;
    const taskDragId = event.dataTransfer.getData(TASK_DRAG_TYPE) || draggingTaskId;

    if (listDragId) {
      dispatch({ type: "reorderLists", draggedId: listDragId, targetId: listId });
    } else if (taskDragId) {
      // Released over list background rather than a card: append to the end.
      dispatch({ type: "moveTaskToList", taskId: taskDragId, listId });
    }
    clearDragState();
  }

  function cancelPointerHold() {
    const pointerDrag = pointerDragRef.current;
    if (pointerDrag?.holdTimer !== null && pointerDrag?.holdTimer !== undefined) {
      window.clearTimeout(pointerDrag.holdTimer);
      pointerDrag.holdTimer = null;
    }
  }

  /**
   * Pen and touch dragging. Touch needs a hold before the drag starts so a
   * normal swipe still scrolls the board; pen starts as soon as it moves.
   */
  function onTaskPointerDown(event: React.PointerEvent<HTMLElement>, taskId: string) {
    if (event.pointerType !== "pen" && event.pointerType !== "touch") return;
    const target = event.target as HTMLElement;
    if (target.closest("button, input, select, textarea")) return;

    const pointerDrag = { taskId, startX: event.clientX, startY: event.clientY, dragging: false, holdTimer: null as number | null };
    pointerDragRef.current = pointerDrag;

    if (event.pointerType === "touch") {
      const element = event.currentTarget;
      pointerDrag.holdTimer = window.setTimeout(() => {
        pointerDrag.holdTimer = null;
        if (pointerDragRef.current !== pointerDrag) return;
        pointerDrag.dragging = true;
        setDraggingTaskId(taskId);
        try {
          element.setPointerCapture(event.pointerId);
        } catch {
          // Capture can fail if the pointer already ended; the drag then no-ops.
        }
      }, TOUCH_DRAG_HOLD_MS);
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onTaskPointerMove(event: React.PointerEvent<HTMLElement>) {
    const pointerDrag = pointerDragRef.current;
    if (!pointerDrag) return;

    const distance = Math.hypot(event.clientX - pointerDrag.startX, event.clientY - pointerDrag.startY);

    if (!pointerDrag.dragging) {
      // Movement before the hold completes is a scroll, not a drag.
      if (event.pointerType === "touch") {
        if (distance > 12) {
          cancelPointerHold();
          pointerDragRef.current = null;
        }
        return;
      }
      if (distance < 8) return;
      pointerDrag.dragging = true;
      setDraggingTaskId(pointerDrag.taskId);
    }

    const under = pointerTargetsAt(event.clientX, event.clientY);
    setDragOverListId(under.listId);
    setDropTarget(
      resolveDropTarget({
        draggedTaskId: pointerDrag.taskId,
        overTaskId: under.taskId,
        overListId: under.listId,
        rect: under.rect,
        clientY: event.clientY,
      })
    );
  }

  /** What sits under a pointer: the card and list it is over, if any. */
  function pointerTargetsAt(clientX: number, clientY: number) {
    const element = document.elementFromPoint(clientX, clientY);
    const card = element?.closest<HTMLElement>("[data-task-id]");
    const list = element?.closest<HTMLElement>("[data-list-id]");
    return {
      taskId: card?.dataset.taskId || null,
      listId: list?.dataset.listId || null,
      rect: card ? card.getBoundingClientRect() : null,
    };
  }

  function onTaskPointerUp(event: React.PointerEvent<HTMLElement>) {
    const pointerDrag = pointerDragRef.current;
    cancelPointerHold();
    pointerDragRef.current = null;
    if (!pointerDrag) return;

    if (!pointerDrag.dragging) {
      // Let the synthesized click open the task after the touch gesture has
      // fully completed. Opening here mounts the dialog before that click,
      // which can make it activate the date or list control under the finger.
      return;
    }

    const under = pointerTargetsAt(event.clientX, event.clientY);
    const target = resolveDropTarget({
      draggedTaskId: pointerDrag.taskId,
      overTaskId: under.taskId,
      overListId: under.listId,
      rect: under.rect,
      clientY: event.clientY,
    });

    if (target?.taskId) {
      dispatch({ type: "moveTaskRelativeToTask", taskId: pointerDrag.taskId, targetTaskId: target.taskId, position: target.position });
    } else if (target) {
      dispatch({ type: "moveTaskToList", taskId: pointerDrag.taskId, listId: target.listId });
    }

    suppressCardClickUntilRef.current = Date.now() + CARD_CLICK_SUPPRESS_MS;
    clearDragState();
  }

  /** Opens a task, unless the click is the tail end of a touch drag. */
  function openTaskFromClick(taskId: string) {
    if (Date.now() < suppressCardClickUntilRef.current) return;
    if (document.activeElement instanceof HTMLElement) taskReturnFocusRef.current = document.activeElement;
    setSelectedTaskId(taskId);
  }

  function closeSelectedTask() {
    const taskId = selectedTaskId;
    setSelectedTaskId(null);
    requestAnimationFrame(() => {
      const target = taskReturnFocusRef.current;
      if (target?.isConnected) target.focus();
      else if (taskId) document.querySelector<HTMLElement>(`[data-task-id="${CSS.escape(taskId)}"]`)?.focus();
      else document.querySelector<HTMLElement>('[aria-label="Board actions"]')?.focus();
    });
  }

  function onTaskPointerCancel() {
    cancelPointerHold();
    pointerDragRef.current = null;
    clearDragState();
  }

  function onBoardGridScroll() {
    if (typeof window === "undefined" || window.innerWidth > 900 || mobileScrollFrameRef.current !== null) return;

    mobileScrollFrameRef.current = window.requestAnimationFrame(() => {
      mobileScrollFrameRef.current = null;
      const grid = boardGridRef.current;
      if (!grid) return;

      const gridLeft = grid.getBoundingClientRect().left;
      const lists = Array.from(grid.querySelectorAll<HTMLElement>("[data-list-id]"));
      const closestList = lists.reduce<{ id: string; distance: number } | null>((closest, list) => {
        const id = list.dataset.listId;
        if (!id) return closest;
        const distance = Math.abs(list.getBoundingClientRect().left - gridLeft);
        return !closest || distance < closest.distance ? { id, distance } : closest;
      }, null);

      if (closestList) setMobileVisibleListId(closestList.id);
    });
  }

  useEffect(() => {
    if (!mobileActiveListId || typeof window === "undefined" || window.innerWidth > 900) return;

    const tabs = mobileListTabsRef.current;
    const activeTab = Array.from(tabs?.querySelectorAll<HTMLElement>("[data-list-tab-id]") || []).find(
      (tab) => tab.dataset.listTabId === mobileActiveListId
    );
    if (!tabs || !activeTab) return;

    const centeredLeft = activeTab.offsetLeft - (tabs.clientWidth - activeTab.offsetWidth) / 2;
    tabs.scrollTo({ left: Math.max(0, centeredLeft), behavior: "smooth" });
  }, [mobileActiveListId]);

  const taskDragHandlers: TaskDragHandlers = {
    onDragStart: onTaskDragStart,
    onDragEnd: clearDragState,
    onDragOverCard,
    onDropOnCard,
    onPointerDown: onTaskPointerDown,
    onPointerMove: onTaskPointerMove,
    onPointerUp: onTaskPointerUp,
    onPointerCancel: onTaskPointerCancel,
  };

  const boardToolbar = (iconSize: string, location: "mobile" | "desktop") => (
    <Popover open={boardMenuOpen === location} onOpenChange={(open) => setBoardMenuOpen(open ? location : null)}>
      <PopoverTrigger asChild>
        <button
          ref={location === "mobile" ? mobileBoardMenuTriggerRef : desktopBoardMenuTriggerRef}
          className="icon-button toolbar-icon-button"
          aria-label="Board actions"
        >
          <MoreVertical className={iconSize} aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <BoardMenu
        boardCount={ownedBoardCount}
        canDelete={canDeleteBoard}
        onShare={modular && activeSummary ? () => { setBoardMenuOpen(null); setSharingOpen(true); } : undefined}
        onArchive={modular && activeSummary ? () => { setBoardMenuOpen(null); setArchiveOpen(true); } : undefined}
        onExport={modular ? () => { setBoardMenuOpen(null); void exportBoards(activeBoard.id); } : undefined}
        onAppearance={() => {
          const trigger = location === "mobile" ? mobileBoardMenuTriggerRef.current : desktopBoardMenuTriggerRef.current;
          const rect = trigger?.getBoundingClientRect();
          setBoardMenuOpen(null);
          setAppearanceAnchor(rect ? { top: rect.bottom, right: window.innerWidth - rect.right } : null);
          setAppearanceOpen(true);
        }}
        onDeleteBoard={requestDeleteActiveBoard}
        onSettings={() => {
          setBoardMenuOpen(null);
          setSettingsOpen(true);
        }}
      />
    </Popover>
  );

  const deleteListTarget = activeBoard.lists.find((list) => list.id === deleteListTargetId) || null;
  const deleteListTaskCount = deleteListTargetId
    ? activeBoard.tasks.filter((task) => task.listId === deleteListTargetId).length
    : 0;

  if (modular && !sync.ready) return (
    <main className="grid min-h-dvh place-content-center gap-4 p-8">
      <h1 className="text-2xl font-semibold">OpenKanban</h1>
      <p role="status">{modularSync.message ?? "Opening your boards…"}</p>
      <button type="button" onClick={() => void modularSync.pullLatest()}>Retry</button>
      {modularSync.message && <button type="button" onClick={modularSync.exportRecovery}>Download saved recovery data</button>}
    </main>
  );

  return (
    <main className={cn("kanban-shell", !glass && "no-glass")} data-theme={activeBoard.theme === "default" ? undefined : activeBoard.theme} data-wallpaper={activeBoard.wallpaper}>
      <BoardBackground
        theme={activeBoard.theme}
        wallpaper={activeBoard.wallpaper}
        wallpaperBlur={activeBoard.wallpaperBlur}
      />

      <div className={cn("app-frame", archiveOpen && "archive-is-open", mobileMenuOpen && "mobile-sidebar-is-open")}>
        <div className={cn("mobile-sidebar-backdrop", mobileMenuOpen && "visible")} onClick={() => setMobileMenuOpen(false)} />

        <BoardSidebar
        sharedBoards={Object.fromEntries(modularSync.summaries.map((board) => [board.id, !!board.shared]))}
          boards={boards}
          activeBoardId={activeBoard.id}
          lists={activeBoard.lists}
          boardCounts={modular ? modularSync.counts : boardCounts}
          listCounts={listCounts}
          syncStatus={sync.status}
          glass={glass}
          collapsed={sidebarCollapsed}
          mobileOpen={mobileMenuOpen}
          newBoardName={newBoardName}
          onNewBoardNameChange={setNewBoardName}
          onCreateBoard={createBoard}
          onCreateQuickBoard={createQuickBoard}
          onSelectBoard={selectBoard}
          onJumpToList={jumpToList}
          onToggleCollapsed={() => setSidebarCollapsed((value) => !value)}
          onExpand={() => setSidebarCollapsed(false)}
          onOpenSettings={() => {
            setMobileMenuOpen(false);
            setSettingsOpen(true);
          }}
        />

        <section className="workspace" aria-label={`${activeBoard.name} kanban board`}>
          <header className={cn("mobile-topbar", !glass && "solid-surface")}>
            <button className="icon-button" onClick={() => setMobileMenuOpen(true)} aria-label="Open menu">
              <Menu className="size-5" aria-hidden="true" />
            </button>
            <div className="mobile-topbar-title">
              {editingBoardTitle ? (
                <input
                  className="mobile-board-title-input"
                  value={boardTitleDraft}
                  onChange={(event) => setBoardTitleDraft(event.target.value)}
                  onBlur={commitBoardTitleEdit}
                  onFocus={(event) => event.currentTarget.select()}
                  onKeyDown={onBoardTitleKeyDown}
                  aria-label="Board name"
                  maxLength={120}
                  autoFocus
                />
              ) : (
                <button
                  type="button"
                  className="mobile-topbar-title-button"
                  onClick={beginBoardTitleEdit}
                  aria-label={`Rename ${activeBoard.name}`}
                  title="Rename board"
                >
                  <span>{activeBoard.name}</span>
                </button>
              )}
            </div>
            <div className="mobile-topbar-actions">{boardToolbar("size-4", "mobile")}</div>
          </header>

          <nav ref={mobileListTabsRef} className="mobile-list-tabs" aria-label="Board lists">
            {activeBoard.lists.map((list) => (
              <button
                key={list.id}
                type="button"
                data-list-tab-id={list.id}
                className={cn("mobile-list-tab", mobileActiveListId === list.id && "mobile-list-tab-active")}
                onClick={() => jumpToList(list.id)}
                aria-current={mobileActiveListId === list.id ? "page" : undefined}
              >
                <ListIcon icon={list.icon} />
                <span>{list.name}</span>
                <strong>{listCounts[list.id] || 0}</strong>
              </button>
            ))}
          </nav>

          {modular && modularSync.message && (modularSync.status !== "offline" || modularSync.recovered > 0) && (
            <div className="data-banner data-banner-sync-conflict" role="alert">
              <AlertTriangle className="size-5" aria-hidden="true" />
              <span><strong>{modularSync.reloadRequired ? "Update OpenKanban" : modularSync.status === "offline" ? "Working offline" : "Sync paused"}</strong><small>{modularSync.message}</small></span>
              <div className="data-banner-actions">
                <button type="button" className="toolbar-button" onClick={modularSync.exportRecovery}>Download unsent edits</button>
                {modularSync.reloadRequired && <button type="button" className="toolbar-button" onClick={() => window.location.reload()}>Reload OpenKanban</button>}
                {!modularSync.reloadRequired && modularSync.status !== "synced" && <button type="button" className="toolbar-button" onClick={() => void modularSync.pullLatest()}>Retry</button>}
                {modularSync.canDiscard && <button type="button" className="toolbar-button" onClick={modularSync.useCloudVersion}>Discard this edit</button>}
              </div>
            </div>
          )}
          {sync.conflict && (
            <div className="data-banner data-banner-sync-conflict" role="alert">
              <AlertTriangle className="size-5" aria-hidden="true" />
              <span>
                <strong>This board changed on another device</strong>
                <small>Choose which version to keep. Nothing will be overwritten until you decide.</small>
              </span>
              <div className="data-banner-actions">
                <button type="button" className="toolbar-button" onClick={sync.useCloudVersion}>
                  Use cloud
                </button>
                <button type="button" className="primary-button" onClick={sync.keepDeviceVersion}>
                  Keep this device
                </button>
              </div>
            </div>
          )}

          {sync.status === "offline" && !sync.conflict && !modular && (
            <div className="data-banner data-banner-sync-offline" role="status">
              <CloudOff className="size-5" aria-hidden="true" />
              <span>
                <strong>Cloud sync is temporarily offline</strong>
                <small>Your changes are safe on this device and will retry automatically.</small>
              </span>
              <button type="button" className="toolbar-button" onClick={() => void sync.pullLatest()}>
                Retry
              </button>
            </div>
          )}

          {storageWarning && (
            <div className="data-banner data-banner-warning" role="alert">
              <AlertTriangle className="size-5" aria-hidden="true" />
              <span>
                <strong>Changes are not being saved</strong>
                <small>Browser storage is unavailable. Export a backup before closing this tab.</small>
              </span>
              <button type="button" className="toolbar-button" onClick={() => void exportBoards()}>
                <Download className="size-4" aria-hidden="true" />
                Export
              </button>
            </div>
          )}

          {dataNotice && <ActionNotice notice={dataNotice} onDismiss={dismissNotice} busy={undoBusy} onUndo={() => void (async () => {
            setUndoBusy(true);
            try {
              for (const card of [...undoCards].reverse()) {
                await modularSync.undoDelete(card.boardId, card.id);
                setUndoCards((current) => current.filter((item) => item !== card));
              }
              setDataNotice(null);
            } catch (e) { setDataNotice({ tone: "error", message: e instanceof Error ? e.message : "Open Archive to restore the remaining cards." }); }
            finally { setUndoBusy(false); }
          })()} />}

          <div className="board-header">
            <div className="board-title-row">
              {editingBoardTitle ? (
                <div className="board-title board-title-editing">
                  <input
                    className="board-title-input"
                    value={boardTitleDraft}
                    onChange={(event) => setBoardTitleDraft(event.target.value)}
                    onBlur={commitBoardTitleEdit}
                    onFocus={(event) => event.currentTarget.select()}
                    onKeyDown={onBoardTitleKeyDown}
                    aria-label="Board name"
                    maxLength={120}
                    autoFocus
                  />
                </div>
              ) : (
                <>
                  <h1>
                    <button
                      type="button"
                      className="board-title board-title-button"
                      onClick={beginBoardTitleEdit}
                      aria-label={`Rename ${activeBoard.name}`}
                      title="Rename board"
                    >
                      {activeBoard.name}
                    </button>
                  </h1>
                  <button
                    type="button"
                    className="icon-button board-title-edit-button"
                    onClick={beginBoardTitleEdit}
                    aria-label={`Rename ${activeBoard.name}`}
                    title="Rename board"
                  >
                    <Pencil className="size-4" aria-hidden="true" />
                  </button>
                </>
              )}
            </div>
            <div className="board-actions">
              <SyncBadge status={sync.status} />
              {boardToolbar("size-4", "desktop")}
            </div>
          </div>

          <div ref={boardGridRef} className="board-grid" onScroll={onBoardGridScroll}>
            {activeBoard.lists.map((list, index) => (
              <BoardColumn
                key={list.id}
                list={list}
                tasks={listedTasks[list.id] || []}
                index={index}
                glass={glass}
                canDeleteList={activeBoard.lists.length > 1}
                styleMenuOpen={openListStyleMenuId === list.id}
                dragOver={dragOverListId === list.id}
                listDragging={draggingListId === list.id}
                draggingTaskId={draggingTaskId}
                dropTarget={dropTarget?.listId === list.id ? dropTarget : null}
                newTaskTitle={newTaskTitles[list.id] || ""}
                drag={taskDragHandlers}
                onToggleStyleMenu={(listId) => {
                  setBoardMenuOpen(null);
                  setOpenListStyleMenuId((current) => (current === listId ? null : listId));
                }}
                onUpdateList={(listId, updates) => dispatch({ type: "updateList", listId, updates })}
                onDeleteList={(listId) => {
                  setDeleteListTargetId(listId);
                  setOpenListStyleMenuId(null);
                }}
                onNewTaskTitleChange={(listId, value) => setNewTaskTitles((current) => ({ ...current, [listId]: value }))}
                onAddTask={addTask}
                onCreateDetailedTask={createDetailedTask}
                onOpenTask={openTaskFromClick}
                onMoveTask={moveTaskByKeyboard}
                onListDragStart={onListDragStart}
                onListDragOver={onListDragOver}
                onListDragLeave={onListDragLeave}
                onListDrop={onListDrop}
                onDropAtEnd={onDragOverListBody}
              />
            ))}
            <form id="add-list-panel" className={cn("add-list-panel", !glass && "solid-surface")} onSubmit={createList}>
              <div className="add-list-heading">
                <Plus className="size-4" aria-hidden="true" />
                <span>Add list</span>
              </div>
              <label className="sr-only" htmlFor="list-name">
                List name
              </label>
              <div className="add-list-form">
                <input id="list-name" value={newListName} onChange={(event) => setNewListName(event.target.value)} placeholder="List name" className="field" />
                <button className="icon-button primary-icon-button" type="submit" aria-label="Create list">
                  <Plus className="size-4" aria-hidden="true" />
                </button>
              </div>
            </form>
          </div>
        </section>
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        {moveAnnouncement}
      </p>

      <SettingsPanel
        open={settingsOpen}
        name={name}
        email={email}
        boardCount={ownedBoardCount}
        onClose={() => setSettingsOpen(false)}
        onDeleteBoard={requestDeleteActiveBoard}
        onExportBoards={() => void exportBoards()}
        canDeleteBoard={canDeleteBoard}
        onImportBoards={() => importInputRef.current?.click()}
      />

      {modular && activeSummary && <CardArchiveDialog key={activeSummary.boardKey} accountId={accountId} boardKey={activeSummary.boardKey} boardName={activeBoard.name} lists={activeBoard.lists} open={archiveOpen} canPurge={canDeleteBoard} onOpenChange={(open) => { setArchiveOpen(open); dismissNotice(); }} onReturnFocus={() => { [mobileBoardMenuTriggerRef.current, desktopBoardMenuTriggerRef.current].find((button) => button?.offsetParent)?.focus(); }} onPurgeAll={(revision) => modularSync.purgeArchive(activeBoard.id, revision)} onRecover={(id, deletionId, permanent, destinationListId) => modularSync.recoverCard(activeBoard.id, id, deletionId, permanent, destinationListId)} />}

      {modular && activeSummary && <BoardSharingDialog key={activeSummary.boardKey} accountId={accountId} boardKey={activeSummary.boardKey} boardName={activeBoard.name} open={sharingOpen} onOpenChange={setSharingOpen} onReturnFocus={() => { const trigger = [mobileBoardMenuTriggerRef.current, desktopBoardMenuTriggerRef.current].find((button) => button?.offsetParent); trigger?.focus(); }} onChanged={() => { void modularSync.pullLatest(); }} />}

      <AppearancePicker
        theme={activeBoard.theme}
        mode={mode}
        wallpaper={activeBoard.wallpaper}
        wallpaperBlur={activeBoard.wallpaperBlur}
        glass={glass}
        open={appearanceOpen}
        onOpenChange={setAppearanceOpen}
        onThemeChange={(theme) => dispatch({ type: "updateBoardAppearance", updates: { theme, wallpaper: "none", wallpaperBlur: false } })}
        onModeChange={setMode}
        onWallpaperChange={(wallpaper) => dispatch({ type: "updateBoardAppearance", updates: { theme: "default", wallpaper } })}
        onWallpaperBlurChange={(wallpaperBlur) => dispatch({ type: "updateBoardAppearance", updates: { wallpaperBlur } })}
        onGlassChange={setGlass}
        anchor={appearanceAnchor}
      />

      <input ref={importInputRef} type="file" accept="application/json,.json" className="sr-only" onChange={selectImportFile} />

      <TaskDetailDialog
        recoverable={Boolean(modular)}
        task={selectedTask}
        lists={activeBoard.lists}
        position={selectedTaskPosition}
        onClose={closeSelectedTask}
        onUpdate={(taskId, updates) => dispatch({ type: "updateTask", taskId, updates })}
        onDelete={(taskId) => {
          if (!dispatch({ type: "deleteTask", taskId })) return;
          if (modular) {
            const recent = dataNotice?.undo ? undoCards : [];
            const next = [...recent, { boardId: activeBoard.id, id: taskId }].slice(-50);
            setUndoCards(next);
            setDataNotice({ tone: "success", message: next.length === 1 ? "Card archived" : `${next.length} cards archived`, undo: true });
          }
        }}
        onMoveWithinList={moveSelectedTaskWithinList}
      />

      <ConfirmDialog
        open={pendingImport !== null}
        title={modular ? "Import board copies?" : "Replace current boards?"}
        message={
          pendingImport
            ? `From "${pendingImport.fileName}": ${pendingImport.boards.map((board) => `“${board.name}” (${board.lists.length} lists, ${board.tasks.length} cards, ${board.archivedTasks?.length ?? 0} archived)`).join("; ")}. ${modular ? "Each import creates a separate personal copy, including when this file was imported before. Existing boards stay intact. Archived cards stay archived. Sharing access is excluded." : "Your current local boards will be replaced; export them first if you need a backup."}`
            : ""
        }
        confirmLabel="Import boards"
        icon={<Upload className="size-5" />}
        tone="neutral"
        onCancel={() => setPendingImport(null)}
        onConfirm={confirmImport}
      />

      <ConfirmDialog
        open={deleteListTarget !== null}
        title="Delete list?"
        message={deleteListTarget ? `Delete “${deleteListTarget.name}”. Its ${deleteListTaskCount} ${deleteListTaskCount === 1 ? "task moves" : "tasks move"} to the end of the first remaining list.` : ""}
        confirmLabel="Delete list"
        onCancel={() => setDeleteListTargetId(null)}
        onConfirm={() => {
          if (deleteListTargetId) dispatch({ type: "deleteList", listId: deleteListTargetId });
          setDeleteListTargetId(null);
        }}
      />

      <ConfirmDialog
        open={deleteBoardDialogOpen}
        title={ownedBoardCount > 1 ? "Delete board?" : "Reset board?"}
        message={
          ownedBoardCount > 1
            ? `Delete "${activeBoard.name}" and its tasks. This cannot be undone.`
            : `Clear "${activeBoard.name}" and start with an empty board. This cannot be undone.`
        }
        confirmLabel={ownedBoardCount > 1 ? "Delete board" : "Reset board"}
        onCancel={() => setDeleteBoardDialogOpen(false)}
        onConfirm={deleteActiveBoard}
      />
    </main>
  );
}
