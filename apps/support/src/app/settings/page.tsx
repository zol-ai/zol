import { getAgentSettings, VOICES } from "@/lib/settings";
import { operationalNotes } from "@/lib/agent/prompt";
import { env } from "@/lib/env";
import { resetToDefault, saveSettings } from "./actions";

export const dynamic = "force-dynamic";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const [{ saved, error }, settings] = await Promise.all([searchParams, getAgentSettings()]);
  const handoff = env.handoffNumber();
  const notes = operationalNotes({ handoffAvailable: Boolean(handoff), recording: env.recordCalls() });

  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-2xl font-semibold">Agent settings</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Changes apply to the next call. No redeploy needed.
        {settings.updatedAt && (
          <> Last saved {new Date(settings.updatedAt).toLocaleString()}.</>
        )}
        {!settings.fromDatabase && <> Currently using the built-in default.</>}
      </p>

      {saved && (
        <p className="mt-4 rounded-md border border-green-300 bg-green-50 p-3 text-sm text-green-900">
          Saved.
        </p>
      )}
      {error && (
        <p className="mt-4 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900">
          {error}
        </p>
      )}

      <form action={saveSettings} className="mt-6 space-y-5">
        <div>
          <label htmlFor="instructions" className="block text-sm font-medium">
            Instructions
          </label>
          <p className="text-xs text-neutral-500">
            What the agent knows and how it should behave. Plain English works best.
          </p>
          <textarea
            id="instructions"
            name="instructions"
            rows={26}
            defaultValue={settings.instructions}
            className="mt-2 w-full rounded-md border border-neutral-300 p-3 font-mono text-sm leading-relaxed"
          />
        </div>

        <div>
          <label htmlFor="voice" className="block text-sm font-medium">
            Voice
          </label>
          <select
            id="voice"
            name="voice"
            defaultValue={settings.voice}
            className="mt-2 rounded-md border border-neutral-300 px-3 py-2 text-sm"
          >
            {VOICES.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm text-white hover:bg-neutral-700"
          >
            Save
          </button>
          <button
            type="submit"
            formAction={resetToDefault}
            className="rounded-md border border-neutral-300 px-4 py-2 text-sm hover:bg-neutral-50"
          >
            Reset to default
          </button>
        </div>
      </form>

      <section className="mt-10">
        <h2 className="text-sm font-medium">Always appended (set by configuration)</h2>
        <p className="text-xs text-neutral-500">
          Human handoff: {handoff ? `forwards to ${handoff}` : "not configured"}. Recording:{" "}
          {env.recordCalls() ? "on" : "off"}.
        </p>
        <pre className="mt-2 whitespace-pre-wrap rounded-md border border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-700">
          {notes.trim()}
        </pre>
      </section>
    </main>
  );
}
