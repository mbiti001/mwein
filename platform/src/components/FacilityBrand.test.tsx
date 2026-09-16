import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BrandMark, FacilityLetterhead, MWEIN_BRAND } from "@/components/FacilityBrand";

describe("facility branding", () => {
  it("renders the reviewed public brand asset", () => {
    const html = renderToStaticMarkup(<BrandMark decorative={false} />);
    expect(MWEIN_BRAND.logoPath).toBe("/icon.png");
    expect(html).toContain(MWEIN_BRAND.logoPath);
    expect(html).toContain("Mwein Medical Services");
    expect(html).not.toContain("mwein-medical-logo");
  });

  it("adds the Mwein contact lockup to official documents", () => {
    const html = renderToStaticMarkup(
      <FacilityLetterhead
        facilityName="Mwein Medical Services"
        title="Official receipt"
        reference="MMS-RCT-2026-1"
        badge={<strong>PAID</strong>}
      />,
    );
    expect(html).toContain(MWEIN_BRAND.location);
    expect(html).toContain(MWEIN_BRAND.phone);
    expect(html).toContain(MWEIN_BRAND.email);
    expect(html).toContain(MWEIN_BRAND.tagline);
    expect(html).toContain("Official receipt");
    expect(html).toContain("PAID");
    expect(html).toContain("facilityLetterheadWave");
  });

  it("does not misbrand another tenant's document as Mwein", () => {
    const html = renderToStaticMarkup(
      <FacilityLetterhead facilityName="Other Facility" title="Visit summary" />,
    );
    expect(html).toContain("Other Facility");
    expect(html).not.toContain(MWEIN_BRAND.logoPath);
    expect(html).not.toContain(MWEIN_BRAND.phone);
    expect(html).not.toContain("facilityLetterheadWave");
  });
});
