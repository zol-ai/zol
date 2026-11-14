import type { ReactNode } from "react";

import { site } from "@/lib/site";

/*
  Illustrations for the SMS opt-in page. Everything here is built from HTML
  and CSS so it renders identically on the page and in the PNG exports
  (public/sms-opt-in/*.png, screenshotted from these very elements). Shop
  data is placeholder; no real customers, no real numbers.

  `exportId` becomes a data attribute the export script selects on. The
  wrapper is sized and padded so the screenshot stands on its own.
*/

export const EXAMPLE_LABEL = "Example of what customers see";

export function MockupFrame({
  exportId,
  children,
  className = "",
}: {
  exportId: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <figure className={`flex flex-col items-center ${className}`}>
      <div
        data-export={exportId}
        className="flex w-full justify-center rounded-lg bg-paper-3 px-6 py-8"
      >
        {children}
      </div>
      <figcaption className="t-eyebrow mt-3 text-[0.625rem]">{EXAMPLE_LABEL}</figcaption>
    </figure>
  );
}

type Bubble = { from: "shop" | "customer"; text: string };

/**
 * A phone, drawn with CSS: dark bezel, screen, status bar, the sender name
 * at the top and a thread of bubbles. Grey on the left is what the shop line
 * sent; the customer's own replies sit on the right.
 */
export function PhoneMockup({ sender, bubbles }: { sender: string; bubbles: Bubble[] }) {
  return (
    <div
      className="w-[272px] shrink-0 rounded-[2.25rem] bg-panel p-[10px] shadow-[0_18px_40px_-18px_rgb(25_23_20/0.45)]"
      role="img"
      aria-label={`Phone showing a text thread with ${sender}: ${bubbles
        .map((b) => `${b.from === "shop" ? sender : "Customer"}: ${b.text}`)
        .join(" ")}`}
    >
      <div className="flex min-h-[440px] flex-col overflow-hidden rounded-[1.75rem] bg-paper">
        <div className="relative border-b border-line bg-paper-2 px-4 pt-3 pb-3">
          <div className="absolute top-2 left-1/2 h-[18px] w-[72px] -translate-x-1/2 rounded-full bg-panel" />
          <div className="t-data flex justify-between text-[0.625rem] text-ink-3">
            <span>9:41</span>
            <span>●●● ▲ ▮</span>
          </div>
          <div className="mt-3 flex flex-col items-center">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-paper-4 text-[0.6875rem] font-semibold text-ink-2">
              {sender.slice(0, 1)}
            </div>
            <span className="mt-1 text-[0.6875rem] font-semibold text-ink">{sender}</span>
          </div>
        </div>
        <div className="flex flex-1 flex-col gap-2.5 px-3 py-4">
          <p className="t-data text-center text-[0.5625rem] text-ink-3">Today</p>
          {bubbles.map((b, i) =>
            b.from === "shop" ? (
              <div
                key={i}
                className="max-w-[88%] self-start rounded-2xl rounded-bl-md bg-paper-4 px-3 py-2 text-[0.6875rem] leading-snug text-ink"
              >
                {b.text}
              </div>
            ) : (
              <div
                key={i}
                className="max-w-[70%] self-end rounded-2xl rounded-br-md bg-emerald px-3 py-2 text-[0.6875rem] font-semibold leading-snug text-white"
              >
                {b.text}
              </div>
            ),
          )}
        </div>
        <div className="flex items-center gap-2 border-t border-line px-3 py-2.5">
          <div className="h-7 flex-1 rounded-full border border-line-2 bg-paper px-3 text-[0.625rem] leading-7 text-ink-3">
            Text message
          </div>
          <div className="h-7 w-7 rounded-full bg-paper-4" />
        </div>
      </div>
    </div>
  );
}

/**
 * The consent conversation: the script a staff member or ZOL's phone
 * assistant reads word for word, and the customer saying yes.
 */
export function ConsentCard({ script }: { script: string }) {
  return (
    <div className="card w-full max-w-[440px] overflow-hidden">
      <div className="flex items-center justify-between border-b border-line bg-paper-2 px-4 py-2.5">
        <span className="t-eyebrow text-[0.5625rem]">At the counter · On a call</span>
        <span className="t-data text-[0.625rem] text-ink-3">Consent script</span>
      </div>
      <div className="space-y-3 px-4 py-4">
        <div className="flex gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-panel text-[0.625rem] font-semibold text-panel-fg">
            {site.name}
          </div>
          <div className="rounded-2xl rounded-tl-md border border-line bg-paper px-3.5 py-2.5 text-[0.75rem] leading-relaxed text-ink">
            &ldquo;{script}&rdquo;
          </div>
        </div>
        <div className="flex justify-end gap-3">
          <div className="rounded-2xl rounded-tr-md bg-emerald px-3.5 py-2.5 text-[0.8125rem] font-semibold text-white">
            &ldquo;Yes.&rdquo;
          </div>
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-paper-4 text-[0.625rem] font-semibold text-ink-2">
            C
          </div>
        </div>
      </div>
      <div className="border-t border-line bg-emerald-wash px-4 py-2.5">
        <p className="t-data text-[0.625rem] text-emerald-deep">
          ✓ Consent recorded · verbal · counter · 2026-11-14 09:41
        </p>
        <p className="t-data mt-0.5 text-[0.625rem] text-ink-3">
          Customer record · (555) 010-0100 · texting enabled
        </p>
      </div>
    </div>
  );
}
