import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Colophon } from "@/components/Colophon";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

// Inter also serves as body font via --font-body alias set in globals.css
const interBody = Inter({
  subsets: ["latin"],
  variable: "--font-body",
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  weight: ["400", "500", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://best-deal-shops.com"),
  title: "BestDeal — Every deal in Europe, in one place",
  description:
    "Browse weekly retail catalogs from grocery, electronics, and furniture stores across Europe. Updated every Monday and Thursday.",
  alternates: {
    types: { "application/atom+xml": "/feed.xml" },
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${interBody.variable} ${jetbrainsMono.variable}`}
    >
      <body>
        {children}
        <Colophon />
      </body>
    </html>
  );
}
