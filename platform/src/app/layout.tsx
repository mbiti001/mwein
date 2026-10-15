import type { Metadata } from "next";
import { connection } from "next/server";
import BuildStamp from "@/components/BuildStamp";
import { releaseIdentity } from "@/lib/release";
import "./styles.css";
import "./triage.css";
import "./privacy.css";
import "./workflow.css";
import "./consultation.css";
import "./findings.css";
import "./clinical-terms.css";
import "./targeted-review.css";
import "./catalogue.css";
import "./service-points.css";
import "./service-validation.css";
import "./mobile.css";
import "./visit-summary.css";
import "./modern.css";
import "./mfa.css";
import "./branding.css";
import "./actions.css";
import "./worklists.css";
import "./theme.css";
import "./build-stamp.css";
import "./measured-vitals.css";

export const metadata: Metadata = {
  title: "Mwein HMIS · Connected outpatient care",
  description: "One secure workspace for reception, consultation, diagnostics, pharmacy, billing and reporting.",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  await connection();
  return (
    <html lang="en">
      <body>{children}<BuildStamp release={releaseIdentity()} /></body>
    </html>
  );
}
