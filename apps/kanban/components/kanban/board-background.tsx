"use client";

import { useEffect, useRef, useState } from "react";
import type { BoardAppearance } from "@/lib/kanban-data";

function wallpaperUrl(wallpaper: BoardAppearance["wallpaper"], blurred: boolean): string | null {
  return wallpaper === "none" ? null : `/${wallpaper}${blurred ? "-blur50.webp" : ".webp"}`;
}

export function BoardBackground({
  theme,
  wallpaper,
  wallpaperBlur,
}: BoardAppearance) {
  const desiredUrl = wallpaperUrl(wallpaper, wallpaperBlur);
  const desiredUrlRef = useRef(desiredUrl);
  const framesRef = useRef(new Set<number>());
  const [committedUrl, setCommittedUrl] = useState(desiredUrl);
  const [committedVisible, setCommittedVisible] = useState(true);
  const [incomingUrl, setIncomingUrl] = useState<string | null>(null);
  const [incomingVisible, setIncomingVisible] = useState(false);

  useEffect(() => {
    const cancelFrames = () => {
      for (const frame of framesRef.current) cancelAnimationFrame(frame);
      framesRef.current.clear();
    };
    const requestFrame = (callback: () => void) => {
      const frame = requestAnimationFrame(() => {
        framesRef.current.delete(frame);
        callback();
      });
      framesRef.current.add(frame);
    };

    desiredUrlRef.current = desiredUrl;
    cancelFrames();

    if (desiredUrl === committedUrl) {
      requestFrame(() => {
        setIncomingUrl(null);
        setIncomingVisible(false);
        setCommittedVisible(true);
      });
      return cancelFrames;
    }

    if (desiredUrl === null) {
      requestFrame(() => {
        setIncomingUrl(null);
        setIncomingVisible(false);
        setCommittedVisible(false);
      });
      return cancelFrames;
    }

    requestFrame(() => {
      setIncomingUrl(null);
      setIncomingVisible(false);
      setCommittedVisible(true);
    });
    let cancelled = false;
    const image = new Image();
    image.src = desiredUrl;

    void image.decode().then(() => {
      if (cancelled || desiredUrlRef.current !== desiredUrl) return;
      setIncomingUrl(desiredUrl);
      requestFrame(() => {
        requestFrame(() => setIncomingVisible(true));
      });
    }).catch(() => {
      // Keep the previous wallpaper if the replacement cannot be decoded.
    });

    return () => {
      cancelled = true;
      cancelFrames();
    };
  }, [committedUrl, desiredUrl]);

  const commitIncoming = () => {
    if (!incomingVisible || !incomingUrl || desiredUrlRef.current !== incomingUrl) return;
    setCommittedUrl(incomingUrl);
    setCommittedVisible(true);
    setIncomingUrl(null);
    setIncomingVisible(false);
  };

  const clearCommitted = () => {
    if (committedVisible || desiredUrlRef.current !== null) return;
    setCommittedUrl(null);
    setCommittedVisible(true);
  };

  return (
    <div className="persistent-background" data-theme={theme === "default" ? undefined : theme}>
      {committedUrl && (
        <div
          className="wallpaper-layer wallpaper-layer-transition"
          style={{ backgroundImage: `url("${committedUrl}")`, opacity: committedVisible ? 1 : 0 }}
          onTransitionEnd={clearCommitted}
        />
      )}
      {incomingUrl && (
        <div
          className="wallpaper-layer wallpaper-layer-transition"
          style={{ backgroundImage: `url("${incomingUrl}")`, opacity: incomingVisible ? 1 : 0 }}
          onTransitionEnd={commitIncoming}
        />
      )}
    </div>
  );
}
