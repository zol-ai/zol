// Points the Twilio phone number at the deployed service.
//   node scripts/configure-twilio.mjs https://zol-support-xxxx.us-west1.run.app
// Reads TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_PHONE_NUMBER from the
// environment (load web/.env.local first, e.g. via `npm run twilio:configure`).
import twilio from "twilio";

const base = (process.argv[2] ?? process.env.PUBLIC_BASE_URL ?? "").replace(/\/$/, "");
if (!/^https:\/\//.test(base)) {
  console.error("usage: node scripts/configure-twilio.mjs https://<service-url>");
  process.exit(1);
}
const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER } = process.env;
if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER) {
  console.error("TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_PHONE_NUMBER must be set.");
  process.exit(1);
}

const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
const numbers = await client.incomingPhoneNumbers.list({ phoneNumber: TWILIO_PHONE_NUMBER });
if (numbers.length === 0) {
  console.error(`Number ${TWILIO_PHONE_NUMBER} not found on this Twilio account.`);
  process.exit(1);
}
const updated = await client.incomingPhoneNumbers(numbers[0].sid).update({
  voiceUrl: `${base}/api/twilio/voice`,
  voiceMethod: "POST",
  statusCallback: `${base}/api/twilio/status`,
  statusCallbackMethod: "POST",
  voiceApplicationSid: "",
});
console.log(`configured ${updated.phoneNumber}`);
console.log(`  voice   : ${updated.voiceUrl}`);
console.log(`  status  : ${updated.statusCallback}`);
