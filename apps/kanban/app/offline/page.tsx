import { connection } from "next/server";
import OfflineShell from "@/components/kanban/offline-shell";

export default async function OfflinePage() {
  // Cache the public HTML and matching request CSP together for offline reloads.
  await connection();
  return <OfflineShell />;
}
