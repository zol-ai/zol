import WebSocket from "ws";
import { env } from "../env";
import { buildInstructions } from "../agent/prompt";
import { appendTurn, attachStream } from "../calls";

/**
 * One instance per phone call. Pipes Twilio Media Stream audio (G.711 mu-law,
 * 8 kHz, base64) into an OpenAI Realtime session and the model's audio back,
 * and writes transcripts to Postgres as they complete.
 *
 * Twilio events: start, media, mark, stop.
 * OpenAI events used: session.created, response.output_audio.delta,
 *   response.output_audio_transcript.done,
 *   conversation.item.input_audio_transcription.completed,
 *   input_audio_buffer.speech_started, error.
 */
export class CallBridge {
  private openai: WebSocket | null = null;
  private streamSid: string | null = null;
  private callSid: string | null = null;
  private openaiReady = false;
  private pendingAudio: string[] = [];
  private closed = false;

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
        }
        this.connectOpenAI();
        break;
      }
      case "media": {
        const payload = msg.media.payload;
        if (this.openaiReady && this.openai) {
          this.sendOpenAI({ type: "input_audio_buffer.append", audio: payload });
        } else {
          // Buffer the first few frames while the OpenAI socket comes up.
          if (this.pendingAudio.length < 200) this.pendingAudio.push(payload);
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

  private connectOpenAI() {
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
          instructions: buildInstructions({ handoffAvailable: Boolean(env.handoffNumber()) }),
          audio: {
            input: {
              format: { type: "audio/pcmu" },
              turn_detection: { type: "server_vad", silence_duration_ms: 600 },
              transcription: { model: "gpt-4o-mini-transcribe" },
            },
            output: {
              format: { type: "audio/pcmu" },
              voice: env.openaiVoice(),
            },
          },
        },
      });
    });

    ws.on("message", (data) => this.onOpenAIMessage(data.toString()));
    ws.on("close", () => this.teardown("openai closed"));
    ws.on("error", (err) => {
      console.error("openai ws error", err);
      this.teardown("openai error");
    });
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
        if (!this.streamSid) break;
        this.sendTwilio({
          event: "media",
          streamSid: this.streamSid,
          media: { payload: msg.delta },
        });
        break;
      }
      case "input_audio_buffer.speech_started": {
        // Caller interrupted: drop queued audio on Twilio and cancel the response.
        if (this.streamSid) this.sendTwilio({ event: "clear", streamSid: this.streamSid });
        this.sendOpenAI({ type: "response.cancel" });
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

  private record(role: "caller" | "agent", text: string | undefined) {
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
};
