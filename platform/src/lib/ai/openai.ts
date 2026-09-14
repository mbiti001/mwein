import "server-only";

import OpenAI from "openai";
import { getAstraConfiguration } from "./config";
import {
  buildAstraVisitSummaryRequest,
  parseAiVisitSummaryDraft,
  type AiVisitSummaryInput,
} from "./visit-summary";

export type AstraVisitSummaryResult = {
  draft: ReturnType<typeof parseAiVisitSummaryDraft>;
  providerResponseId: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
};

export async function generateAstraVisitSummary(
  input: AiVisitSummaryInput,
  safetyIdentifier: string,
): Promise<AstraVisitSummaryResult> {
  const config = getAstraConfiguration();
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    timeout: config.timeoutMs,
    maxRetries: 1,
  });

  try {
    const response = await client.responses.create(
      buildAstraVisitSummaryRequest(config, input, safetyIdentifier),
    );
    if (!response.output_text) {
      throw Object.assign(new Error("AI service returned no summary"), { code: "AI_EMPTY_OUTPUT" });
    }
    return {
      draft: parseAiVisitSummaryDraft(response.output_text, input),
      providerResponseId: response.id,
      model: response.model,
      inputTokens: response.usage?.input_tokens ?? null,
      outputTokens: response.usage?.output_tokens ?? null,
      totalTokens: response.usage?.total_tokens ?? null,
    };
  } catch (error) {
    if ((error as { code?: string }).code?.startsWith("AI_")) throw error;
    const status = error instanceof OpenAI.APIError ? error.status : undefined;
    const code = status === 429 ? "AI_RATE_LIMITED" : error instanceof OpenAI.APIConnectionTimeoutError ? "AI_TIMEOUT" : "AI_UNAVAILABLE";
    throw Object.assign(new Error("The AI drafting service is temporarily unavailable"), {
      status: 503,
      code,
    });
  }
}
