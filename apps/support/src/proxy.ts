import { NextResponse, type NextRequest } from "next/server";
import { isValidSession, SESSION_COOKIE } from "@/lib/auth";

/**
 * Gate every dashboard page behind the shared password. Twilio webhooks are
 * exempt (they carry their own signature check) and so is the login page.
 * With DASHBOARD_PASSWORD unset the dashboard is open, which is only
 * acceptable on localhost.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (
    pathname.startsWith("/api/twilio/") ||
    pathname === "/login" ||
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico"
  ) {
    return NextResponse.next();
  }

  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) return NextResponse.next();

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (await isValidSession(password, token)) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return new NextResponse("unauthorized", { status: 401 });
  }
  const login = request.nextUrl.clone();
  login.pathname = "/login";
  login.search = `?next=${encodeURIComponent(pathname)}`;
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
