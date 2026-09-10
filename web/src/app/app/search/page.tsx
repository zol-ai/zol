import Link from "next/link";
import { Search } from "lucide-react";

import { PageHead } from "@/components/app/shell";
import { EmptyState, Section, StatusBadge } from "@/components/app/ui";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { formatCents } from "@/lib/money";
import { formatPhone } from "@/lib/phone";
import {
  appointmentHref,
  countResults,
  customerHref,
  estimateHref,
  invoiceHref,
  parseSearch,
  repairOrderHref,
  runSearch,
  vehicleHref,
  type SearchResults,
} from "@/lib/search";

export const metadata = { title: "Search" };

/**
 * ⌘K lands here. One box, results grouped by what they are, each row a
 * link to the screen that owns the record. A plain GET form: the query is
 * in the URL, so it survives a reload and can be pasted to a colleague.
 */
export default async function SearchPage(props: PageProps<"/app/search">) {
  const user = await requireUser();
  const { q } = await props.searchParams;
  const raw = typeof q === "string" ? q : "";
  const terms = parseSearch(raw);

  const results: SearchResults | null = terms
    ? await runSearch(await db(), user.shopId, terms)
    : null;
  const total = results ? countResults(results) : 0;

  return (
    <>
      <PageHead eyebrow={user.shopName} title="Search" />

      <form role="search" className="mb-6 flex gap-2">
        <label htmlFor="q" className="sr-only">
          Search
        </label>
        <div className="relative min-w-0 flex-1">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3"
          />
          <input
            id="q"
            name="q"
            type="search"
            autoFocus
            autoComplete="off"
            defaultValue={raw}
            placeholder="Name, phone, plate, VIN, #ticket, or a word from the complaint"
            className="input pl-9"
          />
        </div>
        <button type="submit" className="btn btn-emerald btn-sm">
          Search
        </button>
      </form>

      {!terms || !results ? (
        <Hints />
      ) : total === 0 ? (
        <div className="card">
          <EmptyState
            title={`Nothing matches “${terms.text}”`}
            detail="Try fewer words, the last four digits of the phone, or the plate without dashes."
            action={
              <Link href="/app/customers/new" className="btn btn-ghost btn-sm">
                Add a new customer
              </Link>
            }
          />
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          <p className="text-[0.875rem] text-ink-2">
            {total} result{total === 1 ? "" : "s"} for{" "}
            <span className="font-semibold text-ink">“{terms.text}”</span>
          </p>

          {results.customers.length > 0 && (
            <Section title="Customers" detail={`${results.customers.length}`} flush>
              <ul className="divide-y divide-line">
                {results.customers.map((hit) => (
                  <li key={hit.id}>
                    <Link href={customerHref(hit)} className="flex items-center gap-x-4 gap-y-1 px-4 py-3 transition-colors hover:bg-paper-2 sm:px-5">
                      <span className="min-w-0 flex-1">
                        <span className="block text-[0.9375rem] font-semibold text-ink">
                          {hit.full_name ?? "Unnamed"}
                        </span>
                        <span className="block truncate text-[0.8125rem] text-ink-2">
                          <span className="t-data">{formatPhone(hit.phone)}</span>
                          {hit.email && ` · ${hit.email}`}
                          {hit.vehicle && ` · ${hit.vehicle}`}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {results.vehicles.length > 0 && (
            <Section title="Vehicles" detail={`${results.vehicles.length}`} flush>
              <ul className="divide-y divide-line">
                {results.vehicles.map((hit) => (
                  <li key={hit.id}>
                    <Link href={vehicleHref(hit)} className="flex items-center gap-x-4 gap-y-1 px-4 py-3 transition-colors hover:bg-paper-2 sm:px-5">
                      <span className="min-w-0 flex-1">
                        <span className="block text-[0.9375rem] font-semibold text-ink">
                          {hit.label ?? "Vehicle"}
                        </span>
                        <span className="block truncate text-[0.8125rem] text-ink-2">
                          {hit.customer_name ?? "Unnamed"}
                          {hit.plate && (
                            <>
                              {" · "}
                              <span className="t-data">{hit.plate}</span>
                            </>
                          )}
                          {hit.vin && (
                            <>
                              {" · VIN "}
                              <span className="t-data">{hit.vin}</span>
                            </>
                          )}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {results.repairOrders.length > 0 && (
            <Section title="Repair orders" detail={`${results.repairOrders.length}`} flush>
              <ul className="divide-y divide-line">
                {results.repairOrders.map((hit) => (
                  <li key={hit.id}>
                    <Link href={repairOrderHref(hit)} className="flex items-center gap-x-4 gap-y-1 px-4 py-3 transition-colors hover:bg-paper-2 sm:px-5">
                      <span className="t-data w-14 flex-none text-[0.8125rem] text-ink-3">
                        #{hit.number}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[0.9375rem] font-semibold text-ink">
                          {hit.complaint ?? "No complaint recorded"}
                        </span>
                        <span className="block truncate text-[0.8125rem] text-ink-2">
                          {hit.customer_name ?? "Unnamed"}
                          {hit.vehicle && ` · ${hit.vehicle}`}
                        </span>
                      </span>
                      <StatusBadge kind="ro" value={hit.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {results.appointments.length > 0 && (
            <Section title="Appointments" detail={`${results.appointments.length}`} flush>
              <ul className="divide-y divide-line">
                {results.appointments.map((hit) => (
                  <li key={hit.id}>
                    <Link href={appointmentHref(hit, user.timezone)} className="flex items-center gap-x-4 gap-y-1 px-4 py-3 transition-colors hover:bg-paper-2 sm:px-5">
                      <span className="t-data w-28 flex-none text-[0.8125rem] text-ink">
                        {formatDateTime(hit.starts_at, user.timezone)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[0.9375rem] font-semibold text-ink">
                          {hit.service_type ?? hit.complaint ?? "Appointment"}
                        </span>
                        <span className="block truncate text-[0.8125rem] text-ink-2">
                          {hit.customer_name ?? "Unnamed"}
                          {hit.vehicle && ` · ${hit.vehicle}`}
                          {!hit.upcoming && " · past"}
                        </span>
                      </span>
                      <StatusBadge kind="appointment" value={hit.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {results.estimates.length > 0 && (
            <Section title="Estimates" detail={`${results.estimates.length}`} flush>
              <ul className="divide-y divide-line">
                {results.estimates.map((hit) => (
                  <li key={hit.id}>
                    <Link href={estimateHref(hit)} className="flex items-center gap-x-4 gap-y-1 px-4 py-3 transition-colors hover:bg-paper-2 sm:px-5">
                      <span className="t-data w-14 flex-none text-[0.8125rem] text-ink-3">
                        #{hit.number}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[0.9375rem] font-semibold text-ink">
                          {hit.customer_name ?? "Unnamed"}
                        </span>
                        <span className="block text-[0.8125rem] text-ink-2">
                          Ticket #{hit.ro_number} · {formatCents(hit.total_cents)}
                        </span>
                      </span>
                      <StatusBadge kind="estimate" value={hit.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {results.invoices.length > 0 && (
            <Section title="Invoices" detail={`${results.invoices.length}`} flush>
              <ul className="divide-y divide-line">
                {results.invoices.map((hit) => (
                  <li key={hit.id}>
                    <Link href={invoiceHref(hit)} className="flex items-center gap-x-4 gap-y-1 px-4 py-3 transition-colors hover:bg-paper-2 sm:px-5">
                      <span className="t-data w-14 flex-none text-[0.8125rem] text-ink-3">
                        #{hit.number}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[0.9375rem] font-semibold text-ink">
                          {hit.customer_name ?? "Unnamed"}
                        </span>
                        <span className="block text-[0.8125rem] text-ink-2">
                          Ticket #{hit.ro_number} · {formatCents(hit.total_cents)}
                          {hit.paid_cents > 0 &&
                            hit.paid_cents < hit.total_cents &&
                            ` · ${formatCents(hit.total_cents - hit.paid_cents)} owing`}
                        </span>
                      </span>
                      <StatusBadge kind="invoice" value={hit.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>
      )}
    </>
  );
}

/** The empty box. Says what it can find, with examples that work on any shop. */
function Hints() {
  const hints: { label: string; example: string }[] = [
    { label: "A customer", example: "by name, email, or any part of their phone number" },
    { label: "A vehicle", example: "by year, make and model in any order, plate, or VIN" },
    { label: "A ticket", example: "by number — #1047 — or a word from the complaint" },
    { label: "An appointment", example: "by the service or the complaint; upcoming ones first" },
    { label: "An estimate or invoice", example: "by number" },
  ];
  return (
    <div className="card p-5 sm:p-6">
      <p className="t-eyebrow">What you can find</p>
      <ul className="mt-3 grid gap-x-8 gap-y-2 sm:grid-cols-2">
        {hints.map((hint) => (
          <li key={hint.label} className="text-[0.875rem] text-ink-2">
            <span className="font-semibold text-ink">{hint.label}</span> {hint.example}
          </li>
        ))}
      </ul>
      <p className="mt-4 text-[0.8125rem] text-ink-3">
        Press <kbd className="t-data rounded border border-line bg-paper-2 px-1.5 py-0.5 text-[0.6875rem]">⌘K</kbd>{" "}
        or <kbd className="t-data rounded border border-line bg-paper-2 px-1.5 py-0.5 text-[0.6875rem]">Ctrl K</kbd>{" "}
        from any screen to get here.
      </p>
    </div>
  );
}
