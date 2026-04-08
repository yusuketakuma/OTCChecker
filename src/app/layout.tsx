import type { Metadata } from "next";
import { Noto_Sans_JP, Space_Mono } from "next/font/google";

import { BottomNav } from "@/components/app/bottom-nav";

import "./globals.css";

const notoSans = Noto_Sans_JP({
  variable: "--font-noto-sans",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

const spaceMono = Space_Mono({
  variable: "--font-space-mono",
  subsets: ["latin"],
  weight: ["400", "700"],
});

export const metadata: Metadata = {
  title: {
    default: "OTCChecker",
    template: "%s | OTCChecker",
  },
  description: "健康食品の賞味期限と在庫を iPhone で管理する店舗向けアプリ",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ja"
      className={`${notoSans.variable} ${spaceMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <main className="mx-auto flex min-h-[100dvh] w-full max-w-3xl flex-col px-3 pb-[calc(7.5rem+var(--safe-bottom))] pt-[calc(0.9rem+var(--safe-top))] sm:px-6 sm:pb-32 sm:pt-6">
          {children}
        </main>
        <BottomNav />
      </body>
    </html>
  );
}
