"use client";

import { FirebaseError } from "firebase/app";
import { signInWithPopup, signOut } from "firebase/auth";
import { LogIn, ShieldAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Card } from "@/components/ui/core";
import {
  getClientAuth,
  getMissingClientEnv,
  googleProvider,
} from "@/lib/firebase/client";

export default function LoginPage() {
  const router = useRouter();
  const missing = getMissingClientEnv();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [unauthorized, setUnauthorized] = useState(false);

  async function login() {
    setLoading(true);
    setError("");
    setUnauthorized(false);
    try {
      const auth = getClientAuth();
      const credential = await signInWithPopup(auth, googleProvider);
      const idToken = await credential.user.getIdToken();
      const response = await fetch("/api/auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) {
        await signOut(auth);
        if (response.status === 403) setUnauthorized(true);
        throw new Error(result.error || "Sign-in failed.");
      }
      router.replace("/dashboard");
      router.refresh();
    } catch (cause) {
      if (cause instanceof FirebaseError && cause.code === "auth/popup-closed-by-user") {
        setError("Sign-in was cancelled.");
      } else {
        setError(cause instanceof Error ? cause.message : "Sign-in failed.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 p-4">
      <Card className="w-full max-w-md p-8">
        <div className="mb-8 flex items-center gap-3">
          <div className="grid size-11 place-items-center rounded-xl bg-blue-600 text-lg font-bold text-white">
            C
          </div>
          <div>
            <h1 className="text-xl font-semibold">Company OS</h1>
            <p className="text-sm text-slate-500">Your team workspace</p>
          </div>
        </div>
        {unauthorized ? (
          <div className="mb-5 rounded-lg border border-red-200 bg-red-50 p-4">
            <div className="flex gap-3">
              <ShieldAlert className="mt-0.5 text-red-600" size={20} />
              <div>
                <h2 className="font-semibold text-red-900">Access not authorized</h2>
                <p className="mt-1 text-sm text-red-700">
                  This Google account is not in the Company OS allowlist. You have been signed out.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="mb-6">
            <h2 className="text-2xl font-semibold tracking-tight">Welcome back</h2>
            <p className="mt-2 text-sm text-slate-500">
              Sign in with an approved Google account to continue.
            </p>
          </div>
        )}
        {missing.length ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <p className="font-semibold">Setup required</p>
            <p className="mt-1">
              Firebase web configuration is missing. Copy <code>.env.example</code> to{" "}
              <code>.env.local</code> and add your Firebase values.
            </p>
          </div>
        ) : (
          <Button className="w-full" disabled={loading} onClick={login}>
            <LogIn size={18} />
            {loading ? "Signing in…" : "Continue with Google"}
          </Button>
        )}
        {error ? (
          <p role="alert" className="mt-4 text-sm text-red-600">
            {error}
          </p>
        ) : null}
        <p className="mt-6 text-center text-xs text-slate-400">
          Access is limited to approved company accounts.
        </p>
      </Card>
    </main>
  );
}
