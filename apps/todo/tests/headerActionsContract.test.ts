import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "..");
const pageHeader = readFileSync(resolve(root, "components/page-header.tsx"), "utf8");
const actionsMenu = readFileSync(resolve(root, "components/header-actions-menu.tsx"), "utf8");
const listPageHeader = readFileSync(resolve(root, "components/list-page-header.tsx"), "utf8");

describe("Todo desktop header actions", () => {
  it("moves the save indicator and menu together when they reach the content", () => {
    expect(pageHeader).toContain("floatingActionsRef");
    expect(pageHeader).toContain("floatingRect.left < contentRect.right + 8");
    expect(pageHeader).toContain("pendingTaskMutations");
  });

  it("uses the same corner radius for the save indicator and menu button", () => {
    expect(pageHeader).toContain('const actionSurfaceClass = cn("rounded-xl');
    expect(pageHeader).toContain("min-w-[5.625rem]");
    expect(pageHeader).toContain("<SaveIndicator");
    expect(pageHeader).toContain("renderActions(buttonClass)");
  });

  it("places list sharing in its own desktop and mobile menu sections", () => {
    expect(actionsMenu).toContain("<DropdownMenuLabel>Sharing</DropdownMenuLabel>");
    expect(actionsMenu).toContain("<SheetSectionLabel>Sharing</SheetSectionLabel>");
    expect(actionsMenu.indexOf("<DropdownMenuLabel>Appearance</DropdownMenuLabel>"))
      .toBeLessThan(actionsMenu.indexOf("<DropdownMenuLabel>Sharing</DropdownMenuLabel>"));
  });

  it("does not repeat the shared member count below an owned list title", () => {
    expect(listPageHeader).not.toContain("Shared with {list.memberCount}");
    expect(listPageHeader).toContain("Shared by {list.ownerDisplay} · You can edit");
  });
});
