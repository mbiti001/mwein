import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { shaGatewayReadiness } from "@/lib/sha";
import { shaClaimPreflight, shaClaimPreflightRequestSchema } from "@/lib/sha-claim-preflight";

const activeStatuses = ["DRAFT", "SUBMITTED", "APPROVED", "PAID"] as const;

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requirePermission("claims.write");
    const { id } = await context.params;
    const input = shaClaimPreflightRequestSchema.parse(await request.json());
    const invoice = await db.invoice.findFirst({
      where: { id, visit: { facilityId: user.facilityId }, status: { not: "VOID" } },
      include: {
        items: true,
        claims: { where: { status: { in: [...activeStatuses] } }, include: { lines: true } },
        visit: {
          include: {
            patient: { include: { identifiers: true } },
            encounters: { include: { diagnoses: true } },
            orders: true,
          },
        },
      },
    });
    if (!invoice) throw Object.assign(new Error("Invoice not found"), { status: 404 });

    const selectedIds = new Set(input.coveredItemIds);
    const invoiceItemIds = new Set(invoice.items.map((item) => item.id));
    const allocatedIds = new Set(invoice.claims.flatMap((claim) => claim.lines.map((line) => line.invoiceItemId)));
    const contractProfile = await db.shaContractProfile.findUnique({ where: { facilityId: user.facilityId } });
    const gateway = shaGatewayReadiness(contractProfile);
    const fundEnabled = gateway.contract.enabledFunds.includes(input.shaPreparation.fund);
    const patientShaNumber = invoice.visit.patient.identifiers.find((identifier) => identifier.type === "SHA")?.value;
    const signedEncounter = invoice.visit.encounters.find((encounter) => encounter.status === "SIGNED");
    const preflight = shaClaimPreflight(input.shaPreparation, {
      patientShaNumber,
      memberNumber: input.memberNumber,
      signedEncounter: Boolean(signedEncounter),
      codedDiagnosis: Boolean(signedEncounter?.diagnoses.some((diagnosis) => diagnosis.codingSystem === "ICD-11 MMS" && diagnosis.code)),
      unresolvedOrderCount: invoice.visit.orders.filter((order) => !["COMPLETED", "CANCELLED"].includes(order.status)).length,
      selectedLineCount: input.coveredItemIds.length,
      invalidLineCount: [...selectedIds].filter((itemId) => !invoiceItemIds.has(itemId)).length,
      duplicateLineCount: [...selectedIds].filter((itemId) => allocatedIds.has(itemId)).length,
      contractReady: gateway.contract.activationReady && fundEnabled,
      gatewayReady: gateway.ready && fundEnabled,
    });
    return NextResponse.json({ preflight });
  } catch (error) {
    return apiError(error);
  }
}
