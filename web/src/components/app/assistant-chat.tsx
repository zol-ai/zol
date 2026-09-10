"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { Send, Sparkles } from "lucide-react";

import { askZol } from "@/app/actions/assistant";
import type { AssistantLink, AssistantReply } from "@/lib/ai/assistant";
import { Avatar } from "@/components/app/ui";

/**
 * The Ask ZOL screen.
 *
 * A transcript kept in component state for the length of the visit — there
 * is nothing here worth persisting; the answers are live reads of the shop's
 * tables and go stale the moment a ticket moves. Each turn calls the server
 * action directly and appends what comes back. Every answer says where it
 * came from: the templates, or a named model grounded in the same rows.
 */

interface Message {
  id: number;
  role: "user" | "zol";
  text: string;
  links?: AssistantLink[];
  source?: AssistantReply["source"];
  model?: string;
  failed?: boolean;
}

export function AssistantChat({
  firstName,
  shopName,
  suggestions,
  aiConfigured,
}: {
  firstName: string;
  shopName: string;
  suggestions: readonly string[];
  /** Whether a model key is set. Changes the caption, nothing else. */
  aiConfigured: boolean;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, startTransition] = useTransition();
  const nextId = useRef(1);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep the newest turn in view. Smooth on a laptop; on a phone the
  // keyboard is up and instant is less disorienting.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: messages.length > 1 ? "smooth" : "auto" });
  }, [messages.length, pending]);

  function ask(question: string) {
    const asked = question.replace(/\s+/g, " ").trim();
    if (!asked || pending) return;

    const history = pairs(messages);
    setMessages((prev) => [...prev, { id: nextId.current++, role: "user", text: asked }]);
    setDraft("");

    startTransition(async () => {
      try {
        const reply = await askZol(asked, history);
        setMessages((prev) => [
          ...prev,
          {
            id: nextId.current++,
            role: "zol",
            text: reply.answer,
            links: reply.links,
            source: reply.source,
            model: reply.model,
          },
        ]);
      } catch {
        setMessages((prev) => [
          ...prev,
          {
            id: nextId.current++,
            role: "zol",
            text: "Something went wrong reading the shop's records. Try again in a moment.",
            failed: true,
          },
        ]);
      }
      inputRef.current?.focus();
    });
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    ask(draft);
  }

  return (
    <div className="card flex min-h-[60dvh] flex-col overflow-hidden">
      <div
        className="flex-1 overflow-y-auto px-4 py-5 sm:px-6"
        role="log"
        aria-live="polite"
        aria-label="Conversation with ZOL"
      >
        {messages.length === 0 ? (
          <div className="mx-auto flex max-w-xl flex-col items-center py-6 text-center sm:py-10">
            <span
              aria-hidden="true"
              className="wash-zol grid h-12 w-12 place-items-center rounded-full"
            >
              <Sparkles className="h-6 w-6" />
            </span>
            <p className="t-h3 mt-4 text-[1.125rem] text-ink">Ask about {shopName}</p>
            <p className="mt-1.5 text-[0.9375rem] leading-relaxed text-ink-2">
              Approvals, the schedule, parts, the techs, revenue, declined work, a customer, a
              ticket. Answers come from your own records, with a button into each one.
            </p>
            <ul className="mt-5 flex flex-wrap justify-center gap-2">
              {suggestions.map((suggestion) => (
                <li key={suggestion}>
                  <button
                    type="button"
                    onClick={() => ask(suggestion)}
                    className="rounded-full border border-line-2 bg-paper px-3.5 py-2 text-[0.875rem] text-ink transition-colors hover:border-emerald hover:bg-emerald-wash hover:text-emerald-deep"
                  >
                    {suggestion}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <ol className="flex flex-col gap-5">
            {messages.map((message) =>
              message.role === "user" ? (
                <li key={message.id} className="flex justify-end gap-3">
                  <div className="max-w-[85%] rounded-[var(--radius)] rounded-br-sm bg-paper-3 px-3.5 py-2.5 text-[0.9375rem] text-ink sm:max-w-[70%]">
                    {message.text}
                  </div>
                  <Avatar name={firstName} size="sm" tone="person" />
                </li>
              ) : (
                <li key={message.id} className="flex gap-3">
                  <span
                    aria-hidden="true"
                    className="wash-zol grid h-7 w-7 flex-none place-items-center rounded-full"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                  </span>
                  <div className="min-w-0 max-w-[92%] sm:max-w-[80%]">
                    <div
                      className={`whitespace-pre-line rounded-[var(--radius)] rounded-tl-sm border px-3.5 py-2.5 text-[0.9375rem] leading-relaxed text-ink ${
                        message.failed
                          ? "border-amber-line bg-amber-wash text-amber-deep"
                          : "border-line bg-paper"
                      }`}
                    >
                      {message.text}
                    </div>
                    {message.links && message.links.length > 0 && (
                      <ul className="mt-2 flex flex-wrap gap-2">
                        {message.links.map((link) => (
                          <li key={link.href}>
                            <Link href={link.href} className="btn btn-ghost btn-sm">
                              {link.label}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                    {message.source && (
                      <p className="mt-1.5 text-[0.75rem] text-ink-3">
                        {message.source === "openai"
                          ? `${message.model ?? "Model"} · grounded in your shop data`
                          : "Answered from your shop data"}
                      </p>
                    )}
                  </div>
                </li>
              ),
            )}
            {pending && (
              <li className="flex gap-3" aria-label="ZOL is looking that up">
                <span
                  aria-hidden="true"
                  className="wash-zol grid h-7 w-7 flex-none place-items-center rounded-full"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                </span>
                <div className="rounded-[var(--radius)] rounded-tl-sm border border-line bg-paper px-3.5 py-2.5 text-[0.9375rem] text-ink-3">
                  Looking that up…
                </div>
              </li>
            )}
            <div ref={endRef} />
          </ol>
        )}
      </div>

      {messages.length > 0 && (
        <div className="swipe-x flex gap-2 border-t border-line px-4 py-2.5 sm:px-6">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => ask(suggestion)}
              disabled={pending}
              className="flex-none rounded-full border border-line bg-paper px-3 py-1.5 text-[0.8125rem] text-ink-2 transition-colors hover:border-emerald hover:text-emerald-deep disabled:opacity-50"
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}

      <form onSubmit={onSubmit} className="flex gap-2 border-t border-line bg-paper-2 px-3 py-3 sm:px-4">
        <label htmlFor="assistant-question" className="sr-only">
          Ask ZOL
        </label>
        <input
          ref={inputRef}
          id="assistant-question"
          name="question"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Ask about the shop…"
          autoComplete="off"
          maxLength={400}
          className="input flex-1"
          // This screen is the input; landing here and having to tap it first is the bug.
          autoFocus
        />
        <button
          type="submit"
          className="btn btn-emerald btn-sm"
          disabled={pending || draft.trim().length < 2}
          aria-label="Send"
        >
          <Send className="h-4 w-4" aria-hidden="true" />
          <span className="hidden sm:inline">Ask</span>
        </button>
      </form>

      <p className="border-t border-line px-4 py-2 text-[0.75rem] text-ink-3 sm:px-6">
        {aiConfigured
          ? "ZOL picks from a fixed set of shop queries and writes the answer from their results only. It never writes SQL and never sees another shop."
          : "No model key is set, so ZOL routes each question to a fixed set of shop queries by keyword and answers from templates. Same data, same links."}
      </p>
    </div>
  );
}

/** The transcript as question/answer pairs, for context on the next turn. */
function pairs(messages: Message[]): { question: string; answer: string }[] {
  const out: { question: string; answer: string }[] = [];
  for (let i = 0; i < messages.length - 1; i += 1) {
    const q = messages[i];
    const a = messages[i + 1];
    if (q.role === "user" && a.role === "zol" && !a.failed) {
      out.push({ question: q.text, answer: a.text });
    }
  }
  return out;
}
