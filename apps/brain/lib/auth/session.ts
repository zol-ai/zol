import { cookies } from "next/headers";
import { getAdminAuth } from "@/lib/firebase/admin";

export const SESSION_COOKIE = "company_os_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 5;

export type SessionUser = {
  uid: string;
  email: string;
  name: string;
  picture?: string;
};

export function allowedEmails() {
  return (process.env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export function isAllowedEmail(email?: string) {
  return Boolean(email && allowedEmails().includes(email.toLowerCase()));
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE)?.value;
  if (!sessionCookie) return null;

  try {
    const decoded = await getAdminAuth().verifySessionCookie(sessionCookie, true);
    if (!isAllowedEmail(decoded.email)) return null;
    return {
      uid: decoded.uid,
      email: decoded.email!,
      name: decoded.name || decoded.email!.split("@")[0],
      picture: decoded.picture,
    };
  } catch {
    return null;
  }
}

export async function requireSessionUser() {
  const user = await getSessionUser();
  if (!user) throw new Error("UNAUTHORIZED");
  return user;
}
