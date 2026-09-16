import type { ReactNode } from "react";

export const MWEIN_BRAND = {
  name: "Mwein Medical Services",
  location: "Mungatsi, Busia County, Kenya",
  phone: "+254 707 711 888",
  email: "mweinmedical@gmail.com",
  availability: "Open 24 hours, 7 days",
  logoPath: "/branding/mwein-medical-logo.png",
} as const;

export function BrandMark({
  className = "brandMark",
  decorative = true,
}: {
  className?: string;
  decorative?: boolean;
}) {
  return (
    <img
      className={className}
      src={MWEIN_BRAND.logoPath}
      alt={decorative ? "" : "Mwein Medical Services"}
      aria-hidden={decorative ? "true" : undefined}
      width={768}
      height={768}
    />
  );
}

export function FacilityLetterhead({
  facilityName = MWEIN_BRAND.name,
  title,
  reference,
  badge,
}: {
  facilityName?: string | null;
  title: string;
  reference?: string | null;
  badge?: ReactNode;
}) {
  const resolvedName = facilityName || MWEIN_BRAND.name;
  const isMwein = resolvedName.toLowerCase().includes("mwein");

  return (
    <header className="facilityLetterhead">
      <div className="facilityLetterheadIdentity">
        {isMwein && <BrandMark className="facilityLetterheadLogo" decorative={false} />}
        <div>
          <p className="facilityLetterheadName">{resolvedName}</p>
          {isMwein && (
            <>
              <p className="facilityLetterheadLocation">{MWEIN_BRAND.location}</p>
              <p className="facilityLetterheadContact">
                {MWEIN_BRAND.phone} · {MWEIN_BRAND.email}
              </p>
            </>
          )}
        </div>
      </div>
      <div className="facilityLetterheadDocument">
        <h1>{title}</h1>
        {reference && <p>{reference}</p>}
      </div>
      {badge && <div className="facilityLetterheadBadge">{badge}</div>}
    </header>
  );
}
