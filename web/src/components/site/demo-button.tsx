import { site } from "@/lib/site";

type Props = {
  variant?: "primary" | "emerald" | "ghost" | "onpanel";
  size?: "md" | "sm";
  children?: React.ReactNode;
  className?: string;
};

/**
 * Every "Book a demo" on the page routes through here, so the calendar link
 * lives in exactly one place (`lib/site.ts`).
 */
export function DemoButton({
  variant = "primary",
  size = "md",
  children = "Book a demo",
  className = "",
}: Props) {
  const variantClass = {
    primary: "btn-primary",
    emerald: "btn-emerald",
    ghost: "btn-ghost",
    onpanel: "btn-onpanel",
  }[variant];

  return (
    <a
      href={site.demoUrl}
      target="_blank"
      rel="noopener noreferrer"
      className={`btn ${variantClass} ${size === "sm" ? "btn-sm" : ""} ${className}`}
    >
      {children}
    </a>
  );
}
