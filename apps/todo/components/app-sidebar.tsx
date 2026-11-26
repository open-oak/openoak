"use client";

import { Sun, Star, Calendar, Home, List as ListIcon, Plus, Search, PanelLeft, Settings, Users } from "lucide-react";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Fragment, useState, useTransition, useCallback, useEffect, useRef } from "react";
import { createList, reorderLists, toggleMyDay, toggleImportant, moveTaskToList } from "@/app/actions";
import { useAppStore } from "@/store/app-store";
import { useSidebarCounts } from "@/store/selectors";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  useSidebar,
} from "@/components/ui/sidebar";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const staticItems = [
  { icon: Sun, label: "My Day", href: "/" },
  { icon: Star, label: "Important", href: "/important" },
  { icon: Calendar, label: "Planned", href: "/planned" },
  { icon: Home, label: "Tasks", href: "/tasks" },
] as const;

const sidebarItemClass = "h-10 min-h-10 text-[14.5px] gap-2 px-3 rounded-2xl [&_svg]:size-4.5 [&_svg]:shrink-0 transition-all duration-200";
const sidebarActiveClass = "data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground data-[active=true]:shadow-sm data-[active=true]:ring-1 data-[active=true]:ring-sidebar-border/70";
const sidebarMobileItemClass = "max-md:h-14 max-md:text-base max-md:rounded-2xl";
const sidebarCollapsedItemClass = "group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0";
const sidebarLabelClass = "group-data-[collapsible=icon]:hidden flex-1 min-w-0 whitespace-nowrap overflow-hidden text-ellipsis leading-5";
const sidebarCountClass = "group-data-[collapsible=icon]:hidden ml-auto inline-flex min-w-5 items-center justify-center text-[11px] leading-none font-semibold text-foreground/55 dark:text-foreground/65";

export function AppSidebar() {
  const urlPathname = usePathname();
  const currentPath = useAppStore((s) => s.currentPath);
  const pathname = currentPath || urlPathname;
  const router = useRouter();
  const [, startTransition] = useTransition();
  const { setOpenMobile, toggleSidebar, state, setOpen, isMobile } = useSidebar();

  // Close fullscreen mobile sidebar when navigating to a new list
  useEffect(() => {
    setOpenMobile(false);
  }, [pathname, setOpenMobile]);

  // Close sidebar on any nav click (handles same-route clicks too)
  const closeSidebar = useCallback(() => setOpenMobile(false), [setOpenMobile])
  const setCurrentPath = useAppStore((s) => s.setCurrentPath);
  const navigateTo = useCallback((href: string) => {
    if (isMobile) {
      // On mobile, just close the sidebar — let the <Link> handle navigation
      // naturally. Avoids unnecessary store update + re-render during animation.
      closeSidebar();
      return;
    }
    setCurrentPath(href);
    closeSidebar();
  }, [isMobile, setCurrentPath, closeSidebar]);
  const [isCreating, setIsCreating] = useState(false);
  const [newListName, setNewListName] = useState("");
  const [dragOver, setDragOver] = useState<string | null>(null);

  const lists = useAppStore((s) => s.lists);
  const setLists = useAppStore((s) => s.setLists);
  const updateTaskOptimistic = useAppStore((s) => s.updateTaskOptimistic);
  const finishTaskMutation = useAppStore((s) => s.finishTaskMutation);
  const counts = useSidebarCounts();
  const glassEnabled = useAppStore((s) => s.glassEnabled);
  const defaultListId = useAppStore((s) => s.defaultListId);

  const ownedLists = lists.filter((list) => list.kind === "CUSTOM" && list.section === "owned");
  const joinedLists = lists.filter((list) => list.kind === "CUSTOM" && list.section === "joined");
  const visibleLists = [...ownedLists, ...joinedLists];

  const handleDrop = async (e: React.DragEvent, target: string, listId?: string) => {
    e.preventDefault();
    setDragOver(null);
    const taskId = e.dataTransfer.getData("text/plain");
    if (!taskId) return;

    startTransition(async () => {
      let result: { error: string } | void = undefined;
      let mutationVersion = 0;
      if (target === "my-day") {
        mutationVersion = updateTaskOptimistic(taskId, { isMyDay: true });
        result = await toggleMyDay(taskId, true);
      } else if (target === "important") {
        mutationVersion = updateTaskOptimistic(taskId, { isImportant: true });
        result = await toggleImportant(taskId, true);
      } else if (target === "tasks" && defaultListId) {
        mutationVersion = updateTaskOptimistic(taskId, { listId: defaultListId });
        result = await moveTaskToList(taskId, defaultListId);
      } else if (target.startsWith("list-") && listId) {
        mutationVersion = updateTaskOptimistic(taskId, { listId });
        result = await moveTaskToList(taskId, listId);
      }
      if (result?.error) toast.error(result.error);
      if (mutationVersion) finishTaskMutation(taskId, !result?.error, mutationVersion);
      router.refresh();
    });
  };

  const dragHandlers = (id: string, listId?: string) => ({
    "data-task-drop-target": "true" as const,
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(id);
    },
    onDragLeave: () => setDragOver(null),
    onDrop: (e: React.DragEvent) => handleDrop(e, id, listId),
  });

  const handleCreateList = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newListName.trim()) return;

    startTransition(async () => {
      const newList = await createList(newListName);
      if (!newList) {
        toast.error("Failed to create list");
        return;
      }
      setLists([...lists, newList]);
      setNewListName("");
      setIsCreating(false);
      router.push(`/lists/${newList.id}`);
      router.refresh();
    });
  };

  const handleListReorder = useCallback(
    (fromIndex: number, toIndex: number) => {
      if (fromIndex === toIndex) return;
      const current = [...ownedLists];
      const [moved] = current.splice(fromIndex, 1);
      current.splice(toIndex, 0, moved);
      const defaultLists = lists.filter((list) => list.kind === "DEFAULT");
      setLists([...defaultLists, ...current, ...joinedLists]);
      reorderLists(current.map((l) => l.id))
        .then((result) => {
          if (result?.error) toast.error(result.error);
        })
        .catch(() => toast.error("Failed to reorder lists"))
        .finally(() => router.refresh());
    },
    [ownedLists, joinedLists, lists, setLists, router]
  );

  // Touch drag for list reordering
  const [touchDragFrom, setTouchDragFrom] = useState<number | null>(null);
  const [touchDragOver, setTouchDragOver] = useState<number | null>(null);
  const touchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const touchActivatedRef = useRef(false);
  const touchDidDragRef = useRef(false);

  // Prevent scroll during active touch drag (non-passive)
  useEffect(() => {
    if (touchDragFrom === null) return;
    const prevent = (e: TouchEvent) => { if (touchActivatedRef.current) e.preventDefault(); };
    window.addEventListener("touchmove", prevent, { passive: false });
    return () => window.removeEventListener("touchmove", prevent);
  }, [touchDragFrom]);

  const handleListTouchStart = useCallback((index: number, e: React.TouchEvent) => {
    const touch = e.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
    touchActivatedRef.current = false;
    touchDidDragRef.current = false;
    touchTimerRef.current = setTimeout(() => {
      touchActivatedRef.current = true;
      touchDidDragRef.current = true;
      setTouchDragFrom(index);
      setTouchDragOver(index);
      navigator.vibrate?.(40);
    }, 500);
  }, []);

  const handleListTouchMove = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    const start = touchStartRef.current;
    if (!start) return;

    if (!touchActivatedRef.current) {
      const dist = Math.hypot(touch.clientX - start.x, touch.clientY - start.y);
      if (dist > 8) {
        // Moved too much before long-press fired — cancel
        if (touchTimerRef.current) { clearTimeout(touchTimerRef.current); touchTimerRef.current = null; }
      }
      return;
    }

    const el = document.elementFromPoint(touch.clientX, touch.clientY);
    const item = el?.closest("[data-list-index]");
    if (item) {
      setTouchDragOver(Number(item.getAttribute("data-list-index")));
    }
  }, []);

  const handleListTouchEnd = useCallback(() => {
    if (touchTimerRef.current) { clearTimeout(touchTimerRef.current); touchTimerRef.current = null; }
    if (touchActivatedRef.current && touchDragFrom !== null && touchDragOver !== null && touchDragFrom !== touchDragOver) {
      handleListReorder(touchDragFrom, touchDragOver);
    }
    touchActivatedRef.current = false;
    touchStartRef.current = null;
    setTouchDragFrom(null);
    setTouchDragOver(null);
  }, [touchDragFrom, touchDragOver, handleListReorder]);

  return (
    <Sidebar collapsible="icon" variant="floating" glass={glassEnabled}>
      <SidebarHeader className="min-h-[54px] pt-4 pb-2 px-4 max-md:pt-4 max-md:pb-2 max-md:px-4 flex items-center justify-center">
        <span className="flex h-[30px] items-center text-[19px] font-bold text-foreground whitespace-nowrap max-md:text-[22px] group-data-[collapsible=icon]:hidden">
          OpenTodo
        </span>
        <span className="hidden size-[30px] items-center justify-center text-xl leading-none group-data-[collapsible=icon]:flex" aria-hidden="true">
          ✅
        </span>
      </SidebarHeader>

      <SidebarContent className="px-2 max-md:px-1.5">
        <SidebarGroup className="pb-4 max-md:pb-0">
          <SidebarGroupContent>
            <SidebarMenu className="gap-1 max-md:gap-1">
              <SidebarMenuItem>
                <SidebarMenuButton
                  onClick={() => { window.dispatchEvent(new Event("open-search")); closeSidebar(); }}
                  tooltip="Search (Ctrl+K)"
                  className={cn(sidebarItemClass, sidebarMobileItemClass, sidebarCollapsedItemClass)}
                >
                  <Search />
                  <span className="group-data-[collapsible=icon]:hidden">Search</span>
                </SidebarMenuButton>
              </SidebarMenuItem>

              {staticItems.map((item) => {
                const isActive = pathname === item.href;
                const countMap: Record<string, number> = {
                  "/": counts.myDay,
                  "/important": counts.important,
                  "/planned": counts.planned,
                  "/tasks": counts.all,
                };
                const count = countMap[item.href] || 0;
                const dropTargetMap: Record<string, string> = {
                  "/": "my-day",
                  "/important": "important",
                  "/tasks": "tasks",
                };
                const dropTarget = dropTargetMap[item.href];

                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive}
                      tooltip={item.label}
                      className={cn(
                        sidebarItemClass,
                        sidebarMobileItemClass,
                        sidebarActiveClass,
                        sidebarCollapsedItemClass,
                        dragOver === (dropTarget || "") && "ring-2 ring-foreground/15 bg-foreground/5"
                      )}
                      {...(dropTarget ? dragHandlers(dropTarget) : {})}
                    >
                      <Link href={item.href} onClick={() => navigateTo(item.href)}>
                        <item.icon />
                        <span className={cn(sidebarLabelClass, isActive && "font-bold")}>
                          {item.label}
                        </span>
                        {count > 0 && (
                          <span className={sidebarCountClass}>
                            {count}
                          </span>
                        )}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup className="pt-2">
          <div className="h-8 mb-2 px-2 flex items-center">
            {/* Expanded: label text */}
            <span className="text-[11px] font-bold uppercase tracking-[0.15em] text-foreground/60 dark:text-foreground/70 group-data-[collapsible=icon]:hidden">
              My Lists
            </span>
            {/* Collapsed: divider line */}
            <div className="hidden h-[3px] w-full rounded-full bg-foreground/35 group-data-[collapsible=icon]:block" />
          </div>
          <SidebarGroupContent>
            <SidebarMenu className="gap-1 max-md:gap-1">
              {visibleLists.map((list, index) => {
                const href = `/lists/${list.id}`;
                const isActive = pathname === href;
                const count = counts.lists[list.id] || 0;
                const canReorder = list.section === "owned";
                const reorderIndex = canReorder ? ownedLists.findIndex((owned) => owned.id === list.id) : -1;
                const startsJoinedSection = list.section === "joined" && (index === 0 || visibleLists[index - 1]?.section !== "joined");

                const isTouchDragging = canReorder && touchDragFrom === reorderIndex;
                const isTouchDropTarget = canReorder && touchDragOver === reorderIndex && touchDragFrom !== null && touchDragFrom !== reorderIndex;

                return (
                  <Fragment key={list.id}>
                  {startsJoinedSection && (
                    <li className="px-3 pt-4 pb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-foreground/50 group-data-[collapsible=icon]:hidden">
                      Shared with me
                    </li>
                  )}
                  <SidebarMenuItem
                    data-list-index={canReorder ? reorderIndex : undefined}
                    draggable={canReorder}
                    onDragStart={(e) => {
                      if (!canReorder) return;
                      e.dataTransfer.setData("application/list-reorder", String(reorderIndex));
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onDragOver={(e) => {
                      if (e.dataTransfer.types.includes("application/list-reorder")) {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                      }
                      if (!e.dataTransfer.types.includes("application/list-reorder")) {
                        dragHandlers(`list-${list.id}`, list.id).onDragOver(e);
                      }
                    }}
                    onDragLeave={() => setDragOver(null)}
                    onDrop={(e) => {
                      if (e.dataTransfer.types.includes("application/list-reorder")) {
                        e.preventDefault();
                        const fromIndex = parseInt(e.dataTransfer.getData("application/list-reorder"));
                        if (canReorder) handleListReorder(fromIndex, reorderIndex);
                      } else {
                        handleDrop(e, `list-${list.id}`, list.id);
                      }
                    }}
                    onTouchStart={canReorder ? (e) => handleListTouchStart(reorderIndex, e) : undefined}
                    onTouchMove={canReorder ? handleListTouchMove : undefined}
                    onTouchEnd={canReorder ? handleListTouchEnd : undefined}
                    onContextMenu={(e) => e.preventDefault()}
                    className={cn(
                      isTouchDragging && "opacity-40",
                      isTouchDropTarget && "ring-2 ring-foreground/30 rounded-xl bg-foreground/5"
                    )}
                  >
                    <SidebarMenuButton
                      asChild
                      isActive={isActive}
                      tooltip={list.name}
                      className={cn(
                        sidebarItemClass,
                        sidebarMobileItemClass,
                        sidebarActiveClass,
                        sidebarCollapsedItemClass,
                        dragOver === `list-${list.id}` && "ring-2 ring-foreground/20 bg-foreground/5"
                      )}
                    >
                      <Link
                        href={href}
                        onClick={(e) => {
                          if (touchDidDragRef.current) { e.preventDefault(); return; }
                          navigateTo(href);
                        }}
                        onContextMenu={(e) => e.preventDefault()}
                      >
                        {list.section === "joined" || list.shared ? <Users aria-label="Shared list" /> : <ListIcon />}
                        <span className={cn(sidebarLabelClass, isActive && "font-bold")}>
                        {list.name}
                        </span>
                        {list.section === "joined" && count === 0 && <span className="sr-only">Shared with you</span>}
                        {count > 0 && (
                          <span className={sidebarCountClass}>
                            {count}
                          </span>
                        )}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  </Fragment>
                );
              })}

              {isCreating ? (
                <SidebarMenuItem>
                  <form onSubmit={handleCreateList} className="px-2 py-1 max-md:px-4">
                    <Input
                      autoFocus
                      type="text"
                      value={newListName}
                      onChange={(e) => setNewListName(e.target.value)}
                      onBlur={() => !newListName && setIsCreating(false)}
                      placeholder="List name"
                      className="h-9 text-[15px] max-md:h-11 max-md:text-base group-data-[collapsible=icon]:hidden"
                    />
                    <button type="submit" className="mt-2 h-9 w-full rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 group-data-[collapsible=icon]:hidden">Create list</button>
                  </form>
                </SidebarMenuItem>
              ) : (
                <SidebarMenuItem>
                  <SidebarMenuButton
                    onClick={() => { if (state === "collapsed") setOpen(true); setIsCreating(true); }}
                    className={cn(sidebarItemClass, sidebarMobileItemClass, sidebarCollapsedItemClass)}
                  >
                    <Plus />
                    <span className="group-data-[collapsible=icon]:hidden">New list</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

      </SidebarContent>

      <SidebarFooter className="p-4 max-md:pb-8">
        <SidebarMenu className="gap-2">
          {/* Collapse toggle — desktop only */}
          <SidebarMenuItem className="md:block hidden">
            <SidebarMenuButton
              onClick={toggleSidebar}
              tooltip="Collapse Sidebar"
              className={cn(sidebarItemClass, sidebarCollapsedItemClass)}
            >
              <PanelLeft />
              <span className="group-data-[collapsible=icon]:hidden">Collapse Sidebar</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          {/* Settings */}
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={() => { window.dispatchEvent(new Event("open-settings")); closeSidebar(); }}
              className={cn(sidebarItemClass, sidebarMobileItemClass, sidebarCollapsedItemClass)}
              tooltip="Settings"
            >
              <Settings />
              <span className="group-data-[collapsible=icon]:hidden">Settings</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
