import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BestDeal - Retail Catalog Browser",
  description:
    "Browse weekly retail catalogs from grocery, electronics, and furniture stores across Europe.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
