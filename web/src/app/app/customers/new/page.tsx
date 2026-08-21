import Link from "next/link";

import { CustomerForm } from "@/components/app/customer-forms";
import { PageHead } from "@/components/app/shell";
import { requireUser } from "@/lib/auth";

export const metadata = { title: "New customer" };

export default async function NewCustomerPage() {
  await requireUser();

  return (
    <>
      <PageHead eyebrow="Customers" title="New customer">
        <Link href="/app/customers" className="btn btn-ghost btn-sm">
          Cancel
        </Link>
      </PageHead>

      <section className="card max-w-3xl p-5 sm:p-6">
        <CustomerForm submitLabel="Add customer" />
        <p className="mt-4 text-[0.8125rem] text-ink-3">
          If that number is already on file, this opens the existing record
          rather than making a second one — the phone number is the customer.
        </p>
      </section>
    </>
  );
}
