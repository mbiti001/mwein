/** Operational visit identity only. Cancellation eligibility is checked separately by the server. */
export type CancellationWorklistVisit = {
  id: string;
  visitNumber: string;
  clinic: string;
  priority: string;
  status: string;
  arrivedAt: string;
  clinicallyClosedAt: string | null;
  patient: {
    id: string;
    fullName: string;
    patientNumber: string;
  };
};

export type CancellationWorklistResponse = {
  visits: CancellationWorklistVisit[];
  nextCursor: string | null;
};
