import "server-only";

import type { WaitlistEntry } from "@/lib/waitlist";

/**
 * ⚠️  NOT IMPLEMENTED, AND DELIBERATELY SO.
 *
 * Company Brain (the "Company OS" app that lives beside this repo) keeps its
 * records in Firestore behind Next route handlers, and every one of those
 * routes goes through `authorized()` → `requireSessionUser()`, which verifies
 * a Firebase Admin **session cookie** minted from an interactive Google
 * Sign-In and checked against an ALLOWED_EMAILS list.
 *
 * That is a human-in-a-browser door. There is no API key, no service account
 * path, no signed webhook, no machine-to-machine route of any kind — so there
 * is nothing here for a server action to call. Building one would mean adding
 * an authentication mode to that app, which is its own decision and not this
 * feature's to make.
 *
 * This function is the single place that integration goes when it exists.
 * It is called for every waitlist entry, it does nothing, and it must keep
 * doing nothing quietly rather than failing a submission.
 *
 * When Company Brain grows a service credential, the shape wanted is almost
 * certainly a `client` record (shop name, contact, phone) — its
 * `POST /api/clients` route already takes one, it just won't take one from us.
 */
export async function pushWaitlistEntryToCompanyBrain(
  entry: WaitlistEntry,
): Promise<void> {
  // Intentionally does nothing. See the note above before filling this in —
  // the discard keeps the parameter in the signature, which is the half of
  // this function that is actually load-bearing today.
  void entry;
}
