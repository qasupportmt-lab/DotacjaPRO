# Platform Master Architecture — plan infrastruktury

Status: DESIGN BASELINE
Data: 2026-10-06
Zakres: obecna aplikacja doradcyPRO / przyszła marka po rebrandingu.

## 1. Zasada nadrzędna

Budujemy jedną platformę z wieloma silnikami produktowymi.

Użytkownik loguje się raz.
Ma jeden profil 360.
Każdy produkt korzysta z danych już podanych, ale ma własny engine, QA, dokumenty, commerce i entitlement.

Warstwy:
1. Experience Shell
2. Identity & Profile 360
3. Product Router
4. Product Engines
5. Document / eBook Factory
6. Commerce & Entitlements
7. Partner Hub
8. Market Intelligence
9. Notifications / Telegram
10. Audit / QA / Legal / Tax Gate
11. Social Acquisition
12. Owner Control Tower

## 2. Experience Shell

### 2.1 Wejście

Po zalogowaniu użytkownik widzi oryginalną postać przewodnika:
- muskularna, pewna siebie,
- subtelny wąs,
- fryzura zaczesana na bok,
- elegancki garnitur,
- żadnych elementów kojarzących się bezpośrednio z chronioną postacią Nintendo:
  - brak czerwonej czapki,
  - brak litery M,
  - brak ogrodniczek,
  - inna sylwetka, twarz, kolorystyka i animacja.

Robocza nazwa komponentu: GUIDE.

### 2.2 Intro

GUIDE wyciąga rękę.
Pojawia się:
"Czego potrzebujesz?"

Kategorie pojawiają się sekwencyjnie:
- Dotacje
- Finansowanie firmy
- Leasing
- Kredyty
- Ubezpieczenia
- Nieruchomości
- Dokumenty / formalności
- Inne możliwości wsparcia

Lista jest sterowana z ProductCatalog, nie zakodowana na stałe.

### 2.3 Animacja wyboru

Po wyborze:
- GUIDE pobiera wizualny "moduł/kapsułę" produktu,
- umieszcza go w oryginalnym mechanizmie transportowym,
- kapsuła zostaje wysłana poza ekran,
- transition prowadzi do odpowiedniego Product Engine.

To ma być autorska animacja. Nie kopiujemy rur, dźwięków ani charakterystycznych mechanik z Mario.

### 2.4 Accessibility

- prefers-reduced-motion => brak animacji, natychmiastowe przejście,
- animacja max 1.5–2.5 s,
- nie może blokować nawigacji,
- możliwość Skip,
- pełna obsługa klawiatury,
- aria-labels.

## 3. Profile 360

Rozszerzamy obecny UserProfile + FundingProfile.

Dane wspólne:
- region / TERYT,
- status zawodowy,
- etap firmy,
- forma prawna,
- PKD,
- cel,
- budżet,
- potrzebna kwota,
- planowany zakup/inwestycja,
- dokumenty,
- preferencje kontaktu,
- zgody.

Zasada:
ASK ONCE, REUSE WITH CONSENT.

## 4. Product Router

Input:
- wybrana kategoria,
- Profile 360,
- region,
- dostępne źródła,
- entitlements,
- legal availability.

Output:
- productEngineId,
- requiredInputs,
- availableProducts,
- legalWarnings,
- partnerRoutingAvailable,
- priceBenchmarkAvailable.

Każdy engine jest niezależny.

## 5. Engines

### Grant Engine
Istniejące:
- FundingProgram
- FundingCall
- QualificationSnapshot
- LocalCriterionSet
- OfficialFormTemplate
- FormFieldMapping
- DocumentRenderJob
- DocumentPackageJob

### Financial Partner Engine
Z planu product-expansion-doradcypro-benchmark.md.

### Insurance Router
Informacyjny routing + zweryfikowany partner.
Brak samodzielnego wykonywania regulowanej dystrybucji bez właściwej podstawy/uprawnień.

### Leasing Router
Potrzeba -> parametry -> partnerzy -> przekazanie po zgodzie.

### Credit Router
Analogicznie, ale z regulatory gate.

### Property Router
Potrzeba -> region -> typ transakcji -> partner/referral.

## 6. Product Lifecycle

DISCOVERED
-> CONFIGURED
-> LEGAL_REVIEW
-> TAX_REVIEW
-> QA
-> ACTIVE
-> SUSPENDED / RETIRED.

Żaden produkt nie może zostać ACTIVE, jeśli:
- brak klasyfikacji świadczenia,
- brak ceny,
- brak regulaminu,
- brak tax classification,
- brak privacy mapping,
- brak delivery definition.

## 7. Output model

Każdy zakup ma jasno określony Output Contract.

Przykład DOTACJA:
- personalized report,
- qualification evidence,
- risk analysis,
- checklist,
- draft/final official forms,
- submission instructions,
- eBook/report PDF,
- optional access entitlement.

Przykład LEASING:
- needs report,
- comparison framework,
- partner routing record,
- eBook/report PDF,
- optional access entitlement.

## 8. Owner Control

Telegram pozostaje owner control plane.

Nowe sekcje:
- Products
- Engines
- Legal Gates
- Tax Gates
- Publishing
- Commerce
- Entitlements
- Partner QA
- Price Intelligence
- Incidents
- CAPA

Owner dostaje raporty, nie wykonuje pracy operacyjnej.
