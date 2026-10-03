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

type Step = 'welcome' | 'region' | 'employment' | 'business' | 'done';

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

  async function authenticate() {
    setBusy(true);
    setError(null);
    try {
      const initData = window.Telegram?.WebApp?.initData;
      if (!initData) {
        throw new Error('Otwórz aplikację z poziomu @DotacjaPRO_bot.');
      }
      const res = await fetch(`${API}/v1/auth/telegram`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData })
      });
      if (!res.ok) throw new Error('Nie udało się zalogować przez Telegram.');
      const data = await res.json();
      setToken(data.token);
      setStep('region');
      window.Telegram?.WebApp?.requestWriteAccess?.();
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
      setStep('employment');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Błąd zapisu');
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

  return (
    <main className="shell">
      <section className="brand">
        <span className="eyebrow">DOTACJAPRO</span>
        <h1>Twoja droga do finansowania firmy</h1>
        <p>Najpierw ustalimy Twój region i sytuację. Później dopasujemy programy i będziemy pracować wyłącznie na aktualnych, oficjalnych formularzach.</p>
      </section>

      <section className="card">
        <div className="progress">
          <span className={step !== 'welcome' ? 'active' : ''}></span>
          <span className={['employment','business','done'].includes(step) ? 'active' : ''}></span>
          <span className={['business','done'].includes(step) ? 'active' : ''}></span>
          <span className={step === 'done' ? 'active' : ''}></span>
        </div>

        {step === 'welcome' && <>
          <h2>Zaczynamy</h2>
          <p>Logowanie odbywa się przez Telegram. Nie tworzymy dodatkowego hasła.</p>
          <button onClick={authenticate} disabled={busy}>{busy ? 'Łączenie…' : 'Rozpocznij'}</button>
        </>}

        {step === 'region' && <>
          <h2>Gdzie mieszkasz?</h2>
          <p>Na tej podstawie przypiszemy właściwy PUP, WUP, LGD oraz programy regionalne.</p>
          <label>Województwo<select value={region.voivodeship} onChange={e => setRegion({...region, voivodeship:e.target.value})}>
            <option value="">Wybierz</option>{VOIVODESHIPS.map(v => <option key={v}>{v}</option>)}
          </select></label>
          <label>Miasto / miejscowość<input value={region.city} onChange={e => setRegion({...region, city:e.target.value})} placeholder="np. Sosnowiec" /></label>
          <label>Gmina <small>opcjonalnie</small><input value={region.municipality} onChange={e => setRegion({...region, municipality:e.target.value})} /></label>
          <label>Powiat <small>opcjonalnie</small><input value={region.county} onChange={e => setRegion({...region, county:e.target.value})} /></label>
          <label>Kod pocztowy <small>opcjonalnie</small><input value={region.postalCode} onChange={e => setRegion({...region, postalCode:e.target.value})} placeholder="00-000" /></label>
          <button onClick={saveRegion} disabled={busy || !region.voivodeship || region.city.length < 2}>Dalej</button>
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
          <p>Teraz utworzymy Twoją pierwszą sprawę. W kolejnych krokach system sprawdzi PUP, Fundusze Europejskie, LGD i inne pasujące źródła.</p>
          <button onClick={startCase} disabled={busy}>Utwórz moją sprawę</button>
        </>}

        {step === 'done' && <>
          <div className="success">✓</div>
          <h2>Sprawa utworzona</h2>
          <p>Profil jest gotowy do dalszej kwalifikacji. Następnym etapem będzie automatyczne dopasowanie właściwych programów i aktualnych naborów.</p>
        </>}

        {error && <p className="error">{error}</p>}
      </section>
    </main>
  );
}
