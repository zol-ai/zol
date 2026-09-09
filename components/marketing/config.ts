import type { MarketingChannel, MarketingContentType } from "@/types";

export const contentTypes: Array<{ value: MarketingContentType; label: string }> = [
  { value: "video", label: "Video" },
  { value: "social_post", label: "Social post" },
  { value: "blog", label: "Blog" },
  { value: "email", label: "Email" },
  { value: "campaign", label: "Campaign" },
  { value: "other", label: "Other" },
];

export const channels: Array<{ value: MarketingChannel; label: string }> = [
  { value: "instagram", label: "Instagram" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "youtube", label: "YouTube" },
  { value: "tiktok", label: "TikTok" },
  { value: "x", label: "X" },
  { value: "email", label: "Email" },
  { value: "website", label: "Website" },
  { value: "other", label: "Other" },
];

export function labelFor<T extends string>(
  options: Array<{ value: T; label: string }>,
  value: T,
) {
  return options.find((option) => option.value === value)?.label ?? value;
}
