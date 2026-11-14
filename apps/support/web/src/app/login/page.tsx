import { login } from "./actions";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const { error, next } = await searchParams;
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center p-8">
      <h1 className="text-2xl font-semibold">Zol Support</h1>
      <p className="mt-1 text-sm text-neutral-500">Enter the team password to continue.</p>
      <form action={login} className="mt-6 space-y-3">
        <input type="hidden" name="next" value={next ?? "/"} />
        <input
          type="password"
          name="password"
          autoFocus
          required
          placeholder="Password"
          className="w-full rounded-md border border-neutral-300 px-3 py-2"
        />
        {error && <p className="text-sm text-red-600">That password did not match.</p>}
        <button
          type="submit"
          className="w-full rounded-md bg-neutral-900 px-3 py-2 text-white hover:bg-neutral-700"
        >
          Sign in
        </button>
      </form>
    </main>
  );
}
