import type { Metadata, MetadataRoute, Viewport } from "next";
import apps from "./apps.json" with { type: "json" };

export type PwaApp = keyof typeof apps;

export function createManifest(app: PwaApp): MetadataRoute.Manifest {
  const { name, shortName, description } = apps[app];
  return {
    id: "/",
    name,
    short_name: shortName,
    description,
    lang: "en",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f5f5f5",
    theme_color: "#f5f5f5",
    categories: ["productivity"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

export function pwaMetadata(app: PwaApp): Metadata {
  return {
    applicationName: apps[app].name,
    manifest: "/manifest.webmanifest",
    appleWebApp: { capable: true, title: apps[app].shortName, statusBarStyle: "default" },
    icons: {
      icon: [{ url: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
      apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
    },
  };
}

export const pwaThemeColor: Viewport["themeColor"] = [
  { media: "(prefers-color-scheme: light)", color: "#f5f5f5" },
  { media: "(prefers-color-scheme: dark)", color: "#1e1e1e" },
];
