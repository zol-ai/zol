/**
 * ZOL INC's own SMS program: ZOL texting the shop owners and staff who are
 * its customers, for support replies, onboarding help, service and
 * maintenance notices, and billing notices.
 *
 * This is NOT a shop texting its vehicle owners. That program is registered
 * separately, per shop, and nothing in this file may describe ZOL as sending
 * on a shop's behalf.
 *
 * Every word here is what a carrier reviewer will compare against live
 * traffic, so the page, the form, the consent row and the Twilio webhook all
 * read from this one module. Change the text here and bump the version in
 * the same commit; the consent rows carry both.
 *
 * No `server-only`: the form is a client component and needs the consent
 * wording, and nothing here is secret.
 */

export const SMS_CONSENT_VERSION = "2026-11-14";

/** The checkbox text on /sms-opt-in. */
export const SMS_CONSENT_TEXT =
  "I agree to receive customer support and account text messages from ZOL INC at the mobile number I provided, including replies to my support requests, onboarding help, service and maintenance notices, and billing notices. Message frequency varies. Msg & data rates may apply. Reply STOP to opt out or HELP for help. Consent is not a condition of purchase.";

/** Read word for word on an onboarding call before a number is saved. */
export const SMS_CALL_SCRIPT =
  "Can we text you at this number for customer support and account messages from ZOL INC: replies to your support requests, onboarding help, service and maintenance notices, and billing notices? Message frequency varies, msg and data rates may apply. Reply STOP to opt out or HELP for help. Do we have your permission?";

/** Sent once, right after a number is opted in, and in reply to START. */
export const SMS_CONFIRMATION =
  "ZOL INC: You're now opted in to ZOL customer support and account texts. Msg frequency varies. Msg & data rates may apply. Reply HELP for help, STOP to opt out.";

/** Reply to HELP or INFO. */
export const SMS_HELP =
  "ZOL INC Support: For help, email zaz@tryzol.com. Msg frequency varies. Msg & data rates may apply. Reply STOP to opt out.";

/** Reply to STOP and the other carrier opt-out keywords. */
export const SMS_STOP =
  "ZOL INC: You've been unsubscribed and will receive no more texts. Reply START to resubscribe.";

/** A sample support exchange for the page. Placeholder data only. */
export const SMS_SAMPLE_THREAD = [
  { from: "customer", text: "Hi, the estimate link isn't opening for one of my customers." },
  {
    from: "zol",
    text: "ZOL INC Support: Thanks, looking at it now. Which repair order is it? Reply STOP to opt out.",
  },
  { from: "customer", text: "RO 1042" },
  {
    from: "zol",
    text: "ZOL INC Support: Fixed, the link had expired. A fresh one has been sent to your customer. Reply STOP to opt out.",
  },
] as const;

export type SmsConsentChannel = "web" | "call" | "sms";
export type SmsConsentEvent = "opt_in" | "opt_out";
