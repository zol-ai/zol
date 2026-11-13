import Link from "next/link";
import { callStats, listCalls } from "@/lib/calls";
import { formatDuration, formatPhone } from "@/lib/phone";

export const dynamic = "force-dynamic";

export default async function CallsPage() {
  const [calls, stats] = await Promise.all([listCalls(), callStats()]);

  if (calls === null) {
    return (
      <main className="mx-auto max-w-4xl p-8">
        <h1 className="text-2xl font-semibold">Zol Support</h1>
        <p className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-4 text-amber-900">
          <code>DATABASE_URL</code> is not set. Copy <code>.env.example</code> to{" "}
          <code>.env.local</code>, fill it in, and run <code>npm run db:migrate</code>.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl p-8">
      <header className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">Zol Support · Calls</h1>
        <span className="text-sm text-neutral-500">auto-refreshes on reload</span>
      </header>

      <section className="mt-6 grid grid-cols-3 gap-4">
        <Stat label="Total calls" value={String(stats?.total ?? 0)} />
        <Stat label="Today" value={String(stats?.today ?? 0)} />
        <Stat label="Avg duration" value={formatDuration(stats?.avgDuration)} />
      </section>

      <section className="mt-8 overflow-hidden rounded-lg border border-neutral-200">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left text-neutral-600">
            <tr>
              <th className="px-4 py-2 font-medium">When</th>
              <th className="px-4 py-2 font-medium">Caller</th>
              <th className="px-4 py-2 font-medium">Duration</th>
              <th className="px-4 py-2 font-medium">Intent</th>
              <th className="px-4 py-2 font-medium">Outcome</th>
              <th className="px-4 py-2 font-medium">Summary</th>
            </tr>
          </thead>
          <tbody>
            {calls.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-neutral-500">
                  No calls yet. Point your Twilio number at <code>/api/twilio/voice</code> and
                  give it a ring.
                </td>
              </tr>
            )}
            {calls.map((c) => (
              <tr key={c.id} className="border-t border-neutral-100 hover:bg-neutral-50">
                <td className="whitespace-nowrap px-4 py-2">
                  <Link href={`/calls/${c.id}`} className="text-blue-700 hover:underline">
                    {new Date(c.started_at).toLocaleString()}
                  </Link>
                </td>
                <td className="whitespace-nowrap px-4 py-2">{formatPhone(c.from_number)}</td>
                <td className="whitespace-nowrap px-4 py-2">
                  {c.status === "in-progress" ? (
                    <span className="rounded bg-green-100 px-2 py-0.5 text-green-800">live</span>
                  ) : (
                    formatDuration(c.duration_seconds)
                  )}
                </td>
                <td className="px-4 py-2">{c.intent ? <Tag>{c.intent}</Tag> : "—"}</td>
                <td className="px-4 py-2">{c.outcome ? <Tag>{c.outcome}</Tag> : "—"}</td>
                <td className="max-w-md truncate px-4 py-2 text-neutral-700">
                  {c.summary ?? <span className="text-neutral-400">pending</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-neutral-200 p-4">
      <div className="text-xs uppercase tracking-wide text-neutral-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </div>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs text-neutral-700">{children}</span>
  );
}
