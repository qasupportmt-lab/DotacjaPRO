# DoradcaPRO Instagram Growth & Control System

## Cel
Zbudować dwukanałowy system marketingowy dla DoradcaPRO:
- konto PL — rynek polski,
- konto EN — rynek międzynarodowy / anglojęzyczny,
sterowany z prywatnego panelu właściciela w Telegramie.

## Założenia zgodności
System korzysta wyłącznie z oficjalnych funkcji Meta/Instagram API.
Nie realizuje:
- masowych, niezamówionych DM,
- automatycznego follow/unfollow,
- identyfikacji anonimowych odwiedzających profil,
- sztucznego pompowania polubień/obserwujących,
- powtarzalnego spamu komentarzami.

## Możliwości docelowe
1. Publikacja postów, karuzel i Reels.
2. Harmonogram roczny i kolejka treści.
3. Monitoring komentarzy, odpowiedzi i moderacja.
4. Odpowiadanie na wiadomości po rozpoczęciu rozmowy przez użytkownika.
5. Automatyczne CTA do DoradcaPRO po kwalifikującym zdarzeniu użytkownika.
6. Insights: reach, views, watch time, saves, shares, comments, follows i CTR.
7. Dzienny przegląd strategii i rekomendacje zmian.
8. Alerty ryzyka, błędów publikacji i spadków wyników.
9. Panel Telegram do zatwierdzania, pauzowania i sterowania kampaniami.

## Tryby sterowania
- SAFE_AUTO: automatyczna publikacja treści zatwierdzonych przez strategię i reguły.
- REVIEW_FIRST: bot przygotowuje materiał i czeka na zatwierdzenie w Telegramie.
- MANUAL_ONLY: bot tylko analizuje i proponuje.
- PAUSE: zatrzymanie wszystkich publikacji i odpowiedzi.

## Telegram Control Plane
Docelowe komendy:
- /ig_status — stan obu kont, tokenów, webhooków i błędów
- /ig_plan — plan na dziś / tydzień / miesiąc
- /ig_queue — kolejka postów i Reels
- /ig_approve — zatwierdzenie materiału
- /ig_pause — pauza automatyzacji
- /ig_resume — wznowienie
- /ig_metrics — KPI obu kont
- /ig_daily — dzienny raport strategii
- /ig_comments — komentarze wymagające reakcji
- /ig_inbox — rozmowy wymagające odpowiedzi
- /ig_experiments — aktywne testy A/B
- /ig_account_pl — widok konta PL
- /ig_account_en — widok konta EN

## Silnik strategii
Codziennie:
1. pobierz wyniki z poprzednich 24 h,
2. oceń każdy materiał względem mediany konta,
3. wykryj zwycięskie tematy, hooki, CTA i długości,
4. sprawdź komentarze, pytania i intencje zakupowe,
5. aktualizuj scoring tematów,
6. nie zmieniaj całej strategii po jednym wyniku,
7. zaproponuj maksymalnie 1-3 korekty dziennie,
8. zapisz decyzję i jej późniejszy wynik.

Co tydzień:
- analiza cohort / format / temat / hook / CTA,
- przesunięcie udziału formatów o maks. 20 pp,
- wybór 2-3 eksperymentów na kolejny tydzień.

Co miesiąc:
- pełny przegląd funnelu: reach -> profile visit -> follow -> conversation -> click -> registration,
- decyzja KEEP / SCALE / MODIFY / STOP dla serii treści.

## Główne KPI
North Star:
- kwalifikowane wejścia do DoradcaPRO z Instagrama.

Wspierające:
- non-follower reach,
- Reel retention / watch time,
- shares per reach,
- saves per reach,
- comments per reach,
- follows from content,
- profile actions,
- inbound conversations,
- link clicks,
- registrations attributed to Instagram,
- conversion rate PL i EN osobno.

## Zasada treści
PL i EN nie są mechanicznym tłumaczeniem 1:1.
Każde konto ma własne:
- przykłady,
- problemy użytkownika,
- CTA,
- kalendarz,
- słownictwo,
- lokalne programy / źródła / przepisy.

## Etapy wdrożenia
P0 — Meta app + dwa Professional Instagram accounts + OAuth + webhook.
P1 — publishing, queue, Telegram control.
P2 — comments, messaging, moderation.
P3 — insights + daily strategy engine.
P4 — experimentation + attribution.
P5 — controlled engagement actions supported by current official Meta API.


## Zweryfikowana korekta strategii — 2026-10-05

### Konto PL
Rynek: Polska.
Główne segmenty:
- osoby bezrobotne planujące JDG,
- osoby szukające PUP / Funduszu Pracy / Funduszy Europejskich,
- osoby porównujące dostępne ścieżki finansowania,
- użytkownicy potrzebujący pomocy z formularzami i dokumentami.

### Konto EN
Nie kierować szeroko do całego świata, dopóki produkt pozostaje skoncentrowany na polskich programach.
Rynek:
- foreigners / expats planning a business in Poland,
- English-speaking residents of Poland,
- returning diaspora,
- people looking for Polish startup grants and official funding procedures in English.

### Oficjalnie wspierana automatyzacja Meta
- publikacja postów, video, karuzel i Reels,
- Stories tylko tam, gdzie wspiera je aktualny typ konta/API,
- pobieranie insights,
- odczyt i moderacja komentarzy,
- publiczne odpowiedzi na komentarze,
- private reply do autora komentarza w dozwolonym oknie,
- obsługa DM po rozpoczęciu interakcji przez użytkownika,
- webhooki komentarzy i wiadomości.

### Czego system nie robi
- nie identyfikuje anonimowych odwiedzających profil,
- nie wysyła masowych DM do osób, które tylko odwiedziły profil,
- nie wykonuje automatycznego follow/unfollow,
- nie wykonuje masowego automatycznego lajkowania,
- nie stosuje fake engagement.

### Funnel rekomendowany
REEL/POST
-> CTA: skomentuj HASŁO / wyślij DM
-> webhook
-> publiczna odpowiedź + opcjonalny private reply
-> link z UTM do DoradcaPRO
-> rejestracja
-> kwalifikacja
-> pomiar konwersji.

### Roczny model pracy
Q1: walidacja problem-market-content fit i podstawowego funnelu.
Q2: skalowanie zwycięskich serii i SEO/social search.
Q3: autorytet, case studies, partnerstwa i evergreen library.
Q4: konwersja, retargeting, sezonowość i optymalizacja całego lejka.

### Minimalna kadencja początkowa na konto
- 4 Reels / tydzień,
- 2 karuzele / tydzień,
- 3-5 Stories / dzień,
- 1 post dowodowy/case-study / tydzień,
- codzienna obsługa komentarzy i kwalifikowanych DM,
- codzienny raport strategii,
- tygodniowy eksperyment A/B,
- miesięczny review KEEP / SCALE / MODIFY / STOP.

Kadencja jest adaptacyjna: strategia nie zwiększa częstotliwości, jeśli jakość, retention lub konwersja spadają.
