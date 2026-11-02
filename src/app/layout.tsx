import type { Metadata, Viewport } from "next";
import { Geist_Mono, Instrument_Sans } from "next/font/google";
import { preconnect } from "react-dom";
import { Toaster } from "sonner";
import { AdminProvider } from "@/components/admin-provider";
import { SUPABASE_URL } from "@/lib/config";
import "./globals.css";

const sans = Instrument_Sans({ subsets: ["latin"], variable: "--font-instrument", display: "swap" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Longshot", template: "%s · Longshot" },
  description: "Long screenshots, kept at full resolution and smooth to scroll on any device.",
  applicationName: "Longshot",
  appleWebApp: { capable: true, title: "Longshot", statusBarStyle: "default" },
  formatDetection: { telephone: false },
  // Private screenshots: keep every page out of search engines.
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f4f0" },
    { media: "(prefers-color-scheme: dark)", color: "#0f0f0e" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  if (SUPABASE_URL) preconnect(SUPABASE_URL, { crossOrigin: "anonymous" });

  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>
        <AdminProvider>{children}</AdminProvider>
        <Toaster
          position="top-center"
          theme="system"
          offset={{ top: "calc(env(safe-area-inset-top) + 14px)" }}
          mobileOffset={{ top: "calc(env(safe-area-inset-top) + 10px)" }}
          toastOptions={{
            style: {
              borderRadius: 16,
              fontFamily: "var(--font-sans)",
              fontSize: 14,
              background: "var(--surface)",
              color: "var(--ink)",
              border: "1px solid var(--line)",
              boxShadow: "var(--float-shadow)",
            },
          }}
        />
      </body>
    </html>
  );
}
