import { describe, expect, it } from "vitest";
import { verifyIdentitySchema, requireRightsIdentity } from "./privacy-identity";
const body={action:"VERIFY_IDENTITY",requestId:"11111111-1111-4111-8111-111111111111",requestKey:"22222222-2222-4222-8222-222222222222",requesterKind:"PATIENT",requesterReference:"protected-recipient",identityEvidenceReference:"protected-evidence",authorizationScope:"REQUEST_REVIEW_ONLY",scopeSummary:"Review this synthetic request only",attested:true};
describe("rights identity evidence",()=>{
 it("requires representative relationship and authority without accepting caller attribution",()=>{
  expect(verifyIdentitySchema.safeParse(body).success).toBe(true);
  for(const extra of [{attested:false},{requesterKind:"AUTHORIZED_REPRESENTATIVE"},{verifiedById:"pretend"},{verifiedAt:"2026-01-01T00:00:00Z"},{identityEvidenceReference:" "}]) expect(verifyIdentitySchema.safeParse({...body,...extra}).success).toBe(false);
  expect(verifyIdentitySchema.safeParse({...body,requesterKind:"AUTHORIZED_REPRESENTATIVE",relationship:"guardian",authorityEvidenceReference:"authority-reference"}).success).toBe(true);
 });
 it("binds evidence to the original patient, facility, request and type and separates export authority",()=>{
  const record={id:body.requestId,patientId:"patient",facilityId:"facility",type:"ACCESS"};
  const identityVerification={...body,version:1,patientId:record.patientId,facilityId:record.facilityId,requestType:record.type,verifiedAt:"2026-10-16T00:00:00.000Z",verifiedById:"dpo",verifiedByName:"Synthetic reviewer"};
  expect(requireRightsIdentity({...record,identityVerification}).requesterReference).toBe(body.requesterReference);
  expect(()=>requireRightsIdentity({...record,identityVerification},true)).toThrow(/not authorized/);
  for(const extra of [{patientId:"other"},{facilityId:"other"},{requestId:"other"},{requestType:"CORRECTION"}]) expect(()=>requireRightsIdentity({...record,identityVerification:{...identityVerification,...extra}})).toThrow();
 });
});
