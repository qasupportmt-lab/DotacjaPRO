'use client';

import { useEffect, useMemo, useState } from 'react';

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData: string;
        ready(): void;
        expand(): void;
        requestWriteAccess?(callback?: (granted: boolean) => void): void;
      };
    };
  }
}

const VOIVODESHIPS = [
  'dolnośląskie','kujawsko-pomorskie','lubelskie','lubuskie','łódzkie','małopolskie',
  'mazowieckie','opolskie','podkarpackie','podlaskie','pomorskie','śląskie',
  'świętokrzyskie','warmińsko-mazurskie','wielkopolskie','zachodniopomorskie'
];

type Step = 'welcome' | 'region' | 'email' | 'employment' | 'business' | 'done';

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';

export default function Home() {
  const [step, setStep] = useState<Step>('welcome');
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [region, setRegion] = useState({
    voivodeship: '',
    city: '',
    municipality: '',
    county: '',
    postalCode: ''
  });
  const [regionSuggestions, setRegionSuggestions] = useState<Array<{
    municipality: string | null;
    city: string | null;
    county: string | null;
    pup: { id: string; name: string; officialUrl: string };
  }>>([]);
  const [selectedPupName, setSelectedPupName] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [emailCode, setEmailCode] = useState('');
  const [emailCodeSent, setEmailCodeSent] = useState(false);
  const [employmentStatus, setEmploymentStatus] = useState('UNEMPLOYED_REGISTERED');
  const [description, setDescription] = useState('');

  const authHeaders = useMemo(
    () => token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : undefined,
    [token]
  );

  useEffect(() => {
    const webApp = window.Telegram?.WebApp;
    webApp?.ready();
    webApp?.expand();
  }, []);

  useEffect(() => {
    if (step !== 'region' || !region.voivodeship || region.city.trim().length < 2) {
      setRegionSuggestions([]);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams({
          voivodeship: region.voivodeship,
          q: region.city.trim()
        });
        const res = await fetch(`${API}/v1/regions/search?${params.toString()}`, {
          signal: controller.signal
        });
        if (!res.ok) return;
        const data = await res.json();
        setRegionSuggestions(data.items ?? []);
      } catch {
        // Sugestie są pomocą. Ich brak nie blokuje ręcznego zapisu regionu.
      }
    }, 250);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [step, region.voivodeship, region.city]);

  async function saveTelegramWriteAccess(sessionToken: string, granted: boolean) {
    try {
      await fetch(`${API}/v1/me/notifications`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${sessionToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ telegramWriteAccess: granted })
      });
    } catch {
      // Brak zgody nie blokuje onboardingu.
    }
  }

  async function authenticate() {
    setBusy(true);
    setError(null);
    try {
      const initData = window.Telegram?.WebApp?.initData;
      if (!initData) throw new Error('Otwórz aplikację z poziomu @DotacjaPRO_bot.');

      const res = await fetch(`${API}/v1/auth/telegram`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData })
      });
      if (!res.ok) throw new Error('Nie udało się zalogować przez Telegram.');

      const data = await res.json();
      setToken(data.token);
      setStep('region');

      const requestWriteAccess = window.Telegram?.WebApp?.requestWriteAccess;
      if (requestWriteAccess) {
        requestWriteAccess((granted) => {
          void saveTelegramWriteAccess(data.token, granted);
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Błąd logowania');
    } finally {
      setBusy(false);
    }
  }

  async function saveRegion() {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const body: Record<string,string> = {
        voivodeship: region.voivodeship,
        city: region.city
      };
      if (region.municipality) body.municipality = region.municipality;
      if (region.county) body.county = region.county;
      if (region.postalCode) body.postalCode = region.postalCode;

      const res = await fetch(`${API}/v1/me/region`, {
        method: 'PUT',
        headers: authHeaders,
        body: JSON.stringify(body)
      });
      if (!res.ok) throw new Error('Nie udało się zapisać regionu.');
      setStep('email');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Błąd zapisu');
    } finally {
      setBusy(false);
    }
  }

  async function sendEmailCode() {
    if (!token || !email) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API}/v1/me/email/start`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ email })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data.error === 'EMAIL_ALREADY_IN_USE') throw new Error('Ten adres e-mail jest już przypisany do innego konta.');
        if (data.error === 'EMAIL_DELIVERY_FAILED') throw new Error('Nie udało się wysłać kodu. Spróbuj ponownie za chwilę.');
        throw new Error('Nie udało się wysłać kodu.');
      }
      setEmailCodeSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Błąd wysyłki');
    } finally {
      setBusy(false);
    }
  }

  async function confirmEmailCode() {
    if (!token || !email || emailCode.length !== 6) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API}/v1/me/email/confirm`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ email, code: emailCode })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data.error === 'CODE_EXPIRED') throw new Error('Kod wygasł. Wyślij nowy.');
        if (data.error === 'TOO_MANY_ATTEMPTS') throw new Error('Za dużo prób. Wyślij nowy kod.');
        throw new Error('Kod jest nieprawidłowy.');
      }
      setStep('employment');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Błąd weryfikacji');
    } finally {
      setBusy(false);
    }
  }

  async function saveFundingProfile() {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API}/v1/me/funding-profile`, {
        method: 'PUT',
        headers: authHeaders,
        body: JSON.stringify({
          employmentStatus,
          wantsToStartBusiness: true,
          plannedLegalForm: 'JDG',
          plannedBusinessDescription: description || undefined
        })
      });
      if (!res.ok) throw new Error('Nie udało się zapisać profilu finansowania.');
      setStep('business');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Błąd zapisu');
    } finally {
      setBusy(false);
    }
  }

  async function startCase() {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API}/v1/cases`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ caseType: 'START_BUSINESS' })
      });
      if (!res.ok) throw new Error('Nie udało się utworzyć sprawy.');
      setStep('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Błąd tworzenia sprawy');
    } finally {
      setBusy(false);
    }
  }

  const progressed = {
    welcome: 0,
    region: 1,
    email: 2,
    employment: 3,
    business: 4,
    done: 5
  }[step];

  return (
    <main className="shell">
      <section className="brand">
        <span className="eyebrow">DOTACJAPRO</span>
        <h1>Twoja droga do finansowania firmy</h1>
        <p>Ustalimy Twój region i sytuację, dopasujemy programy, a dokumenty przygotujemy wyłącznie na aktualnych, oficjalnych formularzach.</p>
      </section>

      <section className="card">
        <div className="progress">
          {[1,2,3,4,5].map((n) => <span key={n} className={progressed >= n ? 'active' : ''}></span>)}
        </div>

        {step === 'welcome' && <>
          <h2>Zaczynamy</h2>
          <p>Logowanie odbywa się przez Telegram. Nie tworzysz dodatkowego hasła.</p>
          <button onClick={authenticate} disabled={busy}>{busy ? 'Łączenie…' : 'Rozpocznij'}</button>
        </>}

        {step === 'region' && <>
          <h2>Gdzie mieszkasz?</h2>
          <p>Na tej podstawie przypiszemy właściwy PUP, WUP, LGD oraz programy regionalne.</p>
          <label>Województwo<select value={region.voivodeship} onChange={e => setRegion({...region, voivodeship:e.target.value})}>
            <option value="">Wybierz</option>{VOIVODESHIPS.map(v => <option key={v}>{v}</option>)}
          </select></label>
          <label>Miasto / miejscowość<input value={region.city} onChange={e => {
            setRegion({...region, city:e.target.value});
            setSelectedPupName(null);
          }} placeholder="np. Sosnowiec" /></label>
          {regionSuggestions.length > 0 && <div className="suggestions">
            {regionSuggestions.map((item) => {
              const label = item.municipality ?? item.city ?? '';
              return <button
                type="button"
                className="suggestion"
                key={`${item.pup.id}-${label}`}
                onClick={() => {
                  setRegion({
                    ...region,
                    city: item.city ?? label,
                    municipality: item.municipality ?? label,
                    county: item.county ?? region.county
                  });
                  setSelectedPupName(item.pup.name);
                  setRegionSuggestions([]);
                }}
              >
                <strong>{label}</strong>
                <span>{item.pup.name}</span>
              </button>;
            })}
          </div>}
          {selectedPupName && <p className="verified">✓ Właściwy urząd: {selectedPupName}</p>}
          <label>Gmina <small>opcjonalnie</small><input value={region.municipality} onChange={e => setRegion({...region, municipality:e.target.value})} /></label>
          <label>Powiat <small>opcjonalnie</small><input value={region.county} onChange={e => setRegion({...region, county:e.target.value})} /></label>
          <label>Kod pocztowy <small>opcjonalnie</small><input value={region.postalCode} onChange={e => setRegion({...region, postalCode:e.target.value})} placeholder="00-000" /></label>
          <button onClick={saveRegion} disabled={busy || !region.voivodeship || region.city.length < 2}>Dalej</button>
        </>}

        {step === 'email' && <>
          <h2>Potwierdź e-mail</h2>
          <p>Na ten adres wyślemy gotowy komplet dokumentów i instrukcję złożenia.</p>
          <label>Adres e-mail<input type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="twoj@email.pl" disabled={emailCodeSent} /></label>
          {!emailCodeSent ? (
            <button onClick={sendEmailCode} disabled={busy || !email.includes('@')}>{busy ? 'Wysyłanie…' : 'Wyślij kod'}</button>
          ) : <>
            <label>Kod z e-maila<input inputMode="numeric" maxLength={6} value={emailCode} onChange={e => setEmailCode(e.target.value.replace(/\D/g,'').slice(0,6))} placeholder="000000" /></label>
            <button onClick={confirmEmailCode} disabled={busy || emailCode.length !== 6}>{busy ? 'Sprawdzanie…' : 'Potwierdź e-mail'}</button>
            <button className="secondary" onClick={() => { setEmailCodeSent(false); setEmailCode(''); }} disabled={busy}>Zmień adres / wyślij ponownie</button>
          </>}
        </>}

        {step === 'employment' && <>
          <h2>Jaka jest Twoja sytuacja?</h2>
          <label>Status<select value={employmentStatus} onChange={e => setEmploymentStatus(e.target.value)}>
            <option value="UNEMPLOYED_REGISTERED">Jestem zarejestrowany jako bezrobotny</option>
            <option value="NOT_WORKING_UNREGISTERED">Nie pracuję, ale nie jestem zarejestrowany</option>
            <option value="EMPLOYED">Pracuję</option>
            <option value="STUDENT">Jestem studentem</option>
            <option value="FARMER">Jestem rolnikiem / domownikiem rolnika</option>
            <option value="CIS_GRADUATE">Jestem absolwentem CIS</option>
            <option value="KIS_GRADUATE">Jestem absolwentem KIS</option>
            <option value="DISABILITY_CARER">Jestem opiekunem osoby z niepełnosprawnością</option>
            <option value="OTHER">Inna sytuacja</option>
          </select></label>
          <label>Co chcesz robić?<textarea rows={5} value={description} onChange={e => setDescription(e.target.value)} placeholder="Krótko opisz planowaną działalność" /></label>
          <button onClick={saveFundingProfile} disabled={busy}>Zapisz i sprawdź ścieżki</button>
        </>}

        {step === 'business' && <>
          <h2>Profil zapisany</h2>
          <p>Utworzymy pierwszą sprawę. Kolejny moduł sprawdzi PUP, Fundusze Europejskie, LGD i pozostałe pasujące źródła.</p>
          <button onClick={startCase} disabled={busy}>Utwórz moją sprawę</button>
        </>}

        {step === 'done' && <>
          <div className="success">✓</div>
          <h2>Sprawa utworzona</h2>
          <p>Profil jest gotowy do dalszej kwalifikacji i monitorowania aktualnych naborów.</p>
        </>}

        {error && <p className="error">{error}</p>}
      </section>
    </main>
  );
}
