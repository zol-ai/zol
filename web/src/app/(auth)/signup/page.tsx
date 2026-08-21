import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { currentUser } from "@/lib/auth";
import { SignUpForm } from "./sign-up-form";

export const metadata: Metadata = {
  title: "Set up your shop",
  robots: { index: false, follow: false },
};

export default async function SignUpPage() {
  if (await currentUser()) redirect("/app");

  return (
    <div className="card p-6 sm:p-8">
      <h1 className="t-h3 text-[1.5rem]">Set up your shop</h1>
      <p className="mt-1.5 text-[0.9375rem] text-ink-2">
        Two minutes. Nothing to install, and nothing changes on the phone line
        until you say so.
      </p>

      <div className="mt-6">
        {/* Read on the server: the code's existence is a deployment fact, and
            the value itself never reaches the browser. */}
        <SignUpForm codeRequired={Boolean(process.env.ZOL_SIGNUP_CODE)} />
      </div>

      <p className="mt-6 border-t border-line pt-5 text-[0.875rem] text-ink-2">
        Already set up?{" "}
        <Link href="/signin" className="font-semibold text-emerald-deep underline underline-offset-2">
          Sign in
        </Link>
        .
      </p>
    </div>
  );
}
