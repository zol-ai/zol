import { Notice } from "@/components/app/ui";

/**
 * What the CRM buttons say when they land the person back on the page.
 *
 * The actions redirect with a query string rather than holding state, so a
 * reload doesn't repeat a send and a link can be shared. This reads that
 * query string once and turns it into a sentence.
 */
export function FollowUpNotices({
  params,
}: {
  params: Record<string, string | string[] | undefined>;
}) {
  const one = (key: string) => {
    const value = params[key];
    return typeof value === "string" ? value : undefined;
  };

  const notices: { tone: "zol" | "person" | "neutral" | "red"; text: string }[] = [];

  const drafted = one("drafted");
  if (drafted) {
    notices.push(
      one("via") === "openai"
        ? { tone: "zol", text: "ZOL drafted a message from the facts on file. Read it before you use it." }
        : {
            tone: "neutral",
            text: "Drafted from the built-in template — no AI key is configured, so the model wasn't asked.",
          },
    );
  }

  const sent = one("sent");
  if (sent) {
    const outcome = one("outcome");
    const via = one("via");
    if (outcome === "sent") {
      notices.push(
        via === "portal"
          ? {
              tone: "zol",
              text: "Sent. Texting is switched off, so it landed on the customer's portal page and in their message history.",
            }
          : { tone: "zol", text: "Sent as a text." },
      );
    } else if (outcome === "cancelled") {
      notices.push({
        tone: "person",
        text: "Not sent: this customer has stopped texts. The follow-up is closed — a phone call is still fine.",
      });
    } else if (outcome === "skipped") {
      notices.push({
        tone: "neutral",
        text: "Nothing to send — it had already gone, or the worker had it at that moment.",
      });
    } else if (outcome === "retry") {
      notices.push({
        tone: "person",
        text: "Couldn't send just now. It stays queued and goes again on the next pass — the reason is on the card.",
      });
    } else if (outcome === "failed") {
      notices.push({
        tone: "red",
        text: "Gave up on that one — the reason is on the card. Call them.",
      });
    }
  }

  const winbacks = one("winbacks");
  if (winbacks !== undefined) {
    const n = Number(winbacks);
    notices.push(
      n > 0
        ? {
            tone: "zol",
            text: `${n} win-back ${n === 1 ? "follow-up" : "follow-ups"} queued for customers you haven't seen in six months. They're under Due now.`,
          }
        : {
            tone: "neutral",
            text: "No win-backs to queue: everyone six months out already has one, has something open, or has stopped texts.",
          },
    );
  }

  if (notices.length === 0) return null;

  return (
    <div className="mb-6 flex flex-col gap-2">
      {notices.map((notice) => (
        <Notice key={notice.text} tone={notice.tone}>
          {notice.text}
        </Notice>
      ))}
    </div>
  );
}
