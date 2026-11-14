"use server";

import { headers } from "next/headers";

import { clientIp } from "@/lib/client-ip";
import { query } from "@/lib/db";
import { OPERATOR_EMAIL, sendEmail } from "@/lib/notify";
import { formatPhone, toE164 } from "@/lib/phone";
import { site } from "@/lib/site";
import { SMS_CONSENT_TEXT, SMS_CONSENT_VERSION } from "@/lib/sms-consent";
import { HONEYPOT } from "@/lib/waitlist";
import type { FormState } from "./auth";

/**
 * The public opt-in form for ZOL INC's own support texts.
 *
 * A Server Action for the reason `actions/waitlist.ts` gives: the Origin
 * check Next runs on every action is the CSRF protection a public POST would
 * otherwise need, and the form still submits with JavaScript off.
 *
 * What this writes is evidence. The row records the number, who gave it, the
 * exact consent wording they ticked and its version, when, from which IP and
 * browser. It sends NO text message: the confirmation text goes out from the
 * support line once the campaign is approved and telephony is switched on.
 * Until then the opt-in is on file and nothing else happens.
 */

export interface SmsOptInState extends FormState {
  ok?: boolean;
}

const MAX_SUBMISSIONS = 5;
const WINDOW_MINUTES = 60;

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

export async function submitSmsOptIn(
  _state: SmsOptInState | undefined,
  form: FormData,
): Promise<SmsOptInState> {
  const fullName = text(form, "full_name");
  const shopName = text(form, "shop_name");
  const rawPhone = text(form, "phone");
  const consent = form.get("consent") === "on";

  const values: Record<string, string> = {
    full_name: fullName,
    shop_name: shopName,
    phone: rawPhone,
    consent: consent ? "on" : "",
  };

  // Honeypot, as on the waitlist: filled means a script, which gets the same
  // success screen a person does.
  if (text(form, HONEYPOT).length > 0) return { ok: true };

  const fields: Record<string, string> = {};

  if (fullName.length < 2) fields.full_name = "Your name, so we know who agreed.";
  if (fullName.length > 120) fields.full_name = "That's longer than we can store.";
  if (shopName.length < 2) fields.shop_name = "What's the shop called?";
  if (shopName.length > 200) fields.shop_name = "That's longer than we can store.";

  const phone = toE164(rawPhone);
  if (!phone) fields.phone = "Ten digits, or + and a country code.";

  /*
    The box is the consent. It is never pre-ticked, and the browser's
    `required` is re-checked here because the browser is not the record.
  */
  if (!consent) fields.consent = "Tick the box if you'd like us to text you. It's the consent.";

  if (Object.keys(fields).length > 0) return { fields, values };

  const h = await headers();
  const ip = clientIp(h);
  const userAgent = h.get("user-agent")?.slice(0, 500) ?? null;

  let at: Date;

  try {
    await query("DELETE FROM sms_consent_attempts WHERE at < now() - interval '1 day'");

    if (ip) {
      const recent = await query<{ n: string }>(
        `SELECT count(*) AS n FROM sms_consent_attempts
          WHERE ip = $1 AND at > now() - ($2 || ' minutes')::interval`,
        [ip, String(WINDOW_MINUTES)],
      );
      if (Number(recent[0].n) >= MAX_SUBMISSIONS) {
        return {
          values,
          error: `That's a few tries from this connection. Give it an hour, or email ${site.contactEmail} and we'll note your consent by hand.`,
        };
      }
      await query("INSERT INTO sms_consent_attempts (ip) VALUES ($1)", [ip]);
    }

    const rows = await query<{ at: Date }>(
      `INSERT INTO sms_consent_events
         (phone, event, channel, full_name, shop_name,
          consent_text_version, consent_text, ip, user_agent)
       VALUES ($1, 'opt_in', 'web', $2, $3, $4, $5, $6, $7)
       RETURNING at`,
      [phone, fullName, shopName, SMS_CONSENT_VERSION, SMS_CONSENT_TEXT, ip, userAgent],
    );
    at = rows[0].at;
  } catch (error) {
    console.error("[sms-opt-in] submission failed", error);
    return {
      values,
      error: `Something went wrong on our end — nothing to do with what you typed. Email ${site.contactEmail} and we'll note your consent by hand.`,
    };
  }

  // Best-effort, after the row is written: a notification that didn't go out
  // is our problem, not theirs.
  await sendEmail({
    to: OPERATOR_EMAIL,
    subject: `SMS opt-in: ${fullName} at ${shopName}`,
    text: [
      `${fullName} opted in to ZOL support texts.`,
      "",
      `Name            ${fullName}`,
      `Shop            ${shopName}`,
      `Mobile          ${formatPhone(phone!)}  (${phone})`,
      `Channel         web form, ${site.url}${site.smsOptInPath}`,
      `Consented at    ${at.toISOString()}`,
      `Consent text    v${SMS_CONSENT_VERSION}`,
      `IP              ${ip ?? "—"}`,
      `User agent      ${userAgent ?? "—"}`,
      "",
      "No text has been sent. The confirmation goes out from the support line",
      "once the campaign is approved and telephony is on.",
    ].join("\n"),
  }).catch((error: unknown) => {
    console.error("[sms-opt-in] notification failed", error);
  });

  return { ok: true };
}
