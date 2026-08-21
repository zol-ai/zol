import Image from "next/image";

/**
 * The ZOL mark. Sourced from zol-logo.png with the black plate masked off, so
 * it drops onto the light page (and the dark CTA panel) without a square
 * around it. Master lives at web/public/zol-mark.png.
 */
export function Mark({ size = 30, className = "" }: { size?: number; className?: string }) {
  return (
    <Image
      src="/zol-mark.png"
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      priority
      className={className}
      style={{ width: size, height: size }}
    />
  );
}

export function Wordmark({
  size = 30,
  tone = "ink",
  className = "",
}: {
  size?: number;
  tone?: "ink" | "panel";
  className?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <Mark size={size} />
      <span
        className={`t-h3 leading-none ${tone === "panel" ? "text-panel-fg" : "text-ink"}`}
        style={{ fontSize: size * 0.72, letterSpacing: "-0.03em" }}
      >
        ZOL
      </span>
    </span>
  );
}
