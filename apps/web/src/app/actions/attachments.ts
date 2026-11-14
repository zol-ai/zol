"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth";
import { query, tx } from "@/lib/db";
import { logRoEvent } from "@/lib/events";
import { getStorageProvider } from "@/lib/storage/provider";
import type { FormState } from "./auth";

/**
 * Photos, hung off whatever they describe.
 *
 * The bytes go to object storage through lib/storage/provider.ts; the row is
 * the pointer plus the caption. The action checks three things before it
 * touches storage: that a provider exists on this deploy at all, that the
 * file is an image of a size a phone produces, and that the thing it is
 * being attached to belongs to this shop — an entity id is a uuid from a
 * form and proves nothing on its own.
 */

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

const MAX_BYTES = 8 * 1024 * 1024;

const IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/heic": "heic",
  "image/heif": "heif",
};

type EntityType = "repair_order" | "inspection" | "inspection_item" | "vehicle" | "diagnostic";

const ENTITY_TYPES: readonly EntityType[] = [
  "repair_order",
  "inspection",
  "inspection_item",
  "vehicle",
  "diagnostic",
];

/**
 * True when `entityId` of `entityType` is this shop's and, where it applies,
 * on this ticket. Each entity has its own path to shop_id.
 */
async function entityBelongs(
  entityType: EntityType,
  entityId: string,
  repairOrderId: string,
  shopId: string,
): Promise<boolean> {
  const sql: Record<EntityType, string> = {
    repair_order: "SELECT 1 FROM repair_orders WHERE id = $1 AND shop_id = $2 AND id = $3",
    inspection: "SELECT 1 FROM inspections WHERE id = $1 AND shop_id = $2 AND repair_order_id = $3",
    inspection_item: `SELECT 1 FROM inspection_items it JOIN inspections i ON i.id = it.inspection_id
                       WHERE it.id = $1 AND i.shop_id = $2 AND i.repair_order_id = $3`,
    vehicle: `SELECT 1 FROM vehicles v JOIN repair_orders ro ON ro.vehicle_id = v.id
               WHERE v.id = $1 AND v.shop_id = $2 AND ro.id = $3`,
    diagnostic: "SELECT 1 FROM diagnostics WHERE id = $1 AND shop_id = $2 AND repair_order_id = $3",
  };
  const rows = await query(sql[entityType], [entityId, shopId, repairOrderId]);
  return rows.length > 0;
}

export async function uploadAttachment(
  _state: FormState | undefined,
  form: FormData,
): Promise<FormState> {
  const user = await requireUser();

  const repairOrderId = text(form, "repair_order_id");
  const entityType = text(form, "entity_type");
  const entityId = text(form, "entity_id");
  const caption = text(form, "caption");
  const file = form.get("file");

  const values = { caption };
  const fields: Record<string, string> = {};

  const provider = getStorageProvider();
  if (!provider) {
    return { error: "Photo storage isn't configured on this deployment.", values };
  }

  if (!(ENTITY_TYPES as readonly string[]).includes(entityType)) {
    return { error: "That isn't something a photo can be attached to.", values };
  }
  if (!/^[0-9a-f-]{36}$/i.test(entityId) || !/^[0-9a-f-]{36}$/i.test(repairOrderId)) {
    return { error: "That isn't something a photo can be attached to.", values };
  }

  if (!(file instanceof File) || file.size === 0) {
    fields.file = "Choose a photo.";
  } else if (!IMAGE_TYPES[file.type]) {
    fields.file = "JPEG, PNG, WebP, GIF or HEIC.";
  } else if (file.size > MAX_BYTES) {
    fields.file = "Under 8 MB, please — most phones can send a smaller copy.";
  }
  if (caption.length > 200) fields.caption = "Keep it under 200 characters.";
  if (Object.keys(fields).length > 0) return { fields, values };

  const image = file as File;
  if (!(await entityBelongs(entityType as EntityType, entityId, repairOrderId, user.shopId))) {
    redirect("/app/repair-orders");
  }

  // Random segment in the key: a bucket that is readable by URL must not be
  // walkable by guessing the next id.
  const key = `shops/${user.shopId}/${entityType}/${entityId}/${randomUUID()}.${IMAGE_TYPES[image.type]}`;
  const bytes = new Uint8Array(await image.arrayBuffer());

  let stored: { key: string; url: string };
  try {
    stored = await provider.put({ key, bytes, contentType: image.type });
  } catch (error) {
    console.error("[attachments] upload failed", error);
    return { error: "The photo didn't upload. Try again in a moment.", values };
  }

  await tx(async (client) => {
    await client.query(
      `INSERT INTO attachments
         (shop_id, kind, entity_type, entity_id, storage_key, url, content_type,
          size_bytes, caption, created_by)
       VALUES ($1, 'photo', $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        user.shopId,
        entityType,
        entityId,
        stored.key,
        stored.url,
        image.type,
        image.size,
        caption || null,
        user.staffId,
      ],
    );
    await logRoEvent(client, {
      shopId: user.shopId,
      repairOrderId,
      kind: "photo_added",
      detail: caption ? `Photo added: ${caption}` : "Photo added.",
      actor: "person",
      staffId: user.staffId,
    });
  });

  revalidatePath(`/app/repair-orders/${repairOrderId}`);
  redirect(`/app/repair-orders/${repairOrderId}#inspection`);
}

export async function removeAttachment(form: FormData): Promise<void> {
  const user = await requireUser();
  const id = text(form, "id");
  const repairOrderId = text(form, "repair_order_id");

  const rows = await query<{ storage_key: string }>(
    "DELETE FROM attachments WHERE id = $1 AND shop_id = $2 RETURNING storage_key",
    [id, user.shopId],
  );

  // The row is gone either way; an object the bucket refuses to delete is a
  // few hundred kilobytes of orphan, not a reason to fail the person.
  const key = rows[0]?.storage_key;
  if (key) {
    await getStorageProvider()
      ?.remove(key)
      .catch((error) => console.warn("[attachments] delete failed", error));
  }

  revalidatePath(`/app/repair-orders/${repairOrderId}`);
  redirect(`/app/repair-orders/${repairOrderId}#inspection`);
}
