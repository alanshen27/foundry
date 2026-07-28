import type { Metadata } from "next";
import type { ReactNode } from "react";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { TRPCProvider } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import "./globals.css";

const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-sans",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "FOUNDRY",
  description: "Describe it. Engineer it. Build it. Sell it.",
  icons: {
    icon: [{ url: "/logo.png", type: "image/png" }],
    apple: [{ url: "/logo.png", type: "image/png" }],
  },
};

/** Applies stored theme before paint to avoid a flash of the default. */
const themeInitScript = `
(function(){
  try {
    var raw = localStorage.getItem("foundry-theme-v4")
      || localStorage.getItem("foundry-theme-v3")
      || localStorage.getItem("foundry-theme-v2");
    var theme = raw ? JSON.parse(raw) : { mode: "light", accent: "signal" };
    var mode = theme.mode === "dark" ? "dark" : "light";
    var map = { forge: "signal", steel: "cobalt", copper: "ember", moss: "jade", ocean: "signal" };
    var accent = theme.accent;
    if (map[accent]) accent = map[accent];
    if (["signal","ember","cobalt","graphite","jade","lilac"].indexOf(accent) < 0) accent = "signal";
    var root = document.documentElement;
    if (mode === "dark") root.classList.add("dark");
    else root.classList.remove("dark");
    root.dataset.accent = accent;
  } catch (e) {
    document.documentElement.classList.remove("dark");
    document.documentElement.dataset.accent = "signal";
  }
})();
`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={cn("font-sans", plexSans.variable, plexMono.variable)}
      data-accent="signal"
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-screen">
        <ThemeProvider>
          <TRPCProvider>{children}</TRPCProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
