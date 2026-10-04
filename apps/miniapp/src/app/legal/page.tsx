const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';

type LegalPayload = {
  version: string;
  sha256: string;
  statements: Record<string, string>;
  operatorType: string;
  representativeRequired: boolean;
  representative: {
    name: string | null;
    email: string | null;
  };
  taxClassificationConfirmed: boolean;
  nipRequired: boolean;
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

function operatorLabel(operatorType?: string) {
  if (operatorType === 'UNREGISTERED_ACTIVITY') {
    return 'Osoba fizyczna — działalność nierejestrowana';
  }
  return operatorType ?? 'Model operatora nie został skonfigurowany';
}

function blockedReasonLabel(reason: string | null | undefined) {
  const labels: Record<string, string> = {
    LEGAL_SELLER_IDENTITY_INCOMPLETE:
      'Brakuje kompletnych danych sprzedawcy / administratora.',
    LEGAL_REPRESENTATIVE_REQUIRED:
      'Wymagane są dane przedstawiciela ustawowego.',
    LEGAL_TAX_CLASSIFICATION_UNCONFIRMED:
      'Klasyfikacja podatkowa i VAT dla odpłatnych produktów nie została jeszcze potwierdzona.'
  };
  return reason ? (labels[reason] ?? reason) : null;
}

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

  const brand = 'DoradcaPRO';
  const contact = legal?.seller?.email ?? 'qasupportmt@gmail.com';
  const blockedReason = blockedReasonLabel(legal?.checkoutBlockedReason);

  return (
    <main className="shell">
      <section className="brand">
        <div className="eyebrow">DORADCAPRO</div>
        <h1>Regulamin, licencja i RODO</h1>
        <p>Aktualne informacje prawne dotyczące korzystania z DoradcaPRO.</p>
      </section>

      <section className="card legal-page">
        <h2>Marka / usługa</h2>
        <p><strong>{brand}</strong></p>
        <p>Kontakt: <a className="source-link" href={`mailto:${contact}`}>{contact}</a></p>

        <h2>Sprzedawca / administrator</h2>
        <p><strong>{operatorLabel(legal?.operatorType)}</strong></p>
        {legal?.seller?.name && <p>{legal.seller.name}</p>}
        {legal?.seller?.address && <p>{legal.seller.address}</p>}
        {legal?.seller?.nip && <p>NIP: {legal.seller.nip}</p>}
        {legal?.operatorType === 'UNREGISTERED_ACTIVITY' && !legal?.seller?.nip && (
          <p>
            Sam status działalności nierejestrowanej nie powoduje automatycznie
            obowiązku posiadania NIP. NIP może być wymagany w szczególnych
            sytuacjach podatkowych, w tym związanych z VAT, kasą rejestrującą
            lub KSeF.
          </p>
        )}

        {legal?.representativeRequired && (
          <>
            <h2>Przedstawiciel ustawowy</h2>
            {legal.representative?.name ? (
              <>
                <p><strong>{legal.representative.name}</strong></p>
                {legal.representative.email && <p>{legal.representative.email}</p>}
              </>
            ) : (
              <p>Dane przedstawiciela ustawowego wymagają uzupełnienia przed sprzedażą.</p>
            )}
          </>
        )}

        {!legal?.checkoutAllowed && (
          <div className="legal-warning">
            <strong>Sprzedaż płatna nie jest jeszcze aktywna.</strong>
            <p>
              {blockedReason ??
                'Wymagane warunki prawne i podatkowe muszą zostać potwierdzone przed uruchomieniem checkoutu.'}
            </p>
          </div>
        )}

        <h2>Charakter materiałów</h2>
        <p>
          Autorskie komentarze, checklisty, instrukcje, przykłady i materiały
          szkoleniowe DoradcaPRO mają charakter informacyjny i edukacyjny.
          Oficjalne formularze urzędowe mogą służyć do przygotowania własnej
          sprawy po sprawdzeniu aktualności właściwego naboru.
        </p>

        <h2>Licencja</h2>
        <p>
          Zakup nie przenosi autorskich praw majątkowych do autorskich materiałów
          DoradcaPRO. Bez odrębnej zgody zabroniona jest ich odsprzedaż,
          sublicencjonowanie, publiczne rozpowszechnianie i tworzenie na ich
          podstawie konkurencyjnej biblioteki lub produktu, z zachowaniem
          wyjątków wynikających z bezwzględnie obowiązującego prawa.
        </p>

        <h2>Brak gwarancji wyniku</h2>
        <p>
          DoradcaPRO nie gwarantuje przyznania dotacji, określonej punktacji ani
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

        <a className="source-link" href="/">← Wróć do DoradcaPRO</a>
      </section>
    </main>
  );
}
