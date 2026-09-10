"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";

/**
 * The bell.
 *
 * Two actions, both scoped to the shop and to what this person is allowed
 * to see: a notification addressed to somebody else (`staff_id` set to
 * another person) is not theirs to open or clear. Opening one marks it read
 * and then goes wherever it pointed, so the list and the unread count never
 * disagree with what the person has actually looked at.
 */

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

/**
 * A stored href is data written by our own code, but it still goes through
 * `redirect()`, and a redirect target has to be a path inside the app —
 * never a protocol, never a scheme-relative `//host`, never anything a
 * future bug in a notify call could turn into an open redirect.
 */
function safeHref(href: string | null | undefined): string {
  if (!href) return "/app/notifications";
  if (!href.startsWith("/app") || href.startsWith("//")) return "/app/notifications";
  if (/[\s\\]/.test(href) || href.includes("://")) return "/app/notifications";
  return href;
}

export async function openNotification(form: FormData): Promise<void> {
  const user = await requireUser();
  const id = text(form, "id");
  if (!id) redirect("/app/notifications");

  const rows = await query<{ href: string | null }>(
    `UPDATE notifications
        SET read_at = coalesce(read_at, now())
      WHERE id = $1 AND shop_id = $2
        AND (staff_id IS NULL OR staff_id = $3)
      RETURNING href`,
    [id, user.shopId, user.staffId],
  );

  revalidatePath("/app/notifications");
  // The unread count lives in the layout's chrome, so the layout is what
  // has to re-render for the badge to drop.
  revalidatePath("/app", "layout");
  redirect(safeHref(rows[0]?.href));
}

export async function markAllRead(): Promise<void> {
  const user = await requireUser();

  await query(
    `UPDATE notifications
        SET read_at = now()
      WHERE shop_id = $1 AND read_at IS NULL
        AND (staff_id IS NULL OR staff_id = $2)`,
    [user.shopId, user.staffId],
  );

  revalidatePath("/app/notifications");
  revalidatePath("/app", "layout");
  redirect("/app/notifications");
}
