"use client";

import { GripVertical, Layers3, Plus } from "lucide-react";
import type { DropPosition } from "@/lib/kanban-board";
import type { KanbanList, Task } from "@/lib/kanban-data";
import { cn } from "@/lib/utils";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import { ListStyleMenu } from "./list-style-menu";
import { ListIcon } from "./primitives";
import { TaskCard, type TaskDragHandlers } from "./task-card";

export type ColumnDropTarget = {
  listId: string;
  taskId: string | null;
  position: DropPosition;
};

export function BoardColumn({
  list,
  tasks,
  index,
  glass,
  canDeleteList,
  styleMenuOpen,
  dragOver,
  listDragging,
  draggingTaskId,
  dropTarget,
  newTaskTitle,
  drag,
  onToggleStyleMenu,
  onUpdateList,
  onDeleteList,
  onNewTaskTitleChange,
  onAddTask,
  onCreateDetailedTask,
  onOpenTask,
  onMoveTask,
  onListDragStart,
  onListDragOver,
  onListDragLeave,
  onListDrop,
  onDropAtEnd,
}: {
  list: KanbanList;
  tasks: Task[];
  index: number;
  glass: boolean;
  canDeleteList: boolean;
  styleMenuOpen: boolean;
  dragOver: boolean;
  listDragging: boolean;
  draggingTaskId: string | null;
  dropTarget: ColumnDropTarget | null;
  newTaskTitle: string;
  drag: TaskDragHandlers;
  onToggleStyleMenu: (listId: string) => void;
  onUpdateList: (listId: string, updates: Partial<KanbanList>) => void;
  onDeleteList: (listId: string) => void;
  onNewTaskTitleChange: (listId: string, value: string) => void;
  onAddTask: (listId: string, event: React.FormEvent) => void;
  onCreateDetailedTask: (listId: string) => void;
  onOpenTask: (taskId: string) => void;
  onMoveTask: (taskId: string, axis: "vertical" | "horizontal", offset: number) => void;
  onListDragStart: (event: React.DragEvent<HTMLElement>, listId: string) => void;
  onListDragOver: (event: React.DragEvent<HTMLElement>, listId: string) => void;
  onListDragLeave: (event: React.DragEvent<HTMLElement>) => void;
  onListDrop: (event: React.DragEvent<HTMLElement>, listId: string) => void;
  onDropAtEnd: (event: React.DragEvent<HTMLElement>, listId: string) => void;
}) {
  const dropAtEnd = dropTarget?.listId === list.id && dropTarget.taskId === null;

  return (
    <section
      id={`list-${list.id}`}
      data-list-id={list.id}
      data-list-color={list.color}
      className={cn("column-panel", dragOver && "column-drag-over", listDragging && "list-dragging", !glass && "solid-surface")}
      style={{ animationDelay: `${index * 55}ms` }}
      aria-labelledby={`${list.id}-title`}
      draggable
      onDragStart={(event) => onListDragStart(event, list.id)}
      onDragEnd={drag.onDragEnd}
      onDragOver={(event) => onListDragOver(event, list.id)}
      onDragLeave={onListDragLeave}
      onDrop={(event) => onListDrop(event, list.id)}
    >
      <div className="column-header">
        <div className="list-icon-wrap">
          <Popover open={styleMenuOpen} onOpenChange={(open) => { if (open !== styleMenuOpen) onToggleStyleMenu(list.id); }}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="column-icon list-icon-button"
                aria-label={`Style ${list.name}`}
                title="Style list"
              >
                <ListIcon icon={list.icon} />
              </button>
            </PopoverTrigger>
          {styleMenuOpen && (
            <ListStyleMenu
              list={list}
              canDelete={canDeleteList}
              onUpdate={(updates) => onUpdateList(list.id, updates)}
              onDelete={() => onDeleteList(list.id)}
            />
          )}
          </Popover>
        </div>
        <div className="list-header-main">
          <label className="sr-only" htmlFor={`${list.id}-title`}>
            List name
          </label>
          <input id={`${list.id}-title`} value={list.name} onChange={(event) => onUpdateList(list.id, { name: event.target.value })} className="list-name-input" />
        </div>
        <span className="count-badge">{tasks.length}</span>
        <GripVertical className="size-4 list-drag-handle" aria-hidden="true" />
      </div>

      <div
        className={cn("card-list", dropAtEnd && "card-list-drop-end")}
        role="list"
        aria-label={`${list.name} tasks`}
        onDragOver={(event) => onDropAtEnd(event, list.id)}
      >
        {tasks.length === 0 ? (
          <button type="button" className="empty-state" onClick={() => onCreateDetailedTask(list.id)} aria-label={`Create a task in ${list.name}`}>
            <Layers3 className="size-5" aria-hidden="true" />
            <p>No tasks yet</p>
            <small>Click to add one, or move a task here.</small>
          </button>
        ) : (
          tasks.map((task, taskIndex) => (
            <TaskCard
              key={task.id}
              task={task}
              index={taskIndex}
              total={tasks.length}
              listName={list.name}
              dragging={draggingTaskId === task.id}
              dropIndicator={dropTarget?.taskId === task.id ? dropTarget.position : null}
              drag={drag}
              onOpen={onOpenTask}
              onMove={onMoveTask}
            />
          ))
        )}
      </div>

      <form className="column-add-form" onSubmit={(event) => onAddTask(list.id, event)}>
        <label className="sr-only" htmlFor={`new-task-${list.id}`}>
          Add task to {list.name}
        </label>
        <button className="icon-button task-add-button" type="submit" aria-label={`Add task to ${list.name}`}>
          <Plus className="size-4" aria-hidden="true" />
        </button>
        <input
          id={`new-task-${list.id}`}
          value={newTaskTitle}
          onChange={(event) => onNewTaskTitleChange(list.id, event.target.value)}
          placeholder="Add a task"
          className="field"
          maxLength={255}
        />
      </form>
    </section>
  );
}
