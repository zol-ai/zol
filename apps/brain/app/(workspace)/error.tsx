"use client";

import { ErrorState } from "@/components/shared";

export default function WorkspaceError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorState message={error.message} retry={reset} />;
}
