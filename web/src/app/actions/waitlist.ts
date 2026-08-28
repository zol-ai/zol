"use server";

import { headers } from "next/headers";

import { query } from "@/lib/db";
import { pushWaitlistEntryToCompanyBrain } from "@/lib/company-brain";
import { OPERATOR_EMAIL, sendEmail } from "@/lib/notify";
import { formatPhone, toE164 } from "@/lib/phone";
import { site } from "@/lib/site";
import {
  HONEYPOT,
  UTM_KEYS,
  ZIP,
  isBayBand,
  type WaitlistEntry,
} from "@/lib/waitlist";
import type { FormState } from "./auth";

/**
 * The public waitlist.
 *
 * A Server Action rather than a route handler, for the reason `actions/auth.ts`
 * gives: Next checks Origin against Host on every action call, so the CSRF
 * token a hand-rolled public POST endpoint would need is already handled, and
 * the form still submits with JavaScript switched off.
 *
 * This is the only unauthenticated write in the application. Everything here
 * assumes the caller is hostile: the client's validation is re-run from
 * scratch, both option lists are checked against the same constants the
 * database constrains, and there is a per-IP ceiling.
 */

/** `ok` is the success state. The form swaps itself out for a confirmation. */
export interface WaitlistState extends FormState {
  ok?: boolean;
}

/** Submissions allowed from one IP before it's told to stop, and the window. */
const MAX_SUBMISSIONS = 5;
const WINDOW_MINUTES = 60;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

/** Empty string is not a value; it's an unset column. */
function nullable(value: string, max = 500): string | null {
  const trimmed = value.trim().slice(0, max);
  return trimmed.length > 0 ? trimmed : null;
}

async function requestMeta() {
  const h = await headers();
  return {
    userAgent: h.get("user-agent")?.slice(0, 500) ?? null,
    // Vercel sets this. Behind Cloud Run it's the load balancer's list, whose
    // first entry is the client.
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
  };
}

export async function joinWaitlist(
  _state: WaitlistState | undefined,
  form: FormData,
): Promise<WaitlistState> {
  const fullName = text(form, "full_name");
  const email = text(form, "email").toLowerCase();
  const rawPhone = text(form, "phone");
  const shopName = text(form, "shop_name");
  const zip = text(form, "zip");
  const bays = text(form, "bays");
  const consent = form.get("consent") === "on";

  // Echoed back so a rejected submit doesn't wipe six fields of typing.
  const values: Record<string, string> = {
    full_name: fullName,
    email,
    phone: rawPhone,
    shop_name: shopName,
    zip,
    bays,
    consent: consent ? "on" : "",
  };

  /*
    The honeypot. A field no person can see, positioned off-screen rather than
    display:none, because the crude scripts skip hidden inputs and happily fill
    one the DOM still calls visible. Anything in it and this was not a shop
    owner.

    It gets the same success state a real submission does: telling a bot it was
    caught is how the next attempt gets tuned around the trap.
  */
  if (text(form, HONEYPOT).length > 0) {
    return { ok: true };
  }

  const fields: Record<string, string> = {};

  if (fullName.length < 2) fields.full_name = "Your name, so we know who to ask for.";
  if (fullName.length > 120) fields.full_name = "That's longer than we can store.";
  if (!EMAIL.test(email)) fields.email = "That doesn't look like an email.";
  if (email.length > 200) fields.email = "That's longer than we can store.";

  const phone = toE164(rawPhone);
  if (!phone) fields.phone = "Ten digits, or + and a country code.";

  if (shopName.length < 2) fields.shop_name = "What's the shop called?";
  if (shopName.length > 200) fields.shop_name = "That's longer than we can store.";
  if (!ZIP.test(zip)) fields.zip = "Five digits.";
  if (!isBayBand(bays)) fields.bays = "Pick the closest one.";

  /*
    Not a formality. We are asking permission to phone and text a business
    line, and that permission is the thing that has to be provable later — so
    an unticked box is a hard stop, and the row records the moment it was
    ticked rather than inferring consent from the row existing at all.
  */
  if (!consent) {
    fields.consent = "We need your okay before we can call or text you.";
  }

  if (Object.keys(fields).length > 0) return { fields, values };

  const { ip, userAgent } = await requestMeta();
  const utm = UTM_KEYS.map((key) => nullable(text(form, key), 200));

  /*
    One address is one entry, and somebody who fills the form in twice — a
    fortnight apart, from a different phone, because they forgot — is not an
    error worth showing. The second submission updates what we hold and returns
    the identical success state, so this page can never be used to ask whether
    a given address is already on the list.

    created_at is left alone: when they first asked is the part with any value
    in it.
  */
  let rows: WaitlistEntry[];

  /*
    Every statement that touches the database is inside this one try, the rate
    limit included. Guarding only the insert is not enough: the prune runs
    first, so a database that can't be reached takes the action down before the
    guarded line is ever evaluated, and the shop owner gets a stack trace on
    the marketing site. Ask how it failed the first time, not the second.
  */
  try {
    /*
      Per-IP ceiling, pruned by the same statement that reads it so the table
      never needs a sweeper — the arrangement auth_attempts uses, for the same
      reason: an in-process counter in a serverless function counts one warm
      instance's traffic and nothing else.
    */
    await query("DELETE FROM waitlist_attempts WHERE at < now() - interval '1 day'");

    if (ip) {
      const recent = await query<{ n: string }>(
        `SELECT count(*) AS n FROM waitlist_attempts
          WHERE ip = $1 AND at > now() - ($2 || ' minutes')::interval`,
        [ip, String(WINDOW_MINUTES)],
      );

      if (Number(recent[0].n) >= MAX_SUBMISSIONS) {
        return {
          values,
          error: `That's a few tries from this connection. Give it an hour, or email ${site.contactEmail} and we'll add you by hand.`,
        };
      }

      await query("INSERT INTO waitlist_attempts (ip) VALUES ($1)", [ip]);
    }

    rows = await query<WaitlistEntry>(
      `INSERT INTO waitlist_entries
         (full_name, email, phone, shop_name, zip, bays,
          consent, consent_at, source_page,
          utm_source, utm_medium, utm_campaign, utm_term, utm_content,
          ip, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, true, now(), $7,
               $8, $9, $10, $11, $12, $13, $14)
       ON CONFLICT (lower(email)) DO UPDATE
          SET full_name        = EXCLUDED.full_name,
              phone            = EXCLUDED.phone,
              shop_name        = EXCLUDED.shop_name,
              zip              = EXCLUDED.zip,
              bays             = EXCLUDED.bays,
              consent          = true,
              consent_at       = now(),
              source_page      = EXCLUDED.source_page,
              -- Attribution only fills in. A later visit with no UTMs on it must
              -- not erase the campaign that actually brought them.
              utm_source       = COALESCE(EXCLUDED.utm_source, waitlist_entries.utm_source),
              utm_medium       = COALESCE(EXCLUDED.utm_medium, waitlist_entries.utm_medium),
              utm_campaign     = COALESCE(EXCLUDED.utm_campaign, waitlist_entries.utm_campaign),
              utm_term         = COALESCE(EXCLUDED.utm_term, waitlist_entries.utm_term),
              utm_content      = COALESCE(EXCLUDED.utm_content, waitlist_entries.utm_content),
              ip               = EXCLUDED.ip,
              user_agent       = EXCLUDED.user_agent,
              updated_at       = now()
       RETURNING *`,
      [
        fullName,
        email,
        phone,
        shopName,
        zip,
        bays,
        nullable(text(form, "source_page"), 200),
        ...utm,
        ip,
        userAgent,
      ],
    );
  } catch (error) {
    /*
      A public form must never hand somebody a stack trace because the database
      is unreachable — or because this deployment is running ahead of its
      migration. They get a route to us that doesn't depend on any of it, and
      the real reason goes to the log.
    */
    console.error("[waitlist] submission failed", error);
    return {
      values,
      error: `Something went wrong on our end — nothing to do with what you typed. Email ${site.contactEmail} and we'll add you by hand.`,
    };
  }

  const entry = rows[0];

  /*
    Everything past this point is best-effort. The row is written and the shop
    owner is owed their confirmation screen; a notification that didn't go out
    is our problem, not a red box on their page.
  */
  await notify(entry).catch((error: unknown) => {
    console.error("[waitlist] notification failed", error);
  });

  await pushWaitlistEntryToCompanyBrain(entry).catch((error: unknown) => {
    console.error("[waitlist] company brain push failed", error);
  });

  return { ok: true };
}

/**
 * Both messages a submission produces.
 *
 * Neither actually sends today — `lib/notify.ts` has no provider behind it and
 * logs instead. Written out properly anyway, so wiring one in is a change to
 * one function body and not to this file.
 */
async function notify(entry: WaitlistEntry): Promise<void> {
  const repeat = entry.created_at !== entry.updated_at;

  await sendEmail({
    to: OPERATOR_EMAIL,
    replyTo: entry.email,
    subject: `${repeat ? "Waitlist (updated)" : "Waitlist"}: ${entry.shop_name} — ${entry.bays} bays`,
    text: [
      `${entry.full_name} put ${entry.shop_name} on the waitlist.`,
      "",
      `Shop          ${entry.shop_name}`,
      `Name          ${entry.full_name}`,
      `Main line     ${formatPhone(entry.phone)}  (${entry.phone})`,
      `Email         ${entry.email}`,
      `ZIP           ${entry.zip}`,
      `Bays          ${entry.bays}`,
      "",
      `Consented     yes, at ${entry.consent_at}`,
      `Source        ${entry.source_page ?? "—"}`,
      `UTM           ${
        [
          entry.utm_source,
          entry.utm_medium,
          entry.utm_campaign,
          entry.utm_term,
          entry.utm_content,
        ]
          .filter(Boolean)
          .join(" / ") || "—"
      }`,
      `IP            ${entry.ip ?? "—"}`,
      `User agent    ${entry.user_agent ?? "—"}`,
      "",
      repeat
        ? `Updated an existing row. First asked ${entry.created_at}.`
        : `New row, ${entry.created_at}.`,
    ].join("\n"),
  });

  await sendEmail({
    to: entry.email,
    replyTo: OPERATOR_EMAIL,
    subject: `${site.name} — you're on the list`,
    text: [
      `${entry.full_name.split(" ")[0]},`,
      "",
      `You're on the ${site.name} waitlist for ${entry.shop_name}.`,
      "",
      `We'll call ${formatPhone(entry.phone)} when there's a slot open, and`,
      `you'll get a real person, not a recording. If you'd rather pick a time`,
      `yourself, the calendar is here:`,
      "",
      site.demoUrl,
      "",
      `Anything at all, reply to this — it comes straight to us.`,
      "",
      `— The ${site.name} team`,
    ].join("\n"),
  });
}
