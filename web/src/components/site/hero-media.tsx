"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

/**
 * Rotating hero imagery, framed inside the hero's right column.
 *
 * Real shop photography, in the order a job actually moves: the front desk
 * takes the call, the bay does the work, the counter pulls the parts, the
 * ticket closes on the screen.
 */
const slides = [
  {
    src: "/images/landing_page/front-desk.jpg",
    alt: "A service advisor at a ZOL front desk taking a call with a tablet in hand",
  },
  {
    src: "/images/landing_page/bay-tech.jpg",
    alt: "A technician working under an open hood with a torque wrench",
  },
  {
    src: "/images/landing_page/parts-counter.jpg",
    alt: "Two technicians at the parts counter reviewing the shop-wide workflow board",
  },
  {
    src: "/images/landing_page/work-order.png",
    alt: "A technician reading an open work order on the shop management screen",
  },
];

const INTERVAL_MS = 5500;

export function HeroMedia() {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  /* Advance on a timer. Held still for reduced-motion readers, and while the
     tab is in the background — an invisible carousel is wasted work. */
  useEffect(() => {
    if (paused) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const timer = window.setInterval(
      () => setIndex((i) => (i + 1) % slides.length),
      INTERVAL_MS,
    );
    return () => window.clearInterval(timer);
  }, [paused]);

  useEffect(() => {
    const onVisibility = () => setPaused(document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  return (
    <div className="hero-frame">
      {slides.map((slide, i) => (
        <Image
          key={slide.src}
          src={slide.src}
          alt={i === index ? slide.alt : ""}
          fill
          sizes="(min-width: 1024px) 46vw, 100vw"
          unoptimized
          priority={i === 0}
          /*
            Slides default to lazy, which means the first crossfade can land on
            an image that hasn't downloaded yet and flash blank. Fetch one slide
            ahead of the current one instead — the next image has a full
            interval to arrive, and later slides still stay off the initial load
            so they don't compete with LCP.
          */
          loading={i <= index + 1 ? "eager" : "lazy"}
          aria-hidden={i === index ? undefined : true}
          className="object-cover transition-opacity duration-[1100ms] ease-in-out motion-reduce:transition-none"
          style={{ opacity: i === index ? 1 : 0 }}
        />
      ))}

      {/* Softens the top edge into the paper so the frame doesn't read as a
          pasted-on rectangle. */}
      <div className="hero-frame-fade" aria-hidden="true" />

      {/* Real controls, not decoration — reachable by keyboard. */}
      <div className="absolute bottom-4 left-4 z-10 flex gap-2">
        {slides.map((slide, i) => (
          <button
            key={slide.src}
            type="button"
            onClick={() => {
              setIndex(i);
              setPaused(true);
            }}
            aria-label={`Show image ${i + 1} of ${slides.length}`}
            aria-current={i === index}
            /* The visible bar is the inner span; the button stays 32px so
               there is something to hit on a touch screen. */
            className="group grid h-8 place-items-center px-1"
          >
            <span
              className={`block h-1.5 rounded-full transition-all duration-300 ${
                i === index
                  ? "w-7 bg-paper"
                  : "w-1.5 bg-paper/45 group-hover:bg-paper/75"
              }`}
            />
          </button>
        ))}
      </div>
    </div>
  );
}
