const POLL_INTERVAL_MS = 30_000;
const IDLE_TIMEOUT_MS = 120_000;

/** Poll while the user is active; edit saving runs independently of this timer. */
export function startKanbanSyncPolling(
  refresh: () => Promise<void>,
  pageWindow: Pick<Window, "setInterval" | "clearInterval" | "addEventListener" | "removeEventListener"> = window,
  pageDocument: Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener"> = document,
) {
  let lastActivityAt = Date.now();
  let lastRefreshAt = Date.now();
  const refreshVisible = () => {
    if (pageDocument.visibilityState !== "visible") return;
    lastRefreshAt = Date.now();
    void refresh();
  };
  const onActivity = () => {
    const wasIdle = Date.now() - lastActivityAt >= IDLE_TIMEOUT_MS;
    lastActivityAt = Date.now();
    if (wasIdle) refreshVisible();
  };
  const onResume = () => {
    if (pageDocument.visibilityState !== "visible") return;
    lastActivityAt = Date.now();
    // Browsers can emit focus and visibilitychange together when returning.
    if (Date.now() - lastRefreshAt >= 1_000) refreshVisible();
  };
  const interval = pageWindow.setInterval(() => {
    if (Date.now() - lastActivityAt < IDLE_TIMEOUT_MS) refreshVisible();
  }, POLL_INTERVAL_MS);
  pageWindow.addEventListener("focus", onResume);
  pageDocument.addEventListener("visibilitychange", onResume);
  for (const event of ["pointerdown", "keydown", "scroll"]) pageDocument.addEventListener(event, onActivity, { capture: true, passive: true });

  return () => {
    pageWindow.clearInterval(interval);
    pageWindow.removeEventListener("focus", onResume);
    pageDocument.removeEventListener("visibilitychange", onResume);
    for (const event of ["pointerdown", "keydown", "scroll"]) pageDocument.removeEventListener(event, onActivity, { capture: true });
  };
}
