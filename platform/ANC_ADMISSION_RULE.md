# ANC admission and safeguarding rule

## Rule implemented

- Routine ANC check-in requires a consented, documented positive pregnancy-test result, its test date, source and retained result/accession reference.
- Negative, pending or untested clients are not discarded or told to return later. They must be routed to pregnancy confirmation or a general clinical assessment. Emergency presentations go directly to Emergency and are never delayed for pregnancy confirmation.
- Age is not an exclusion criterion. A client younger than 15 with positive confirmation is admitted to ANC and automatically flagged for a private, non-judgemental clinician safeguarding assessment under the facility child-protection pathway.
- Reception must not ask a child or adolescent to justify or explain the pregnancy. Pregnancy evidence is shown only to triage and clinical users through the existing permission-scoped visit projection.

The positive-test prerequisite is a facility routing rule requested for this implementation; WHO guidance calls for confirming pregnancy at the first ANC contact but does not establish a universal test-only admission barrier.

## Clinical basis reviewed 14 September 2026

- [WHO recommendations on antenatal care for a positive pregnancy experience](https://www.who.int/publications/i/item/9789241549912) applies to pregnant women and adolescent girls and promotes person-centred, rights-based care.
- [WHO maternal health intervention schedule](https://www.who.int/teams/maternal-newborn-child-adolescent-health-and-ageing/handbooks/programme-manager-s-handbook-mncah/recommendations-on-interventions-along-life-course/maternal) places pregnancy confirmation and routine blood tests at the first booking contact.
- [WHO guideline on preventing early pregnancy and poor reproductive outcomes among adolescents](https://www.who.int/publications/i/item/9789240104105) emphasizes access to maternal health services and respectful care for pregnant adolescents.
- [WHO global standards for quality health care services for adolescents](https://www.who.int/publications/i/item/9789240114012) calls for non-discriminatory, rights-based, confidential and adolescent-responsive services.

This rule supports routing and documentation; it does not replace clinical judgement, emergency protocols, national law, or an approved facility safeguarding policy.

## Shared pregnancy dating rule

- When LNMP is entered, EDD is calculated as LNMP plus 280 days.
- Gestational age is calculated from the LNMP to the facility's current calendar date and retained as completed weeks plus additional days.
- The same server-authoritative calculation applies in triage and the structured ANC assessment. It is displayed again in consultation and included in the governed visit-summary source.
- Client-supplied EDD or gestational-age values are overwritten when LNMP is present, preventing conflicting calculations between workstations.
- LNMP dating remains an estimate. The clinician must assess date reliability and use ultrasound dating when clinically indicated; future support for an approved ultrasound re-dating workflow must retain both the original LNMP estimate and the reason for any revised EDD.

The 280-day convention is documented in Kenya's National Guidelines for Quality Obstetrics and Perinatal Care, while WHO materials recognize gestational age calculated from LMP and recommend ultrasound dating where possible.
