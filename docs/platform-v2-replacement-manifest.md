# Platform V2 — Replacement Manifest

Status: PREPARED
Branch: release/platform-v2-candidate
Date: 2026-10-07

## Goal

Replace the currently running application experience and application code with Platform V2, while preserving user/business data and maintaining a tested rollback path.

## REPLACE at cutover

### MiniApp / frontend
Replace the current production frontend with the new Platform V2 frontend:
- new authenticated entry shell
- GUIDE experience
- "Czego potrzebujesz?" product router
- Product Catalog-driven UI
- Profile 360-driven flows
- new product engine navigation
- new eBook/access experience
- retained support and owner features re-integrated into V2

The old frontend becomes rollback-only after cutover and is removed only after stabilization.

### API application version
Replace the current API application version with the V2 API build containing:
- Platform routes
- Profile 360
- product catalogue
- access-redemption keys
- new V2 engine interfaces
- existing auth/legal/commerce/support compatibility

### Worker application versions
Replace the worker builds with verified Dockerfile builds:
- update-engine -> deploy/update-engine.Dockerfile
- document-worker -> deploy/document-worker.Dockerfile

### Telegram/control application version
Replace only the application code where V2 owner/control functions require it.
Keep current bot identity, credentials and owner mapping unless explicitly changed by release scope.

## PRESERVE

These must NOT be deleted during replacement:

### User / business data
- User
- UserProfile
- FundingProfile
- NotificationPreference
- Case
- QualificationSnapshot
- LocalCriterionSet / assessments
- FundingProgram / FundingCall
- Source / SourceDocument
- OfficialFormTemplate / FormFieldMapping
- DocumentRenderJob
- CaseDocument
- DocumentPackageJob
- CommerceProduct
- CommerceOrder
- PaymentRecord
- PaymentEvent
- Entitlement
- SaleTransaction
- legal acceptances
- AuditEvent
- Notification
- accounting records

### Infrastructure continuity
Initially preserve:
- Railway project ID
- production environment
- public domains
- service identities where practical
- production environment variables/secrets
- Supabase project and stored production data

This avoids unnecessary DNS, OAuth, webhook and credential breakage.

## REMOVE only after V2 stabilization

Eligible for cleanup only after production E2E + stabilization:
- old frontend components no longer referenced
- old route adapters superseded by V2
- obsolete CSS/UI framing
- unused compatibility layers
- old technical brand strings when the new brand is approved
- obsolete Railway config after confirmed replacement
- old schema fields/tables only through a separate contract migration

## NEVER DELETE AS PART OF CUTOVER

- production user accounts
- documents
- payment/accounting history
- legal/audit evidence
- entitlement history
- source provenance
- database rollback capability
- backup/pre-platform-v2-20261007
- known-good Railway deployment IDs until stabilization closes

## Atomic replacement sequence

1. Complete release/platform-v2-candidate.
2. CI and Docker build verification.
3. Verify non-destructive DB migrations.
4. Verify workers with Dockerfile-based build path.
5. Full E2E on release candidate.
6. Record current production deployment IDs.
7. Freeze release candidate SHA.
8. Deploy DB expand migration.
9. Deploy API V2.
10. Deploy workers V2.
11. Deploy MiniApp V2.
12. Deploy Telegram/control V2 only if included.
13. Run production E2E.
14. If FAIL -> rollback to known-good deployment/code.
15. If PASS -> STABILIZING.
16. After stabilization -> remove old application code and obsolete compatibility assets.
17. Only then run contract cleanup and mark CLOSED.

## Current state

- backup branch: READY
- release candidate branch: CREATED
- cutover runbook: READY
- production deletion: NOT AUTHORIZED
- production cutover: HOLD
- final V2 completion: IN_PROGRESS
