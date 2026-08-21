import type { Metadata, Viewport } from "next";
import { Archivo, Inter, JetBrains_Mono } from "next/font/google";
import { ArmReveals } from "@/components/site/arm-reveals";
import { site } from "@/lib/site";
import "./globals.css";

/** Headlines only — uppercase, heavy, very tight. ZOL's voice. */
const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  weight: ["700", "800"],
  display: "swap",
});

/** All reading copy. */
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

/** Anything the machine produced: RO numbers, VINs, timestamps, totals. */
const jetbrains = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: {
    default: `${site.name} — ${site.tagline}`,
    template: `%s — ${site.name}`,
  },
  description: site.description,
  keywords: [
    "AI shop management software",
    "auto repair shop management software",
    "AI receptionist for auto repair shops",
    "Tekmetric alternative",
    "Shopmonkey alternative",
    "repair order automation",
  ],
  openGraph: {
    type: "website",
    url: site.url,
    siteName: site.name,
    title: `${site.name} — ${site.tagline}`,
    description: site.description,
  },
  twitter: {
    card: "summary_large_image",
    title: `${site.name} — ${site.tagline}`,
    description: site.description,
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
  colorScheme: "light",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${archivo.variable} ${inter.variable} ${jetbrains.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/*
          Runs while the HTML is still parsing, before first paint. Scroll
          reveals only hide themselves under `.js`, so if scripting is blocked,
          fails, or never arrives, every section renders plainly visible
          instead of sitting at opacity 0. Marketing copy must never depend on
          JavaScript to be readable.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `document.documentElement.classList.add("js")`,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col bg-paper text-ink">
        <ArmReveals />
        {children}
      </body>
    </html>
  );
}
