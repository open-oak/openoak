import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "..");
const taskDialog = readFileSync(resolve(root, "components/task-detail-panel.tsx"), "utf8");
const sidebar = readFileSync(resolve(root, "components/ui/sidebar.tsx"), "utf8");

describe("Todo accessibility contracts", () => {
  it("restores task-dialog focus to the opener or a surviving task", () => {
    expect(taskDialog).toContain("returnFocusRef.current = document.activeElement");
    expect(taskDialog).toContain("onCloseAutoFocus");
    expect(taskDialog).toContain("if (target?.isConnected) target.focus()");
    expect(taskDialog).toContain('document.querySelector<HTMLElement>("[data-task-id]")?.focus()');
  });

  it("removes the closed mobile sidebar from accessibility and focus navigation", () => {
    expect(sidebar).toContain("aria-hidden={isMobile && !openMobile ? true : undefined}");
    expect(sidebar).toContain("inert={isMobile && !openMobile ? true : undefined}");
  });

  it("traps open-sidebar focus and restores it after Escape", () => {
    expect(sidebar).toContain('if (event.key === "Escape")');
    expect(sidebar).toContain('if (event.key !== "Tab") return');
    expect(sidebar).toContain("last.focus()");
    expect(sidebar).toContain("first.focus()");
    expect(sidebar).toContain("mobileReturnFocusRef.current?.focus()");
  });
});
