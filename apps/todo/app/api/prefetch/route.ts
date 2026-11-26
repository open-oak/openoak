import { NextResponse } from "next/server";
import { getSidebarData, getUserSettings } from "@/app/actions";

export async function GET() {
  try {
    const [sidebarData, userSettings] = await Promise.all([
      getSidebarData(),
      getUserSettings(),
    ]);

    return NextResponse.json({
      ...sidebarData,
      userSettings,
    });
  } catch (error) {
    // Auth errors (from ensureUser/getAuthUser) vs unexpected failures
    const isAuthError =
      error instanceof Error &&
      (error.message.includes("Unauthorized") || error.message.includes("auth"));
    console.error("Prefetch failed:", error);
    return NextResponse.json(
      { error: isAuthError ? "Unauthorized" : "Internal server error" },
      { status: isAuthError ? 401 : 500 }
    );
  }
}
