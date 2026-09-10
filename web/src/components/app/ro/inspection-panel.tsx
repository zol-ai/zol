import Image from "next/image";

import { removeAttachment } from "@/app/actions/attachments";
import { completeInspection, startInspection } from "@/app/actions/inspections";
import { InspectionSummarySchema, type InspectionSummary } from "@/lib/ai/inspection";
import {
  InspectionItemForm,
  UploadPhotoForm,
  type InspectionItemRecord,
} from "@/components/app/ro-forms";
import { EmptyState, Notice, RatingDot, Section, StatusBadge, Tag } from "@/components/app/ui";
import { query } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { countRatings } from "@/lib/inspections";
import { storageConfigured } from "@/lib/storage/provider";
import { RATING_LABEL, type Rating } from "@/lib/statuses";
import type { RoContext } from "./contracts";

/**
 * The digital inspection: thirteen systems, each green, yellow, red or not
 * looked at, with a note, a measurement and — when a bucket is configured —
 * photos. Completing it writes the customer-facing summary from the rated
 * items and nothing else, and freezes the sheet.
 */

interface InspectionRow {
  id: string;
  overall: Rating;
  summary: unknown;
  summary_source: "openai" | "fallback" | null;
  completed_at: string | null;
  created_at: string;
  technician_name: string | null;
}

interface ItemRow extends InspectionItemRecord {
  updated_at: string;
}

interface AttachmentRow {
  id: string;
  entity_id: string;
  url: string;
  caption: string | null;
}

export async function InspectionPanel({ ro }: { ro: RoContext }) {
  const inspections = await query<InspectionRow>(
    `SELECT i.id, i.overall, i.summary, i.summary_source, i.completed_at::text, i.created_at::text,
            t.full_name AS technician_name
       FROM inspections i
       LEFT JOIN staff t ON t.id = i.technician_id
      WHERE i.repair_order_id = $1 AND i.shop_id = $2
      ORDER BY i.created_at DESC
      LIMIT 1`,
    [ro.id, ro.shopId],
  );
  const inspection = inspections[0];
  const closed = ro.status === "closed" || ro.status === "cancelled";

  if (!inspection) {
    return (
      <Section id="inspection" title="Inspection" detail="Thirteen systems, rated from the bay.">
        {closed ? (
          <p className="text-[0.875rem] text-ink-2">No inspection was done on this ticket.</p>
        ) : (
          <EmptyState
            title="No inspection yet"
            detail="Start one and rate each system as you go. The customer gets a plain-English summary when you finish."
            className="py-6"
            action={
              <form action={startInspection}>
                <input type="hidden" name="repair_order_id" value={ro.id} />
                <button type="submit" className="btn btn-emerald btn-sm">
                  Start inspection
                </button>
              </form>
            }
          />
        )}
      </Section>
    );
  }

  const [items, attachments] = await Promise.all([
    query<ItemRow>(
      `SELECT id, category, name, rating, measurement, notes, updated_at::text
         FROM inspection_items
        WHERE inspection_id = $1
        ORDER BY position`,
      [inspection.id],
    ),
    query<AttachmentRow>(
      `SELECT a.id, a.entity_id, a.url, a.caption
         FROM attachments a
         JOIN inspection_items it ON it.id = a.entity_id
        WHERE a.shop_id = $1 AND a.entity_type = 'inspection_item' AND it.inspection_id = $2
        ORDER BY a.created_at`,
      [ro.shopId, inspection.id],
    ),
  ]);

  const counts = countRatings(items.map((item) => item.rating));
  const rated = items.length - counts.not_inspected;
  const completed = Boolean(inspection.completed_at);
  const readOnly = completed || closed;
  const photosOn = storageConfigured() && !readOnly;
  const parsedSummary = InspectionSummarySchema.safeParse(inspection.summary);
  const summary: InspectionSummary | null = parsedSummary.success ? parsedSummary.data : null;

  return (
    <Section
      id="inspection"
      title="Inspection"
      detail={
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <StatusBadge kind="rating" value={inspection.overall} />
          <span>
            {counts.green} good · {counts.yellow} watch · {counts.red} urgent
            {counts.not_inspected > 0 && ` · ${counts.not_inspected} not checked`}
          </span>
          {inspection.technician_name && <span>· {inspection.technician_name}</span>}
          {inspection.completed_at && (
            <span>· completed {formatDateTime(inspection.completed_at, ro.timezone)}</span>
          )}
        </span>
      }
      action={
        !readOnly ? (
          <form action={completeInspection}>
            <input type="hidden" name="inspection_id" value={inspection.id} />
            <input type="hidden" name="repair_order_id" value={ro.id} />
            <button type="submit" className="btn btn-emerald btn-sm" disabled={rated === 0}>
              Complete inspection
            </button>
          </form>
        ) : completed && !closed ? (
          <form action={startInspection}>
            <input type="hidden" name="repair_order_id" value={ro.id} />
            <button type="submit" className="btn btn-ghost btn-sm">
              Start a new inspection
            </button>
          </form>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-5">
        {summary && (
          <div className="rounded-[var(--radius)] border border-line bg-paper-2/60 p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="t-eyebrow">What the customer reads</h3>
              <Tag tone={inspection.summary_source === "openai" ? "zol" : "neutral"}>
                {inspection.summary_source === "openai" ? "Model summary" : "Fallback summary"}
              </Tag>
            </div>
            <p className="mt-2 text-[0.9375rem] leading-relaxed text-ink">{summary.summary}</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <SummaryList title="Needs attention now" items={summary.urgent} tone="red" />
              <SummaryList title="Plan for soon" items={summary.recommended} tone="yellow" />
              <SummaryList title="Maintenance" items={summary.maintenance} tone="not_inspected" />
              <SummaryList title="Safety" items={summary.safety} tone="red" />
            </div>
          </div>
        )}

        {!readOnly && rated === 0 && (
          <Notice tone="neutral">
            Rate at least one system before completing. Anything left as not checked stays out of the summary.
          </Notice>
        )}

        <ul className="flex flex-col gap-3">
          {items.map((item) => {
            const photos = attachments.filter((photo) => photo.entity_id === item.id);
            return (
              <li key={item.id} className="rounded-[var(--radius)] border border-line p-3 sm:p-4">
                <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <p className="flex items-center gap-2 text-[0.9375rem] font-semibold text-ink">
                    <RatingDot rating={item.rating} />
                    {item.category}
                    <span className="sr-only">, {RATING_LABEL[item.rating]}</span>
                  </p>
                  <p className="text-[0.8125rem] text-ink-3">{item.name}</p>
                </div>

                {readOnly ? (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.875rem]">
                    <StatusBadge kind="rating" value={item.rating} />
                    {item.measurement && <span className="t-data text-ink-2">{item.measurement}</span>}
                    {item.notes && <span className="text-ink-2">{item.notes}</span>}
                    {!item.measurement && !item.notes && item.rating === "not_inspected" && (
                      <span className="text-ink-3">Not looked at on this visit.</span>
                    )}
                  </div>
                ) : (
                  <InspectionItemForm
                    key={item.updated_at}
                    item={item}
                    repairOrderId={ro.id}
                    readOnly={false}
                  />
                )}

                {photos.length > 0 && (
                  <ul className="mt-3 flex flex-wrap gap-2">
                    {photos.map((photo) => (
                      <li key={photo.id} className="w-28">
                        <a href={photo.url} target="_blank" rel="noreferrer" className="block">
                          <Image
                            src={photo.url}
                            alt={photo.caption ?? `${item.category} photo`}
                            width={112}
                            height={112}
                            unoptimized
                            className="h-28 w-28 rounded-[var(--radius)] border border-line object-cover"
                          />
                        </a>
                        <p className="mt-1 flex items-start justify-between gap-1 text-[0.75rem] text-ink-3">
                          <span className="min-w-0 truncate">{photo.caption ?? "Photo"}</span>
                          {!readOnly && (
                            <form action={removeAttachment}>
                              <input type="hidden" name="id" value={photo.id} />
                              <input type="hidden" name="repair_order_id" value={ro.id} />
                              <button
                                type="submit"
                                className="underline-offset-2 hover:text-amber-deep hover:underline"
                                aria-label={`Remove photo ${photo.caption ?? ""}`}
                              >
                                Remove
                              </button>
                            </form>
                          )}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}

                {photosOn && (
                  <details className="mt-3">
                    <summary className="cursor-pointer list-none text-[0.8125rem] font-semibold text-ink-2 underline-offset-2 hover:underline [&::-webkit-details-marker]:hidden">
                      Add a photo
                    </summary>
                    <div className="mt-2">
                      <UploadPhotoForm
                        repairOrderId={ro.id}
                        entityType="inspection_item"
                        entityId={item.id}
                      />
                    </div>
                  </details>
                )}
              </li>
            );
          })}
        </ul>

        {!storageConfigured() && !readOnly && (
          <p className="text-[0.75rem] text-ink-3">
            Photos are off on this deployment — set GCS_BUCKET to turn them on. Ratings, notes and
            measurements are the inspection either way.
          </p>
        )}
      </div>
    </Section>
  );
}

function SummaryList({
  title,
  items,
  tone,
}: {
  title: string;
  items: string[];
  tone: Rating;
}) {
  if (items.length === 0) return null;
  return (
    <div>
      <h4 className="t-eyebrow mb-1 flex items-center gap-1.5">
        <RatingDot rating={tone} />
        {title}
      </h4>
      <ul className="flex flex-col gap-0.5 text-[0.875rem] leading-relaxed text-ink-2">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
