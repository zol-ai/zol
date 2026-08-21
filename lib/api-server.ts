import "server-only";

import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { requireSessionUser } from "@/lib/auth/session";

export async function authorized<T>(
  handler: (user: Awaited<ReturnType<typeof requireSessionUser>>) => Promise<T>,
) {
  try {
    const user = await requireSessionUser();
    return NextResponse.json(await handler(user));
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: "Validation failed", issues: error.flatten() },
        { status: 400 },
      );
    }
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const message = error instanceof Error ? error.message : "Unexpected server error";
    console.error(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
