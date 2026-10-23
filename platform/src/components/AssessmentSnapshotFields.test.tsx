import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { AssessmentSnapshotFields } from "./AssessmentSnapshotFields";

it("preserves template order, missing values, negatives, zero and extra saved keys", () => {
  const html = renderToStaticMarkup(createElement(AssessmentSnapshotFields, { snapshot: {
    servicePoint: "WALK_IN", templateVersion: "KE-WALKIN-1.0",
    data: { serviceRequested: "Screening", carePlan: "Saved plan", extraNegative: false, extraZero: 0, nested: { source: "retained" } },
  } }));
  expect(html.indexOf("Screening")).toBeLessThan(html.indexOf("Saved plan"));
  expect(html).toContain("Not recorded");
  expect(html).toContain("Additional saved fields");
  expect(html).toContain("<dd>No</dd>");
  expect(html).toContain("<dd>0</dd>");
  expect(html).toContain("retained");
});

it("does not assign modern labels or units to an unknown historical template", () => {
  const html = renderToStaticMarkup(createElement(AssessmentSnapshotFields, { snapshot: {
    servicePoint: "WALK_IN", templateVersion: "older-template",
    data: { carePlan: "Older value", retiredField: "<script>synthetic</script>", missing: null },
  } }));
  expect(html).toContain("original field keys");
  expect(html).toContain("<dt>carePlan</dt>");
  expect(html).toContain("<dt>retiredField</dt>");
  expect(html).not.toContain("<script>");
  expect(html).toContain("Not recorded");
  expect(html).not.toContain("Follow-up, escalation or referral plan");
});
