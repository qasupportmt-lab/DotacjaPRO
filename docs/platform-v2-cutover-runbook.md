# Platform V2 — Cutover / Replacement Runbook

Status: PREPARED, NOT AUTHORIZED FOR PRODUCTION CUTOVER
Prepared: 2026-10-07

## Objective

Replace the current production application with Platform V2 in one controlled cutover, without building directly on production and without deleting the rollback path.

## Non-negotiable rules

1. Current production remains live until the replacement candidate is VERIFIED.
2. Do not delete the current production services before the new release is healthy.
3. The replacement must be atomic from the user perspective.
4. Database changes must use expand -> migrate -> switch -> contract. No destructive schema step before rollback expires.
5. Every release gate requires evidence.
6. Any failed gate = HOLD and rollback / no cutover.
7. User data, documents, orders, audit records and entitlements are preserved.
8. A full rollback target must exist before production changes.

## Current rollback anchor

Git branch:
- backup/pre-platform-v2-20261007

Base production code snapshot:
- d2516600bd0bfb2ae21d20d9a302b0bb995071ce

Do not delete this branch until Platform V2 has passed post-release stabilization.

## Current production service inventory

Railway project: DotacjaPRO
Environment: production

Services:
- api
- miniapp
- telegram-bot
- update-engine
- document-worker

Current state at preparation time:
- api: live
- miniapp: live
- telegram-bot: live
- update-engine: failed latest deployment
- document-worker: failed latest deployment

The failed workers must be repaired before full V2 release can receive a GO.

## Replacement strategy

Use blue/green behavior even if final infrastructure uses the same Railway project:

BLUE = current production
GREEN = Platform V2 candidate

Flow:
BUILD GREEN
-> CI
-> DB EXPAND
-> PREVIEW/STAGING
-> E2E
-> SECURITY QA
-> DATA MIGRATION CHECK
-> RELEASE FREEZE
-> PRODUCTION DEPLOY
-> HEALTH GATE
-> FUNCTIONAL E2E
-> TRAFFIC CONFIRMATION
-> STABILIZATION
-> OLD UI/CODE CLEANUP
-> CONTRACT MIGRATIONS
-> CLOSED

We do NOT perform:
DELETE BLUE -> BUILD GREEN ON PRODUCTION.

## P0 Release prerequisites

All required:
- [ ] New brand/name approved for release, or temporary neutral product label approved.
- [ ] Tax classification gates defined for every active commerce product.
- [ ] Regulated products remain disabled until legal gate passes.
- [ ] Production payment path verified.
- [ ] update-engine healthy.
- [ ] document-worker healthy.
- [ ] database backup / rollback point confirmed.
- [ ] all schema migrations reviewed as non-destructive for cutover phase.

## P1 App completion gate

Platform V2 must include:
- [ ] new authenticated Experience Shell
- [ ] original GUIDE / new visual identity
- [ ] "Czego potrzebujesz?" product selection
- [ ] dynamic product catalogue
- [ ] Profile 360
- [ ] Grant Engine integration
- [ ] document generation integration
- [ ] eBook/report delivery architecture
- [ ] entitlement/access-key handling
- [ ] account/session flows
- [ ] support/report-problem flow
- [ ] owner/admin access
- [ ] legal consent flows
- [ ] mobile/iOS layout
- [ ] reduced-motion mode

No route may drop the user into an unfinished placeholder without an explicit PLANNED gate.

## P2 Data preservation gate

Must preserve:
- User
- UserProfile / FundingProfile
- Case
- QualificationSnapshot
- Source / SourceDocument
- OfficialFormTemplate / mappings
- Document jobs / generated documents
- CommerceProduct / CommerceOrder
- Payment records/events
- Entitlements
- Legal acceptances
- Audit events
- Notifications
- accounting records

No production cutover if row-count or integrity checks show unexplained loss.

## P3 Database migration strategy

Phase A — EXPAND
- add new tables / nullable columns / indexes
- keep old schema readable
- no drop
- no destructive rename

Phase B — MIGRATE
- backfill if needed
- verify counts and FK integrity
- dual-read or compatibility adapter where needed

Phase C — SWITCH
- deploy Platform V2 reading/writing new model

Phase D — CONTRACT
Only after stabilization:
- remove obsolete routes/code
- remove old schema fields/tables only if proven unused
- preserve audit/data retention requirements

## P4 Pre-release verification

Required evidence:
- [ ] pnpm typecheck PASS
- [ ] API tests PASS
- [ ] rules tests PASS
- [ ] worker tests PASS
- [ ] production Docker builds PASS
- [ ] auth E2E PASS
- [ ] registration/login PASS
- [ ] product routing PASS
- [ ] Profile 360 PASS
- [ ] grant qualification PASS
- [ ] verified source flow PASS
- [ ] official-form render PASS
- [ ] document package PASS
- [ ] commerce order PASS
- [ ] payment webhook replay/idempotency PASS
- [ ] entitlement grant/revoke PASS
- [ ] access-key issue/redeem/replay rejection PASS
- [ ] support issue flow PASS
- [ ] admin/owner access PASS
- [ ] mobile/iPhone layout PASS
- [ ] no critical security findings
- [ ] no P0/P1 unresolved defects

## P5 Cutover sequence

1. Declare RELEASE FREEZE.
2. Record exact current BLUE commit/deployment IDs.
3. Verify backup branch and DB rollback strategy.
4. Apply expand-only database migrations.
5. Deploy API V2.
6. Verify API health and smoke tests.
7. Deploy document/update workers.
8. Verify worker health.
9. Deploy MiniApp V2.
10. Verify authentication and critical user journeys.
11. Deploy/update Telegram owner/control functions if included.
12. Execute production E2E.
13. If any critical failure: rollback immediately.
14. If PASS: keep BLUE rollback artifacts intact during stabilization.

## P6 Rollback triggers

Immediate rollback for:
- login failure
- registration failure
- data corruption/loss
- entitlement bypass
- payment amount/status corruption
- document delivery failure on critical path
- 5xx spike / crash loop
- migration incompatibility
- security exposure
- inability to restore known-good operation quickly

Rollback target:
- backup/pre-platform-v2-20261007
- plus exact Railway deployment IDs recorded immediately before cutover.

## P7 Cleanup

Only after stabilization and explicit release evidence:
- archive obsolete old UI
- remove dead routes/components
- remove compatibility adapters
- contract database migrations
- clean unused Railway configuration
- retain audit/legal/accounting records
- update MASTER issue to CLOSED only after production E2E

## Status vocabulary

READY
IN_PROGRESS
BLOCKED
FIXED
VERIFYING
VERIFIED
RELEASE_READY
DEPLOYING
STABILIZING
CLOSED
HOLD
ROLLBACK

## Current decision

Production replacement: HOLD
Preparation: IN_PROGRESS
Reason: Platform V2 is not yet complete and two worker services are not currently healthy.

No production deletion is authorized by this document.
