/**
 * Small product mockups, one per "runs itself" card. Each one restages its
 * card's story as UI: the rows land in sequence when the card reveals, and
 * the only continuous motion is the accents that mean "live right now" (the
 * waveform on an open call, the caret on a reply being typed).
 *
 * All four are aria-hidden: the card's own copy and event line carry the
 * story for a screen reader, and these restate it visually.
 *
 * Emerald keeps its one meaning here — it marks what ZOL did unattended.
 * The parts conflict stays in ink: it is a fact being surfaced, not a person
 * taking over, so it must not wear amber.
 */

function Head({
  label,
  right,
  live = false,
}: {
  label: string;
  right?: React.ReactNode;
  live?: boolean;
}) {
  return (
    <div className="jw-head">
      {live && <span className="dot dot-live" />}
      <span className="t-data text-[0.625rem] font-medium uppercase tracking-[0.08em] text-ink-2">
        {label}
      </span>
      {right && <span className="ml-auto flex items-center">{right}</span>}
    </div>
  );
}

const step = (d: number) => ({ "--d": `${d}ms` }) as React.CSSProperties;

export function CallWidget() {
  return (
    <div className="jw" aria-hidden="true">
      <Head
        label="Incoming · Mon 9:41 PM"
        live
        right={
          <span className="jw-eq">
            <span />
            <span />
            <span />
            <span />
            <span />
          </span>
        }
      />
      <div className="grid gap-2 p-3.5">
        <p className="jw-step text-[0.75rem] leading-relaxed text-ink-2" style={step(120)}>
          &ldquo;Brakes are grinding — can anyone look at it tomorrow?&rdquo;
        </p>
        <p className="jw-step t-data text-[0.6875rem] text-ink-3" style={step(300)}>
          Complaint, VIN and callback captured
        </p>
        <p className="jw-step" style={step(480)}>
          <span className="tag tag-zol">
            <span className="dot bg-emerald" />
            Booked · Tue 7:30a
          </span>
        </p>
      </div>
    </div>
  );
}

export function TextWidget() {
  return (
    <div className="jw" aria-hidden="true">
      <Head
        label="Texts · 7:02 AM"
        right={
          <span className="t-data text-[0.625rem] text-emerald-deep">
            8s reply
          </span>
        }
      />
      <div className="grid gap-2 p-3.5">
        <p
          className="jw-step max-w-[85%] rounded-lg rounded-bl-[3px] bg-paper-3 px-3 py-2 text-[0.75rem] leading-relaxed text-ink-2"
          style={step(120)}
        >
          Can you fit an A/C check in today?
        </p>
        <p
          className="jw-step ml-auto max-w-[85%] rounded-lg rounded-br-[3px] border border-emerald-line bg-emerald-wash px-3 py-2 text-[0.75rem] leading-relaxed text-ink"
          style={step(320)}
        >
          Yes — 10:30 or 2:15?
          <span className="jw-caret" />
        </p>
        <p className="jw-step t-data text-[0.6875rem] text-ink-3" style={step(520)}>
          Confirmed slots write straight to the board
        </p>
      </div>
    </div>
  );
}

export function ApprovalWidget() {
  return (
    <div className="jw" aria-hidden="true">
      <Head
        label="Estimate · RO-4471"
        right={
          <span className="t-data text-[0.6875rem] font-semibold text-ink">
            $742.18
          </span>
        }
      />
      <div className="grid gap-2 p-3.5">
        <p className="jw-step t-data text-[0.6875rem] text-ink-2" style={step(120)}>
          Texted 8:30a · photo + reasoning attached
        </p>
        <p className="jw-step t-data text-[0.6875rem] text-ink-3" style={step(300)}>
          No reply after 20h → one nudge, then a person
        </p>
        <p className="jw-step flex items-center gap-2" style={step(480)}>
          <svg width="14" height="12" viewBox="0 0 14 12" fill="none">
            <path
              d="M1.5 6.4 5.2 10 12.5 1.5"
              pathLength="100"
              className="jw-draw"
              style={step(620)}
              stroke="var(--emerald-deep)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="t-data text-[0.75rem] font-medium text-emerald-deep">
            YES — approved 10:15a
          </span>
        </p>
      </div>
    </div>
  );
}

export function PartsWidget() {
  return (
    <div className="jw" aria-hidden="true">
      <Head
        label="Parts · reman alternator"
        right={
          <span className="t-data text-[0.625rem] text-ink-3">
            vendor: O&rsquo;Reilly
          </span>
        }
      />
      <div className="grid gap-2 p-3.5">
        <p
          className="jw-step t-data flex items-baseline gap-2 text-[0.75rem] text-ink-2"
          style={step(120)}
        >
          ETA
          <span className="jw-strike" style={step(340)}>
            Wednesday
          </span>
          <span className="jw-step font-semibold text-ink" style={step(520)}>
            → Thursday
          </span>
        </p>
        <p className="jw-step" style={step(700)}>
          <span className="t-data inline-flex items-center gap-1.5 rounded border border-line-2 bg-paper-2 px-2 py-1 text-[0.6875rem] font-medium text-ink">
            <svg width="11" height="10" viewBox="0 0 11 10" fill="none">
              <path
                d="M5.5 1 10.2 9H0.8L5.5 1Z"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinejoin="round"
              />
              <path d="M5.5 4.2v2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
            Bay 4 conflict — surfaced before the car was on the lift
          </span>
        </p>
      </div>
    </div>
  );
}

export const jobWidgets = [CallWidget, TextWidget, ApprovalWidget, PartsWidget];
