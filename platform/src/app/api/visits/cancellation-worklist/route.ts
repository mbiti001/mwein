import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { recordClinicalAccess } from "@/lib/clinical-access";
import { db } from "@/lib/db";
import { apiError, privateJson } from "@/lib/http";

const pageSize = 50;
const querySchema = z.object({
  q: z.string().trim().max(100).default(""),
  cursor: z.uuid().optional(),
});

export async function GET(request: Request) {
  try {
    const user = await requirePermission("visit.cancel");
    const parameters = new URL(request.url).searchParams;
    const { q, cursor } = querySchema.parse({
      q: parameters.get("q") ?? undefined,
      cursor: parameters.get("cursor") ?? undefined,
    });
    // A previously displayed anchor may now be cancelled. Resolve its immutable sort key
    // within this facility, without requiring it to remain in the active worklist.
    const anchor = cursor ? await db.visit.findFirst({
      where: { id: cursor, facilityId: user.facilityId },
      select: { id: true, arrivedAt: true },
    }) : null;
    if (cursor && !anchor)
      throw Object.assign(new Error("The visit page could not be found. Refresh the visit list."), { status: 404 });
    const rows = await db.visit.findMany({
      where: {
        facilityId: user.facilityId,
        status: { notIn: ["COMPLETED", "CANCELLED"] },
        ...(q || anchor ? { AND: [
          ...(q ? [{ OR: [
            { visitNumber: { contains: q, mode: "insensitive" as const } },
            { clinic: { contains: q, mode: "insensitive" as const } },
            { patient: { fullName: { contains: q, mode: "insensitive" as const } } },
            { patient: { patientNumber: { contains: q, mode: "insensitive" as const } } },
          ] }] : []),
          ...(anchor ? [{ OR: [
            { arrivedAt: { gt: anchor.arrivedAt } },
            { arrivedAt: anchor.arrivedAt, id: { gt: anchor.id } },
          ] }] : []),
        ] } : {}),
      },
      select: {
        id: true,
        visitNumber: true,
        clinic: true,
        priority: true,
        status: true,
        arrivedAt: true,
        clinicallyClosedAt: true,
        patient: { select: { id: true, fullName: true, patientNumber: true } },
      },
      // An immutable arrival time and unique tie-breaker keep older waiting visits reachable.
      orderBy: [{ arrivedAt: "asc" }, { id: "asc" }],
      take: pageSize + 1,
    });
    const visits = rows.slice(0, pageSize);
    const nextCursor = rows.length > pageSize ? visits[visits.length - 1].id : null;
    await recordClinicalAccess(user, "VISIT_WORKLIST", visits.flatMap(visit => [
      { type: "Visit" as const, id: visit.id },
      { type: "Patient" as const, id: visit.patient.id },
    ]));
    return privateJson({ visits, nextCursor });
  } catch (error) {
    return apiError(error);
  }
}
