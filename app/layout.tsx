import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "听写小助手",
  description: "Private, browser-based Chinese handwriting recognition",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-SG">
      <body>{children}</body>
    </html>
  );
}
