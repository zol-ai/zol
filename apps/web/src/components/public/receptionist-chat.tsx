"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";

import { Wordmark } from "@/components/site/mark";

/**
 * The chat a customer has with ZOL at /talk/<slug>.
 *
 * Built for one hand on a phone in a parking lot: one column, big type, the
 * composer pinned to the bottom, Enter sends. The greeting is rendered here
 * from the same words the engine stored, so the transcript the shop reads
 * back matches what the customer saw.
 *
 * Everything goes to POST /api/receptionist in the body. The conversation id
 * lives in component state — never in the URL, never in storage — so nothing
 * about a person's car trouble ends up in a browser history or a log line.
 */

interface Message {
  id: number;
  role: "assistant" | "customer";
  content: string;
}

interface Booked {
  when: string;
  technician: string | null;
  bay: number;
  confirmationQueued: boolean;
}

export function ReceptionistChat({
  slug,
  shopName,
  shopPhone,
  shopPhoneLabel,
  address,
  greeting,
}: {
  slug: string;
  shopName: string;
  /** E.164, for the tel: link. */
  shopPhone: string | null;
  shopPhoneLabel: string | null;
  address: string | null;
  greeting: string;
}) {
  const [messages, setMessages] = useState<Message[]>([{ id: 0, role: "assistant", content: greeting }]);
  const [draft, setDraft] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [booked, setBooked] = useState<Booked | null>(null);
  const [done, setDone] = useState(false);

  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [messages, busy, booked]);

  async function send() {
    const text = draft.trim();
    if (!text || busy || done) return;

    setDraft("");
    setError(null);
    setMessages((m) => [...m, { id: Date.now(), role: "customer", content: text }]);
    setBusy(true);

    try {
      const response = await fetch("/api/receptionist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, conversationId: conversationId ?? undefined, message: text }),
      });
      const data = (await response.json().catch(() => null)) as
        | { conversationId: string; reply: string; state: string; booked: Booked | null; error?: string }
        | { error?: string }
        | null;

      if (!response.ok || !data || !("reply" in data)) {
        setError((data && "error" in data && data.error) || "Something went wrong. Try again, or call the shop.");
        setDraft(text);
        return;
      }

      setConversationId(data.conversationId);
      setMessages((m) => [...m, { id: Date.now() + 1, role: "assistant", content: data.reply }]);
      if (data.booked) setBooked(data.booked);
      if (data.state === "booked") setDone(true);
    } catch {
      setError("Couldn't reach the shop's receptionist. Check your connection and try again.");
      setDraft(text);
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void send();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col bg-paper">
      <header className="sticky top-0 z-10 border-b border-line bg-paper/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="t-eyebrow">Book a visit</p>
            <h1 className="t-h3 truncate text-[1.125rem] text-ink">{shopName}</h1>
          </div>
          <div className="flex flex-none items-center gap-3">
            {shopPhone && (
              <a href={`tel:${shopPhone}`} className="btn btn-ghost btn-sm">
                Call {shopPhoneLabel}
              </a>
            )}
            <Wordmark size={22} />
          </div>
        </div>
        <p className="mt-2 text-[0.75rem] leading-snug text-ink-3">
          ZOL is the shop&apos;s automated receptionist. It can book you in; it can&apos;t diagnose
          the car or send help. If the vehicle is unsafe or this is an emergency, call 911 or your
          roadside assistance.
        </p>
      </header>

      <main className="flex flex-1 flex-col gap-3 px-4 py-4" aria-live="polite">
        {messages.map((message) => {
          const zol = message.role === "assistant";
          return (
            <div key={message.id} className={`flex flex-col ${zol ? "items-start" : "items-end"}`}>
              <span className="t-eyebrow mb-1 px-1">{zol ? "ZOL" : "You"}</span>
              <p
                className={`max-w-[88%] whitespace-pre-wrap rounded-[var(--radius)] border px-3.5 py-2.5 text-[1rem] leading-relaxed ${
                  zol
                    ? "rounded-bl-sm border-emerald-line bg-emerald-wash text-ink"
                    : "rounded-br-sm border-ink bg-ink text-paper"
                }`}
              >
                {message.content}
              </p>
            </div>
          );
        })}

        {busy && (
          <p className="px-1 text-[0.8125rem] text-ink-3" role="status">
            ZOL is typing…
          </p>
        )}

        {booked && (
          <section className="mt-2 rounded-[var(--radius)] border border-emerald-line bg-emerald-wash p-4">
            <p className="t-eyebrow text-emerald-deep">Booked</p>
            <p className="t-h3 mt-1 text-[1.25rem] text-ink">{booked.when}</p>
            <p className="mt-1 text-[0.9375rem] text-ink-2">
              {shopName}
              {address ? ` · ${address}` : ""}
              {booked.technician ? ` · with ${booked.technician}` : ""}
            </p>
            <p className="mt-2 text-[0.875rem] text-ink-2">
              {booked.confirmationQueued
                ? "A confirmation is on its way to your phone."
                : "Texts to your number are switched off, so please make a note of the time."}
              {shopPhoneLabel ? ` To change it, call ${shopPhoneLabel}.` : ""}
            </p>
          </section>
        )}

        {error && (
          <p role="alert" className="rounded-[var(--radius)] border border-amber-line bg-amber-wash px-3 py-2.5 text-[0.875rem] text-amber-deep">
            {error}
          </p>
        )}

        <div ref={endRef} />
      </main>

      <form
        onSubmit={onSubmit}
        className="sticky bottom-0 border-t border-line bg-paper px-4 py-3"
        style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
      >
        <noscript>
          <p className="mb-2 text-[0.8125rem] text-amber-deep">
            This chat needs JavaScript. {shopPhoneLabel ? `Call ${shopPhoneLabel} instead.` : "Please call the shop instead."}
          </p>
        </noscript>
        <div className="flex items-end gap-2">
          <label htmlFor="talk-message" className="sr-only">
            Your message
          </label>
          <textarea
            id="talk-message"
            ref={inputRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            maxLength={1000}
            disabled={done}
            autoFocus
            enterKeyHint="send"
            placeholder={done ? "You're booked — see you then." : "What's going on with the car?"}
            className="max-h-40 min-h-[2.875rem] w-full flex-1 resize-none rounded-[var(--radius)] border border-line-2 bg-paper px-3 py-2.5 text-[1rem] text-ink placeholder:text-ink-3/70 disabled:bg-paper-3"
          />
          <button type="submit" className="btn btn-emerald" disabled={busy || done || draft.trim().length === 0}>
            Send
          </button>
        </div>
      </form>
    </div>
  );
}
