import { recordDisclosure } from "./disclosure-audit";
import { privateJson } from "./http";

// Only a digest of the response is retained; never put raw records into the audit log.
export async function auditedOperationalJson(actor: { id: string; facilityId: string; sessionId: string }, route: string, body: unknown, init?: ResponseInit) {
  await recordDisclosure(actor, `OPERATIONS_READ:${route}`, [], body);
  return privateJson(body, init);
}
