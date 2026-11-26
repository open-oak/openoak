import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/kanban/client";
import { auth } from "@/lib/auth-server";
import { cleanBoards } from "@/lib/kanban-data";
import { kanbanPrisma } from "@/lib/kanban-prisma";
import { readLegacyKanbanDocument, mutateLegacyKanbanDocument } from "@/lib/kanban-legacy-bridge";
import { KanbanError } from "@/lib/kanban-v2-common";
import { BodyTooLargeError, readLimitedText } from "../../../../../shared/read-limited-text";

export const runtime = "nodejs";

const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;

async function getUserId(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers });
  return session?.user.id || null;
}

function documentResponse(document: {
  boards: unknown;
  activeBoardId: string;
  revision: number;
  updatedAt: Date;
}) {
  const boards = cleanBoards(document.boards);
  const activeBoardId = boards.some((board) => board.id === document.activeBoardId)
    ? document.activeBoardId
    : boards[0]?.id || "";

  return {
    boards,
    activeBoardId,
    revision: document.revision,
    updatedAt: document.updatedAt.toISOString(),
  };
}

export async function GET(request: NextRequest) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const document = await readLegacyKanbanDocument(userId);
    if (!document) return NextResponse.json({ document: null });
    return NextResponse.json({ document: documentResponse(document) });
  } catch (error) {
    if (error instanceof KanbanError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.code === "upgrade_required" ? 409 : 503 });
    console.error("Unable to load kanban document", error);
    return NextResponse.json({ error: "Board sync is temporarily unavailable." }, { status: 503 });
  }
}

export async function PUT(request: NextRequest) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = JSON.parse(await readLimitedText(request, MAX_DOCUMENT_BYTES));
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      return NextResponse.json({ error: "Board data is too large." }, { status: 413 });
    }
    return NextResponse.json({ error: "Invalid board data." }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid board data." }, { status: 400 });
  }

  const candidate = body as { boards?: unknown; activeBoardId?: unknown; baseRevision?: unknown };
  const boards = cleanBoards(candidate.boards);
  const baseRevision =
    typeof candidate.baseRevision === "number" && Number.isInteger(candidate.baseRevision) && candidate.baseRevision >= 0
      ? candidate.baseRevision
      : null;

  if (boards.length === 0 || typeof candidate.activeBoardId !== "string" || baseRevision === null) {
    return NextResponse.json({ error: "Invalid board data." }, { status: 400 });
  }

  const activeBoardId = boards.some((board) => board.id === candidate.activeBoardId)
    ? candidate.activeBoardId
    : boards[0].id;
  const boardsJson = JSON.parse(JSON.stringify(boards)) as Prisma.InputJsonValue;

  try {
    const bridged = await mutateLegacyKanbanDocument(userId, baseRevision, () => ({ state: { boards, activeBoardId }, result: {} }));
    if (bridged) return NextResponse.json({ document: documentResponse(bridged.document) });
    if (baseRevision === 0) {
      const existing = await kanbanPrisma.kanbanDocument.findUnique({ where: { userId } });
      if (existing) {
        return NextResponse.json({ conflict: documentResponse(existing) }, { status: 409 });
      }

      try {
        const created = await kanbanPrisma.kanbanDocument.create({
          data: { userId, boards: boardsJson, activeBoardId },
        });
        return NextResponse.json({ document: documentResponse(created) });
      } catch (error) {
        const concurrentDocument = await kanbanPrisma.kanbanDocument.findUnique({ where: { userId } });
        if (concurrentDocument) {
          return NextResponse.json({ conflict: documentResponse(concurrentDocument) }, { status: 409 });
        }
        throw error;
      }
    }

    const updated = await kanbanPrisma.kanbanDocument.updateMany({
      where: { userId, revision: baseRevision },
      data: {
        boards: boardsJson,
        activeBoardId,
        revision: { increment: 1 },
      },
    });

    if (updated.count === 0) {
      const current = await kanbanPrisma.kanbanDocument.findUnique({ where: { userId } });
      if (!current) return NextResponse.json({ error: "Board data was not found." }, { status: 404 });
      return NextResponse.json({ conflict: documentResponse(current) }, { status: 409 });
    }

    const document = await kanbanPrisma.kanbanDocument.findUniqueOrThrow({ where: { userId } });
    return NextResponse.json({ document: documentResponse(document) });
  } catch (error) {
    if (error instanceof KanbanError) {
      if (error.code === "conflict" && error.details?.conflict) return NextResponse.json({ conflict: error.details.conflict }, { status: 409 });
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.code === "too_large" ? 413 : error.code === "invalid" ? 400 : 409 });
    }
    console.error("Unable to save kanban document", error);
    return NextResponse.json({ error: "Board sync is temporarily unavailable." }, { status: 503 });
  }
}
