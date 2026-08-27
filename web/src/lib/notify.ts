import "server-only";

import { site } from "@/lib/site";

/**
 * Outbound email.
 *
 * ⚠️  NOTHING HERE ACTUALLY SENDS YET. There is no email provider wired into
 * this repo — no Resend, no Postmark, no SES, nothing in .env.example. That is
 * the same deliberate hole `0001_auth.sql` describes for staff invites:
 * warming a sending domain (SPF, DKIM, DMARC, reputation) is the same problem
 * the SMS side is waiting on, and half-warming one to send a handful of
 * waitlist confirmations is how a domain gets itself filtered before it
 * matters.
 *
 * So this is the seam, not the implementation. Every message the product sends
 * goes through `sendEmail`, and today that writes the message to the server log
 * and returns `{ delivered: false }`. When a provider is picked, one function
 * body changes and every caller is already correct.
 *
 * Callers must treat delivery as best-effort and must never fail a user's
 * submission because a message didn't go out.
 */

export interface EmailMessage {
  to: string;
  subject: string;
  /** Plain text only. No HTML sending until there's a provider and a template. */
  text: string;
  replyTo?: string;
}

export interface EmailResult {
  delivered: boolean;
  /** Why not, when `delivered` is false. Safe to log; never shown to a user. */
  reason?: string;
}

/** Where operational notifications go. */
export const OPERATOR_EMAIL = site.contactEmail;

/**
 * Hand a message to whatever provider is configured.
 *
 * Never throws: a caller that has already written a row must not be unwound
 * because a notification failed.
 */
export async function sendEmail(message: EmailMessage): Promise<EmailResult> {
  /*
    ── Wire the provider in HERE ────────────────────────────────────────────
    Read the key through `lib/env.ts` rather than process.env directly, the
    way every other credential in this app is read, and keep the signature.
    Everything else in this file can stay as it is.
    ─────────────────────────────────────────────────────────────────────────
  */

  console.info(
    "[email:not-configured] would have sent",
    JSON.stringify({
      to: message.to,
      subject: message.subject,
      replyTo: message.replyTo,
      text: message.text,
    }),
  );

  return {
    delivered: false,
    reason: "No email provider configured. See src/lib/notify.ts.",
  };
}
