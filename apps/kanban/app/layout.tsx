import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { ColorModeScript } from "../../../shared/color-mode-script";
import { pwaMetadata, pwaThemeColor } from "../../../shared/pwa/metadata";
import { PwaControls } from "../../../shared/pwa/pwa-controls";
import { MODE_KEY } from "@/components/kanban/constants";
import "../../../shared/pwa/pwa.css";
import "./globals.css";


const appUrl =
  process.env.BETTER_AUTH_URL ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

export const metadata: Metadata = {
  ...pwaMetadata("kanban"),
  metadataBase: new URL(appUrl),
  title: "OpenKanban",
  description: "A self-hostable board app optimized for desktop and mobile.",
  openGraph: {
    title: "OpenKanban",
    description: "A self-hostable board app optimized for desktop and mobile.",
    url: appUrl,
    type: "website",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "OpenKanban board preview" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "OpenKanban",
    description: "A self-hostable board app optimized for desktop and mobile.",
    images: ["/og.png"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: pwaThemeColor,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const nonce = (await headers()).get("x-nonce") || undefined;

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <ColorModeScript storageKey={MODE_KEY} nonce={nonce} />
      </head>
      <body className="font-sans antialiased">{children}<PwaControls app="kanban" /></body>
    </html>
  );
}
