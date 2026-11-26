export type ListColorId = BoardTheme;
export type ListIconId = "circle" | "clock" | "check" | "flag" | "briefcase" | "star" | "calendar" | "todo";
export type BoardTheme = "default" | "blue" | "purple" | "coral" | "green" | "gold";
export type BoardWallpaper = "none" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10";
export type TaskColorId = "green" | "yellow" | "red";

export type BoardAppearance = {
  theme: BoardTheme;
  wallpaper: BoardWallpaper;
  wallpaperBlur: boolean;
};

export const defaultBoardAppearance: BoardAppearance = {
  theme: "default",
  wallpaper: "none",
  wallpaperBlur: false,
};

export type KanbanList = {
  id: string;
  name: string;
  color: ListColorId;
  icon: ListIconId;
};

export type Task = {
  id: string;
  title: string;
  description: string;
  dueDate: string;
  color: TaskColorId | null;
  listId: string;
  /** Position within the task's list. Contiguous from 0 after normalization. */
  order: number;
};

export type ArchivedTask = Task & { archivedAt: string };

export type Board = BoardAppearance & {
  id: string;
  name: string;
  lists: KanbanList[];
  tasks: Task[];
  archivedTasks?: ArchivedTask[];
};

type LegacyCard = {
  id: string;
  title: string;
  column: "todo" | "doing" | "done";
};

type LegacyBoard = {
  id: string;
  name: string;
  cards?: LegacyCard[];
  lists?: KanbanList[];
  tasks?: Task[];
  theme?: unknown;
  wallpaper?: unknown;
  wallpaperBlur?: unknown;
};

/** Tasks stored before explicit ordering existed carry no `order` field. */
type StoredTask = Partial<Task> & { id: string; title: string };

const listColorIds = new Set<ListColorId>(["default", "blue", "purple", "coral", "green", "gold"]);
const listIconIds = new Set<ListIconId>(["circle", "clock", "check", "flag", "briefcase", "star", "calendar", "todo"]);
const boardThemes = new Set<BoardTheme>(["default", "blue", "purple", "coral", "green", "gold"]);
const boardWallpapers = new Set<BoardWallpaper>(["none", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]);
const taskColorIds = new Set<TaskColorId>(["green", "yellow", "red"]);

export const defaultLists: KanbanList[] = [
  { id: "todo", name: "To do", color: "blue", icon: "circle" },
  { id: "doing", name: "Doing", color: "gold", icon: "clock" },
  { id: "done", name: "Done", color: "green", icon: "check" },
];

export const starterTasks: Task[] = [
  { id: "1", title: "Map the project shape", description: "", dueDate: "", color: null, listId: "todo", order: 0 },
  { id: "2", title: "Keep the first board simple", description: "", dueDate: "", color: null, listId: "doing", order: 0 },
  { id: "3", title: "Save cards locally", description: "", dueDate: "", color: null, listId: "done", order: 0 },
];

export const starterBoards: Board[] = [
  {
    id: "main",
    name: "Main board",
    ...defaultBoardAppearance,
    lists: defaultLists,
    tasks: starterTasks,
  },
];

function isListColor(value: unknown): value is ListColorId {
  return typeof value === "string" && listColorIds.has(value as ListColorId);
}

function isListIcon(value: unknown): value is ListIconId {
  return typeof value === "string" && listIconIds.has(value as ListIconId);
}

function isTaskColor(value: unknown): value is TaskColorId {
  return typeof value === "string" && taskColorIds.has(value as TaskColorId);
}

function cleanLists(value: unknown): KanbanList[] {
  if (!Array.isArray(value)) return defaultLists.map((list) => ({ ...list }));
  const lists = value
    .filter((list): list is Partial<KanbanList> & { id: string; name: string } => {
      return Boolean(list && typeof list === "object" && "id" in list && "name" in list && typeof list.id === "string" && typeof list.name === "string");
    })
    .map((list) => ({
      id: list.id,
      name: list.name.trim() || "Untitled list",
      color: isListColor(list.color) ? list.color : "blue",
      icon: isListIcon(list.icon) ? list.icon : "circle",
    }));
  return lists.length ? lists : defaultLists.map((list) => ({ ...list }));
}

/**
 * Rewrites task order so every list holds a contiguous 0..n-1 sequence and the
 * array itself is canonical: grouped in list order, ordered within each list.
 * A canonical array keeps `serializeBoardState` stable, so sync change
 * detection does not fire on reordering that produced the same board.
 *
 * Tasks with an equal or missing order keep their relative array position.
 */
export function normalizeTaskOrder(tasks: Task[], lists: KanbanList[]): Task[] {
  const positions = new Map(tasks.map((task, index) => [task.id, index]));
  const grouped = new Map<string, Task[]>(lists.map((list) => [list.id, []]));
  const fallbackListId = lists[0]?.id || "todo";
  // A task pointing at a deleted list carries an order from that list, which
  // says nothing about where it belongs here, so it goes to the end instead.
  const orphans: Task[] = [];

  for (const task of tasks) {
    const bucket = grouped.get(task.listId);
    if (bucket) bucket.push(task);
    else orphans.push({ ...task, listId: fallbackListId });
  }

  const ordered: Task[] = [];
  for (const [listId, bucket] of grouped) {
    bucket.sort((left, right) => {
      if (left.order !== right.order) return left.order - right.order;
      return (positions.get(left.id) ?? 0) - (positions.get(right.id) ?? 0);
    });
    if (listId === fallbackListId) bucket.push(...orphans);
    bucket.forEach((task, index) => {
      ordered.push(task.order === index ? task : { ...task, order: index });
    });
  }

  return ordered;
}

/** Tasks of one list, already in display order. */
export function tasksForList(tasks: Task[], listId: string): Task[] {
  return tasks.filter((task) => task.listId === listId).sort((left, right) => left.order - right.order);
}

function cleanTasks(value: unknown, lists: KanbanList[]): Task[] {
  if (!Array.isArray(value)) return [];
  const fallbackListId = lists[0]?.id || "todo";
  const listIds = new Set(lists.map((list) => list.id));
  const tasks = value
    .filter((task): task is StoredTask => {
      return Boolean(task && typeof task === "object" && "id" in task && "title" in task && typeof task.id === "string" && typeof task.title === "string");
    })
    .map((task, index) => ({
      id: task.id,
      // A blank title is a valid draft created by the detailed-task flow.
      title: task.title.trim(),
      description: typeof task.description === "string" ? task.description : "",
      dueDate: typeof task.dueDate === "string" ? task.dueDate : "",
      color: isTaskColor(task.color) ? task.color : null,
      listId: typeof task.listId === "string" && listIds.has(task.listId) ? task.listId : fallbackListId,
      // Documents written before ordering existed fall back to array position.
      order: typeof task.order === "number" && Number.isFinite(task.order) ? task.order : index,
    }));

  return normalizeTaskOrder(tasks, lists);
}

export function legacyCardsToTasks(value: unknown, lists: KanbanList[]): Task[] {
  if (!Array.isArray(value)) return [];
  const listIds = new Set(lists.map((list) => list.id));
  const cards = value
    .filter((card): card is LegacyCard => {
      return Boolean(
        card &&
          typeof card === "object" &&
          "id" in card &&
          "title" in card &&
          "column" in card &&
          typeof card.id === "string" &&
          typeof card.title === "string" &&
          typeof card.column === "string"
      );
    })
    .map((card, index) => ({
      id: card.id,
      title: card.title.trim() || "Untitled task",
      description: "",
      dueDate: "",
      color: null,
      listId: listIds.has(card.column) ? card.column : lists[0]?.id || "todo",
      order: index,
    }));

  return normalizeTaskOrder(cards, lists);
}

export function cleanBoards(value: unknown, appearanceFallback: BoardAppearance = defaultBoardAppearance): Board[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((board): board is LegacyBoard => {
      return Boolean(board && typeof board === "object" && "id" in board && "name" in board && typeof board.id === "string" && typeof board.name === "string");
    })
    .map((board) => {
      const lists = cleanLists(board.lists);
      // A board carries either the current task array or legacy cards, never both.
      const tasks = board.tasks ? cleanTasks(board.tasks, lists) : legacyCardsToTasks(board.cards, lists);
      return {
        id: board.id,
        name: board.name.trim() || "Untitled board",
        theme: typeof board.theme === "string" && boardThemes.has(board.theme as BoardTheme)
          ? board.theme as BoardTheme
          : appearanceFallback.theme,
        wallpaper: typeof board.wallpaper === "string" && boardWallpapers.has(board.wallpaper as BoardWallpaper)
          ? board.wallpaper as BoardWallpaper
          : appearanceFallback.wallpaper,
        wallpaperBlur: typeof board.wallpaperBlur === "boolean"
          ? board.wallpaperBlur
          : appearanceFallback.wallpaperBlur,
        lists,
        tasks,
      };
    });
}

export function serializeBoardState(boards: Board[], activeBoardId: string): string {
  return JSON.stringify({ boards, activeBoardId });
}
