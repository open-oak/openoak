"use client";

import { useEffect, useState } from "react";
import apps from "./apps.json" with { type: "json" };
import type { PwaApp } from "./metadata";

interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function PwaControls({ app }: { app: PwaApp }) {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [ios, setIos] = useState(false);
  const [instructions, setInstructions] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [updateReady, setUpdateReady] = useState(false);
  const [offline, setOffline] = useState(false);
  const { name, worker } = apps[app];
  const offerInstall = app !== "account";

  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone;
    const onInstallPrompt = (event: Event) => {
      if (standalone) return;
      event.preventDefault();
      if (!offerInstall) return;
      setPrompt(event as InstallPrompt);
    };
    const onInstalled = () => { setPrompt(null); setIos(false); };
    const onConnection = () => setOffline(!navigator.onLine);
    queueMicrotask(() => {
      onConnection();
      setIos(offerInstall && !standalone && (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)));
      try { setDismissed(sessionStorage.getItem("openoak-install-dismissed") === "true"); } catch {}
    });
    window.addEventListener("beforeinstallprompt", onInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);
    window.addEventListener("online", onConnection);
    window.addEventListener("offline", onConnection);
    return () => {
      window.removeEventListener("beforeinstallprompt", onInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
      window.removeEventListener("online", onConnection);
      window.removeEventListener("offline", onConnection);
    };
  }, [offerInstall]);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !window.isSecureContext || !("serviceWorker" in navigator)) return;
    let disposed = false;
    let registration: ServiceWorkerRegistration | undefined;
    let installing: ServiceWorker | null = null;
    const onStateChange = () => {
      if (!disposed && registration?.waiting && navigator.serviceWorker.controller) setUpdateReady(true);
    };
    const onUpdateFound = () => {
      installing?.removeEventListener("statechange", onStateChange);
      installing = registration?.installing ?? null;
      installing?.addEventListener("statechange", onStateChange);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible" && navigator.onLine) void registration?.update().catch(() => {});
    };
    void navigator.serviceWorker.register(worker, { scope: "/", updateViaCache: "none" }).then((value) => {
      if (disposed) return;
      registration = value;
      onStateChange();
      onUpdateFound();
      registration.addEventListener("updatefound", onUpdateFound);
    }).catch((error) => { console.error(`${name} offline setup failed:`, error); });
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      disposed = true;
      registration?.removeEventListener("updatefound", onUpdateFound);
      installing?.removeEventListener("statechange", onStateChange);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [name, worker]);

  const dismissInstall = () => {
    setDismissed(true);
    try { sessionStorage.setItem("openoak-install-dismissed", "true"); } catch {}
  };
  const install = async () => {
    if (!prompt) { setInstructions(true); return; }
    try {
      await prompt.prompt();
      await prompt.userChoice;
    } finally {
      setPrompt(null);
    }
  };

  return (
    <aside className="pwa-notices" aria-label={`${name} app`}>
      {offline && <div className="pwa-notice" role="status">
        <p>{app === "kanban" ? "You are offline. Saved boards and edits are available on this device." : "You are offline. Connect to view and save changes."}</p>
      </div>}
      {updateReady && <div className="pwa-notice" role="status" data-pwa-update>
        <p>An update is ready. Finish your changes, then close all {name} windows to apply it.</p>
        <button type="button" onClick={() => setUpdateReady(false)}>Dismiss update notice</button>
      </div>}
      {offerInstall && !dismissed && (prompt || ios) && <div className="pwa-notice">
        {instructions ? <p>Open the Share menu and choose Add to Home Screen to install {name}.</p> :
          <button type="button" onClick={() => { void install().catch(() => {}); }}>Install {name}</button>}
        <button type="button" onClick={dismissInstall} aria-label="Dismiss app installation">Dismiss</button>
      </div>}
    </aside>
  );
}
