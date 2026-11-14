import twilio from "twilio";
import { env } from "../env";

let client: ReturnType<typeof twilio> | null = null;

export function twilioClient() {
  if (!client) client = twilio(env.twilioAccountSid(), env.twilioAuthToken());
  return client;
}

/** Start a call-level recording. Resolves to the recording SID or null. */
export async function startRecording(callSid: string): Promise<string | null> {
  try {
    const rec = await twilioClient()
      .calls(callSid)
      .recordings.create({
        recordingChannels: "dual",
        recordingStatusCallback: `${env.publicBaseUrl()}/api/twilio/recording`,
        recordingStatusCallbackEvent: ["completed"],
      });
    return rec.sid;
  } catch (err) {
    console.error(`[${callSid}] startRecording failed`, err);
    return null;
  }
}

/** Last resort when neither the agent nor a human is available. */
export async function playApologyAndHangup(callSid: string): Promise<boolean> {
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">Sorry, our assistant is unavailable right now. Please call back shortly, or visit try zol dot com. Goodbye.</Say>
  <Hangup/>
</Response>`;
  try {
    await twilioClient().calls(callSid).update({ twiml });
    return true;
  } catch (err) {
    console.error(`[${callSid}] playApologyAndHangup failed`, err);
    return false;
  }
}

/**
 * Pull the live call out of the media stream and dial the human. Twilio ends
 * the <Stream> when the call's TwiML is replaced, which closes our bridge.
 */
export async function transferToHuman(callSid: string, to: string): Promise<boolean> {
  const from = env.twilioPhoneNumber();
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">Connecting you to the Zol team now.</Say>
  <Dial callerId="${from}" timeout="25" answerOnBridge="true">${to}</Dial>
  <Say voice="Polly.Joanna">Sorry, nobody could pick up right now. Please call back during business hours, or visit try zol dot com. Goodbye.</Say>
  <Hangup/>
</Response>`;
  try {
    await twilioClient().calls(callSid).update({ twiml });
    return true;
  } catch (err) {
    console.error(`[${callSid}] transferToHuman failed`, err);
    return false;
  }
}
