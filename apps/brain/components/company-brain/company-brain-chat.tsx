"use client";

import {
  BrainCircuit,
  Database,
  Send,
  Sparkles,
  Trash2,
  UserRound,
} from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/utils";
import type {
  CompanyBrainMessage,
  CompanyBrainResponse,
} from "@/types/company-brain";
import { Button, Card, Textarea } from "@/components/ui/core";

const suggestions = [
  "How many total tasks and people are there?",
  "Which open tasks are overdue?",
  "Who has the most open tasks?",
  "Summarize our active clients.",
];

function newMessage(role: CompanyBrainMessage["role"], content: string) {
  return { id: crypto.randomUUID(), role, content };
}

export function CompanyBrainChat() {
  const [messages, setMessages] = useState<CompanyBrainMessage[]>([]);
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, loading]);

  async function ask(content: string) {
    const trimmed = content.trim();
    if (!trimmed || loading) return;

    const userMessage = newMessage("user", trimmed);
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setPrompt("");
    setError("");
    setLoading(true);

    try {
      const response = await apiFetch<CompanyBrainResponse>("/api/company-brain", {
        method: "POST",
        body: JSON.stringify({
          messages: nextMessages.map(({ role, content: messageContent }) => ({
            role,
            content: messageContent,
          })),
        }),
      });
      setMessages((current) => [
        ...current,
        newMessage("assistant", response.answer),
      ]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Company Brain could not answer.");
    } finally {
      setLoading(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void ask(prompt);
  }

  return (
    <Card className="mt-6 overflow-hidden p-0">
      <div className="flex flex-col gap-3 border-b bg-slate-950 px-5 py-5 text-white sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="grid size-11 place-items-center rounded-xl bg-blue-500/20 text-blue-300">
            <BrainCircuit size={24} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold">Company Brain</h2>
              <span className="rounded-full bg-emerald-400/15 px-2 py-0.5 text-[11px] font-medium text-emerald-300">
                Read only
              </span>
            </div>
            <p className="text-sm text-slate-400">
              Ask questions about live tasks, people, and clients.
            </p>
          </div>
        </div>
        {messages.length ? (
          <Button
            variant="ghost"
            className="self-start text-slate-300 hover:bg-white/10 hover:text-white sm:self-auto"
            onClick={() => {
              setMessages([]);
              setError("");
            }}
          >
            <Trash2 size={16} /> Clear chat
          </Button>
        ) : null}
      </div>

      <div className="flex min-h-[560px] flex-col">
        <div
          className="max-h-[560px] flex-1 overflow-y-auto px-4 py-6 sm:px-6"
          aria-live="polite"
        >
          {!messages.length ? (
            <div className="mx-auto flex h-full max-w-2xl flex-col items-center justify-center py-10 text-center">
              <div className="grid size-14 place-items-center rounded-2xl bg-blue-50 text-blue-600">
                <Sparkles size={27} />
              </div>
              <h3 className="mt-4 text-xl font-semibold">What would you like to know?</h3>
              <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">
                Company Brain checks Firestore before answering, so counts and task
                details reflect your current workspace.
              </p>
              <div className="mt-6 grid w-full gap-2 sm:grid-cols-2">
                {suggestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => void ask(suggestion)}
                    className="rounded-xl border bg-white p-3 text-left text-sm text-slate-700 transition hover:border-blue-300 hover:bg-blue-50"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="mx-auto max-w-3xl space-y-5">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={cn(
                    "flex gap-3",
                    message.role === "user" && "flex-row-reverse",
                  )}
                >
                  <div
                    className={cn(
                      "grid size-8 shrink-0 place-items-center rounded-full",
                      message.role === "assistant"
                        ? "bg-blue-600 text-white"
                        : "bg-slate-200 text-slate-700",
                    )}
                  >
                    {message.role === "assistant" ? (
                      <BrainCircuit size={17} />
                    ) : (
                      <UserRound size={17} />
                    )}
                  </div>
                  <div
                    className={cn(
                      "max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-6",
                      message.role === "assistant"
                        ? "rounded-tl-sm border bg-white text-slate-700"
                        : "rounded-tr-sm bg-blue-600 text-white",
                    )}
                  >
                    {message.content}
                  </div>
                </div>
              ))}
              {loading ? (
                <div className="flex gap-3">
                  <div className="grid size-8 shrink-0 place-items-center rounded-full bg-blue-600 text-white">
                    <BrainCircuit size={17} />
                  </div>
                  <div className="rounded-2xl rounded-tl-sm border bg-white px-4 py-3 text-sm text-slate-500">
                    Checking company data…
                  </div>
                </div>
              ) : null}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        <div className="border-t bg-slate-50 p-4 sm:p-5">
          <form onSubmit={submit} className="mx-auto max-w-3xl">
            {error ? (
              <p role="alert" className="mb-2 text-sm text-red-600">
                {error}
              </p>
            ) : null}
            <div className="flex items-end gap-2 rounded-xl border bg-white p-2 shadow-sm">
              <Textarea
                aria-label="Ask Company Brain"
                placeholder="Ask about tasks, people, clients, priorities, or due dates…"
                className="min-h-11 resize-none border-0 px-2 py-2.5 focus-visible:outline-none"
                rows={1}
                maxLength={3000}
                value={prompt}
                disabled={loading}
                onChange={(event) => setPrompt(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void ask(prompt);
                  }
                }}
              />
              <Button
                aria-label="Send prompt"
                className="size-10 shrink-0 px-0"
                disabled={loading || !prompt.trim()}
              >
                <Send size={17} />
              </Button>
            </div>
            <p className="mt-2 flex items-center justify-center gap-1.5 text-center text-xs text-slate-400">
              <Database size={13} />
              Answers use live Firestore data. Gmail and Calendar are not connected yet.
            </p>
          </form>
        </div>
      </div>
    </Card>
  );
}
