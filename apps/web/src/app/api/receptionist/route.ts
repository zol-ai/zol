import { NextResponse } from "next/server";
import { z } from "zod";

import { clientIp } from "@/lib/client-ip";
import { query } from "@/lib/db";
import { handleTurn, startConversation } from "@/lib/receptionist/engine";

export const dynamic = "force-dynamic";

/**
 * The public receptionist's one endpoint. /talk/<slug> posts each message
 * here; the reply comes back in the body. No session, no cookie: a customer
 * has no account and never will.
 *
 * What stands between this and abuse:
 *   - the shop is named by slug and the conversation must belong to it;
 *   - a connection may open 20 conversations an hour, across every shop
 *     (counted in Postgres, because a serverless counter counts nothing);
 *   - a conversation may run 80 messages, which is more than any booking
 *     needs and less than a script can burn;
 *   - no personal data travels in a URL — everything is in the POST body,
 *     and the conversation id is an opaque uuid;
 *   - a phone number typed here is unverified, so the engine never surfaces
 *     what the shop has on file for it (see `handleTurn`).
 */

const Body = z.object({
  slug: z.string().max(120).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  // Absent or null on the first turn — a JSON client naturally sends null.
  conversationId: z.uuid().nullish(),
  message: z.string().trim().min(1).max(1000),
});

const CONVERSATIONS_PER_IP_PER_HOUR = 20;
const MESSAGES_PER_CONVERSATION = 80;

/**
 * The connecting client, read from the trusted end of x-forwarded-for.
 *
 * Vercel overwrites the header with the real client, so it has one entry.
 * Google's front end APPENDS the real client to whatever the caller sent, so
 * on Cloud Run everything before the last entry is the caller's to invent —
 * reading the first entry there hands every request its own rate-limit
 * bucket for the price of a header. The last entry is the client on both
 * hosts. (An external HTTPS load balancer in front of the Cloud Run service
 * would make the client second-to-last; revisit if one is ever added.)
 *
 * No x-real-ip fallback: where it would be consulted it is caller-set too,
 * and unknown callers sharing one bucket is the safer failure.
 */
function problem(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return problem("Send JSON.", 400);
  }

  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    // Two different mistakes, two different sentences: a message that's too
    // long is the visitor's to fix; a bad slug or conversation id is the
    // page's, and the way out is a fresh start.
    const fields = new Set(parsed.error.issues.map((issue) => String(issue.path[0])));
    return problem(
      fields.has("slug") || fields.has("conversationId")
        ? "That conversation isn't here. Reload the page and start a new one."
        : "That message can't be sent. Keep it under 1000 characters.",
      400,
    );
  }
  const { slug, message } = parsed.data;
  let id: string | undefined = parsed.data.conversationId ?? undefined;

  const shops = await query<{ id: string; name: string }>("SELECT id, name FROM shops WHERE slug = $1", [slug]);
  const shop = shops[0];
  if (!shop) return problem("No such shop.", 404);

  // No header at all is a shared bucket, never a free pass.
  const ip = clientIp(request.headers) ?? "unknown";

  if (id) {
    const rows = await query<{ id: string; n: string }>(
      `SELECT cv.id,
              (SELECT count(*) FROM conversation_messages m WHERE m.conversation_id = cv.id) AS n
         FROM conversations cv
        WHERE cv.id = $1 AND cv.shop_id = $2 AND cv.channel = 'web'`,
      [id, shop.id],
    );
    if (!rows[0]) return problem("That conversation isn't here. Start a new one.", 404);
    if (Number(rows[0].n) >= MESSAGES_PER_CONVERSATION) {
      return problem("This conversation has run long. Please call the shop and they'll take it from here.", 429);
    }
  } else {
    // Per connection, not per shop: a host that has used its twenty at one
    // shop doesn't get twenty more at the next slug.
    const recent = await query<{ n: string }>(
      `SELECT count(*) AS n FROM conversations
        WHERE ip = $1 AND created_at > now() - interval '1 hour'`,
      [ip],
    );
    if (Number(recent[0]?.n ?? 0) >= CONVERSATIONS_PER_IP_PER_HOUR) {
      return problem("Too many new conversations from this connection. Please call the shop.", 429);
    }
    id = (await startConversation({ shopId: shop.id, channel: "web", ip })).conversationId;
  }

  let outcome;
  try {
    outcome = await handleTurn({ conversationId: id, text: message });
  } catch (error) {
    // The customer sees a sentence, not a stack trace; the shop's logs get
    // the cause. Their message is already in the transcript, so a person
    // can pick the thread up.
    console.error("[receptionist] turn failed", { conversationId: id, error });
    return problem(
      `Something went wrong on our side. Please try again in a moment${shop.name ? `, or call ${shop.name}` : ""}.`,
      500,
    );
  }

  return NextResponse.json(
    {
      conversationId: id,
      reply: outcome.reply,
      state: outcome.state,
      booked: outcome.booked
        ? {
            when: outcome.booked.when,
            technician: outcome.booked.technicianName,
            bay: outcome.booked.bay,
            confirmationQueued: outcome.booked.confirmationQueued,
          }
        : null,
      source: outcome.source,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
