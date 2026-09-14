import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Callbox Case Study Generator",
  description: "Upload a draft, map it into Callbox's case study format, export a copy-pasteable PDF.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
