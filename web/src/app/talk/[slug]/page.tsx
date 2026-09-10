import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ReceptionistChat } from "@/components/public/receptionist-chat";
import { query } from "@/lib/db";
import { formatPhone } from "@/lib/phone";
import { greetingFor } from "@/lib/receptionist/engine";

/**
 * The shop's public receptionist. A customer lands here from the shop's
 * website or a text, tells ZOL what's wrong, and leaves with a booking.
 *
 * No sign-in — there is nobody to sign in. The shop is named by its slug and
 * nothing else about it is exposed beyond what's on its sign: the name, the
 * phone number, the address.
 */

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

interface Shop {
  id: string;
  name: string;
  public_phone: string | null;
  address: string | null;
}

async function shopBySlug(slug: string): Promise<Shop | null> {
  if (!SLUG.test(slug) || slug.length > 120) return null;
  const rows = await query<Shop>(
    "SELECT id, name, public_phone, address FROM shops WHERE slug = $1",
    [slug],
  );
  return rows[0] ?? null;
}

export async function generateMetadata(props: PageProps<"/talk/[slug]">): Promise<Metadata> {
  const { slug } = await props.params;
  const shop = await shopBySlug(slug);
  return {
    title: shop ? `Book a visit — ${shop.name}` : "Book a visit",
    description: shop ? `Tell ${shop.name} what's going on with your vehicle and get booked in.` : undefined,
  };
}

export default async function TalkPage(props: PageProps<"/talk/[slug]">) {
  const { slug } = await props.params;
  const shop = await shopBySlug(slug);
  if (!shop) notFound();

  return (
    <ReceptionistChat
      slug={slug}
      shopName={shop.name}
      shopPhone={shop.public_phone}
      shopPhoneLabel={shop.public_phone ? formatPhone(shop.public_phone) : null}
      address={shop.address}
      greeting={greetingFor(shop.name, "web")}
    />
  );
}
