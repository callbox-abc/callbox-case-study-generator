import type { Metadata, Viewport } from "next";
import { Archivo, DM_Sans, IBM_Plex_Mono, Inter } from "next/font/google";

// App chrome keeps Inter; the case study sheet uses the callboxinc.com brand faces.
const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });
const archivo = Archivo({ subsets: ["latin"], axes: ["wdth"], variable: "--font-display" });
const dmSans = DM_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-body" });
const plexMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "600"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "Callbox Case Study Generator",
  description: "Upload a draft, map it into Callbox's case study format, export a copy-pasteable PDF.",
};

export const viewport: Viewport = {
  themeColor: "#101114",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${archivo.variable} ${dmSans.variable} ${plexMono.variable}`}>
      <body style={{ margin: 0, fontFamily: "var(--font-sans), system-ui, sans-serif" }}>{children}</body>
    </html>
  );
}
