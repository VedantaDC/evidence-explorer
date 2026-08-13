import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3001";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const previewImage = `${protocol}://${host}/social-preview.png`;

  return {
    title: "MNR Evidence Explorer",
    description: "Interactive, evidence-tiered analysis of FDA MNR 510(k) device-family sensors, measurements, and outputs.",
    icons: {
      icon: "/favicon.svg",
      shortcut: "/favicon.svg",
    },
    openGraph: {
      title: "MNR Evidence Explorer",
      description: "Explore Core, Expanded, and Historical evidence for FDA-cleared MNR device families.",
      images: [{ url: previewImage, width: 1200, height: 630, alt: "MNR Evidence Explorer" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "MNR Evidence Explorer",
      description: "FDA 510(k) sensor and output evidence, organized by device family.",
      images: [previewImage],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
