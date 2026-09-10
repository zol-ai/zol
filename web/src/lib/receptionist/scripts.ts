import type { TranscriptLine } from "./intake";

/**
 * Scripted phone calls for the "Run a test call" button.
 *
 * A test call is not a mock. The transcript is pushed through
 * `finalizeVoiceCall` — the same function the realtime media service will
 * call when a real call ends — so it exercises intake extraction, customer
 * and vehicle matching, slot finding, the appointment insert, the
 * confirmation follow-up and the staff notification for real. The only
 * difference from a live call is `calls.simulated = true`, which every screen
 * labels and the answer-rate numbers exclude.
 *
 * Two callers, chosen to walk two different paths: a returning customer with
 * two cars on file (matches, attaches to the right one, prefers the brake
 * tech) and somebody the shop has never heard of (creates the customer and
 * the vehicle, prefers the electrical tech). Numbers are in the 555-01xx
 * range reserved for fiction, matching the demo seed.
 */

export interface TestCallScript {
  key: string;
  title: string;
  detail: string;
  /** Caller ID, E.164. */
  from: string;
  durationSeconds: number;
  transcript: TranscriptLine[];
}

export const TEST_CALL_SCRIPTS: TestCallScript[] = [
  {
    key: "returning-brakes",
    title: "Returning customer",
    detail: "Jordan Lee, second car on file, brake noise, wants Thursday afternoon.",
    from: "+16615550171",
    durationSeconds: 128,
    transcript: [
      { role: "assistant", content: "Thanks for calling, this is ZOL. How can I help?" },
      {
        role: "customer",
        content:
          "Hi, this is Jordan Lee, 661-555-0171. My 2012 Honda Civic has started squealing when I brake and the pedal feels a bit soft.",
      },
      {
        role: "assistant",
        content:
          "Sorry to hear that — let's get it looked at. Is the pedal going to the floor at all, or any grinding, or is it mainly the squeal?",
      },
      {
        role: "customer",
        content: "No grinding, it still stops fine. Mostly the squeal and it feels softer than it used to.",
      },
      {
        role: "assistant",
        content:
          "Okay. Keep the trips short until it's seen, and if it gets worse, stop driving it and call us. When would you like to bring it in?",
      },
      { role: "customer", content: "Thursday afternoon would be best if you have anything." },
      {
        role: "assistant",
        content: "Let me find the earliest opening on Thursday afternoon for the Civic. One moment.",
      },
      { role: "customer", content: "Great, thank you." },
    ],
  },
  {
    key: "new-no-start",
    title: "New caller",
    detail: "Marcus Bell, never been in, 2017 Ford Escape clicking on start, wants tomorrow.",
    from: "+16615550177",
    durationSeconds: 151,
    transcript: [
      { role: "assistant", content: "Thanks for calling, this is ZOL. How can I help?" },
      {
        role: "customer",
        content:
          "Hi, I haven't been in before. My name is Marcus Bell and my number is (661) 555-0177. I've got a 2017 Ford Escape that sometimes won't start — it just clicks.",
      },
      {
        role: "assistant",
        content:
          "Thanks, Marcus. Does it start eventually, and do the dash lights dim when you turn the key?",
      },
      {
        role: "customer",
        content:
          "The lights dim when I turn the key, and it took three tries this morning before it caught.",
      },
      {
        role: "assistant",
        content:
          "Got it. I won't guess at the cause over the phone, but that's worth having looked at soon. When works for you?",
      },
      { role: "customer", content: "Earliest tomorrow morning if you can." },
      {
        role: "assistant",
        content: "Let me find the earliest opening tomorrow morning for the Escape.",
      },
      { role: "customer", content: "Perfect." },
    ],
  },
];

export function testCallScript(key: string): TestCallScript | undefined {
  return TEST_CALL_SCRIPTS.find((script) => script.key === key);
}
