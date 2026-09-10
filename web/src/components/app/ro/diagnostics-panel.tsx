import { DiagnosticResultSchema, type DiagnosticResult } from "@/lib/ai/diagnostics";
import { aiConfigured } from "@/lib/ai/client";
import { DiagnosticForm, VerifyDiagnosticForm } from "@/components/app/ro-forms";
import { Notice, Section, Tag } from "@/components/app/ui";
import { query } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import type { RoContext } from "./contracts";

/**
 * Codes, symptoms, the ranked causes, and the technician's verdict.
 *
 * The newest diagnostic is shown in full; earlier runs on the same ticket
 * fold up beneath it. The ranking is labelled with where it came from — the
 * model, or the fallback table when there is no key — and is never presented
 * as the answer: the verification box is the answer, and only it reaches the
 * ticket's cause.
 */

interface DiagnosticRow {
  id: string;
  obd_codes: string[];
  symptoms: string | null;
  observations: string | null;
  ai_result: unknown;
  ai_source: "openai" | "fallback";
  verification: string | null;
  verified_at: string | null;
  verified_by_name: string | null;
  technician_name: string | null;
  created_at: string;
}

export async function DiagnosticsPanel({ ro }: { ro: RoContext }) {
  const rows = await query<DiagnosticRow>(
    `SELECT d.id, d.obd_codes, d.symptoms, d.observations, d.ai_result, d.ai_source,
            d.verification, d.verified_at::text, d.created_at::text,
            verifier.full_name AS verified_by_name,
            tech.full_name AS technician_name
       FROM diagnostics d
       LEFT JOIN staff verifier ON verifier.id = d.verified_by
       LEFT JOIN staff tech ON tech.id = d.technician_id
      WHERE d.repair_order_id = $1 AND d.shop_id = $2
      ORDER BY d.created_at DESC`,
    [ro.id, ro.shopId],
  );

  const [latest, ...earlier] = rows;
  const closed = ro.status === "closed" || ro.status === "cancelled";

  return (
    <Section
      id="diagnostics"
      title="Diagnostics"
      detail={
        latest
          ? `${rows.length} ${rows.length === 1 ? "run" : "runs"} · latest ${formatDateTime(latest.created_at, ro.timezone)}`
          : "Codes and symptoms in, ranked causes out."
      }
    >
      {latest ? (
        <div className="flex flex-col gap-6">
          <DiagnosticView row={latest} ro={ro} />

          {earlier.length > 0 && (
            <details className="group">
              <summary className="cursor-pointer list-none text-[0.8125rem] font-semibold text-ink-2 underline-offset-2 hover:underline [&::-webkit-details-marker]:hidden">
                {earlier.length} earlier {earlier.length === 1 ? "run" : "runs"} on this ticket
              </summary>
              <div className="mt-4 flex flex-col gap-6 border-l-2 border-line pl-4">
                {earlier.map((row) => (
                  <DiagnosticView key={row.id} row={row} ro={ro} compact />
                ))}
              </div>
            </details>
          )}

          {!closed && (
            <details className="border-t border-line pt-4">
              <summary className="btn btn-ghost btn-sm cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                Run another diagnostic
              </summary>
              <div className="mt-4">
                <DiagnosticForm key={rows.length} repairOrderId={ro.id} aiConfigured={aiConfigured()} />
              </div>
            </details>
          )}
        </div>
      ) : closed ? (
        <p className="text-[0.875rem] text-ink-2">No diagnostic was run on this ticket.</p>
      ) : (
        <DiagnosticForm repairOrderId={ro.id} aiConfigured={aiConfigured()} />
      )}
    </Section>
  );
}

function DiagnosticView({
  row,
  ro,
  compact = false,
}: {
  row: DiagnosticRow;
  ro: RoContext;
  compact?: boolean;
}) {
  // The column is storage, not a contract: parse it the same way the model's
  // answer was parsed, and show nothing rather than half a shape.
  const parsed = DiagnosticResultSchema.safeParse(row.ai_result);
  const result: DiagnosticResult | null = parsed.success ? parsed.data : null;
  const closed = ro.status === "closed" || ro.status === "cancelled";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {row.obd_codes.length > 0 ? (
          row.obd_codes.map((code) => (
            <span key={code} className="t-data rounded border border-line-2 bg-paper-2 px-2 py-0.5 text-[0.8125rem] text-ink">
              {code}
            </span>
          ))
        ) : (
          <span className="text-[0.8125rem] text-ink-3">No codes</span>
        )}
        <span className="ml-auto flex flex-wrap items-center gap-2 text-[0.75rem] text-ink-3">
          {row.technician_name && <span>{row.technician_name}</span>}
          {compact && <span className="t-data">{formatDateTime(row.created_at, ro.timezone)}</span>}
          {/* Emerald when the model ranked it; neutral for the fallback — the
              label is the point, not the colour. */}
          <Tag tone={row.ai_source === "openai" ? "zol" : "neutral"}>
            {row.ai_source === "openai" ? "Model ranking" : "Fallback guidance"}
          </Tag>
        </span>
      </div>

      {(row.symptoms || row.observations) && (
        <dl className="grid gap-x-6 gap-y-2 text-[0.875rem] sm:grid-cols-2">
          {row.symptoms && (
            <div>
              <dt className="t-eyebrow mb-0.5">Symptoms</dt>
              <dd className="leading-relaxed text-ink-2">{row.symptoms}</dd>
            </div>
          )}
          {row.observations && (
            <div>
              <dt className="t-eyebrow mb-0.5">Observations</dt>
              <dd className="leading-relaxed text-ink-2">{row.observations}</dd>
            </div>
          )}
        </dl>
      )}

      {result ? (
        <>
          <div>
            <h3 className="t-eyebrow mb-2">Probable causes</h3>
            <ol className="flex flex-col gap-3">
              {result.causes.map((cause, index) => (
                <li key={`${row.id}-${index}`} className="rounded-[var(--radius)] border border-line bg-paper-2/60 p-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="text-[0.9375rem] font-semibold text-ink">
                      <span className="t-data mr-2 text-[0.75rem] text-ink-3">{index + 1}</span>
                      {cause.title}
                    </p>
                    <span className="t-data flex-none text-[0.8125rem] text-ink-2">{cause.confidence}%</span>
                  </div>
                  <div
                    role="meter"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={cause.confidence}
                    aria-label={`${cause.title}, ${cause.confidence}% confidence`}
                    className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-line"
                  >
                    <span
                      className={`block h-full rounded-full ${
                        cause.confidence >= 60 ? "bg-emerald" : cause.confidence >= 35 ? "bg-amber" : "bg-line-2"
                      }`}
                      style={{ width: `${Math.max(3, Math.min(100, cause.confidence))}%` }}
                    />
                  </div>
                  {!compact && cause.explanation && (
                    <p className="mt-2 text-[0.875rem] leading-relaxed text-ink-2">{cause.explanation}</p>
                  )}
                  {cause.supporting.length > 0 && (
                    <p className="mt-1.5 flex flex-wrap gap-1.5">
                      {cause.supporting.map((fact) => (
                        <span key={fact} className="tag tag-neutral">
                          {fact}
                        </span>
                      ))}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          </div>

          {!compact && result.testPlan.length > 0 && (
            <div>
              <h3 className="t-eyebrow mb-2">Test plan</h3>
              <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-[0.875rem] leading-relaxed text-ink-2 marker:t-data marker:text-ink-3">
                {result.testPlan.map((step, index) => (
                  <li key={`${row.id}-t${index}`}>{step}</li>
                ))}
              </ol>
            </div>
          )}

          {!compact && result.warnings.length > 0 && (
            <Notice tone="person">
              <ul className="flex flex-col gap-1">
                {result.warnings.map((warning, index) => (
                  <li key={`${row.id}-w${index}`} className={index === result.warnings.length - 1 ? "font-semibold" : ""}>
                    {warning}
                  </li>
                ))}
              </ul>
            </Notice>
          )}
        </>
      ) : (
        <Notice tone="neutral">This run&rsquo;s ranking could not be read back.</Notice>
      )}

      <div className="rounded-[var(--radius)] border border-line p-3 sm:p-4">
        {row.verification ? (
          <>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="t-eyebrow">Technician verification</h3>
              <p className="text-[0.75rem] text-ink-3">
                <Tag tone="person" className="mr-2">
                  Verified
                </Tag>
                {row.verified_by_name ?? "Someone at the shop"}
                {row.verified_at && ` · ${formatDateTime(row.verified_at, ro.timezone)}`}
              </p>
            </div>
            <p className="mt-2 text-[0.9375rem] leading-relaxed text-ink">{row.verification}</p>
          </>
        ) : compact || closed ? (
          <p className="text-[0.8125rem] text-ink-3">Not verified by a technician.</p>
        ) : (
          <VerifyDiagnosticForm
            diagnosticId={row.id}
            repairOrderId={ro.id}
            suggestion={result?.causes[0]?.title ?? null}
          />
        )}
      </div>
    </div>
  );
}
