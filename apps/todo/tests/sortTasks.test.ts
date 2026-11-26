import { describe, expect, it } from "vitest";
import { sortTasks } from "@/store/selectors";

describe("sortTasks", () => {
  it("sorts by due date and keeps undated tasks last", () => {
    const tasks = [
      {
        title: "No date",
        isImportant: false,
        dueDate: null,
        createdAt: new Date("2026-01-03T10:00:00.000Z"),
      },
      {
        title: "Later",
        isImportant: false,
        dueDate: new Date("2026-01-05T10:00:00.000Z"),
        createdAt: new Date("2026-01-02T10:00:00.000Z"),
      },
      {
        title: "Earlier",
        isImportant: false,
        dueDate: new Date("2026-01-01T10:00:00.000Z"),
        createdAt: new Date("2026-01-01T09:00:00.000Z"),
      },
    ];

    const asc = sortTasks(tasks, "due", "asc").map((task) => task.title);
    const desc = sortTasks(tasks, "due", "desc").map((task) => task.title);

    expect(asc).toEqual(["Earlier", "Later", "No date"]);
    expect(desc).toEqual(["Later", "Earlier", "No date"]);
  });

  it("uses createdAt and title as tie-breakers for equal due dates", () => {
    const tasks = [
      {
        title: "B",
        isImportant: false,
        dueDate: new Date("2026-01-01T10:00:00.000Z"),
        createdAt: new Date("2026-01-02T10:00:00.000Z"),
      },
      {
        title: "A",
        isImportant: false,
        dueDate: new Date("2026-01-01T10:00:00.000Z"),
        createdAt: new Date("2026-01-01T10:00:00.000Z"),
      },
    ];

    const sorted = sortTasks(tasks, "due", "asc").map((task) => task.title);

    expect(sorted).toEqual(["A", "B"]);
  });

  it("sorts by creation date independent of incoming order", () => {
    const tasks = [
      {
        title: "Middle",
        isImportant: false,
        createdAt: new Date("2026-01-02T10:00:00.000Z"),
      },
      {
        title: "Newest",
        isImportant: false,
        createdAt: new Date("2026-01-03T10:00:00.000Z"),
      },
      {
        title: "Oldest",
        isImportant: false,
        createdAt: new Date("2026-01-01T10:00:00.000Z"),
      },
    ];

    const asc = sortTasks(tasks, "created", "asc").map((task) => task.title);
    const desc = sortTasks(tasks, "created", "desc").map((task) => task.title);

    expect(asc).toEqual(["Oldest", "Middle", "Newest"]);
    expect(desc).toEqual(["Newest", "Middle", "Oldest"]);
  });

  it("treats descending importance as important tasks first", () => {
    const tasks = [
      { title: "Regular", isImportant: false, createdAt: new Date("2026-01-01T10:00:00.000Z") },
      { title: "Important", isImportant: true, createdAt: new Date("2026-01-02T10:00:00.000Z") },
    ];

    expect(sortTasks(tasks, "importance", "desc").map((task) => task.title)).toEqual(["Important", "Regular"]);
    expect(sortTasks(tasks, "importance", "asc").map((task) => task.title)).toEqual(["Regular", "Important"]);
  });
});
