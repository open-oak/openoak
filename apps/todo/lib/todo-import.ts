// Parse task data from other apps into one neutral shape. This module is pure:
// it does not touch the database, so the parsers are easy to test.
//
// Supported inputs:
// - Microsoft To Do data as Microsoft Graph JSON. This is what the open-source
//   "Microsoft To Do Export" tool writes with `--type json`
//   (https://github.com/daylamtayari/Microsoft-To-Do-Export): an array of lists,
//   each with a `tasks` array. A raw Graph response (`{ value: [...] }`) also works.
// - The generic CSV of the same tool (`--type csv`): Type, ID, Title, Status, Note, Due Date.
// - Plain text: one task per line, indented lines are steps, `# Name` starts a list.

import {
  MAX_LIST_NAME_LENGTH,
  MAX_SUBTASK_TITLE_LENGTH,
  MAX_TASK_NOTES_LENGTH,
  MAX_TASK_TITLE_LENGTH,
} from "./todo-validation";

// Vercel functions accept request bodies up to 4.5 MB.
export const MAX_IMPORT_BYTES = 4 * 1024 * 1024;
export const MAX_IMPORT_LISTS = 500;
export const MAX_IMPORT_TASKS = 20_000;
export const MAX_IMPORT_STEPS_PER_TASK = 200;

export type ImportedStep = { title: string; isCompleted: boolean };

export type ImportedTask = {
  title: string;
  notes: string | null;
  dueDate: Date | null;
  isCompleted: boolean;
  isImportant: boolean;
  /** Original creation time. Used to keep the order and to skip repeat imports. */
  createdAt: Date | null;
  steps: ImportedStep[];
};

export type ImportedList = {
  name: string;
  /** The source app's default list ("Tasks"). It goes into the OpenTodo default list. */
  isDefault: boolean;
  tasks: ImportedTask[];
};

export type ImportDocument = {
  source: "microsoft-to-do" | "text";
  lists: ImportedList[];
  /** Counts of source data that OpenTodo cannot hold yet. Shown to the user. */
  skipped: { flaggedEmailLists: number; attachments: number };
};

export class ImportFormatError extends Error {}

// ---------------------------------------------------------------------------
// Detection

export function parseImportFile(filename: string, text: string): ImportDocument {
  const trimmed = text.replace(/^﻿/, "").trim();
  if (!trimmed) throw new ImportFormatError("The file is empty.");
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    let data: unknown;
    try {
      data = JSON.parse(trimmed);
    } catch {
      throw new ImportFormatError("The file is not valid JSON.");
    }
    return parseMicrosoftGraphJson(data);
  }
  if (/^\s*"?Type"?\s*,\s*"?ID"?\s*,\s*"?Title"?/i.test(trimmed) || filename.toLowerCase().endsWith(".csv")) {
    return parseMicrosoftExportCsv(trimmed);
  }
  throw new ImportFormatError("This file type is not supported. Use the JSON or CSV file from Microsoft To Do Export, or paste your tasks as text.");
}

// ---------------------------------------------------------------------------
// Microsoft Graph JSON

type GraphDateTime = { dateTime?: unknown; timeZone?: unknown } | null | undefined;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

export function parseMicrosoftGraphJson(data: unknown): ImportDocument {
  const root = asRecord(data);
  const rawLists = Array.isArray(data) ? data : Array.isArray(root?.value) ? root.value as unknown[] : root && Array.isArray(root.lists) ? root.lists as unknown[] : null;
  if (!rawLists) throw new ImportFormatError("This JSON file does not look like a Microsoft To Do export.");

  const document: ImportDocument = { source: "microsoft-to-do", lists: [], skipped: { flaggedEmailLists: 0, attachments: 0 } };
  for (const rawList of rawLists) {
    const list = asRecord(rawList);
    if (!list) continue;
    const name = asString(list.displayName ?? list.name);
    const rawTasks = Array.isArray(list.tasks) ? list.tasks : [];
    if (!name && rawTasks.length === 0) continue;
    if (list.wellknownListName === "flaggedEmails" || list.wellKnownListName === "flaggedEmails") {
      document.skipped.flaggedEmailLists += 1;
      continue;
    }
    const tasks: ImportedTask[] = [];
    for (const rawTask of rawTasks) {
      const task = parseGraphTask(rawTask);
      if (!task) continue;
      tasks.push(task.task);
      if (task.hasAttachments) document.skipped.attachments += 1;
    }
    const wellKnown = asString(list.wellknownListName ?? list.wellKnownListName);
    document.lists.push({ name: cleanName(name) || "Imported tasks", isDefault: wellKnown === "defaultList", tasks });
  }
  if (document.lists.length === 0 && document.skipped.flaggedEmailLists === 0) {
    throw new ImportFormatError("No lists were found in this file.");
  }
  return limitDocument(document);
}

function parseGraphTask(value: unknown): { task: ImportedTask; hasAttachments: boolean } | null {
  const task = asRecord(value);
  if (!task) return null;
  const title = cleanTitle(asString(task.title));
  if (!title) return null;
  const body = asRecord(task.body);
  const content = asString(body?.content);
  const bodyText = asString(body?.contentType).toLowerCase() === "html" ? htmlToText(content) : content;

  const extra: string[] = [];
  const recurrence = describeRecurrence(task.recurrence);
  if (recurrence) extra.push(`Repeats: ${recurrence}`);
  const reminder = task.isReminderOn !== false ? formatGraphDateTime(task.reminderDateTime as GraphDateTime, true) : null;
  if (reminder) extra.push(`Reminder: ${reminder}`);
  const start = formatGraphDateTime(task.startDateTime as GraphDateTime, false);
  if (start) extra.push(`Start date: ${start}`);
  const categories = Array.isArray(task.categories) ? task.categories.filter((c): c is string => typeof c === "string" && c.trim() !== "") : [];
  if (categories.length) extra.push(`Categories: ${categories.join(", ")}`);
  const hasAttachments = task.hasAttachments === true;
  if (hasAttachments) extra.push("Had attachments in Microsoft To Do. They were not imported.");

  const steps = (Array.isArray(task.checklistItems) ? task.checklistItems : [])
    .map(asRecord)
    .filter((item): item is Record<string, unknown> => item !== null)
    .map((item) => ({ title: cleanStep(asString(item.displayName)), isCompleted: item.isChecked === true }))
    .filter((step) => step.title)
    .slice(0, MAX_IMPORT_STEPS_PER_TASK);

  return {
    hasAttachments,
    task: {
      title,
      notes: buildNotes(bodyText, extra),
      dueDate: graphDueDate(task.dueDateTime as GraphDateTime),
      isCompleted: asString(task.status).toLowerCase() === "completed",
      isImportant: asString(task.importance).toLowerCase() === "high",
      createdAt: parseInstant(task.createdDateTime),
      steps,
    },
  };
}

/** A due date is a calendar day. Store it at 12:00 UTC so it shows on the same day in every time zone between UTC-11 and UTC+11. */
export function calendarDay(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  return Number.isNaN(date.getTime()) || date.getUTCDate() !== day ? null : date;
}

function graphDueDate(value: GraphDateTime) {
  const match = asString(value?.dateTime).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? calendarDay(Number(match[1]), Number(match[2]), Number(match[3])) : null;
}

function parseInstant(value: unknown) {
  const text = asString(value);
  if (!text) return null;
  const date = new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(text) ? text : `${text}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatGraphDateTime(value: GraphDateTime, withTime: boolean) {
  const match = asString(value?.dateTime).match(/^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}))?/);
  if (!match) return null;
  const zone = asString(value?.timeZone);
  if (!withTime || !match[2]) return match[1];
  return `${match[1]} ${match[2]}${zone ? ` (${zone})` : ""}`;
}

const DAY_NAMES: Record<string, string> = {
  monday: "Monday", tuesday: "Tuesday", wednesday: "Wednesday", thursday: "Thursday",
  friday: "Friday", saturday: "Saturday", sunday: "Sunday",
};

export function describeRecurrence(value: unknown): string | null {
  const recurrence = asRecord(value);
  const pattern = asRecord(recurrence?.pattern);
  if (!pattern) return null;
  const type = asString(pattern.type);
  const interval = typeof pattern.interval === "number" && pattern.interval > 1 ? pattern.interval : 1;
  const every = (unit: string) => (interval === 1 ? `every ${unit}` : `every ${interval} ${unit}s`);
  const days = (Array.isArray(pattern.daysOfWeek) ? pattern.daysOfWeek : [])
    .map((day) => DAY_NAMES[asString(day).toLowerCase()])
    .filter(Boolean);
  switch (type) {
    case "daily":
      return every("day");
    case "weekly":
      return days.length ? `${every("week")} on ${days.join(", ")}` : every("week");
    case "absoluteMonthly":
      return typeof pattern.dayOfMonth === "number" && pattern.dayOfMonth > 0 ? `${every("month")} on day ${pattern.dayOfMonth}` : every("month");
    case "relativeMonthly":
      return `${every("month")}${days.length ? ` on the ${asString(pattern.index) || "first"} ${days.join(", ")}` : ""}`;
    case "absoluteYearly":
    case "relativeYearly":
      return every("year");
    default:
      return type ? `${every("period")} (${type})` : null;
  }
}

export function htmlToText(html: string) {
  return html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*\/(p|div|li|h[1-6])\s*>/gi, "\n")
    .replace(/<\s*li[^>]*>/gi, "- ")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function buildNotes(body: string, extra: string[]) {
  const parts = [body.trim()];
  if (extra.length) parts.push(`Imported from Microsoft To Do:\n${extra.join("\n")}`);
  const notes = parts.filter(Boolean).join("\n\n");
  return notes ? notes.slice(0, MAX_TASK_NOTES_LENGTH) : null;
}

// ---------------------------------------------------------------------------
// Microsoft To Do Export generic CSV

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === "\"") {
        if (text[i + 1] === "\"") { field += "\""; i += 1; } else quoted = false;
      } else field += char;
    } else if (char === "\"") quoted = true;
    else if (char === ",") { row.push(field); field = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += char;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

export function parseMicrosoftExportCsv(text: string): ImportDocument {
  const rows = parseCsv(text);
  const header = rows.shift()?.map((cell) => cell.trim().toLowerCase()) ?? [];
  const column = (name: string) => header.indexOf(name);
  const [typeAt, titleAt, statusAt, noteAt, dueAt] = ["type", "title", "status", "note", "due date"].map(column);
  if (typeAt < 0 || titleAt < 0) throw new ImportFormatError("This CSV file does not look like a Microsoft To Do Export file.");

  const document: ImportDocument = { source: "microsoft-to-do", lists: [], skipped: { flaggedEmailLists: 0, attachments: 0 } };
  let list: ImportedList | null = null;
  let task: ImportedTask | null = null;
  for (const row of rows) {
    const type = (row[typeAt] ?? "").trim().toLowerCase();
    const title = row[titleAt] ?? "";
    if (type === "list") {
      list = { name: cleanName(title) || "Imported tasks", isDefault: false, tasks: [] };
      document.lists.push(list);
      task = null;
    } else if (type === "task") {
      if (!list) { list = { name: "Imported tasks", isDefault: false, tasks: [] }; document.lists.push(list); }
      const cleanTitleValue = cleanTitle(title);
      if (!cleanTitleValue) { task = null; continue; }
      const due = (row[dueAt] ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
      task = {
        title: cleanTitleValue,
        notes: buildNotes(row[noteAt] ?? "", []),
        dueDate: due ? calendarDay(Number(due[1]), Number(due[2]), Number(due[3])) : null,
        isCompleted: (row[statusAt] ?? "").trim().toLowerCase() === "completed",
        isImportant: false,
        createdAt: null,
        steps: [],
      };
      list.tasks.push(task);
    } else if (type === "step" && task && task.steps.length < MAX_IMPORT_STEPS_PER_TASK) {
      const stepTitle = cleanStep(title);
      if (stepTitle) task.steps.push({ title: stepTitle, isCompleted: (row[statusAt] ?? "").trim().toLowerCase() === "true" });
    }
  }
  if (document.lists.length === 0) throw new ImportFormatError("No lists were found in this file.");
  // The tool writes the default list as "Tasks".
  for (const item of document.lists) item.isDefault = item.name === "Tasks";
  if (document.lists.filter((item) => item.isDefault).length > 1) document.lists.forEach((item) => { item.isDefault = false; });
  return limitDocument(document);
}

// ---------------------------------------------------------------------------
// Plain text

const BULLET = /^(?:[-*+•◦▪‣○◯●□■☐☑☒✓✔✗✘]|\[[ xX✓]?\]|\(\s?\)|\d{1,3}[.)])\s+/;
const DONE_MARK = /^(?:\[[xX✓]\]|[☑☒✓✔])\s+/;

export function parsePlainText(text: string, defaultListName: string): ImportDocument {
  const document: ImportDocument = { source: "text", lists: [], skipped: { flaggedEmailLists: 0, attachments: 0 } };
  const fallbackName = cleanName(defaultListName) || "Imported tasks";
  let list: ImportedList | null = null;
  let task: ImportedTask | null = null;

  for (const rawLine of text.replace(/^﻿/, "").replace(/\r\n?/g, "\n").split("\n")) {
    if (!rawLine.trim()) continue;
    const indent = rawLine.match(/^[ \t]*/)?.[0].replace(/\t/g, "    ").length ?? 0;
    let line = rawLine.trim();

    const heading = line.match(/^#{1,6}\s+(.+)$/);
    if (heading) {
      list = { name: cleanName(heading[1]) || fallbackName, isDefault: false, tasks: [] };
      document.lists.push(list);
      task = null;
      continue;
    }

    const isCompleted = DONE_MARK.test(line);
    line = line.replace(BULLET, "").trim();
    if (!line) continue;

    if (indent >= 2 && task) {
      const title = cleanStep(line);
      if (title && task.steps.length < MAX_IMPORT_STEPS_PER_TASK) task.steps.push({ title, isCompleted });
      continue;
    }

    if (!list) {
      list = { name: fallbackName, isDefault: false, tasks: [] };
      document.lists.push(list);
    }
    const title = cleanTitle(line);
    if (!title) continue;
    task = { title, notes: null, dueDate: null, isCompleted, isImportant: false, createdAt: null, steps: [] };
    list.tasks.push(task);
  }

  document.lists = document.lists.filter((item) => item.tasks.length > 0);
  if (document.lists.length === 0) throw new ImportFormatError("No tasks were found. Paste one task per line.");
  return limitDocument(document);
}

// ---------------------------------------------------------------------------
// Shared helpers

function cleanTitle(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, MAX_TASK_TITLE_LENGTH);
}

function cleanStep(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, MAX_SUBTASK_TITLE_LENGTH);
}

function cleanName(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, MAX_LIST_NAME_LENGTH);
}

function limitDocument(document: ImportDocument): ImportDocument {
  if (document.lists.length > MAX_IMPORT_LISTS) {
    throw new ImportFormatError(`This import has more than ${MAX_IMPORT_LISTS} lists. Split it into smaller files.`);
  }
  const taskCount = document.lists.reduce((sum, list) => sum + list.tasks.length, 0);
  if (taskCount > MAX_IMPORT_TASKS) {
    throw new ImportFormatError(`This import has more than ${MAX_IMPORT_TASKS.toLocaleString("en-US")} tasks. Split it into smaller files.`);
  }
  return document;
}
