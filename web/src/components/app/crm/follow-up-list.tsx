import type { ReactNode } from "react";

import { FollowUpCard, type FollowUpCardData } from "./follow-up-card";

/**
 * A titled group of follow-up cards, with something honest to say when the
 * group is empty. Server component: the cards are the interactive part.
 */
export function FollowUpList({
  title,
  count,
  empty,
  items,
  timezone,
  returnTo,
  aiConfigured,
  showCustomer = true,
  action,
}: {
  title: string;
  /** Shown when it differs from items.length — a capped list of a bigger set. */
  count?: number;
  empty: ReactNode;
  items: FollowUpCardData[];
  timezone: string;
  returnTo: string;
  aiConfigured: boolean;
  showCustomer?: boolean;
  action?: ReactNode;
}) {
  return (
    <section>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2 px-1">
        <h2 className="t-eyebrow">
          {title}
          <span className="t-data ml-2 normal-case tracking-normal text-ink-3">
            {count ?? items.length}
          </span>
        </h2>
        {action}
      </div>

      {items.length === 0 ? (
        <p className="card px-6 py-6 text-center text-[0.875rem] text-ink-2">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((item) => (
            <FollowUpCard
              key={item.id}
              followUp={item}
              timezone={timezone}
              returnTo={returnTo}
              aiConfigured={aiConfigured}
              showCustomer={showCustomer}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
