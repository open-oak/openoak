export const MAX_TASK_TITLE_LENGTH = 255;
export const MAX_LIST_NAME_LENGTH = 255;
export const MAX_SUBTASK_TITLE_LENGTH = 500;
export const MAX_TASK_NOTES_LENGTH = 10_000;
export const MAX_TODO_SORT_ORDER = 2_147_483_647;

export function cleanTaskTitle(value: string) {
  return value.trim().slice(0, MAX_TASK_TITLE_LENGTH);
}

export function cleanListName(value: string) {
  return value.trim().slice(0, MAX_LIST_NAME_LENGTH);
}

export function cleanSubtaskTitle(value: string) {
  return value.trim().slice(0, MAX_SUBTASK_TITLE_LENGTH);
}

export function cleanTaskNotes(value: string) {
  return value.slice(0, MAX_TASK_NOTES_LENGTH);
}
