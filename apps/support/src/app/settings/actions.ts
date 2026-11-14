"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { saveAgentSettings, VOICES } from "@/lib/settings";
import { DEFAULT_INSTRUCTIONS } from "@/lib/agent/prompt";

const SettingsInput = z.object({
  instructions: z.string().trim().min(20, "Instructions are too short.").max(20000),
  voice: z.enum(VOICES),
});

export async function saveSettings(formData: FormData): Promise<void> {
  const parsed = SettingsInput.safeParse({
    instructions: formData.get("instructions"),
    voice: formData.get("voice"),
  });
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? "Invalid input.";
    redirect(`/settings?error=${encodeURIComponent(msg)}`);
  }
  await saveAgentSettings(parsed.data);
  redirect("/settings?saved=1");
}

export async function resetToDefault(): Promise<void> {
  await saveAgentSettings({ instructions: DEFAULT_INSTRUCTIONS, voice: "marin" });
  redirect("/settings?saved=1");
}
