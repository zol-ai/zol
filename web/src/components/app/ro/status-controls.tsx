import { setRepairOrderStatus } from "@/app/actions/repair-orders";
import { RO_STATUS_LABEL, RO_STATUSES, type RoStatus } from "@/lib/statuses";

/**
 * The status buttons.
 *
 * For each stop, the one or two moves a shop actually makes from it — as
 * buttons, because the person pressing them is holding a phone in the bay
 * and the next move should be one tap. Everything else is behind "Move to…",
 * a full list, for the day a ticket has to go backwards or be cancelled.
 *
 * Every button is the same Server Action, and that action is one call to
 * `transitionRepairOrder`: the history row, the customer's message and the
 * counter's notification all happen there, never here.
 */
const NEXT_MOVES: Record<RoStatus, RoStatus[]> = {
  open: ["diagnosing", "in_progress"],
  diagnosing: ["awaiting_approval", "in_progress"],
  awaiting_approval: ["in_progress", "awaiting_parts"],
  awaiting_parts: ["in_progress"],
  in_progress: ["quality_check", "ready"],
  quality_check: ["ready", "in_progress"],
  ready: ["closed"],
  closed: [],
  cancelled: ["open"],
};

/** What the button says — the verb, not the noun the column is called. */
const MOVE_LABEL: Record<RoStatus, string> = {
  open: "Reopen",
  diagnosing: "Start diagnosing",
  awaiting_approval: "Send for approval",
  awaiting_parts: "Waiting on parts",
  in_progress: "On the lift",
  quality_check: "Quality check",
  ready: "Mark ready",
  closed: "Close ticket",
  cancelled: "Cancel",
};

export function StatusControls({
  repairOrderId,
  status,
}: {
  repairOrderId: string;
  status: RoStatus;
}) {
  const moves = NEXT_MOVES[status];

  return (
    <div className="flex flex-wrap items-center gap-2">
      {moves.map((next, index) => (
        <form key={next} action={setRepairOrderStatus}>
          <input type="hidden" name="id" value={repairOrderId} />
          <input type="hidden" name="status" value={next} />
          <button
            type="submit"
            className={`btn btn-sm ${index === 0 ? "btn-emerald" : "btn-ghost"}`}
          >
            {MOVE_LABEL[next]}
          </button>
        </form>
      ))}

      {/* Keyed on the status so a completed move collapses the popover and
          re-seeds the select, instead of it staying open across the refresh. */}
      <details key={status} className="relative">
        <summary className="btn btn-ghost btn-sm cursor-pointer list-none [&::-webkit-details-marker]:hidden">
          Move to…
        </summary>
        <form
          action={setRepairOrderStatus}
          className="absolute right-0 z-20 mt-2 flex w-64 flex-col gap-2 rounded-[var(--radius)] border border-line bg-paper p-3 shadow-lg"
        >
          <input type="hidden" name="id" value={repairOrderId} />
          <label htmlFor="status-move" className="text-[0.8125rem] font-semibold text-ink-2">
            Any status
          </label>
          <select
            id="status-move"
            name="status"
            defaultValue={status}
            className="w-full rounded-[var(--radius)] border border-line-2 bg-paper px-3 py-2 text-[0.9375rem] text-ink"
          >
            {RO_STATUSES.map((value) => (
              <option key={value} value={value}>
                {RO_STATUS_LABEL[value]}
              </option>
            ))}
          </select>
          <button type="submit" className="btn btn-primary btn-sm">
            Move
          </button>
          <p className="text-[0.75rem] text-ink-3">
            Moving to on the lift, waiting on parts or ready texts the customer.
          </p>
        </form>
      </details>
    </div>
  );
}
