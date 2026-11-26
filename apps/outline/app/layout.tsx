import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import { ColorModeScript } from "../../../shared/color-mode-script";
import { COLOR_MODE_STORAGE_KEY } from "@/components/notes/constants";
import { pwaMetadata, pwaThemeColor } from "../../../shared/pwa/metadata";
import { PwaControls } from "../../../shared/pwa/pwa-controls";
import "../../../shared/pwa/pwa.css";
import "./globals.css";


const appUrl =
  process.env.BETTER_AUTH_URL ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

export const metadata: Metadata = {
  ...pwaMetadata("outline"),
  metadataBase: new URL(appUrl),
  title: "OpenOutline",
  description: "A self-hostable notes app optimized for desktop and mobile.",
  openGraph: {
    title: "OpenOutline",
    description: "A self-hostable notes app optimized for desktop and mobile.",
    url: appUrl,
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "OpenOutline",
    description: "A self-hostable notes app optimized for desktop and mobile.",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: pwaThemeColor,
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const nonce = (await headers()).get("x-nonce") || undefined;

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <ColorModeScript storageKey={COLOR_MODE_STORAGE_KEY} nonce={nonce} />
      </head>
      <body className="font-sans antialiased">{children}<PwaControls app="outline" /></body>
    </html>
  );
}
