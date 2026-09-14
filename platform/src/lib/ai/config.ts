export const GPT6_ASTRA_MODEL = "gpt-6-astra" as const;

export type AstraReadinessCheck = {
  code: string;
  ready: boolean;
  requirement: string;
};

export type AstraConfiguration = {
  apiKey: string;
  baseURL?: string;
  model: typeof GPT6_ASTRA_MODEL;
  timeoutMs: number;
  hourlyLimit: number;
  dataRetentionMode: "ZERO_DATA_RETENTION" | "MODIFIED_ABUSE_MONITORING" | "STANDARD";
};

const retentionModes = new Set<AstraConfiguration["dataRetentionMode"]>([
  "ZERO_DATA_RETENTION",
  "MODIFIED_ABUSE_MONITORING",
  "STANDARD",
]);

function enabled(value: string | undefined) {
  return value?.trim().toLowerCase() === "true";
}

function boundedInteger(value: string | undefined, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

function validBaseUrl(value: string | undefined) {
  if (!value) return true;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

export function astraConfigurationReadiness(
  environment: Record<string, string | undefined> = process.env,
) {
  const retentionMode = environment.OPENAI_DATA_RETENTION_MODE?.trim();
  const checks: AstraReadinessCheck[] = [
    {
      code: "AI_VISIT_SUMMARY_ENABLED",
      ready: enabled(environment.AI_VISIT_SUMMARY_ENABLED),
      requirement: "Enable the AI visit-summary feature explicitly",
    },
    {
      code: "OPENAI_API_KEY",
      ready: Boolean(environment.OPENAI_API_KEY?.trim()),
      requirement: "Configure a server-only OpenAI project API key",
    },
    {
      code: "OPENAI_MODEL",
      ready: (environment.OPENAI_MODEL?.trim() || GPT6_ASTRA_MODEL) === GPT6_ASTRA_MODEL,
      requirement: `Keep the approved model fixed to ${GPT6_ASTRA_MODEL}`,
    },
    {
      code: "OPENAI_BASE_URL",
      ready: validBaseUrl(environment.OPENAI_BASE_URL?.trim()),
      requirement: "Use an HTTPS OpenAI API base URL when a regional endpoint is configured",
    },
    {
      code: "OPENAI_DATA_RETENTION_MODE",
      ready: retentionModes.has(retentionMode as AstraConfiguration["dataRetentionMode"]),
      requirement: "Record the approved OpenAI data-retention mode",
    },
  ];
  return { ready: checks.every((check) => check.ready), checks };
}

export function getAstraConfiguration(
  environment: Record<string, string | undefined> = process.env,
): AstraConfiguration {
  const readiness = astraConfigurationReadiness(environment);
  if (!readiness.ready) {
    throw Object.assign(new Error("AI visit summaries are not enabled for this facility"), {
      status: 503,
      code: "AI_NOT_READY",
    });
  }
  return {
    apiKey: environment.OPENAI_API_KEY!.trim(),
    baseURL: environment.OPENAI_BASE_URL?.trim() || undefined,
    model: GPT6_ASTRA_MODEL,
    timeoutMs: boundedInteger(environment.AI_VISIT_SUMMARY_TIMEOUT_MS, 20_000, 1_000, 60_000),
    hourlyLimit: boundedInteger(environment.AI_VISIT_SUMMARY_HOURLY_LIMIT, 10, 1, 100),
    dataRetentionMode: environment.OPENAI_DATA_RETENTION_MODE!.trim() as AstraConfiguration["dataRetentionMode"],
  };
}
