export interface Subtask {
  id: string;
  title: string;
  isCompleted: boolean;
}

export interface Task {
  id: string;
  title: string;
  notes: string | null;
  isCompleted: boolean;
  isImportant: boolean;
  isMyDay: boolean;
  listId: string;
  dueDate: Date | null;
  sortOrder: number;
  subtasks: Subtask[];
  createdAt: Date;
  updatedAt: Date;
  createdById?: string;
  list?: { name: string } | null;
}

export interface ListItem {
  id: string;
  name: string;
  themeColor: string | null;
  backgroundImage: string | null;
  sortOrder: number;
  ownerId: string;
  kind: "DEFAULT" | "CUSTOM";
  accessLevel: "owner" | "editor";
  ownerDisplay: string;
  shared: boolean;
  memberCount: number;
  section: "owned" | "joined";
  createdAt: Date;
  updatedAt: Date;
}

export interface UserSettings {
  id: string;
  themeColor: string | null;
  myDayTheme: string | null;
  importantTheme: string | null;
  plannedTheme: string | null;
  tasksTheme: string | null;
  myDayBg: string | null;
  importantBg: string | null;
  plannedBg: string | null;
  tasksBg: string | null;
}

export interface SidebarCounts {
  myDay: number;
  important: number;
  importantAny: number;
  planned: number;
  plannedAny: number;
  all: number;
  lists: Record<string, number>;
}

export type SmartListType = "my-day" | "important" | "planned" | "tasks";

export type SortOption = "created" | "alpha" | "importance" | "due" | "custom";
export type SortDirection = "asc" | "desc";

export const TASK_PAGE_SIZE = 100;

export type TaskPageScope =
  | { kind: "my-day" }
  | { kind: "important" }
  | { kind: "planned" }
  | { kind: "tasks" }
  | { kind: "list"; listId: string };

export interface TaskPageRequest {
  scope: TaskPageScope;
  completed: boolean;
  sort: SortOption;
  direction: SortDirection;
  cursor?: string | null;
  limit?: number;
}

export interface TaskPageResult<T> {
  items: T[];
  totalCount: number;
  nextCursor: string | null;
}

export interface TaskViewRequest {
  scope: TaskPageScope;
  sort: SortOption;
  direction: SortDirection;
  activeCursor?: string | null;
  completedCursor?: string | null;
  limit?: number;
}

export interface TaskViewResult<T> {
  active: TaskPageResult<T>;
  completed: TaskPageResult<T>;
}
