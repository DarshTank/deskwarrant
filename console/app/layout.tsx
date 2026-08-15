import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "DeskWarrant",
  description: "Natural-language PC agent with remote control.",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#09090b",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      {/*
        h-full + overflow-hidden, not min-h-full: the shell is exactly one
        viewport tall, so the `flex-1 min-h-0` panes inside it (chat transcript,
        live canvas, event feed) scroll within their own frames instead of
        stretching the page. With a minimum height the chat grew without bound
        and took the whole window scrollbar with it.
      */}
      <body className="flex h-full flex-col overflow-hidden bg-background text-foreground">
        {children}
      </body>
    </html>
  );
}
