/**
 * The four icons on the how-it-works rail.
 *
 * Each one draws itself during its own slice of a shared loop, so the row
 * reads left to right: the call comes in, the scan writes to the ticket, the
 * estimate goes out and gets approved, the job closes and the next visit is
 * booked. The timing lives entirely in CSS (`.fx`, `--i`, `--o` in
 * globals.css) so these stay server-rendered and need no JavaScript.
 *
 * `--o` offsets an element within its own step, in seconds.
 */

type IconProps = { className?: string };

const common = {
  width: 34,
  height: 34,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

/** 01 — the phone rings after close and ZOL picks up. */
export function IconCall({ className = "" }: IconProps) {
  return (
    <svg {...common} className={className}>
      <rect x="2.5" y="2.5" width="10" height="19" rx="2.5" />
      <path d="M6 5.8h3.5" />
      <circle cx="7.5" cy="18.2" r="0.85" fill="currentColor" stroke="none" />

      {/* Three rings leaving the handset, one after the other. */}
      <path
        className="fx fx-hidden fx-wave"
        style={{ "--o": "0s" } as React.CSSProperties}
        d="M15.2 9.2a4.2 4.2 0 0 1 0 5.6"
      />
      <path
        className="fx fx-hidden fx-wave"
        style={{ "--o": "0.22s" } as React.CSSProperties}
        d="M17.9 7.2a7.6 7.6 0 0 1 0 9.6"
      />
      <path
        className="fx fx-hidden fx-wave"
        style={{ "--o": "0.44s" } as React.CSSProperties}
        d="M20.6 5.2a11 11 0 0 1 0 13.6"
      />
    </svg>
  );
}

/** 02 — the tech scans the car and the codes land on the same record. */
export function IconScan({ className = "" }: IconProps) {
  return (
    <svg {...common} className={className}>
      <rect x="2.5" y="3.5" width="19" height="13" rx="2.5" />
      <path d="M9 16.5v3.2M15 16.5v3.2M7 20.5h10" />

      {/* The trace runs across the screen. */}
      <path
        className="fx fx-draw"
        style={{ "--o": "0.1s" } as React.CSSProperties}
        pathLength={100}
        strokeDasharray={100}
        strokeDashoffset={100}
        d="M5.2 10.2h2.3l1.4-3.4 2.3 6.6 1.7-4.4 1.2 1.2h4.7"
      />
    </svg>
  );
}

/** 03 — the estimate goes out by text and comes back approved. */
export function IconQuote({ className = "" }: IconProps) {
  return (
    <svg {...common} className={className}>
      <path
        className="fx fx-hidden fx-rise"
        d="M19.5 4.5h-15A1.6 1.6 0 0 0 2.9 6.1v8.3a1.6 1.6 0 0 0 1.6 1.6h1.7v3.5l4.3-3.5h9a1.6 1.6 0 0 0 1.6-1.6V6.1a1.6 1.6 0 0 0-1.6-1.6Z"
      />

      {/* Two lines of estimate, then the approval lands on top of them. */}
      <path
        className="fx fx-draw"
        style={{ "--o": "0.35s" } as React.CSSProperties}
        pathLength={100}
        strokeDasharray={100}
        strokeDashoffset={100}
        d="M6.4 8.6h11.2M6.4 11.6h6.6"
      />
      <path
        className="fx fx-hidden fx-pop"
        style={{ "--o": "0.85s", color: "var(--emerald)" } as React.CSSProperties}
        strokeWidth={2}
        d="M14.6 12.4l1.9 1.9 3.6-3.9"
      />
    </svg>
  );
}

/** 04 — the invoice goes out and the next visit is already on the book. */
export function IconClose({ className = "" }: IconProps) {
  return (
    <svg {...common} className={className}>
      <rect x="3" y="4.5" width="18" height="16.5" rx="2.5" />
      <path d="M3 9.4h18M8 2.6v3.6M16 2.6v3.6" />

      <path
        className="fx fx-hidden fx-pop"
        style={{ "--o": "0.3s", color: "var(--emerald)" } as React.CSSProperties}
        strokeWidth={2}
        d="M8.6 15.3l2.3 2.3 4.5-4.9"
      />
    </svg>
  );
}

export const flowIcons = [IconCall, IconScan, IconQuote, IconClose];
