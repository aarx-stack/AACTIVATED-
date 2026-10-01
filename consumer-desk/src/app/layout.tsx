import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Consumer Desk", template: "%s · Consumer Desk" },
  description: "Private consumer-correspondence workspace.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#070B14",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <div className="app-backdrop" aria-hidden />
        {children}
      </body>
    </html>
  );
}
