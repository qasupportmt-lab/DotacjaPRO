# Architektura doradcyPRO

## Warstwy

1. Telegram Bot — komunikacja, wejście do Mini App, alerty.
2. Mini App — onboarding, region, kwalifikacja, sprawy, dokumenty, płatności.
3. API — auth Telegram, użytkownicy, RBAC, sprawy, formularze, programy.
4. Rule Engine — reguły krajowe, programowe i lokalne.
5. OfficialForm Engine — wyłącznie oficjalne formularze instytucji.
6. Update Engine — monitoring źródeł, hash/diff, wersjonowanie, rekwalifikacja.
7. Notification Engine — segmentacja regionalna i behawioralna.
8. Storage — oryginalne formularze, wersje, dokumenty użytkowników.

## Skanowanie

- 05:00 Europe/Warsaw — skan poranny.
- 07:00 — digest tylko gdy istnieje informacja istotna dla profilu użytkownika.
- 18:00 — skan wieczorny.
- krytyczne zmiany mogą wywołać alert natychmiast.

## Reguła źródła

Źródła klasyfikujemy jako:
- OFFICIAL_PRIMARY — akt prawny, oficjalna strona instytucji, oficjalny formularz,
- OFFICIAL_SECONDARY — oficjalne objaśnienia/FAQ,
- UNVERIFIED — nie może samodzielnie zmienić reguł produkcyjnych.
