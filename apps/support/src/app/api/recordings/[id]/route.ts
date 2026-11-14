import { getCall } from "@/lib/calls";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Streams a call's recording from Twilio. Twilio recording URLs need account
 * credentials, so the browser never talks to Twilio directly; the dashboard's
 * own login gate (proxy.ts) protects this route.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const data = await getCall(id);
  if (!data?.call.recording_url) return new Response("not found", { status: 404 });

  const auth = Buffer.from(`${env.twilioAccountSid()}:${env.twilioAuthToken()}`).toString("base64");
  const upstream = await fetch(`${data.call.recording_url}.mp3`, {
    headers: { Authorization: `Basic ${auth}` },
  });
  if (!upstream.ok || !upstream.body) {
    return new Response("recording unavailable", { status: 502 });
  }
  return new Response(upstream.body, {
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "private, max-age=3600",
    },
  });
}
