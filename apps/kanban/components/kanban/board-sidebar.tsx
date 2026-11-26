"use client";

import { KanbanSquare, PanelLeft, Plus, Settings, Users } from "lucide-react";
import type { Board, KanbanList } from "@/lib/kanban-data";
import { cn } from "@/lib/utils";
import type { SyncStatus } from "./constants";
import { ListIcon, SyncBadge } from "./primitives";

export function BoardSidebar({
  boards, sharedBoards = {},
  activeBoardId,
  lists,
  boardCounts,
  listCounts,
  syncStatus,
  glass,
  collapsed,
  mobileOpen,
  newBoardName,
  onNewBoardNameChange,
  onCreateBoard,
  onCreateQuickBoard,
  onSelectBoard,
  onJumpToList,
  onToggleCollapsed,
  onExpand,
  onOpenSettings,
}: {
  boards: Board[]; sharedBoards?: Record<string, boolean>;
  activeBoardId: string;
  lists: KanbanList[];
  boardCounts: Record<string, number>;
  listCounts: Record<string, number>;
  syncStatus: SyncStatus;
  glass: boolean;
  collapsed: boolean;
  mobileOpen: boolean;
  newBoardName: string;
  onNewBoardNameChange: (value: string) => void;
  onCreateBoard: (event: React.FormEvent) => void;
  onCreateQuickBoard: () => void;
  onSelectBoard: (boardId: string) => void;
  onJumpToList: (listId: string) => void;
  onToggleCollapsed: () => void;
  onExpand: () => void;
  onOpenSettings: () => void;
}) {
  return (
    <aside className={cn("app-sidebar", collapsed && "app-sidebar-collapsed", mobileOpen && "app-sidebar-mobile-open", !glass && "solid-surface")}>
      <div className="sidebar-surface">
        <div className="sidebar-rail" aria-label="Collapsed sidebar">
        <div className="rail-header">
          <span className="rail-brand" aria-hidden="true">📋</span>
        </div>

        <div className="rail-content">
          <nav className="rail-nav" aria-label="Boards">
            <div className="rail-section-marker" aria-hidden="true">
              <span />
            </div>
            {boards.map((board) => (
              <button
                key={board.id}
                className={cn("icon-button rail-button", board.id === activeBoardId && "rail-button-active")}
                onClick={() => onSelectBoard(board.id)}
                aria-label={board.name}
                aria-current={board.id === activeBoardId ? "true" : undefined}
                title={board.name}
              >
                {sharedBoards[board.id] ? <Users className="size-4" aria-label="Shared board" /> : <KanbanSquare className="size-4" aria-hidden="true" />}
              </button>
            ))}
            <button className="icon-button rail-button" onClick={onCreateQuickBoard} aria-label="Create board" title="Create board">
              <Plus className="size-4" aria-hidden="true" />
            </button>
          </nav>
        </div>

        <div className="rail-footer">
          <button className="icon-button rail-button" onClick={onExpand} aria-label="Expand sidebar" title="Expand sidebar">
            <PanelLeft className="size-4" aria-hidden="true" />
          </button>
          <button className="icon-button rail-button" onClick={onOpenSettings} aria-label="Settings" title="Settings">
            <Settings className="size-4" aria-hidden="true" />
          </button>
        </div>
        </div>

        <div className="sidebar-expanded">
        <div className="sidebar-header">
          <span className="brand-text">OpenKanban</span>
        </div>

        <div className="sidebar-content">
          <nav className="sidebar-nav sidebar-group" aria-label="Boards">
            <p className="section-label">Boards</p>
            {boards.map((board) => (
              <button
                key={board.id}
                className={cn("nav-row", board.id === activeBoardId && "nav-row-active")}
                onClick={() => onSelectBoard(board.id)}
                aria-current={board.id === activeBoardId ? "true" : undefined}
              >
                {sharedBoards[board.id] ? <Users className="size-4" aria-label="Shared board" /> : <KanbanSquare className="size-4" aria-hidden="true" />}
                <span>{board.name}</span>
                <strong>{boardCounts[board.id] || 0}</strong>
              </button>
            ))}
          </nav>

          <form className="sidebar-board-form sidebar-group" onSubmit={onCreateBoard}>
            <p className="section-label">New board</p>
            <label className="sr-only" htmlFor="board-name">Board name</label>
            <div className="inline-create-row">
              <input id="board-name" value={newBoardName} onChange={(event) => onNewBoardNameChange(event.target.value)} placeholder="Board name" className="field" />
              <button className="icon-button primary-icon-button" type="submit" aria-label="Create board">
                <Plus className="size-4" aria-hidden="true" />
              </button>
            </div>
          </form>

          <nav className="sidebar-nav sidebar-columns-nav sidebar-group" aria-label="Board lists">
            <p className="section-label">Lists</p>
            {lists.map((list) => (
              <button key={list.id} className="nav-row" onClick={() => onJumpToList(list.id)}>
                <ListIcon icon={list.icon} />
                <span>{list.name}</span>
                <strong>{listCounts[list.id] || 0}</strong>
              </button>
            ))}
          </nav>
        </div>

        <div className="sidebar-footer">
          {mobileOpen ? null : (
            <button className="nav-row desktop-only" onClick={onToggleCollapsed} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
              <PanelLeft className="size-4" aria-hidden="true" />
              <span>Collapse Sidebar</span>
            </button>
          )}
          <div className="sidebar-sync-status">
            <SyncBadge status={syncStatus} />
          </div>
          <button className="nav-row" onClick={onOpenSettings}>
            <Settings className="size-4" aria-hidden="true" />
            <span>Settings</span>
          </button>
        </div>
        </div>
      </div>
    </aside>
  );
}
