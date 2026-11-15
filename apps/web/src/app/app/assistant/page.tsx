import { AssistantChat } from "@/components/app/assistant-chat";
import { PageHead } from "@/components/app/shell";
import { SUGGESTED_QUESTIONS } from "@/lib/ai/assistant";
import { aiConfigured } from "@/lib/ai/client";
import { requireUser } from "@/lib/auth";

export const metadata = { title: "Ask ZOL" };

/**
 * Tenant-scoped questions, answered from SQL. The page itself only decides
 * who is asking; the conversation is the client component, and every turn
 * goes through the `askZol` action, which re-checks the session.
 */
export default async function AssistantPage() {
  const user = await requireUser();

  return (
    <>
      <PageHead
        eyebrow={user.shopName}
        title="Ask ZOL"
        description="Questions about your shop, answered from your own records."
      />
      <AssistantChat
        firstName={user.fullName.split(" ")[0]}
        shopName={user.shopName}
        suggestions={SUGGESTED_QUESTIONS}
        aiConfigured={aiConfigured()}
      />
    </>
  );
}
