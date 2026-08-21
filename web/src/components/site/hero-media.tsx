"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

/**
 * Rotating hero imagery.
 *
 * These are hand-drawn placeholder scenes. To use real photographs, drop files
 * with these exact names into web/public/images/ (jpg or webp, landscape,
 * ~2000px wide) and change the extensions here — nothing else needs to move.
 */
const slides = [
  { src: "/images/shop-01.svg", alt: "Two technicians looking over an open engine bay in a service bay" },
  { src: "/images/shop-02.svg", alt: "A vehicle raised on a two-post lift with a technician working underneath" },
  { src: "/images/shop-03.svg", alt: "The service counter of a repair shop with the phone ringing" },
  { src: "/images/shop-04.svg", alt: "A technician running a diagnostic scan tool at an open driver's door" },
  { src: "/images/shop-05.svg", alt: "A technician carrying a parts box past the shelving, bay door open to daylight" },
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
    <>
      {slides.map((slide, i) => (
        <Image
          key={slide.src}
          src={slide.src}
          alt={i === index ? slide.alt : ""}
          fill
          sizes="(min-width: 1024px) 58vw, 100vw"
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

      <div className="hero-scrim" aria-hidden="true" />

      {/* Real controls, not decoration — reachable by keyboard. */}
      <div className="absolute bottom-5 right-5 z-10 flex gap-2 lg:bottom-7 lg:right-8">
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
              className={`block h-2 rounded-full transition-all duration-300 ${
                i === index
                  ? "w-7 bg-ink"
                  : "w-2 bg-ink/30 group-hover:bg-ink/55"
              }`}
            />
          </button>
        ))}
      </div>
    </>
  );
}
