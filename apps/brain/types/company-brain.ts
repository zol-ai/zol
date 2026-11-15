export type CompanyBrainRole = "user" | "assistant";

export type CompanyBrainMessage = {
  id: string;
  role: CompanyBrainRole;
  content: string;
};

export type CompanyBrainResponse = {
  answer: string;
  generatedAt: string;
};
