import WebSocket from "ws";
import { env } from "../env";
import { operationalNotes } from "../agent/prompt";
import { getAgentSettings } from "../settings";
import { appendTurn, attachStream, markTransferred, saveRecordingSid } from "../calls";
import { playApologyAndHangup, startRecording, transferToHuman } from "../twilio/client";

/**
 * One instance per phone call. Pipes Twilio Media Stream audio (G.711 mu-law,
 * 8 kHz, base64) into an OpenAI Realtime session and the model's audio back,
 * and writes transcripts to Postgres as they complete.
 *
 * Twilio events: start, media, mark, stop.
 * OpenAI events used: session.updated, response.output_audio.delta,
 *   response.output_audio_transcript.done,
 *   conversation.item.input_audio_transcription.completed,
 *   input_audio_buffer.speech_started, response.output_item.done (tool calls),
 *   response.done, error.
 */
export class CallBridge {
  private openai: WebSocket | null = null;
  private streamSid: string | null = null;
  private callSid: string | null = null;
  private openaiReady = false;
  private pendingAudio: string[] = [];
  private closed = false;
  /** Set when the model asked to transfer; executed once its goodbye finishes. */
  private pendingTransfer: { reason: string } | null = null;
  /** True between response.created and response.done, so cancels are only sent when meaningful. */
  private responseActive = false;

  constructor(private readonly twilio: WebSocket) {
    twilio.on("message", (data) => this.onTwilioMessage(data.toString()));
    twilio.on("close", () => this.teardown("twilio closed"));
    twilio.on("error", (err) => {
      console.error("twilio ws error", err);
      this.teardown("twilio error");
    });
  }

  // ---- Twilio side -------------------------------------------------------

  private onTwilioMessage(raw: string) {
    let msg: TwilioEvent;
    try {
      msg = JSON.parse(raw) as TwilioEvent;
    } catch {
      return;
    }

    switch (msg.event) {
      case "start": {
        this.streamSid = msg.start.streamSid;
        this.callSid = msg.start.customParameters?.callSid ?? msg.start.callSid;
        console.log(`[${this.callSid}] stream started ${this.streamSid}`);
        if (this.callSid) {
          attachStream(this.callSid, this.streamSid).catch((e) =>
            console.error("attachStream failed", e),
          );
          if (env.recordCalls()) {
            const sid = this.callSid;
            startRecording(sid).then((recSid) => {
              if (recSid) saveRecordingSid(sid, recSid).catch((e) => console.error(e));
            });
          }
        }
        void this.connectOpenAI();
        break;
      }
      case "media": {
        const payload = msg.media.payload;
        if (this.openaiReady && this.openai) {
          this.sendOpenAI({ type: "input_audio_buffer.append", audio: payload });
        } else if (this.pendingAudio.length < 200) {
          // Buffer the first few frames while the OpenAI socket comes up.
          this.pendingAudio.push(payload);
        }
        break;
      }
      case "stop":
        this.teardown("twilio stop");
        break;
      default:
        break;
    }
  }

  private sendTwilio(obj: unknown) {
    if (this.twilio.readyState === WebSocket.OPEN) {
      this.twilio.send(JSON.stringify(obj));
    }
  }

  // ---- OpenAI side -------------------------------------------------------

  private async connectOpenAI() {
    const settings = await getAgentSettings();
    const handoffAvailable = Boolean(env.handoffNumber());
    const instructions =
      settings.instructions +
      "\n" +
      operationalNotes({ handoffAvailable, recording: env.recordCalls() });

    const tools = handoffAvailable
      ? [
          {
            type: "function",
            name: "transfer_to_human",
            description:
              "Transfer the caller to a human on the Zol team. Call this only after telling the caller you are connecting them.",
            parameters: {
              type: "object",
              properties: {
                reason: { type: "string", description: "One sentence on why the caller needs a person." },
              },
              required: ["reason"],
            },
          },
        ]
      : [];

    const url = `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(env.openaiRealtimeModel())}`;
    const ws = new WebSocket(url, {
      headers: { Authorization: `Bearer ${env.openaiApiKey()}` },
    });
    this.openai = ws;

    ws.on("open", () => {
      this.sendOpenAI({
        type: "session.update",
        session: {
          type: "realtime",
          instructions,
          tools,
          tool_choice: "auto",
          audio: {
            input: {
              format: { type: "audio/pcmu" },
              turn_detection: { type: "server_vad", silence_duration_ms: 600 },
              transcription: { model: "gpt-4o-mini-transcribe" },
            },
            output: {
              format: { type: "audio/pcmu" },
              voice: settings.voice,
            },
          },
        },
      });
    });

    ws.on("message", (data) => this.onOpenAIMessage(data.toString()));
    ws.on("close", () => this.onOpenAIGone("openai closed"));
    ws.on("error", (err) => {
      console.error("openai ws error", err);
      this.onOpenAIGone("openai error");
    });
  }

  /**
   * OpenAI dropped (bad key, billing, outage). Rather than leaving the caller
   * in silence, hand the call to a human if we have a number, otherwise play
   * an apology. Only acts while the Twilio leg is still up.
   */
  private onOpenAIGone(reason: string) {
    if (this.closed || this.twilio.readyState !== WebSocket.OPEN) {
      this.teardown(reason);
      return;
    }
    this.closed = true; // stop any further OpenAI handling
    console.error(`[${this.callSid}] ${reason} before/while serving caller; falling back`);
    if (!this.callSid) {
      this.teardown(reason);
      return;
    }
    const to = env.handoffNumber();
    this.record("system", `Agent unavailable (${reason}); ${to ? "forwarded to human" : "played apology"}.`);
    const done = () => {
      try {
        this.openai?.close();
      } catch {
        /* ignore */
      }
    };
    if (to) {
      const callSid = this.callSid;
      transferToHuman(callSid, to)
        .then(async (ok) => {
          if (ok) await markTransferred(callSid, `agent unavailable: ${reason}`);
          else await playApologyAndHangup(callSid);
        })
        .catch((e) => console.error("fallback failed", e))
        .finally(done);
    } else {
      playApologyAndHangup(this.callSid).catch((e) => console.error("fallback failed", e)).finally(done);
    }
  }

  private onOpenAIMessage(raw: string) {
    let msg: OpenAIEvent;
    try {
      msg = JSON.parse(raw) as OpenAIEvent;
    } catch {
      return;
    }

    switch (msg.type) {
      case "session.updated": {
        if (this.openaiReady) break;
        this.openaiReady = true;
        for (const payload of this.pendingAudio) {
          this.sendOpenAI({ type: "input_audio_buffer.append", audio: payload });
        }
        this.pendingAudio = [];
        // Have the agent speak first.
        this.sendOpenAI({ type: "response.create" });
        break;
      }
      case "response.output_audio.delta": {
        if (!this.streamSid || !msg.delta) break;
        this.sendTwilio({
          event: "media",
          streamSid: this.streamSid,
          media: { payload: msg.delta },
        });
        break;
      }
      case "response.created": {
        this.responseActive = true;
        break;
      }
      case "input_audio_buffer.speech_started": {
        // Caller interrupted: drop queued audio on Twilio and cancel the response.
        if (this.streamSid) this.sendTwilio({ event: "clear", streamSid: this.streamSid });
        if (this.responseActive) this.sendOpenAI({ type: "response.cancel" });
        break;
      }
      case "conversation.item.input_audio_transcription.completed": {
        this.record("caller", msg.transcript);
        break;
      }
      case "response.output_audio_transcript.done": {
        this.record("agent", msg.transcript);
        break;
      }
      case "response.output_item.done": {
        const item = msg.item;
        if (item?.type === "function_call" && item.name === "transfer_to_human") {
          let reason = "caller asked for a human";
          try {
            reason = (JSON.parse(item.arguments ?? "{}") as { reason?: string }).reason ?? reason;
          } catch {
            /* keep default */
          }
          this.pendingTransfer = { reason };
          // Acknowledge the tool so the model can finish its sentence cleanly.
          this.sendOpenAI({
            type: "conversation.item.create",
            item: {
              type: "function_call_output",
              call_id: item.call_id,
              output: JSON.stringify({ status: "transferring" }),
            },
          });
        }
        break;
      }
      case "response.done": {
        this.responseActive = false;
        if (this.pendingTransfer) {
          // Give Twilio a moment to play the trailing audio before we swap TwiML.
          const { reason } = this.pendingTransfer;
          this.pendingTransfer = null;
          setTimeout(() => void this.executeTransfer(reason), 1200);
        }
        break;
      }
      case "error": {
        console.error(`[${this.callSid}] openai error`, msg.error);
        break;
      }
      default:
        break;
    }
  }

  private sendOpenAI(obj: unknown) {
    if (this.openai && this.openai.readyState === WebSocket.OPEN) {
      this.openai.send(JSON.stringify(obj));
    }
  }

  // ---- shared ------------------------------------------------------------

  private async executeTransfer(reason: string) {
    const to = env.handoffNumber();
    if (!this.callSid || !to) return;
    console.log(`[${this.callSid}] transferring to human: ${reason}`);
    this.record("system", `Transferred to human (${reason}).`);
    const ok = await transferToHuman(this.callSid, to);
    if (ok) {
      markTransferred(this.callSid, reason).catch((e) => console.error("markTransferred failed", e));
    } else {
      this.record("system", "Transfer failed; agent continues.");
    }
  }

  private record(role: "caller" | "agent" | "system", text: string | undefined) {
    if (!this.callSid || !text) return;
    appendTurn(this.callSid, role, text).catch((e) => console.error("appendTurn failed", e));
  }

  private teardown(reason: string) {
    if (this.closed) return;
    this.closed = true;
    console.log(`[${this.callSid}] bridge closed: ${reason}`);
    try {
      this.openai?.close();
    } catch {
      /* ignore */
    }
    try {
      this.twilio.close();
    } catch {
      /* ignore */
    }
  }
}

// ---- wire types ----------------------------------------------------------

type TwilioEvent =
  | {
      event: "start";
      start: { streamSid: string; callSid: string; customParameters?: Record<string, string> };
    }
  | { event: "media"; media: { payload: string } }
  | { event: "mark" }
  | { event: "stop" }
  | { event: "connected" };

/** Loose shape: the Realtime API has many event types; we read a few fields. */
type OpenAIEvent = {
  type: string;
  delta?: string;
  transcript?: string;
  error?: unknown;
  item?: { type?: string; name?: string; call_id?: string; arguments?: string };
};
