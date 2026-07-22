import type { Metadata } from "next";
import type { ReactNode } from "react";
import { TRPCProvider } from "@/lib/trpc";
import "./globals.css";
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

export const metadata: Metadata = {
  title: "FOUNDRY",
  description: "Describe it. Engineer it. Build it. Sell it.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={cn("dark", "font-sans", geist.variable)}>
      <body className="min-h-screen">
        <TRPCProvider>{children}</TRPCProvider>
      </body>
    </html>
  );
}
