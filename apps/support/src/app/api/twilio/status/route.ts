import { finishCall, getTranscript, saveAnalysis } from "@/lib/calls";
import { summarizeCall } from "@/lib/agent/summarize";
import { readVerifiedTwilioForm } from "@/lib/twilio/signature";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TERMINAL = new Set(["completed", "busy", "failed", "no-answer", "canceled"]);

/**
 * Twilio call status callback. Set the phone number's "Call status changes"
 * URL to this route in the Twilio console. On a terminal status we close the
 * row and run the post-call summary.
 */
export async function POST(request: Request) {
  const form = await readVerifiedTwilioForm(request);
  if (!form) return new Response("forbidden", { status: 403 });

  const callSid = form.CallSid;
  const status = form.CallStatus ?? "unknown";
  if (!callSid) return new Response("bad request", { status: 400 });

  if (TERMINAL.has(status)) {
    const duration = form.CallDuration ? Number(form.CallDuration) : undefined;
    await finishCall({
      callSid,
      status,
      durationSeconds: Number.isFinite(duration) ? duration : undefined,
      recordingUrl: form.RecordingUrl,
    });
    try {
      const turns = await getTranscript(callSid);
      const analysis = await summarizeCall(turns);
      if (analysis) await saveAnalysis(callSid, analysis);
    } catch (err) {
      console.error("post-call summary failed", err);
    }
  }

  return new Response("ok", { status: 200 });
}
