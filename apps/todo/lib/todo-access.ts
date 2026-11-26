import type { Prisma } from "../generated/prisma/client";

export type TodoAccessLevel = "owner" | "editor";

export interface ListAccessSubject {
  ownerId: string;
  kind: "DEFAULT" | "CUSTOM";
  memberIds: readonly string[];
}

export function resolveListAccess(subject: ListAccessSubject, userId: string): TodoAccessLevel | null {
  if (subject.ownerId === userId) return "owner";
  if (subject.kind === "CUSTOM" && subject.memberIds.includes(userId)) return "editor";
  return null;
}

export function readableListWhere(userId: string): Prisma.ListWhereInput {
  return {
    OR: [
      { ownerId: userId },
      { kind: "CUSTOM", members: { some: { userId } } },
    ],
  };
}

// Collaboration v1 has one non-owner role: editors can change list content
// and presentation. Invite management and final list deletion remain owner-only.
export function editableListWhere(userId: string): Prisma.ListWhereInput {
  return readableListWhere(userId);
}

export function ownerListWhere(userId: string): Prisma.ListWhereInput {
  return { ownerId: userId };
}

export function readableTaskWhere(userId: string): Prisma.TaskWhereInput {
  return { list: readableListWhere(userId) };
}

export function editableTaskWhere(userId: string): Prisma.TaskWhereInput {
  return { list: editableListWhere(userId) };
}

export function readableSubtaskWhere(userId: string): Prisma.SubtaskWhereInput {
  return { task: readableTaskWhere(userId) };
}

export function editableSubtaskWhere(userId: string): Prisma.SubtaskWhereInput {
  return { task: editableTaskWhere(userId) };
}

export function personalFlagWhere(
  userId: string,
  flag: "isImportant" | "isMyDay",
  value = true,
): Prisma.TaskWhereInput {
  return {
    OR: [
      { personalStates: { some: { userId, [flag]: value } } },
      {
        createdById: userId,
        [flag]: value,
        personalStates: { none: { userId } },
      },
    ],
  };
}

type PersonalState = { isImportant: boolean; isMyDay: boolean };

export type PersonalizableTask = {
  createdById: string;
  isImportant: boolean;
  isMyDay: boolean;
  personalStates?: PersonalState[];
};

/**
 * During the compatibility window, creator flags fall back to the legacy task
 * columns. Collaborators never inherit those flags and use their own state.
 */
export function projectPersonalTaskFlags<T extends PersonalizableTask>(task: T, userId: string) {
  const { personalStates, ...rest } = task;
  const state = personalStates?.[0];
  return {
    ...rest,
    isImportant: state?.isImportant ?? (task.createdById === userId ? task.isImportant : false),
    isMyDay: state?.isMyDay ?? (task.createdById === userId ? task.isMyDay : false),
  };
}

export const genericUnavailableMessage = "This list or task is unavailable.";
