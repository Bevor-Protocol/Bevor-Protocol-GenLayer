import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "Bevor Protocol | Audit payments",
  description:
    "Audit payment vesting, evidence exchange, and liability decisions on GenLayer.",
  manifest: "/site.webmanifest",
  icons: {
    icon: [{ url: "/bevor-logo.png", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#030303",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
