# DotacjaPRO — Legal Compliance / Checkout PL

Wersja robocza: 2026-10-03.1

## Zasada nadrzędna

Każdy odpłatny produkt cyfrowy / Edition musi mieć przed zakupem:
1. jednoznaczny opis świadczenia i cenę brutto,
2. widoczny link do Regulaminu, Licencji i Polityki prywatności,
3. obowiązkowe potwierdzenie Regulaminu i Licencji,
4. potwierdzenie zapoznania z Polityką prywatności (nie jako zgoda marketingowa),
5. odrębne oświadczenie dotyczące natychmiastowego dostarczenia treści cyfrowej i skutków dla prawa odstąpienia,
6. przycisk jednoznacznie komunikujący odpłatność, np. „Kupuję i płacę”,
7. utrwalenie wersji dokumentów i czasu akceptacji w AuditEvent,
8. potwierdzenie umowy i oświadczeń na trwałym nośniku,
9. dołączenie Legal Pack do pobranego/otrzymanego produktu.

## Wymagane checkboxy przy płatnym produkcie cyfrowym

### A. Regulamin i licencja — obowiązkowe
„Zapoznałem(-am) się z Regulaminem DotacjaPRO i warunkami licencji oraz akceptuję ich postanowienia.”

### B. Polityka prywatności — obowiązkowe potwierdzenie zapoznania
„Potwierdzam zapoznanie się z Polityką prywatności i klauzulą informacyjną RODO.”

To nie jest zgoda marketingowa.

### C. Natychmiastowe dostarczenie treści cyfrowej — odrębne
„Żądam rozpoczęcia dostarczania odpłatnej treści cyfrowej przed upływem terminu do odstąpienia od umowy.”

### D. Przyjęcie do wiadomości skutku — odrębne
„Przyjmuję do wiadomości, że po rozpoczęciu dostarczania treści cyfrowej, po spełnieniu warunków przewidzianych prawem, mogę utracić prawo odstąpienia od umowy.”

### E. Marketing — tylko opcjonalnie
Nie może być zaznaczone domyślnie i nie może być warunkiem zakupu.

## Przycisk finalizujący

Dozwolone przykłady:
- „Kupuję i płacę”
- „Zapłać teraz”
- „Zamówienie z obowiązkiem zapłaty”

Nie używać jako jedynego tekstu:
- „Dalej”
- „Potwierdź”
- „Zamawiam”
- „Załóż konto”

## Ograniczenia odpowiedzialności

Nie stosować absolutnego „nie ponosimy żadnej odpowiedzialności”.

Stosować:
- brak gwarancji uzyskania dotacji / finansowania / konkretnej punktacji,
- brak odpowiedzialności za decyzje instytucji pozostające poza kontrolą Sprzedawcy,
- brak odpowiedzialności za skutki nieprawdziwych lub niepełnych danych użytkownika,
- brak odpowiedzialności za zmiany prawa/naboru/formularza po oznaczonej dacie weryfikacji,
- brak odpowiedzialności za użycie materiału niezgodnie z instrukcją,
- wyraźne zastrzeżenie zachowania ustawowych praw konsumenta i odpowiedzialności, której nie można wyłączyć.

## Licencja

Model: licencja niewyłączna, niezbywalna, bez prawa sublicencji, na własne potrzeby użytkownika lub wewnętrzne potrzeby jego organizacji.

Zakazy:
- odsprzedaż,
- odpłatne udostępnianie,
- publiczne rozpowszechnianie całości lub istotnych części,
- publikacja w repozytoriach/grupach/bazach wzorów,
- budowa konkurencyjnej biblioteki lub produktu,
- usuwanie oznaczeń wersji/autorów,
- przedstawianie jako oficjalnie zatwierdzonego przez urząd bez podstawy.

Zastrzec wyjątki wynikające z bezwzględnie obowiązującego prawa, w tym dozwolonego użytku i prawa cytatu.

## RODO — obowiązkowe elementy pełnej Polityki prywatności

Przed uruchomieniem sprzedaży uzupełnić:
- pełną tożsamość i dane kontaktowe administratora,
- cele i podstawy prawne przetwarzania,
- kategorie odbiorców/podmiotów przetwarzających,
- informacje o transferach poza EOG, jeśli występują,
- okresy retencji lub kryteria ich ustalania,
- prawa osoby, której dane dotyczą,
- prawo skargi do Prezesa UODO,
- informację czy podanie danych jest wymogiem umownym/prawnym,
- informację o zautomatyzowanym podejmowaniu decyzji, jeżeli występuje,
- zasady marketingu i cofania zgody,
- politykę plików cookies/technologii śledzących, jeżeli zostaną wdrożone.

## Dane Sprzedawcy — HARD BLOCKER przed uruchomieniem płatności

W konfiguracji muszą znaleźć się:
- LEGAL_SELLER_NAME
- LEGAL_SELLER_ADDRESS
- LEGAL_SELLER_EMAIL
- LEGAL_SELLER_NIP

Nie wolno uruchomić checkoutu konsumenckiego bez jasnego wskazania strony umowy.

## Dowód akceptacji

API zapisuje w AuditEvent:
- userId,
- LEGAL_VERSION,
- hash zestawu oświadczeń,
- kontekst akceptacji,
- identyfikator zakupu (po dodaniu modułu Order),
- które oświadczenia zostały zaakceptowane,
- czas utworzenia AuditEvent.

Nie zapisujemy IP tylko po to, by „mieć więcej dowodów”, jeśli nie jest to potrzebne.
