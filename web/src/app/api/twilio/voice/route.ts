import { startCall } from "@/lib/calls";
import { env } from "@/lib/env";
import { readVerifiedTwilioForm, twimlResponse } from "@/lib/twilio/signature";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Twilio "A call comes in" webhook. Records the call and hands the audio to
 * our WebSocket bridge via <Connect><Stream>.
 */
export async function POST(request: Request) {
  const form = await readVerifiedTwilioForm(request);
  if (!form) return new Response("forbidden", { status: 403 });

  const callSid = form.CallSid;
  if (!callSid) return new Response("bad request", { status: 400 });

  try {
    await startCall({
      callSid,
      from: form.From,
      to: form.To,
      direction: form.Direction?.startsWith("outbound") ? "outbound" : "inbound",
    });
  } catch (err) {
    // A DB hiccup must not drop the call; the bridge still answers.
    console.error("startCall failed", err);
  }

  const wsUrl = env.publicBaseUrl().replace(/^http/, "ws") + "/media-stream";

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${wsUrl}">
      <Parameter name="callSid" value="${callSid}" />
    </Stream>
  </Connect>
</Response>`;
  return twimlResponse(xml);
}
