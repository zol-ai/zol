import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  isAllowedEmail,
  SESSION_COOKIE,
  SESSION_MAX_AGE,
} from "@/lib/auth/session";
import { getAdminAuth, getMissingAdminEnv } from "@/lib/firebase/admin";

const sessionSchema = z.object({ idToken: z.string().min(20) });

export async function POST(request: Request) {
  const missing = getMissingAdminEnv();
  if (missing.length || !process.env.ALLOWED_EMAILS) {
    const missingConfiguration = process.env.ALLOWED_EMAILS
      ? missing
      : [...missing, "ALLOWED_EMAILS"];
    return NextResponse.json(
      { error: "Server authentication is not configured.", missing: missingConfiguration },
      { status: 503 },
    );
  }

  try {
    const { idToken } = sessionSchema.parse(await request.json());
    const auth = getAdminAuth();
    const decoded = await auth.verifyIdToken(idToken);
    if (!decoded.email || !decoded.email_verified || !isAllowedEmail(decoded.email)) {
      return NextResponse.json({ error: "Access not authorized" }, { status: 403 });
    }

    const account = await auth.getUser(decoded.uid);
    await auth.setCustomUserClaims(decoded.uid, {
      ...account.customClaims,
      appAccess: true,
    });
    const sessionCookie = await auth.createSessionCookie(idToken, {
      expiresIn: SESSION_MAX_AGE * 1000,
    });
    const cookieStore = await cookies();
    cookieStore.set(SESSION_COOKIE, sessionCookie, {
      maxAge: SESSION_MAX_AGE,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Could not create a secure session." }, { status: 401 });
  }
}

export async function DELETE() {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, "", {
    maxAge: 0,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  });
  return NextResponse.json({ ok: true });
}
