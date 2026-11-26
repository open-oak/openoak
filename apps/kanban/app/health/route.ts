export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { kanbanPrisma } = await import("@/lib/kanban-prisma");
    await kanbanPrisma.$queryRaw`SELECT 1`;
    return Response.json(
      {
        status: "ok",
        service: "openoak-kanban",
        version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) || "development",
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { status: "unavailable", service: "openoak-kanban" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
