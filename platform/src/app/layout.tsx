import type { Metadata } from "next";
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

export const metadata: Metadata = {
  title: "Mwein HMIS · Connected outpatient care",
  description: "One secure workspace for reception, consultation, diagnostics, pharmacy, billing and reporting.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
