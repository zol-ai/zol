"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth";
import { tx } from "@/lib/db";
import { createInvoiceForRepairOrder, voidInvoice } from "@/lib/invoices";

/**
 * The invoice, from the counter.
 *
 * Both actions are one-click buttons the invoice panel only shows when they
 * can work, so a guard that fails here (somebody else invoiced the ticket a
 * second earlier, a payment landed before the void) lands back on the ticket
 * showing whatever is now true.
 */

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

export async function createInvoice(form: FormData): Promise<void> {
  const user = await requireUser();
  const repairOrderId = text(form, "repair_order_id");

  const result = await tx((client) =>
    createInvoiceForRepairOrder(client, {
      shopId: user.shopId,
      repairOrderId,
      staffId: user.staffId,
    }),
  );

  if (!result.ok && result.reason === "no_ticket") redirect("/app/repair-orders");

  revalidatePath(`/app/repair-orders/${repairOrderId}`);
  revalidatePath("/app/invoices");
  redirect(`/app/repair-orders/${repairOrderId}#invoice`);
}

export async function voidInvoiceAction(form: FormData): Promise<void> {
  const user = await requireUser();
  const invoiceId = text(form, "invoice_id");

  const result = await tx((client) =>
    voidInvoice(client, { shopId: user.shopId, invoiceId, staffId: user.staffId }),
  );

  if (!result) redirect("/app/invoices");

  revalidatePath(`/app/repair-orders/${result.repairOrderId}`);
  revalidatePath("/app/invoices");
  redirect(`/app/repair-orders/${result.repairOrderId}#invoice`);
}
