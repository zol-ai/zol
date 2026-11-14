import Link from "next/link";
import { notFound } from "next/navigation";
import { getCall } from "@/lib/calls";
import { formatDuration, formatPhone } from "@/lib/phone";

export const dynamic = "force-dynamic";

export default async function CallDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await getCall(id);
  if (!data) notFound();
  const { call, turns } = data;

  return (
    <main className="mx-auto max-w-3xl p-8">
      <Link href="/" className="text-sm text-blue-700 hover:underline">
        ← All calls
      </Link>

      <h1 className="mt-4 text-2xl font-semibold">{formatPhone(call.from_number)}</h1>
      <dl className="mt-2 grid grid-cols-2 gap-x-8 gap-y-1 text-sm text-neutral-700 sm:grid-cols-4">
        <Field label="Started" value={new Date(call.started_at).toLocaleString()} />
        <Field label="Duration" value={formatDuration(call.duration_seconds)} />
        <Field label="Status" value={call.status} />
        <Field label="Intent" value={call.intent ?? "—"} />
        <Field label="Outcome" value={call.outcome ?? "—"} />
        <Field label="Call SID" value={call.call_sid} mono />
        {call.transferred_at && (
          <Field label="Transferred" value={new Date(call.transferred_at).toLocaleTimeString()} />
        )}
      </dl>

      {call.recording_url ? (
        <div className="mt-6">
          <div className="text-xs uppercase tracking-wide text-neutral-500">Recording</div>
          <audio controls preload="none" src={`/api/recordings/${call.id}`} className="mt-1 w-full" />
        </div>
      ) : call.recording_sid ? (
        <p className="mt-6 text-sm text-neutral-500">Recording is processing.</p>
      ) : null}

      {call.summary && (
        <p className="mt-6 rounded-md border border-neutral-200 bg-neutral-50 p-4">{call.summary}</p>
      )}

      <h2 className="mt-8 text-lg font-medium">Transcript</h2>
      {turns.length === 0 ? (
        <p className="mt-2 text-neutral-500">No transcript captured.</p>
      ) : (
        <ol className="mt-3 space-y-3">
          {turns.map((t) => (
            <li
              key={t.id}
              className={
                t.role === "agent"
                  ? "ml-8 rounded-lg bg-blue-50 p-3"
                  : "mr-8 rounded-lg bg-neutral-100 p-3"
              }
            >
              <div className="text-xs uppercase tracking-wide text-neutral-500">
                {t.role} · {new Date(t.at).toLocaleTimeString()}
              </div>
              <div className="mt-1 whitespace-pre-wrap">{t.content}</div>
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="col-span-1">
      <dt className="text-xs uppercase tracking-wide text-neutral-500">{label}</dt>
      <dd className={mono ? "break-all font-mono text-xs" : ""}>{value}</dd>
    </div>
  );
}
