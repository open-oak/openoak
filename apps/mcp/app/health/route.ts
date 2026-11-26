export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { checkAccountDatabase } = await import("@/lib/auth");
    await checkAccountDatabase();
    return Response.json(
      {
        status: "ok",
        service: "openoak-mcp",
        version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) || "development",
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { status: "unavailable", service: "openoak-mcp" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
