import type { ReactNode } from "react";

export const MWEIN_BRAND = {
  name: "Mwein Medical Services",
  tagline: "Exceptional care close to you.",
  location: "Mungatsi, Busia County, Kenya",
  phone: "+254 707 711 888",
  email: "mweinmedical@gmail.com",
  availability: "Open 24 hours, 7 days",
  logoPath: "/brand/mwein-pulse-icon.png",
  wordmarkPath: "/brand/mwein-wordmark.png",
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
      width={512}
      height={512}
    />
  );
}

export function BrandWordmark({ className = "brandWordmark" }: { className?: string }) {
  return <img className={className} src={MWEIN_BRAND.wordmarkPath} alt="Mwein Medical Services" width={1024} height={344} />;
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
        {isMwein && <BrandWordmark className="facilityLetterheadWordmark" />}
        <div className="facilityLetterheadIdentityCopy">
          {!isMwein && <p className="facilityLetterheadName">{resolvedName}</p>}
          {isMwein && (
            <>
              <p className="facilityLetterheadTagline">{MWEIN_BRAND.tagline}</p>
              <div className="facilityLetterheadMeta">
                <span>{MWEIN_BRAND.location}</span>
                <span>{MWEIN_BRAND.phone}</span>
                <span>{MWEIN_BRAND.email}</span>
              </div>
            </>
          )}
        </div>
      </div>
      <div className="facilityLetterheadDocument">
        <span>Facility document</span>
        <h1>{title}</h1>
        {reference && <p>{reference}</p>}
      </div>
      {badge && <div className="facilityLetterheadBadge">{badge}</div>}
      {isMwein ? (
        <svg className="facilityLetterheadWave" viewBox="0 0 1000 28" preserveAspectRatio="none" aria-hidden="true">
          <path d="M0 15 H590 L615 13 L630 17 L646 3 L661 25 L678 14 L704 15 H1000" />
        </svg>
      ) : (
        <div className="facilityLetterheadNeutralRule" aria-hidden="true" />
      )}
    </header>
  );
}
