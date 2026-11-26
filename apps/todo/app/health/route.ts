export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { prisma } = await import("@/lib/prisma");
    await prisma.$queryRaw`SELECT 1`;
    return Response.json(
      {
        status: "ok",
        service: "openoak-todo",
        version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) || "development",
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { status: "unavailable", service: "openoak-todo" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
