const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';

type LegalPayload = {
  version: string;
  sha256: string;
  statements: Record<string, string>;
  seller: {
    brand: string;
    name: string | null;
    address: string | null;
    email: string | null;
    nip: string | null;
  };
  legalIdentityComplete: boolean;
  checkoutAllowed: boolean;
  checkoutBlockedReason: string | null;
};

export const dynamic = 'force-dynamic';

export default async function LegalPage() {
  let legal: LegalPayload | null = null;

  try {
    const response = await fetch(`${API}/v1/legal/current`, {
      cache: 'no-store'
    });
    if (response.ok) {
      legal = await response.json();
    }
  } catch {
    legal = null;
  }

  const brand = legal?.seller?.brand ?? 'DotacjaPRO Bot';
  const contact = legal?.seller?.email ?? 'qasupportmt@gmail.com';

  return (
    <main className="shell">
      <section className="brand">
        <div className="eyebrow">DOTACJAPRO BOT</div>
        <h1>Regulamin, licencja i RODO</h1>
        <p>
          Aktualne informacje prawne dotyczące korzystania z DotacjaPRO.
        </p>
      </section>

      <section className="card legal-page">
        <h2>Marka / usługa</h2>
        <p><strong>{brand}</strong></p>
        <p>Kontakt: <a className="source-link" href={`mailto:${contact}`}>{contact}</a></p>

        {!legal?.legalIdentityComplete && (
          <div className="legal-warning">
            <strong>Sprzedaż płatna nie jest jeszcze aktywna.</strong>
            <p>
              Dane podmiotu prawnego odpowiedzialnego za sprzedaż i administrację
              danymi muszą zostać uzupełnione przed uruchomieniem checkoutu.
            </p>
          </div>
        )}

        <h2>Charakter materiałów</h2>
        <p>
          Autorskie komentarze, checklisty, instrukcje, przykłady i materiały
          szkoleniowe DotacjaPRO mają charakter informacyjny i edukacyjny.
          Oficjalne formularze urzędowe mogą służyć do przygotowania własnej
          sprawy po sprawdzeniu aktualności właściwego naboru.
        </p>

        <h2>Licencja</h2>
        <p>
          Zakup nie przenosi autorskich praw majątkowych do autorskich materiałów
          DotacjaPRO. Bez odrębnej zgody zabroniona jest ich odsprzedaż,
          sublicencjonowanie, publiczne rozpowszechnianie i tworzenie na ich
          podstawie konkurencyjnej biblioteki lub produktu, z zachowaniem
          wyjątków wynikających z bezwzględnie obowiązującego prawa.
        </p>

        <h2>Brak gwarancji wyniku</h2>
        <p>
          DotacjaPRO nie gwarantuje przyznania dotacji, określonej punktacji ani
          pozytywnego rozstrzygnięcia. Ostateczna decyzja należy do właściwej
          instytucji, a użytkownik odpowiada za prawdziwość i kompletność swoich
          danych.
        </p>

        <h2>Dane osobowe</h2>
        <p>
          Dane są przetwarzane wyłącznie w zakresie niezbędnym do obsługi konta,
          realizacji usługi, przygotowania dokumentów, bezpieczeństwa,
          obowiązków prawnych i obsługi roszczeń. Marketing wymaga odrębnej
          podstawy prawnej i nie jest warunkiem korzystania z usługi.
        </p>

        <h2>Akceptacja warunków</h2>
        <p>
          Przy odpłatnej treści cyfrowej akceptacja regulaminu, licencji,
          informacji RODO oraz wymaganych oświadczeń dotyczących natychmiastowego
          dostarczenia treści jest wersjonowana i utrwalana w systemie.
        </p>

        {legal && (
          <p className="legal-version">
            Wersja prawna: {legal.version} · SHA-256: {legal.sha256.slice(0, 16)}…
          </p>
        )}

        <a className="source-link" href="/">← Wróć do DotacjaPRO</a>
      </section>
    </main>
  );
}
