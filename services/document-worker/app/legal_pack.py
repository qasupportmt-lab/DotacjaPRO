import html
import os
from datetime import datetime, timezone

LEGAL_VERSION = "2026-10-03.1"


def _seller_details() -> dict[str, str]:
    return {
        "name": os.getenv("LEGAL_SELLER_NAME", "Sprzedawca wskazany w potwierdzeniu zakupu"),
        "address": os.getenv("LEGAL_SELLER_ADDRESS", "Adres wskazany w potwierdzeniu zakupu"),
        "email": os.getenv("LEGAL_SELLER_EMAIL", "qasupportmt@gmail.com"),
        "nip": os.getenv("LEGAL_SELLER_NIP", ""),
    }


def legal_pack_text() -> str:
    seller = _seller_details()
    nip_line = f"NIP: {seller['nip']}\n" if seller["nip"] else ""

    return f"""DOTACJAPRO — WARUNKI KORZYSTANIA, LICENCJA, INFORMACJA PRAWNA I RODO
Wersja: {LEGAL_VERSION}

SPRZEDAWCA / ADMINISTRATOR
{seller['name']}
{seller['address']}
{nip_line}Kontakt: {seller['email']}

1. CHARAKTER MATERIAŁÓW
Autorskie komentarze, checklisty, przykłady, wzory, instrukcje i materiały szkoleniowe DotacjaPRO mają charakter informacyjny i edukacyjny. Nie stanowią indywidualnej porady prawnej, podatkowej, księgowej, inwestycyjnej ani decyzji organu administracji.

Urzędowe formularze dołączone do pakietu mogą służyć do przygotowania własnej sprawy użytkownika, o ile są aktualne dla właściwego naboru. Przed złożeniem dokumentów użytkownik powinien zweryfikować aktualne ogłoszenie, termin, załączniki, podpisy i wymogi właściwej instytucji.

DotacjaPRO nie jest urzędem i nie działa w imieniu PUP, WUP, LGD, PARP, instytucji funduszy europejskich ani innego organu publicznego, chyba że w danym przypadku wyraźnie wskazano inaczej.

2. BRAK GWARANCJI WYNIKU
DotacjaPRO wspiera przygotowanie dokumentacji, lecz nie gwarantuje uzyskania dotacji, finansowania, określonej liczby punktów, przyjęcia dokumentów ani pozytywnego rozstrzygnięcia. Ostateczna ocena należy do właściwej instytucji.

Użytkownik odpowiada za prawdziwość, kompletność i aktualność przekazanych przez siebie danych oraz za ostateczną decyzję o złożeniu dokumentów.

3. LICENCJA
Nabycie materiału nie przenosi autorskich praw majątkowych. Użytkownik otrzymuje niewyłączną, niezbywalną licencję do korzystania z autorskich materiałów DotacjaPRO na własne potrzeby albo wewnętrzne potrzeby swojej organizacji, w zakresie niezbędnym do korzystania z zakupionego produktu i prowadzenia własnej sprawy.

Licencja dotyczy wyłącznie elementów, do których Sprzedawcy lub jego licencjodawcom przysługują prawa. Nie obejmuje urzędowych dokumentów, materiałów, znaków lub innych elementów, które z mocy prawa nie stanowią przedmiotu prawa autorskiego albo należą do osób trzecich.

Bez odrębnej pisemnej zgody zabronione jest w szczególności:
- odsprzedawanie, sublicencjonowanie lub odpłatne udostępnianie materiałów;
- publiczne rozpowszechnianie całości lub istotnych części materiałów;
- publikowanie materiałów w repozytoriach, grupach, serwisach plikowych lub bazach wzorów;
- tworzenie na ich podstawie konkurencyjnej biblioteki, produktu lub płatnego pakietu;
- usuwanie oznaczeń autorstwa, źródła, numeru wersji lub zabezpieczeń;
- przedstawianie materiałów jako oficjalnie zatwierdzonych przez urząd, jeżeli takiego zatwierdzenia nie ma.

Powyższe ograniczenia nie naruszają bezwzględnie obowiązujących przepisów, w tym dozwolonego użytku i prawa cytatu, jeżeli mają zastosowanie.

4. NIEDOZWOLONE SPOSOBY UŻYCIA
Materiałów nie wolno wykorzystywać do działań bezprawnych, wprowadzania innych osób lub organów w błąd, podszywania się pod instytucje, składania nieprawdziwych oświadczeń, naruszania praw osób trzecich ani bezprawnych działań celowo nakierowanych na wyrządzenie szkody DotacjaPRO, Sprzedawcy lub osobom trzecim.

Postanowienie to nie ogranicza prawa użytkownika do składania reklamacji, zawiadomień, skarg, dochodzenia roszczeń, zgłaszania naruszeń ani wyrażania zgodnych z prawem opinii i krytyki.

5. ODPOWIEDZIALNOŚĆ
W granicach dopuszczalnych przez prawo Sprzedawca nie odpowiada za skutki:
- wykorzystania materiałów niezgodnie z ich przeznaczeniem lub instrukcjami;
- podania przez użytkownika nieprawdziwych, niepełnych lub nieaktualnych danych;
- zmian prawa, regulaminu naboru, formularza lub praktyki instytucji po dacie weryfikacji materiału;
- decyzji, oceny lub działania właściwej instytucji pozostających poza kontrolą Sprzedawcy;
- samodzielnych modyfikacji materiałów przez użytkownika.

Żadne postanowienie nie wyłącza ani nie ogranicza odpowiedzialności, której nie można skutecznie wyłączyć na podstawie bezwzględnie obowiązującego prawa, ani ustawowych praw konsumenta dotyczących zgodności treści lub usługi cyfrowej z umową.

6. KONSUMENT I TREŚCI CYFROWE
Jeżeli zakup jest dokonywany przez konsumenta na odległość, stosuje się ustawowe prawa konsumenta. Natychmiastowe dostarczenie odpłatnej treści cyfrowej przed upływem terminu do odstąpienia wymaga odrębnej, uprzedniej i wyraźnej zgody konsumenta oraz przyjęcia przez niego do wiadomości skutku przewidzianego prawem. Potwierdzenie zawarcia umowy i tych oświadczeń powinno zostać przekazane na trwałym nośniku.

7. DANE OSOBOWE — INFORMACJA OGÓLNA
Dane osobowe są przetwarzane wyłącznie w zakresie niezbędnym do:
- założenia i obsługi konta;
- wykonania umowy, przygotowania dokumentów i obsługi płatności;
- dostarczenia zakupionych treści i komunikacji dotyczącej sprawy;
- spełnienia obowiązków prawnych, księgowych i podatkowych;
- zapewnienia bezpieczeństwa, przeciwdziałania nadużyciom i dochodzenia lub obrony roszczeń;
- marketingu wyłącznie wtedy, gdy istnieje odpowiednia podstawa prawna.

Podstawą przetwarzania może być w szczególności wykonanie umowy, obowiązek prawny, prawnie uzasadniony interes administratora albo zgoda — zależnie od celu. Zgoda marketingowa nie jest warunkiem zakupu.

Dane nie powinny być przechowywane dłużej niż jest to konieczne dla danego celu, z uwzględnieniem obowiązków prawnych i okresów przedawnienia roszczeń.

Dane mogą być powierzane dostawcom infrastruktury IT, hostingu, bazy danych, poczty elektronicznej, płatności oraz innym podmiotom wspierającym realizację usługi na podstawie odpowiednich umów i zabezpieczeń.

Osobie, której dane dotyczą, przysługują — stosownie do podstawy i okoliczności przetwarzania — prawa dostępu, sprostowania, usunięcia, ograniczenia, przenoszenia danych, sprzeciwu oraz cofnięcia zgody. Przysługuje także prawo wniesienia skargi do Prezesa Urzędu Ochrony Danych Osobowych.

Pełna Polityka prywatności dostępna jest w aplikacji DotacjaPRO i stanowi nadrzędne źródło informacji o przetwarzaniu danych.

8. WERSJA I INTEGRALNOŚĆ
Ten plik jest dołączany do paczki w celu wskazania warunków obowiązujących dla otrzymanego materiału. Wersja dokumentu: {LEGAL_VERSION}.
Data wygenerowania kopii: {datetime.now(timezone.utc).isoformat()}.

W przypadku sprzeczności z bezwzględnie obowiązującym prawem pierwszeństwo mają przepisy prawa.
"""


def legal_pack_html() -> str:
    text = legal_pack_text()
    return """<!doctype html>
<html lang="pl">
<head>
<meta charset="utf-8">
<title>DotacjaPRO — warunki korzystania, licencja i RODO</title>
<style>
body{font-family:Arial,sans-serif;max-width:900px;margin:40px auto;padding:0 24px;line-height:1.55;color:#111}
h1{font-size:24px}
pre{white-space:pre-wrap;font-family:Arial,sans-serif}
.footer{margin-top:36px;font-size:12px;color:#555}
</style>
</head>
<body>
<h1>DotacjaPRO — warunki korzystania, licencja i RODO</h1>
<pre>""" + html.escape(text) + """</pre>
<div class="footer">Dokument stanowi integralną informację dołączaną do pakietu DotacjaPRO.</div>
</body></html>"""
