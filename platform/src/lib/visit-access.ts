export type VisitAccessProfile = {
  billing: boolean;
  clinical: boolean;
  imaging: boolean;
  laboratory: boolean;
  pharmacy: boolean;
  triage: boolean;
};

export function visitAccessProfile(permissions: string[]): VisitAccessProfile {
  const has = (permission: string) => permissions.includes(permission);
  return {
    billing: has("billing.read"),
    clinical: has("encounter.write"),
    imaging: has("imaging.write"),
    laboratory: has("laboratory.write"),
    pharmacy: has("pharmacy.dispense"),
    triage: has("triage.write"),
  };
}

export function visitOrderTypes(profile: VisitAccessProfile) {
  if (profile.clinical) return ["LABORATORY", "IMAGING", "MEDICATION"] as const;
  return [
    ...(profile.laboratory ? (["LABORATORY"] as const) : []),
    ...(profile.imaging ? (["IMAGING"] as const) : []),
    ...(profile.pharmacy ? (["MEDICATION"] as const) : []),
  ];
}
