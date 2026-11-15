import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Zol Support",
  description: "Calls handled by the Zol phone agent",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <nav className="border-b border-neutral-200">
          <div className="mx-auto flex max-w-6xl items-center gap-6 px-8 py-3 text-sm">
            <span className="font-semibold">Zol Support</span>
            <Link href="/" className="text-neutral-700 hover:underline">
              Calls
            </Link>
            <Link href="/settings" className="text-neutral-700 hover:underline">
              Agent settings
            </Link>
          </div>
        </nav>
        {children}
      </body>
    </html>
  );
}
