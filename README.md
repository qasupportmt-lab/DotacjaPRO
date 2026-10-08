# doradcyPRO

Cyfrowy system doradczy dla osób zakładających działalność gospodarczą w Polsce, ze szczególnym naciskiem na osoby bezrobotne ubiegające się o dofinansowanie z PUP oraz środki UE/LGD/PFRON/BGK.

## Zasady nadrzędne

1. **Official Form Only** — system nie tworzy zastępczych formularzy urzędowych. Odpowiedzi użytkownika są mapowane na aktualny, oryginalny dokument pobrany z oficjalnego źródła.
2. **Source + Version + Hash** — każdy dokument urzędowy ma źródło, wersję, datę i SHA-256.
3. **Legal Snapshot** — każda sprawa użytkownika przechowuje wersję prawa, formularza i reguł wykorzystanych przy przygotowaniu dokumentów.
4. **Regional Routing** — użytkownik jest przypisywany do województwa, powiatu, gminy, PUP, WUP, LGD i odpowiednich programów.
5. **Daily Update Engine** — źródła są skanowane rano i wieczorem; użytkownik otrzymuje krótki, spersonalizowany poranny digest oraz pilne alerty.
6. **Privacy by Design** — Telegram służy do komunikacji, a poufna dokumentacja jest przechowywana i prezentowana w zabezpieczonej Mini App.

## Monorepo

- `apps/miniapp` — Telegram Mini App / portal użytkownika (Next.js)
- `apps/api` — API, auth, sprawy, routing regionalny, płatności, uprawnienia
- `apps/bot` — @DotacjaPRO_bot
- `services/document-worker` — wypełnianie oryginalnych PDF/DOCX/XLSX i składanie pakietów
- `services/update-engine` — monitoring prawa, PUP, WUP, FE, PARP, BGK, PFRON, ARiMR, LGD
- `packages/db` — schemat bazy danych
- `packages/rules` — eligibility/routing/rule engine
- `packages/shared` — wspólne typy i kontrakty
- `docs` — architektura, polityki i decyzje projektowe
- `infra` — lokalne usługi infrastrukturalne

## Status

Repozytorium startowe. Kolejny etap: połączenie Telegram Bot API, PostgreSQL, Redis, storage S3 oraz pierwszy regionalny adapter PUP.
