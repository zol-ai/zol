"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { finalizeVoiceCall } from "@/lib/receptionist/engine";
import { TEST_CALL_SCRIPTS, testCallScript } from "@/lib/receptionist/scripts";

/**
 * The "Run a test call" button.
 *
 * Nothing rings. A scripted transcript (lib/receptionist/scripts.ts) is
 * handed to `finalizeVoiceCall` — the same entry point the realtime media
 * service will use for a real call — so the shop can watch the whole
 * pipeline land: the intake, the customer and vehicle match, the slot, the
 * confirmation in the queue, the note on the bell. The row it writes is
 * `simulated = true`, labelled on every screen and left out of the rates.
 */
export async function runTestCall(form: FormData): Promise<void> {
  const user = await requireUser();

  const key = form.get("script");
  const script = (typeof key === "string" ? testCallScript(key) : undefined) ?? TEST_CALL_SCRIPTS[0];

  const shops = await query<{ twilio_number: string | null; public_phone: string | null }>(
    "SELECT twilio_number, public_phone FROM shops WHERE id = $1",
    [user.shopId],
  );
  const shop = shops[0];

  const result = await finalizeVoiceCall({
    shopId: user.shopId,
    callSid: null,
    from: script.from,
    // The line ZOL answers on, once there is one; the shop's number until then.
    to: shop?.twilio_number ?? shop?.public_phone ?? "simulated",
    transcript: script.transcript,
    durationSeconds: script.durationSeconds,
    simulated: true,
  });

  revalidatePath("/app/calls");
  revalidatePath("/app/schedule");
  revalidatePath("/app/customers");
  redirect(`/app/calls/${result.callId}`);
}
