import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { currentUser } from "@/lib/auth";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false, follow: false },
};

export default async function SignInPage(props: PageProps<"/signin">) {
  // Already signed in: don't show a form that can only confuse. This also
  // makes the sign-in link in the marketing nav do the right thing for
  // somebody who never signed out.
  if (await currentUser()) redirect("/app");

  const { next } = await props.searchParams;
  const target = typeof next === "string" ? next : undefined;

  return (
    <div className="card p-6 sm:p-8">
      <h1 className="t-h3 text-[1.5rem]">Sign in</h1>
      <p className="mt-1.5 text-[0.9375rem] text-ink-2">
        The board, the calls, the repair orders.
      </p>

      <div className="mt-6">
        <SignInForm next={target} />
      </div>

      <p className="mt-6 border-t border-line pt-5 text-[0.875rem] text-ink-2">
        New shop?{" "}
        <Link href="/signup" className="font-semibold text-emerald-deep underline underline-offset-2">
          Set one up
        </Link>
        .
      </p>
    </div>
  );
}
