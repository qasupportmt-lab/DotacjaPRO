# GUIDE Experience — UX / animation specification

Status: DESIGN
Data: 2026-10-06

## 1. Cel

Stworzyć charakterystyczne, zapamiętywalne wejście do platformy bez kopiowania cudzej postaci, animacji ani trade dress.

## 2. Postać

Roboczo: GUIDE.

Cechy:
- dorosły mężczyzna,
- atletyczna sylwetka,
- lekki wąs,
- fryzura typu side part,
- nowoczesny, dobrze skrojony garnitur,
- eleganckie buty,
- neutralna / przyszła kolorystyka marki.

Zakazane podobieństwa:
- Mario face proportions,
- red cap,
- M symbol,
- blue overalls,
- gloves + plumber silhouette,
- green pipes,
- coin/block sounds,
- recognisable Nintendo poses.

## 3. Scene 1 — Welcome

Tło minimalistyczne.
GUIDE wchodzi lub już stoi.
Micro-motion 0.5–1.0 s.
Tekst:
"Czego potrzebujesz?"

## 4. Scene 2 — Product reveal

Kategorie pojawiają się jedna po drugiej z lewej/prawej.
Max 6–8 głównych kategorii.
Pozostałe pod "Więcej".

GUIDE reaguje na hover/tap subtelnym ruchem ręki.

## 5. Scene 3 — Selection

Po tap:
- selected card staje się fizyczną "kapsułą sprawy",
- GUIDE przechwytuje ją,
- kapsuła dostaje label produktu,
- wkładana jest do autorskiej stacji transferowej.

## 6. Scene 4 — Transfer

Stacja transferowa:
- nie jest rurą w stylu Mario,
- może wyglądać jak futurystyczny cylinder / pneumatyczny dispatch tube / portal świetlny,
- zamknięcie,
- krótki pulse,
- kapsuła znika poza viewportem.

## 7. Scene 5 — Product Engine

Transition kończy się w engine:
np. DOTACJE:
"Sprawdźmy, jakie wsparcie jest dla Ciebie dostępne."

Engine pobiera Profile 360 i zadaje wyłącznie brakujące pytania.

## 8. Motion safety

- reduced motion,
- skip intro,
- no flashing,
- animations < 3 s,
- first meaningful UI immediately available,
- performance target 60fps,
- assets lazy-loaded after auth shell.

## 9. Technical recommendation

Next.js shell.
Animations:
- CSS transform/opacity first,
- lightweight vector/Rive/Lottie only if bundle budget allows,
- Three.js only if real 3D adds measurable conversion value.

State machine:
WELCOME
-> REVEAL
-> SELECTING
-> TRANSFER
-> ENGINE_LOADING
-> ENGINE_ACTIVE.

No animation state can mutate business data.
