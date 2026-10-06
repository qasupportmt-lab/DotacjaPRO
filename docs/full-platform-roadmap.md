# Full Platform Roadmap

Status: MASTER PLAN
Data: 2026-10-06

## P0 — legal, tax, naming foundations

P0.1 Brand rename clearance.
P0.2 Define product supply taxonomy.
P0.3 Obtain legal opinion for regulated categories.
P0.4 Prepare WIS request for personalized eBook + key + portal model.
P0.5 Checkout legal pack.
P0.6 Payment provider production adapter.

Exit:
LEGAL_READY + TAX_READY + PAYMENT_READY.

## P1 — Experience Shell

P1.1 GUIDE original character design.
P1.2 product-category API.
P1.3 animated product router.
P1.4 reduced-motion fallback.
P1.5 analytics events.
P1.6 E2E navigation.

Exit:
all product cards route to correct engine, no business logic hidden in animation.

## P2 — Profile 360

P2.1 normalize existing UserProfile/FundingProfile.
P2.2 add needs profile.
P2.3 ask-once data dictionary.
P2.4 provenance per answer.
P2.5 consent scopes.

Exit:
engines reuse verified user data.

## P3 — Grant Engine 2.0

P3.1 verified source scanning.
P3.2 program/call population.
P3.3 eligibility state.
P3.4 local criteria.
P3.5 evidence locker.
P3.6 official forms.
P3.7 readiness scoring.
P3.8 deadline/action plan.
P3.9 eBook/report output.

Exit:
profile -> verified call -> qualification -> official docs -> eBook/package.

## P4 — eBook / commerce / access keys

P4.1 extend CommerceProduct tax metadata.
P4.2 order tax snapshot.
P4.3 eBook generation job.
P4.4 manifest.
P4.5 access-redemption token.
P4.6 entitlement activation.
P4.7 email/download delivery.
P4.8 withdrawal/consumer evidence.
P4.9 refund revocation logic.

Exit:
payment -> compliant delivery -> one-time activation -> entitlement.

## P5 — Financial Partner Hub

P5.1 PartnerInstitution.
P5.2 regulatory verification.
P5.3 AdvisorProfile.
P5.4 ConsentRecord.
P5.5 FinancialLeadCase.
P5.6 PartnerReferral.
P5.7 OfferSnapshot.
P5.8 Appointment.
P5.9 partner QA / CAPA.

Exit:
need -> consent -> verified partner -> auditable referral.

## P6 — Market Price Intelligence

Purpose:
show indicative market price ranges and our own transparent price.

Sources:
- public price lists,
- direct partner tariffs,
- verified quotations,
- timestamped market observations.

Never compare incomparable scopes.

Each price observation:
- provider,
- location,
- exact service scope,
- source URL/evidence,
- gross/net context,
- timestamp,
- confidence.

"2% cheaper" may be enabled only if:
- at least N comparable fresh observations,
- same service definition,
- same included deliverables,
- consumer price basis aligned,
- no minimum-price constraint,
- legal/commercial QA pass.

Otherwise:
show market range + our price without "cheapest" claim.

## P7 — Social Acquisition

Instagram PL + TikTok PL.
Connect Social Master architecture.
UTM/contentId attribution into platform funnel.

## P8 — Telegram Master Tower

Owner views:
- platform health,
- users,
- products,
- QA,
- tax gates,
- legal gates,
- orders,
- entitlements,
- document jobs,
- partner leads,
- price intel,
- social,
- incidents/CAPA.

## P9 — Validation

Security:
- auth,
- IDOR,
- entitlement bypass,
- token replay,
- file access,
- admin access.

Commerce:
- payment replay,
- refund,
- mismatched amount,
- wrong tax snapshot,
- legal acceptance.

Documents:
- source version,
- render hash,
- package integrity.

Performance:
- mobile,
- iOS,
- Telegram MiniApp,
- weak network,
- animation fallback.

## Release principle

A single module blocker does not stop independent work.
But no blocked module may be exposed as production-ready.

Statuses:
READY
IN_PROGRESS
BLOCKED
FIXED
VERIFYING
VERIFIED
CLOSED.
