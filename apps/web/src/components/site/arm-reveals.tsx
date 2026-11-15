"use client";

import { useLayoutEffect } from "react";

/**
 * The inline script in the layout head adds `.js` before first paint. React's
 * Strict Mode remount in development resets <html> to only the attributes it
 * manages from JSX, which drops that class — so put it back before paint.
 * No-op in production, where the remount doesn't happen.
 */
export function ArmReveals() {
  useLayoutEffect(() => {
    document.documentElement.classList.add("js");
  }, []);

  return null;
}
