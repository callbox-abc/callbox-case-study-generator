import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "Callbox Case Study Generator",
  description: "Upload a draft, map it into Callbox's case study format, export a copy-pasteable PDF.",
};

export const viewport: Viewport = {
  themeColor: "#101114",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body style={{ margin: 0, fontFamily: "var(--font-sans), system-ui, sans-serif" }}>{children}</body>
    </html>
  );
}
