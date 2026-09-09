import type {
  MarketingChannel,
  MarketingContentType,
  MarketingIdeaStatus,
} from "@/types";

export const marketingStatuses: Array<{
  value: MarketingIdeaStatus;
  label: string;
  description: string;
  dot: string;
}> = [
  { value: "idea", label: "Ideas", description: "Fresh concepts", dot: "bg-violet-500" },
  { value: "planned", label: "Planned", description: "Approved next steps", dot: "bg-blue-500" },
  { value: "creating", label: "Creating", description: "Production in progress", dot: "bg-amber-500" },
  { value: "ready", label: "Ready", description: "Ready to publish", dot: "bg-emerald-500" },
  { value: "posted", label: "Posted", description: "Published work", dot: "bg-slate-500" },
];

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
