import { describe, expect, it } from "vitest";
import {
  ImportFormatError,
  describeRecurrence,
  htmlToText,
  parseCsv,
  parseImportFile,
  parsePlainText,
} from "@/lib/todo-import";

// Shape written by Microsoft To Do Export (`export --type json`), which mirrors Microsoft Graph.
const graphExport = [
  {
    displayName: "Tasks",
    id: "list-default",
    isOwner: true,
    isShared: false,
    wellKnownListName: "defaultList",
    tasks: [
      {
        id: "t1",
        status: "notStarted",
        title: "Pay rent",
        importance: "high",
        isReminderOn: true,
        createdDateTime: "2026-01-10T18:36:12.0646821Z",
        hasAttachments: false,
        categories: ["Home"],
        body: { content: "Transfer before the 1st", contentType: "text" },
        dueDateTime: { dateTime: "2026-02-01T00:00:00.0000000", timeZone: "UTC" },
        reminderDateTime: { dateTime: "2026-01-31T09:00:00.0000000", timeZone: "UTC" },
        recurrence: {
          pattern: { type: "absoluteMonthly", interval: 1, dayOfMonth: 1, daysOfWeek: [] },
          range: { type: "noEnd", startDate: "2026-02-01" },
        },
        checklistItems: [
          { displayName: "Check balance", isChecked: true, id: "c1", createdDatetime: "2026-01-10T18:40:00Z" },
          { displayName: "  ", isChecked: false, id: "c2" },
        ],
      },
      {
        id: "t2",
        status: "completed",
        title: "Old task",
        importance: "normal",
        createdDateTime: "2025-12-01T08:00:00Z",
        hasAttachments: true,
        body: { content: "<p>Line one<br>Line &amp; two</p>", contentType: "html" },
        checklistItems: [],
      },
    ],
  },
  {
    displayName: "Groceries",
    id: "list-2",
    wellKnownListName: "none",
    tasks: [{ id: "t3", title: "Milk", status: "notStarted", importance: "normal", createdDateTime: "2026-03-03T10:00:00Z", body: { content: "", contentType: "text" } }],
  },
  { displayName: "Flagged email", id: "list-3", wellKnownListName: "flaggedEmails", tasks: [{ id: "t4", title: "Re: invoice" }] },
];

describe("Microsoft To Do JSON import", () => {
  const document = parseImportFile("mstodo_export.json", JSON.stringify(graphExport));

  it("keeps lists and maps the default list", () => {
    expect(document.source).toBe("microsoft-to-do");
    expect(document.lists.map((list) => [list.name, list.isDefault])).toEqual([["Tasks", true], ["Groceries", false]]);
    expect(document.skipped).toEqual({ flaggedEmailLists: 1, attachments: 1 });
  });

  it("maps task fields, steps, and extra details into notes", () => {
    const [rent, old] = document.lists[0].tasks;
    expect(rent).toMatchObject({ title: "Pay rent", isCompleted: false, isImportant: true });
    expect(rent.dueDate?.toISOString()).toBe("2026-02-01T12:00:00.000Z");
    expect(rent.createdAt?.toISOString()).toBe("2026-01-10T18:36:12.064Z");
    expect(rent.steps).toEqual([{ title: "Check balance", isCompleted: true }]);
    expect(rent.notes).toContain("Transfer before the 1st");
    expect(rent.notes).toContain("Repeats: every month on day 1");
    expect(rent.notes).toContain("Reminder: 2026-01-31 09:00 (UTC)");
    expect(rent.notes).toContain("Categories: Home");

    expect(old.isCompleted).toBe(true);
    expect(old.notes).toContain("Line one\nLine & two");
    expect(old.notes).toContain("attachments");
  });

  it("accepts a raw Graph response with a value array", () => {
    const result = parseImportFile("lists.json", JSON.stringify({ value: [{ displayName: "Work", tasks: [] }] }));
    expect(result.lists).toEqual([{ name: "Work", isDefault: false, tasks: [] }]);
  });

  it("rejects JSON that is not an export", () => {
    expect(() => parseImportFile("x.json", JSON.stringify({ hello: "world" }))).toThrow(ImportFormatError);
    expect(() => parseImportFile("x.json", "{ broken")).toThrow(ImportFormatError);
    expect(() => parseImportFile("x.txt", "hello")).toThrow(ImportFormatError);
  });
});

describe("Microsoft To Do Export CSV import", () => {
  const csv = [
    "Type,ID,Title,Status,Note,Due Date",
    "list,l1,Tasks,,,",
    "task,t1,\"Buy milk, eggs\",notStarted,\"Note with \"\"quotes\"\"\nand a new line\",2026-01-12 00:00:00 +0000 UTC",
    "step,s1,Eggs,true,,",
    "list,l2,Work,,,",
    "task,t2,Report,completed,,",
    "",
  ].join("\n");

  it("parses lists, tasks and steps", () => {
    const document = parseImportFile("mstodo_export.csv", csv);
    expect(document.lists.map((list) => [list.name, list.isDefault])).toEqual([["Tasks", true], ["Work", false]]);
    const [task] = document.lists[0].tasks;
    expect(task.title).toBe("Buy milk, eggs");
    expect(task.notes).toBe("Note with \"quotes\"\nand a new line");
    expect(task.dueDate?.toISOString()).toBe("2026-01-12T12:00:00.000Z");
    expect(task.steps).toEqual([{ title: "Eggs", isCompleted: true }]);
    expect(document.lists[1].tasks[0].isCompleted).toBe(true);
  });

  it("parses quoted CSV fields", () => {
    expect(parseCsv("a,\"b,c\",\"d\"\"e\"\r\n1,2,3")).toEqual([["a", "b,c", "d\"e"], ["1", "2", "3"]]);
  });
});

describe("Plain text import", () => {
  it("reads tasks, indented steps, done marks and list headings", () => {
    const document = parsePlainText([
      "○ Buy groceries",
      "    - Milk",
      "\t[x] Bread",
      "[x] Call the dentist",
      "",
      "# Work",
      "1. Send the report",
    ].join("\n"), "From To Do");

    expect(document.source).toBe("text");
    expect(document.lists.map((list) => list.name)).toEqual(["From To Do", "Work"]);
    expect(document.lists[0].tasks).toEqual([
      expect.objectContaining({ title: "Buy groceries", isCompleted: false, steps: [{ title: "Milk", isCompleted: false }, { title: "Bread", isCompleted: true }] }),
      expect.objectContaining({ title: "Call the dentist", isCompleted: true, steps: [] }),
    ]);
    expect(document.lists[1].tasks[0].title).toBe("Send the report");
  });

  it("uses a fallback list name and rejects empty input", () => {
    expect(parsePlainText("One", "  ").lists[0].name).toBe("Imported tasks");
    expect(() => parsePlainText("\n\n# Empty\n", "x")).toThrow(ImportFormatError);
  });
});

describe("Import helpers", () => {
  it("describes recurrence patterns", () => {
    expect(describeRecurrence({ pattern: { type: "daily", interval: 1 } })).toBe("every day");
    expect(describeRecurrence({ pattern: { type: "weekly", interval: 2, daysOfWeek: ["monday", "friday"] } })).toBe("every 2 weeks on Monday, Friday");
    expect(describeRecurrence({ pattern: { type: "absoluteYearly", interval: 1 } })).toBe("every year");
    expect(describeRecurrence(null)).toBeNull();
  });

  it("turns note HTML into text", () => {
    expect(htmlToText("<div>A</div><ul><li>B</li></ul>&lt;tag&gt;")).toBe("A\n- B\n<tag>");
  });
});
