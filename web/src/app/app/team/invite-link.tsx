"use client";

import { useState } from "react";

/**
 * The one moment the invite token is visible.
 *
 * There's no outbound email yet, so the owner copies this and sends it however
 * they already talk to their people — text, WhatsApp, or reading it out. It is
 * shown once: the database keeps only a hash, so reloading this page cannot
 * bring it back, and that is deliberate rather than an omission.
 */
export function InviteLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="rounded-[var(--radius)] border border-emerald-line bg-emerald-wash p-4">
      <p className="text-[0.875rem] font-semibold text-emerald-deep">
        Invite ready — copy it now
      </p>
      <p className="mt-1 text-[0.8125rem] text-ink-2">
        Send it to them however you normally would. It works once, and expires
        in two weeks. This is the only time it&rsquo;s shown.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          readOnly
          value={url}
          aria-label="Invite link"
          onFocus={(e) => e.currentTarget.select()}
          className="t-data min-w-0 flex-1 rounded-[var(--radius)] border border-emerald-line bg-paper px-2.5 py-2 text-[0.8125rem] text-ink"
        />
        <button
          type="button"
          className="btn btn-emerald btn-sm"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(url);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            } catch {
              // Clipboard access is blocked on plain HTTP and in some locked
              // down browsers. The input above is selectable either way.
              setCopied(false);
            }
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}
