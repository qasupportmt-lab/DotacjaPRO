# DoradcaPRO Social Master — Polska / Instagram + TikTok

## Mandat
Jeden system marketingowy DoradcaPRO dla rynku polskiego.
Kanały:
- Instagram: 1 konto marki DoradcaPRO PL
- TikTok: 1 konto marki DoradcaPRO PL

Nie tworzymy duplikatów kont tej samej marki bez odrębnej funkcji biznesowej.

## Cel nadrzędny
Maksymalizować liczbę kwalifikowanych użytkowników z Polski, którzy:
1. trafiają do DoradcaPRO,
2. zakładają konto,
3. rozpoczynają kwalifikację,
4. kończą ścieżkę dopasowania finansowania,
5. przechodzą do właściwego produktu/usługi.

Followers, views i likes są wskaźnikami pomocniczymi, nie celem.

# ORGANIZACJA

## 0. MASTER SOCIAL DIRECTOR
Jedyny punkt decyzyjny.
Odpowiada za:
- roczny plan,
- priorytety,
- budżet treści,
- reguły automatyzacji,
- alokację formatów Instagram/TikTok,
- decyzje SCALE / KEEP / MODIFY / STOP,
- dzienny raport właściciela.

Nie generuje wszystkiego sam. Deleguje zadania workerom.

## 1. INTELLIGENCE DEPARTMENT

### 1.1 Poland Audience Intelligence Worker
Monitoruje:
- zachowania odbiorców w Polsce,
- pytania i problemy z komentarzy/DM,
- sezonowość,
- regiony i miasta,
- źródła ruchu,
- profile odbiorców.

### 1.2 Trend Scout — Instagram PL
Monitoruje:
- formaty i hooki,
- tematy,
- Reels,
- komentarze,
- retention,
- saves/shares,
- sygnały rekomendacyjne.

### 1.3 Trend Scout — TikTok PL
Monitoruje:
- Creative Center Polska,
- trendy/hashtagi,
- formaty,
- długość,
- watch behavior,
- popularność regionalną i branżową.

### 1.4 Funding Opportunity Worker
Łączy marketing z rdzeniem DoradcaPRO.
Nowy zweryfikowany nabór / zmiana programu / termin:
-> candidate content event
-> weryfikacja
-> content pipeline.

### 1.5 Competitor & Search Intent Worker
Analizuje publiczne treści konkurencji i pytania użytkowników.
Nie kopiuje treści; identyfikuje luki informacyjne i intencje.

# 2. STRATEGY DEPARTMENT

## 2.1 Annual Planner
Utrzymuje roadmapę 12 miesięcy.

## 2.2 Weekly Strategist
Raz w tygodniu:
- analizuje wyniki,
- wybiera eksperymenty,
- przesuwa udział formatów,
- zamyka nieskuteczne serie.

## 2.3 Daily Strategy Controller
Minimum raz na dobę.
Może zmienić maksymalnie 1-3 zmienne strategiczne dziennie.
Nie przebudowuje strategii po jednym słabym materiale.

## 2.4 Experiment Designer
Projektuje kontrolowane testy:
- hook,
- długość,
- CTA,
- cover,
- pora publikacji,
- typ historii,
- język nagłówka,
- wariant montażu.

# 3. CONTENT FACTORY

## 3.1 Topic Planner
Tworzy kolejkę tematów z priorytetem biznesowym.

## 3.2 Fact & Source Researcher
Każdy materiał dotyczący:
- dotacji,
- PUP,
- warunków,
- kwot,
- terminów,
- dokumentów
musi mieć aktualne źródło DoradcaPRO.

## 3.3 Script Writer
Tworzy skrypt bazowy.

## 3.4 Instagram Adapter
Przerabia pomysł na format natywny IG:
- Reel,
- carousel,
- post,
- Story.

## 3.5 TikTok Adapter
Przerabia ten sam insight na natywny TikTok.
Nie publikuje mechanicznej kopii 1:1.

## 3.6 Creative Producer
Buduje:
- video,
- napisy,
- okładkę,
- grafikę,
- CTA,
- warianty.

## 3.7 Caption / SEO Worker
Polskie słowa kluczowe, opis, hashtag strategy, CTA.

# 4. QUALITY ASSURANCE

Każdy materiał przechodzi bramki.

## Gate A — Factual QA
Czy informacje są zgodne ze zweryfikowanymi źródłami?

## Gate B — Legal / Claims QA
Czy materiał:
- nie obiecuje otrzymania dotacji,
- nie przedstawia szacunku jako gwarancji,
- nie wprowadza w błąd,
- ma właściwy disclaimer, gdy potrzebny?

## Gate C — Brand QA
Czy jest zgodny z DoradcaPRO?

## Gate D — Platform QA
Czy format jest prawidłowy dla IG/TikTok?
Czy media spełniają wymagania techniczne?

## Gate E — Conversion QA
Czy CTA prowadzi do właściwej ścieżki produktu?
Czy UTM / attribution są poprawne?

## Gate F — Duplication / Fatigue QA
Czy nie publikujemy zbyt podobnych treści?

## QA RELEASE
Dopiero PASS wszystkich wymaganych gate:
DRAFT -> QA -> APPROVED -> SCHEDULED -> PUBLISHED.

FAIL:
DRAFT -> QA_FAIL -> REWORK -> QA.

# 5. PUBLISHING DEPARTMENT

## Recommended execution layer
Master Bot -> Metricool API -> Instagram/TikTok.

Powody:
- jeden scheduler dla obu platform,
- autoPublish,
- API do tworzenia/edycji/usuwania publikacji,
- approval workflow,
- analytics,
- inbox,
- best posting times,
- mniejsza zależność od różnic w natywnych API.

Fallback:
- bezpośrednie Meta Instagram API,
- TikTok Content Posting API / Upload API.

# 6. COMMUNITY / LEAD OPERATIONS

## Comment Classifier
Klasy:
- LEAD
- QUESTION
- SUPPORT
- COMPLAINT
- SPAM
- LEGAL_RISK
- OTHER

## Reply Worker
Automatyczne odpowiedzi tylko dla bezpiecznych klas.

## Lead Router
Intencja -> właściwy link DoradcaPRO + UTM.

## Escalation Worker
Ryzykowne / niejednoznaczne przypadki:
-> nie publikuje odpowiedzi
-> raport/exception queue.

# 7. ANALYTICS & LEARNING

## Attribution Worker
Łączy:
platform
-> content_id
-> click
-> registration
-> qualification
-> conversion.

## Performance Analyst
Per post:
- views/reach,
- retention/watch time,
- shares,
- saves,
- comments,
- profile actions,
- clicks,
- registrations,
- qualification starts,
- downstream conversion.

## Strategy Evaluator
Decyzje:
KEEP / SCALE / MODIFY / STOP.

## Memory Worker
Zapisuje:
- hipotezę,
- zmianę,
- datę,
- wynik,
- wniosek.
Zapobiega powtarzaniu przegranych eksperymentów.

# 8. CONTROL & SAFETY

## Watchdog
Monitoruje:
- błędy API,
- tokeny,
- rate limits,
- failed publish,
- duplicate publish,
- utratę webhooka,
- brak danych,
- spike negatywnych komentarzy.

## Kill Switch
Telegram:
- PAUSE ALL
- PAUSE IG
- PAUSE TIKTOK
- PAUSE REPLIES
- RESUME

# 9. TELEGRAM OWNER REPORTING

Właściciel standardowo otrzymuje raporty, nie zadania.

Dzienny raport:
- co opublikowano,
- wyniki 24h,
- leady/rejestracje,
- problemy,
- zmiany strategii,
- plan na jutro.

Tygodniowy raport:
- ranking serii,
- funnel,
- eksperymenty,
- decyzje SCALE/STOP,
- plan kolejnego tygodnia.

Miesięczny:
- wzrost,
- koszt/efektywność jeśli płatne media,
- wpływ IG vs TikTok,
- konwersja,
- korekta planu kwartalnego.

Właściciel angażowany tylko dla:
- jednorazowej autoryzacji kont,
- spraw prawnych/ryzyka,
- krytycznych blockerów,
- decyzji finansowych/budżetowych,
- działań, których platforma wymaga od właściciela konta.

# 10. CZĘSTOTLIWOŚĆ ZMIENNYCH

## Ciągła / event-driven
- komentarze / DM / support,
- publikacja i status,
- API/webhook failures,
- nowy nabór lub zmiana terminu,
- kryzys / negatywny spike.

## 1h–6h po publikacji
- early velocity,
- view/watch behavior,
- komentarze,
- shares/saves,
- błędy dystrybucji.

## 24h
- główny daily strategy review,
- CTR,
- registrations,
- quality of leads,
- content score.

## 72h
- wstępna decyzja o re-use / sequel / stop.
Nie zamyka TikTok content zbyt wcześnie.

## 7–10 dni
- pełniejsza ocena TikTok organic lifecycle,
- tygodniowy strategy review.

## 30 dni
- segmenty odbiorców,
- format mix,
- funnel,
- content pillars,
- najlepsze okna publikacji.

## 90 dni
- strategiczny review kwartału,
- repositioning,
- plan kolejnego Q.

Platformy nie publikują stałego harmonogramu zmian algorytmów.
System opiera się na danych z własnych kont i oficjalnych źródłach platform.

# 11. POLAND GEO RULES

Każdy materiał:
- język polski,
- polskie źródła,
- polskie CTA,
- Europe/Warsaw,
- kontekst prawny i finansowy PL.

System preferuje tematy:
- ogólnopolskie,
- wojewódzkie,
- PUP lokalne,
zgodnie z realną dostępnością programów.

TikTok trend research:
- filter region = Poland,
- industry relevant,
- current trend window.

# 12. RELEASE STATES

PLANNING
-> RESEARCHED
-> SCRIPTED
-> CREATIVE_READY
-> FACT_QA
-> LEGAL_QA
-> BRAND_QA
-> PLATFORM_QA
-> CONVERSION_QA
-> APPROVED
-> SCHEDULED
-> PUBLISHED
-> VERIFIED
-> LEARNED

Każde odchylenie:
CAPA_OPEN
-> FIX
-> VERIFY
-> CLOSED.
