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
    title: "Evidence Explorer",
    description: "Curated analysis of FDA 510(k) sleep-device families, configurations, sensors, measurements, and outputs.",
    icons: {
      icon: "/favicon.svg",
      shortcut: "/favicon.svg",
    },
    openGraph: {
      title: "Evidence Explorer",
      description: "Explore curated FDA 510(k) evidence for MNR and reduced-channel OLV/OLZ sleep-device configurations.",
      images: [{ url: previewImage, width: 1200, height: 630, alt: "Evidence Explorer" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Evidence Explorer",
      description: "Curated FDA 510(k) sensor, measurement, location, output, and quality evidence.",
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
