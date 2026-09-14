import { createHmac, timingSafeEqual } from "node:crypto";
import { applicationSecret } from "./login-security";

export type DiagnosisSelection = {
  facilityId: string;
  code: string;
  title: string;
  foundationUri?: string;
  source: "WHO ICD-11" | "Facility history";
};

type SignedDiagnosisSelection = DiagnosisSelection & { expiresAt: number };

function signature(payload: string) {
  return createHmac("sha256", applicationSecret())
    .update(`diagnosis-selection\u001f${payload}`)
    .digest("base64url");
}

export function createDiagnosisSelectionToken(
  selection: DiagnosisSelection,
  now = Date.now(),
) {
  const payload = Buffer.from(
    JSON.stringify({ ...selection, expiresAt: now + 10 * 60 * 1000 }),
  ).toString("base64url");
  return `${payload}.${signature(payload)}`;
}

export function verifyDiagnosisSelectionToken(
  token: string,
  expected: Omit<DiagnosisSelection, "source">,
  now = Date.now(),
) {
  const [payload, suppliedSignature, ...rest] = token.split(".");
  if (!payload || !suppliedSignature || rest.length)
    throw new Error("Select a diagnosis from the validated search results");
  const expectedSignature = signature(payload);
  const actual = Buffer.from(suppliedSignature);
  const expectedValue = Buffer.from(expectedSignature);
  if (actual.length !== expectedValue.length || !timingSafeEqual(actual, expectedValue))
    throw new Error("The diagnosis selection could not be verified");
  let selection: SignedDiagnosisSelection;
  try {
    selection = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw new Error("The diagnosis selection could not be read");
  }
  if (selection.expiresAt < now)
    throw new Error("The diagnosis search result expired; search and select it again");
  if (
    selection.facilityId !== expected.facilityId ||
    selection.code !== expected.code ||
    selection.title !== expected.title ||
    (selection.foundationUri || undefined) !== (expected.foundationUri || undefined)
  )
    throw new Error("The diagnosis was changed after selection; search and select it again");
  return selection;
}
