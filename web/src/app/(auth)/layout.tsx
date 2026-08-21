import Link from "next/link";

import { Wordmark } from "@/components/site/mark";

/**
 * The frame around sign-in, sign-up and accepting an invite.
 *
 * One column, centred, nothing else on the page. Whatever brought somebody
 * here, the only thing they can usefully do is finish the form.
 */
export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <main className="flex min-h-dvh flex-col bg-paper-2">
      <div className="shell flex h-[64px] items-center">
        <Link href="/" aria-label="ZOL home">
          <Wordmark />
        </Link>
      </div>

      <div className="flex flex-1 items-start justify-center px-5 pb-16 pt-4 sm:items-center sm:pt-0">
        <div className="w-full max-w-[26rem]">{children}</div>
      </div>
    </main>
  );
}
