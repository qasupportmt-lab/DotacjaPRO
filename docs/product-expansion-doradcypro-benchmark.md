# Benchmark DoradcyPro -> plan rozszerzenia produktu

Data: 2026-10-06
Status: DESIGN / DO NOT IMPLEMENT WITHOUT RELEASE GATE

## 1. Cel

Rozszerzyć obecną aplikację DoradcaPRO (nazwa robocza do zmiany) z systemu kwalifikacji dotacyjnej o moduł finansowania i usług partnerskich inspirowany zakresem produktowym DoradcyPro, bez kopiowania ich kodu, tekstów, layoutu, danych ani procesów 1:1.

Obecny Grant Engine pozostaje niezależny i oparty na oficjalnych źródłach.

## 2. Zweryfikowane kategorie produktowe DoradcyPro

- ubezpieczenia majątkowe,
- ubezpieczenia komunikacyjne,
- ubezpieczenia grupowe,
- ubezpieczenia indywidualne,
- ubezpieczenia medyczne / abonament medyczny,
- produkty oszczędnościowe i posagowe,
- inwestycje,
- kredyty,
- nieruchomości,
- leasing,
- finansowanie,
- analiza potrzeb klienta i obsługa przez doradcę.

## 3. Zasada regulacyjna

Aplikacja nie może udawać licencjonowanego pośrednika lub doradcy tam, gdzie prawo wymaga uprawnień.

Model docelowy:
- aplikacja zbiera potrzeby,
- wykonuje bezpieczną kwalifikację informacyjną,
- pokazuje kategorie możliwych rozwiązań,
- użytkownik świadomie wybiera przekazanie sprawy,
- dane przekazywane są wyłącznie partnerowi posiadającemu odpowiednie uprawnienia dla danej kategorii,
- decyzje/rekomendacje regulowane pozostają po stronie uprawnionego partnera,
- inwestycje: aplikacja nie generuje spersonalizowanych rekomendacji kupna/sprzedaży produktów inwestycyjnych.

## 4. Architektura logiczna

### 4.1 Grant Engine — bez zmian zakresowych

Istniejące modele pozostają source-of-truth dla dotacji:
- FundingProfile
- FundingProgram
- FundingCall
- Case
- QualificationSnapshot
- LocalCriterionSet
- CriterionAssessmentSnapshot
- OfficialFormTemplate
- FormFieldMapping
- DocumentRenderJob
- DocumentPackageJob

Nie mieszamy do nich kredytów, polis ani leasingu.

### 4.2 Financial Partner Hub — nowy moduł

Nowe modele proponowane:

#### FinancialNeedsProfile
Powiązany 1:1 z User.
Pola:
- customerType: PERSON / SOLE_TRADER / COMPANY
- businessStage
- financingGoal
- requestedAmountRange
- preferredMonthlyBudget
- assetType
- propertyGoal
- insuranceNeeds[]
- financingNeeds[]
- consentToPartnerRouting
- updatedAt

#### FinancialProductCategory
Słownik:
- GRANT
- PREFERENTIAL_LOAN
- BUSINESS_CREDIT
- CONSUMER_CREDIT
- MORTGAGE
- LEASING
- FACTORING
- PROPERTY
- INSURANCE_PROPERTY
- INSURANCE_MOTOR
- INSURANCE_LIFE
- INSURANCE_GROUP
- INSURANCE_HEALTH
- SAVINGS
- INVESTMENT_EDUCATION

#### PartnerInstitution
- legalName
- brandName
- NIP / KRS
- categories[]
- active
- serviceRegions[]
- regulatoryEvidenceJson
- verifiedAt
- verificationStatus
- contact/API configuration reference

#### AdvisorProfile
- partnerInstitutionId
- publicDisplayName
- specialties[]
- regions[]
- availabilityStatus
- verificationStatus
- regulatoryEvidenceRef
- rating/quality metrics generated only from verified service events

#### ConsentRecord
Immutable consent evidence:
- userId
- purpose
- partnerId
- dataScope
- legalTextVersion
- acceptedAt
- revokedAt

Marketing consent nigdy nie jest łączony z consentem wymaganym do realizacji zapytania.

#### FinancialLeadCase
Oddzielny od grantowego Case.
- userId
- category
- status
- needSnapshotJson
- selectedPartnerId
- assignedAdvisorId
- createdAt
- updatedAt

Lifecycle:
NEW -> QUALIFIED -> CONSENT_REQUIRED -> READY_TO_ROUTE -> ROUTED -> ACCEPTED -> CONTACTED -> OFFERED -> USER_DECISION -> CLOSED
or REJECTED / CANCELLED / EXPIRED.

#### PartnerReferral
Audytowalna transmisja sprawy.
- leadCaseId
- partnerId
- consentRecordId
- dataScopeJson
- routedAt
- acknowledgedAt
- status
- providerReference

#### OfferSnapshot
Do przechowywania otrzymanej oferty/parametrów bez udawania niezależnej rekomendacji.
- leadCaseId
- partnerId
- productCategory
- termsJson
- sourceDocumentRef
- validUntil
- receivedAt
- disclosureJson

#### Appointment
- leadCaseId
- advisorId
- startAt
- status
- channel

## 5. Reuse istniejącej infrastruktury

### User / UserProfile
Tożsamość i region użytkownika.

### Notification / NotificationPreference
- termin konsultacji,
- status przekazania,
- oferta gotowa,
- kończąca się ważność oferty/polisy,
- odnowienia — wyłącznie gdy użytkownik wyraził właściwą zgodę.

### AuditEvent
Każda zmiana:
- consent accepted/revoked,
- partner selected,
- lead routed,
- partner response,
- offer received,
- user decision.

### CaseDocument / StoredObject
Można wykorzystać wspólną warstwę storage, ale dokumenty finansowe muszą dostać osobne scope'y dostępu i retencję.

### Telegram owner panel
Nowe widoki:
- /leads
- /partners
- /partner_qa
- /routing_errors
- /consents
- /regulated_hold

## 6. UX

Dashboard użytkownika:

1. Dotacje
2. Finansowanie firmy
3. Leasing
4. Kredyty
5. Ubezpieczenia
6. Nieruchomości
7. Inne formy wsparcia

Elementy regulowane mają wyraźne rozróżnienie:
- "sprawdź możliwości" = etap informacyjny,
- "przekaż do partnera" = świadoma akcja użytkownika.

Nie używać komunikatów "najlepszy kredyt", "najlepsza polisa", "najlepsza inwestycja", jeśli nie ma prawnej i metodologicznej podstawy.

## 7. Wspólny Profil 360

Największa przewaga produktowa ma wynikać z jednego profilu użytkownika.

Profil 360:
- sytuacja zawodowa,
- czy firma już istnieje,
- forma prawna,
- PKD,
- region,
- cel,
- planowana inwestycja,
- potrzeba kapitałowa,
- potrzeby sprzętowe/leasingowe,
- potrzeby ochronne,
- dostępne dotacje.

Rezultat:
- najpierw system sprawdza finansowanie publiczne/bezzwrotne,
- dopiero potem opcjonalne finansowanie zwrotne lub partnerskie,
- użytkownik widzi źródło i charakter każdego rozwiązania.

## 8. Financial Needs Router

Nie jest "doradcą inwestycyjnym".
Jest routerem potrzeb.

Input -> kategoria -> warunki wejściowe -> uprawniony partner.

Przykład:
zakup maszyny
-> dotacje inwestycyjne
-> preferencyjna pożyczka publiczna
-> leasing partnerski
-> kredyt inwestycyjny partnerski

System ma pokazywać różne klasy instrumentów, nie sugerować, że produkt komercyjny jest lepszy niż dotacja.

## 9. Partner QA

Każdy partner przed aktywacją:
DISCOVERED -> DOCUMENTS_COLLECTED -> REGULATORY_CHECK -> CONTRACT_CHECK -> SECURITY_CHECK -> APPROVED -> ACTIVE.

Cyklicznie:
- status rejestracyjny,
- ważność umowy,
- complaints ratio,
- routing failures,
- response SLA,
- conversion,
- opt-out/consent issues.

Każde odchylenie:
CAPA_OPEN -> FIX -> VERIFY -> CLOSED.

## 10. Fazy wdrożenia

### Faza A — Profil 360 + Financial Needs Router
Bez zewnętrznego przekazywania danych.
Cel: zebrać potrzeby i budować mapę instrumentów.

### Faza B — Partner Registry + regulatory verification
Utworzenie PartnerInstitution, AdvisorProfile, ConsentRecord.

### Faza C — Lead Routing
FinancialLeadCase + PartnerReferral + statusy + Telegram Control Tower.

### Faza D — Offers + appointments
OfferSnapshot, Appointment, dokumenty i SLA.

### Faza E — automatyzacja obsługi
Powiadomienia, odnowienia, cross-sell wyłącznie po user-initiated intent i zgodach.

## 11. Release gate

NO-GO dla kategorii regulowanej, jeśli:
- brak zweryfikowanego partnera/uprawnienia,
- brak wersjonowanej zgody,
- brak privacy/data-sharing mapping,
- brak audit trail,
- brak zasady minimalizacji danych,
- brak E2E revoke/withdrawal,
- aplikacja sugeruje regulowaną poradę bez właściwej podstawy.

Grant Engine może działać niezależnie od tego gate'u.
