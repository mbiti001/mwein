import { z } from "zod";

export function clinicalFollowUpDate(plan: string | null) {
  try {
    const value: unknown = plan ? JSON.parse(plan) : null;
    if (!value || typeof value !== "object") return null;
    const date = z.iso.date().safeParse((value as Record<string, unknown>).followUpDate);
    return date.success ? `${date.data}T00:00:00+03:00` : null;
  } catch { return null; }
}

export type FollowUpPatient = { id: string; patientNumber: string; fullName: string };
export type FollowUpData = {
  generatedAt: string; horizon: string;
  summary: Record<string, number>;
  truncated: { appointments: boolean; referrals: boolean; specialty: boolean; clinical: boolean; clinicalScan: boolean };
  worklists: {
    appointments: { id: string; scheduledAt: string; clinic: string; status: string; patient: FollowUpPatient }[];
    referrals: { id: string; referralNumber: string; receivingFacility: string; status: string; updatedAt: string; patient: FollowUpPatient }[];
    specialty: { id: string; servicePoint: string; followUpAt: string; visitId: string; visitNumber: string; patient: FollowUpPatient }[];
    clinical: { id: string; followUpAt: string; clinic: string; visitId: string; visitNumber: string; patient: FollowUpPatient }[];
  };
};
