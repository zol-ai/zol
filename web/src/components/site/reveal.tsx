"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  children: React.ReactNode;
  /** Stagger within a group, in milliseconds. */
  delay?: number;
  className?: string;
  as?: "div" | "li" | "section";
};

/**
 * Fades content up the first time it enters the viewport, then stops observing.
 *
 * Two things keep this from ever hiding content permanently:
 *   1. The hidden state lives under `.js` (set by the inline script in the
 *      layout head), so without scripting the content just renders.
 *   2. Reduced motion is handled entirely in CSS — the reveal sits at its end
 *      state and never transitions — so there's no motion branch here.
 */
export function Reveal({ children, delay = 0, className = "", as = "div" }: Props) {
  const ref = useRef<HTMLElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    if (typeof IntersectionObserver === "undefined") {
      const immediate = window.setTimeout(() => setShown(true), 0);
      return () => window.clearTimeout(immediate);
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShown(true);
          observer.disconnect();
        }
      },
      { rootMargin: "0px 0px -12% 0px", threshold: 0.08 },
    );

    observer.observe(node);

    /*
      Backstop: a tab that never composites (opened in the background, some
      embedded webviews) never delivers an intersection callback, which would
      strand the section at opacity 0. Show it regardless after a beat.
    */
    const backstop = window.setTimeout(() => {
      setShown(true);
      observer.disconnect();
    }, 2500);

    return () => {
      window.clearTimeout(backstop);
      observer.disconnect();
    };
  }, []);

  const Tag = as;

  return (
    <Tag
      ref={ref as React.Ref<never>}
      data-shown={shown}
      style={{ transitionDelay: `${delay}ms` }}
      className={`reveal ${className}`}
    >
      {children}
    </Tag>
  );
}
