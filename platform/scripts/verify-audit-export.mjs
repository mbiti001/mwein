import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

const exportPath = process.argv[2] ? path.resolve(process.argv[2]) : null;
if (!exportPath) throw new Error("Pass the downloaded audit export path");
const body = await readFile(exportPath, "utf8");
const data = JSON.parse(body);
if (data.schema !== "mwein.audit-export.v1") throw new Error("Unsupported audit export schema");
let previous = "GENESIS";
let expectedSequence = 1n;
for (const event of data.events || []) {
  const sequence = BigInt(event.sequence);
  if (sequence !== expectedSequence) throw new Error(`Expected sequence ${expectedSequence}, received ${sequence}`);
  if (event.previousEventHash !== previous) throw new Error(`Broken previous hash at sequence ${sequence}`);
  const hash = createHash("sha256").update([
    event.id, event.facilityId, String(event.chainVersion), String(sequence), event.previousEventHash,
    new Date(event.occurredAt).toISOString(), event.userId || "SYSTEM", event.sessionId || "NO_SESSION",
    event.action, event.entityType, event.entityId, event.reason || "", event.beforeHash || "", event.afterHash || "",
  ].join("\u001f")).digest("hex");
  if (hash !== event.eventHash) throw new Error(`Invalid event hash at sequence ${sequence}`);
  previous = event.eventHash;
  expectedSequence += 1n;
}
if (previous !== data.chain.expectedHeadHash) throw new Error("Export head hash does not match the event chain");
console.log(JSON.stringify({ status: "verified", events: data.events.length, headHash: previous }));
