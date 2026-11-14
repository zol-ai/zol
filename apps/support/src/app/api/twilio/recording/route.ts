import { saveRecording } from "@/lib/calls";
import { readVerifiedTwilioForm } from "@/lib/twilio/signature";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Twilio recording status callback: stores the recording URL on the call. */
export async function POST(request: Request) {
  const form = await readVerifiedTwilioForm(request);
  if (!form) return new Response("forbidden", { status: 403 });

  const { CallSid, RecordingSid, RecordingUrl, RecordingStatus } = form;
  if (!CallSid || !RecordingSid) return new Response("bad request", { status: 400 });

  if (RecordingStatus === "completed" && RecordingUrl) {
    await saveRecording(CallSid, RecordingSid, RecordingUrl);
  }
  return new Response("ok", { status: 200 });
}
