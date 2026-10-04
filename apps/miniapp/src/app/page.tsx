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

type Step = 'welcome' | 'legal' | 'region' | 'email' | 'employment' | 'business' | 'done';

type LocalCriteriaSet = {
  id: string;
  title: string;
  minimumPoints: number | null;
  maximumPoints: number | null;
  sourceHash: string;
  officialSourceUrl: string;
};

type ActiveCall = {
  id: string;
  title: string;
  status: string;
  opensAt: string | null;
  closesAt: string | null;
  officialUrl: string | null;
  localCriteria: LocalCriteriaSet | null;
};

type FundingProgramCandidate = {
  code: string;
  reason: string;
  priority: number;
  requiresVerifiedCall: boolean;
  program: {
    id: string;
    code: string;
    name: string;
    category: string;
    financingType: string;
    scope: string;
    officialUrl: string | null;
    verificationStatus: string;
    verifiedAt: string | null;
  } | null;
};

type QualificationView = {
  status: string;
  summary: string;
  activeCalls: ActiveCall[];
  programCandidates: FundingProgramCandidate[];
};

type CriterionQuestion = {
  code: string;
  title: string;
  description: string | null;
  inputType: 'BOOLEAN' | 'SELECT' | 'NUMBER' | 'EVIDENCE';
  required: boolean;
  failIfZero: boolean;
  maxPoints: number | null;
  evidenceHint: string | null;
  options?: Array<{ value: string; label: string }>;
};

type CriterionAssessment = {
  status: string;
  knownPoints: number;
  possiblePoints: number;
  publishedMaximumPoints: number | null;
  minimumPoints: number | null;
  thresholdMet: boolean | null;
  blockingFailures: string[];
  unresolvedCriteria: string[];
  summary: string;
  results: Array<{
    code: string;
    title: string;
    state: string;
    points: number | null;
    maxPoints: number | null;
    reason: string;
  }>;
};

type OfficialForm = {
  id: string;
  formCode: string;
  versionLabel: string | null;
  mappingVersion: number;
  originalName: string;
  mimeType: string;
  sha256: string;
  officialSourceUrl: string;
  officialSourceName: string | null;
  requiredForPackage: boolean;
  latestRender: {
    id: string;
    status: string;
    outputName: string | null;
    errorCode: string | null;
    completedAt: string | null;
  } | null;
};

type FormQuestion = {
  fieldKey: string;
  label: string;
  section: string | null;
  inputType: string;
  required: boolean;
  helpText: string | null;
  validation: unknown;
  value: unknown;
};

type RenderJobView = {
  id: string;
  status: string;
  outputName: string | null;
  errorCode: string | null;
};

type PackageJobView = {
  id: string;
  status: string;
  outputName: string | null;
  errorCode: string | null;
};

type AdminReviewQueue = {
  fundingCalls: Array<Record<string, any>>;
  submissionInstructions: Array<Record<string, any>>;
  criterionSets: Array<Record<string, any>>;
  formTemplates: Array<Record<string, any>>;
};

type AdminAccountingSummary = {
  generatedAt: string;
  quarter: {
    year: number;
    quarter: number;
    dueRevenuePln: string;
    limitPln: string | null;
    remainingPln: string | null;
    exceededByPln: string | null;
    thresholdExceeded: boolean | null;
  };
  pit36: {
    year: number;
    revenueCandidatePln: string;
    deductibleCostsPln: string;
    incomeCandidatePln: string;
    reviewRequired: boolean;
    reviewReasons: string[];
  };
};



const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';

export default function Home() {
  const [step, setStep] = useState<Step>('welcome');
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [authChannel, setAuthChannel] = useState<'web' | 'telegram' | null>(null);
  const [webEmail, setWebEmail] = useState('');
  const [webPassword, setWebPassword] = useState('');
  const [webFirstName, setWebFirstName] = useState('');
  const [telegramAvailable, setTelegramAvailable] = useState(false);
  const [legalVersion, setLegalVersion] = useState<string | null>(null);
  const [legalTermsAccepted, setLegalTermsAccepted] = useState(false);
  const [legalLicenseAccepted, setLegalLicenseAccepted] = useState(false);
  const [legalPrivacyAcknowledged, setLegalPrivacyAcknowledged] = useState(false);
  const [region, setRegion] = useState({
    voivodeship: '',
    city: '',
    municipality: '',
    county: '',
    postalCode: '',
    terytMunicipalityCode: '',
    terytLocalityCode: ''
  });
  const [regionSuggestions, setRegionSuggestions] = useState<Array<{
    label: string;
    city: string;
    municipality: string;
    county: string | null;
    pup: { id: string; name: string; officialUrl: string } | null;
    terytVerified: boolean;
    terytMunicipalityCode?: string;
    terytLocalityCode?: string;
  }>>([]);
  const [selectedPupName, setSelectedPupName] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [emailCode, setEmailCode] = useState('');
  const [emailCodeSent, setEmailCodeSent] = useState(false);
  const [employmentStatus, setEmploymentStatus] = useState('UNEMPLOYED_REGISTERED');
  const [description, setDescription] = useState('');
  const [caseId, setCaseId] = useState<string | null>(null);
  const [qualification, setQualification] = useState<QualificationView | null>(null);
  const [selectedFundingCallId, setSelectedFundingCallId] = useState<string | null>(null);
  const [selectedCriterionSetId, setSelectedCriterionSetId] = useState<string | null>(null);
  const [criterionQuestions, setCriterionQuestions] = useState<CriterionQuestion[]>([]);
  const [criterionAnswers, setCriterionAnswers] = useState<Record<string, string | number | boolean | null>>({});
  const [criterionAssessment, setCriterionAssessment] = useState<CriterionAssessment | null>(null);
  const [officialForms, setOfficialForms] = useState<OfficialForm[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [formQuestions, setFormQuestions] = useState<FormQuestion[]>([]);
  const [formAnswers, setFormAnswers] = useState<Record<string, unknown>>({});
  const [renderJob, setRenderJob] = useState<RenderJobView | null>(null);
  const [packageJob, setPackageJob] = useState<PackageJobView | null>(null);
  const [packageMessage, setPackageMessage] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminMode, setAdminMode] = useState(false);
  const [adminQueue, setAdminQueue] = useState<AdminReviewQueue | null>(null);
  const [adminAccounting, setAdminAccounting] = useState<AdminAccountingSummary | null>(null);
  const [adminMessage, setAdminMessage] = useState<string | null>(null);

  const authHeaders = useMemo(
    () => token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : undefined,
    [token]
  );

  function assessmentLabel(status: string) {
    const labels: Record<string, string> = {
      BLOCKING_CRITERION_FAILED: 'Kryterium blokujące niespełnione',
      BELOW_LOCAL_THRESHOLD: 'Wynik poniżej progu',
      LOCAL_THRESHOLD_MET: 'Próg punktowy osiągnięty',
      NEEDS_REVIEW: 'Wymaga dalszej oceny',
      SCORING_COMPLETE_NO_THRESHOLD: 'Punktacja policzona — brak progu'
    };
    return labels[status] ?? status;
  }

  function localDate(value: string | null) {
    if (!value) return null;
    return new Date(value).toLocaleDateString('pl-PL');
  }

  function logout() {
    window.localStorage.removeItem('dotacjapro.session');
    setToken(null);
    setAuthChannel(null);
    setIsAdmin(false);
    setAdminMode(false);
    setCaseId(null);
    setQualification(null);
    resetLegalChecks();
    setError(null);
    setStep('welcome');
  }


  useEffect(() => {
    const webApp = window.Telegram?.WebApp;
    webApp?.ready();
    webApp?.expand();
    setTelegramAvailable(Boolean(webApp?.initData));

    void loadCurrentLegal();

    const savedToken = window.localStorage.getItem('dotacjapro.session');
    if (savedToken) {
      void restoreSession(savedToken);
    }
  }, []);

  useEffect(() => {
    if (
      !caseId ||
      !renderJob ||
      !['QUEUED', 'PROCESSING'].includes(renderJob.status)
    ) {
      return;
    }

    const timer = window.setInterval(async () => {
      try {
        const res = await fetch(
          `${API}/v1/cases/${caseId}/render-jobs/${renderJob.id}`,
          { headers: authHeaders }
        );
        if (!res.ok) return;

        const data = await res.json();
        setRenderJob({
          id: data.job.id,
          status: data.job.status,
          outputName: data.job.outputName ?? null,
          errorCode: data.job.errorCode ?? null
        });

        if (data.job.status === 'COMPLETED') {
          void loadOfficialForms();
        }
      } catch {
        // Status można odświeżyć przy kolejnym cyklu.
      }
    }, 2000);

    return () => window.clearInterval(timer);
  }, [caseId, renderJob?.id, renderJob?.status, authHeaders]);

  useEffect(() => {
    if (
      !caseId ||
      !packageJob ||
      !['QUEUED', 'PROCESSING'].includes(packageJob.status)
    ) {
      return;
    }

    const timer = window.setInterval(async () => {
      try {
        const res = await fetch(
          `${API}/v1/cases/${caseId}/package/${packageJob.id}`,
          { headers: authHeaders }
        );
        if (!res.ok) return;

        const data = await res.json();
        setPackageJob({
          id: data.job.id,
          status: data.job.status,
          outputName: data.job.outputName ?? null,
          errorCode: data.job.errorCode ?? null
        });

        if (data.job.status === 'COMPLETED') {
          setPackageMessage('Komplet został przygotowany i wysłany na zweryfikowany adres e-mail.');
        }
      } catch {
        // Kolejny cykl odświeży stan.
      }
    }, 2500);

    return () => window.clearInterval(timer);
  }, [caseId, packageJob?.id, packageJob?.status, authHeaders]);

  useEffect(() => {
    if (step !== 'region' || !region.voivodeship || region.city.trim().length < 2) {
      setRegionSuggestions([]);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      const params = new URLSearchParams({
        voivodeship: region.voivodeship,
        q: region.city.trim()
      });

      try {
        const terytResponse = await fetch(
          `${API}/v1/locations/search?${params.toString()}`,
          { signal: controller.signal }
        );

        if (terytResponse.ok) {
          const data = await terytResponse.json();
          const items = (data.items ?? []).map((item: any) => ({
            label: item.locality.name,
            city: item.locality.name,
            municipality: item.municipality.name,
            county: item.municipality.county,
            pup: item.pup,
            terytVerified: true,
            terytMunicipalityCode: item.municipality.tercCode,
            terytLocalityCode: item.locality.simcCode
          }));

          if (items.length > 0) {
            setRegionSuggestions(items);
            return;
          }
        }

        const routingResponse = await fetch(
          `${API}/v1/regions/search?${params.toString()}`,
          { signal: controller.signal }
        );
        if (!routingResponse.ok) return;

        const fallback = await routingResponse.json();
        setRegionSuggestions((fallback.items ?? []).map((item: any) => {
          const label = item.municipality ?? item.city ?? '';
          return {
            label,
            city: item.city ?? label,
            municipality: item.municipality ?? label,
            county: item.county ?? null,
            pup: item.pup ?? null,
            terytVerified: false
          };
        }));
      } catch {
        // Brak sugestii nie blokuje ręcznego zapisu regionu.
      }
    }, 250);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [step, region.voivodeship, region.city]);

  async function loadCurrentLegal() {
    try {
      const res = await fetch(`${API}/v1/legal/current`, {
        cache: 'no-store'
      });
      if (!res.ok) return null;
      const data = await res.json();
      setLegalVersion(data.version ?? null);
      return data.version ?? null;
    } catch {
      return null;
    }
  }

  function resetLegalChecks() {
    setLegalTermsAccepted(false);
    setLegalLicenseAccepted(false);
    setLegalPrivacyAcknowledged(false);
  }

  function routeAfterAuthentication(data: any, channel: 'web' | 'telegram') {
    window.localStorage.setItem('dotacjapro.session', data.token);
    setToken(data.token);
    setEmail(data.user?.email ?? '');
    setIsAdmin(Boolean(data.user?.isAdmin));
    setAuthChannel(channel);

    if (data.legalAcceptanceRequired) {
      resetLegalChecks();
      if (data.legalVersion) setLegalVersion(data.legalVersion);
      setStep('legal');
    } else {
      setStep('region');
    }
  }

  async function acceptCurrentLegal() {
    if (
      !token ||
      !legalVersion ||
      !legalTermsAccepted ||
      !legalLicenseAccepted ||
      !legalPrivacyAcknowledged
    ) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const res = await fetch(`${API}/v1/me/legal-acceptances`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          version: legalVersion,
          termsAccepted: true,
          licenseAccepted: true,
          privacyAcknowledged: true,
          digitalImmediateConsent: false,
          withdrawalAcknowledged: false,
          context: 'ACCOUNT'
        })
      });

      if (!res.ok) {
        throw new Error('Nie udało się zapisać akceptacji aktualnych warunków.');
      }

      setStep('region');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Błąd zapisu zgód');
    } finally {
      setBusy(false);
    }
  }

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

  async function restoreSession(sessionToken: string) {
    try {
      const res = await fetch(`${API}/v1/auth/session`, {
        headers: {
          Authorization: `Bearer ${sessionToken}`,
          'Content-Type': 'application/json'
        }
      });

      if (!res.ok) {
        window.localStorage.removeItem('dotacjapro.session');
        return;
      }

      const data = await res.json();
      setToken(sessionToken);
      setIsAdmin(Boolean(data.user?.isAdmin));
      setEmail(data.user?.email ?? '');
      setAuthChannel(data.user?.authMethods?.telegram && window.Telegram?.WebApp?.initData
        ? 'telegram'
        : 'web');

      if (data.legalAcceptanceRequired) {
        resetLegalChecks();
        if (data.legalVersion) setLegalVersion(data.legalVersion);
        setStep('legal');
      } else {
        setStep('region');
      }
    } catch {
      window.localStorage.removeItem('dotacjapro.session');
    }
  }

  async function authenticateWeb() {
    setBusy(true);
    setError(null);

    try {
      const endpoint = authMode === 'register'
        ? '/v1/auth/web/register'
        : '/v1/auth/web/login';

      const body: Record<string, string | boolean> = {
        email: webEmail.trim().toLowerCase(),
        password: webPassword
      };
      if (authMode === 'register') {
        if (!legalVersion) {
          throw new Error('Nie udało się pobrać aktualnej wersji warunków.');
        }
        body.legalVersion = legalVersion;
        body.termsAccepted = legalTermsAccepted;
        body.licenseAccepted = legalLicenseAccepted;
        body.privacyAcknowledged = legalPrivacyAcknowledged;
        if (webFirstName.trim()) {
          body.firstName = webFirstName.trim();
        }
      }

      const res = await fetch(`${API}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.error === 'ACCOUNT_ALREADY_EXISTS') {
          throw new Error('Konto z tym adresem już istnieje. Wybierz logowanie.');
        }
        if (data.error === 'ACCOUNT_REQUIRES_LINKING') {
          throw new Error('Ten e-mail jest już przypisany do konta Telegram. Zaloguj się przez Telegram i ustaw hasło do logowania web.');
        }
        if (data.error === 'INVALID_CREDENTIALS') {
          throw new Error('Nieprawidłowy e-mail lub hasło.');
        }
        throw new Error(
          authMode === 'register'
            ? 'Nie udało się utworzyć konta.'
            : 'Nie udało się zalogować.'
        );
      }

      routeAfterAuthentication(data, 'web');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Błąd logowania');
    } finally {
      setBusy(false);
    }
  }

  async function authenticate() {
    setBusy(true);
    setError(null);
    try {
      const initData = window.Telegram?.WebApp?.initData;
      if (!initData) throw new Error('Telegram nie jest dostępny w tej przeglądarce.');

      const res = await fetch(`${API}/v1/auth/telegram`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData })
      });
      if (!res.ok) throw new Error('Nie udało się zalogować przez Telegram.');

      const data = await res.json();
      routeAfterAuthentication(data, 'telegram');

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

  async function loadAdminQueue(sessionToken = token) {
    if (!sessionToken) return;
    setBusy(true);
    setError(null);

    try {
      const res = await fetch(
        `${API}/v1/admin/review-queue`,
        {
          headers: {
            Authorization: `Bearer ${sessionToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      if (!res.ok) {
        throw new Error('Nie udało się pobrać kolejki weryfikacji.');
      }

      const data = await res.json();
      setAdminQueue(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Błąd panelu administratora');
    } finally {
      setBusy(false);
    }
  }

  async function loadAdminAccounting(sessionToken = token) {
    if (!sessionToken) return;
    try {
      const res = await fetch(
        `${API}/v1/admin/accounting/summary`,
        {
          headers: {
            Authorization: `Bearer ${sessionToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      if (!res.ok) {
        throw new Error('Nie udało się pobrać podsumowania Księgowej.');
      }

      const data = await res.json();
      setAdminAccounting(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Błąd modułu Księgowa');
    }
  }

  async function refreshAdminPanel(sessionToken = token) {
    if (!sessionToken) return;
    await Promise.all([
      loadAdminQueue(sessionToken),
      loadAdminAccounting(sessionToken)
    ]);
  }

  async function toggleAdminMode() {
    const next = !adminMode;
    setAdminMode(next);
    setAdminMessage(null);
    if (next) {
      await refreshAdminPanel();
    }
  }

  async function adminPost(url: string, body: unknown) {
    if (!token) return;
    setBusy(true);
    setError(null);
    setAdminMessage(null);

    try {
      const res = await fetch(`${API}${url}`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify(body)
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error ?? 'Weryfikacja nie powiodła się.');
      }

      setAdminMessage('Zweryfikowano i zapisano.');
      await loadAdminQueue(token);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Błąd weryfikacji');
    } finally {
      setBusy(false);
    }
  }

  async function adminVerifyFundingCall(item: Record<string, any>) {
    const evidence = item.evidenceJson ?? {};
    const status = evidence.candidateStatus;

    if (!['ANNOUNCED', 'OPEN', 'CLOSED', 'SUSPENDED'].includes(status)) {
      setError('Automat nie wykrył statusu wystarczającego do zatwierdzenia. Sprawdź źródło ręcznie.');
      return;
    }

    await adminPost(
      `/v1/admin/funding-calls/${item.id}/verify`,
      {
        status,
        opensAt: evidence.candidateOpensAt ?? null,
        closesAt: evidence.candidateClosesAt ?? null,
        untilExhausted: Boolean(evidence.candidateUntilExhausted),
        programCode: item.programCode ?? null
      }
    );
  }

  async function adminVerifySubmissionInstruction(item: Record<string, any>) {
    await adminPost(
      `/v1/admin/submission-instructions/${item.id}/verify`,
      {}
    );
  }

  async function adminVerifyCriterionSet(item: Record<string, any>) {
    await adminPost(
      `/v1/admin/criterion-sets/${item.id}/verify`,
      {}
    );
  }

  async function adminVerifyTemplate(item: Record<string, any>) {
    if (!token) return;
    setBusy(true);
    setError(null);
    setAdminMessage(null);

    try {
      const mappings = (item.fieldMappings ?? []).map((mapping: Record<string, any>) => ({
        fieldKey: mapping.fieldKey,
        sourcePath: mapping.sourcePath ?? '',
        locatorType: mapping.locatorType,
        ...(mapping.locatorJson ? { locatorJson: mapping.locatorJson } : {}),
        inputType: mapping.inputType,
        ...(mapping.questionLabel ? { questionLabel: mapping.questionLabel } : {}),
        ...(mapping.section ? { section: mapping.section } : {}),
        sortOrder: mapping.sortOrder ?? 0,
        required: Boolean(mapping.required),
        ...(mapping.helpText ? { helpText: mapping.helpText } : {}),
        ...(mapping.validationJson ? { validationJson: mapping.validationJson } : {})
      }));

      if (mappings.length === 0) {
        throw new Error('Brak mapowania pól do zatwierdzenia.');
      }

      const res = await fetch(
        `${API}/v1/admin/templates/${item.id}/mappings`,
        {
          method: 'PUT',
          headers: authHeaders,
          body: JSON.stringify({
            mappingStatus: 'VERIFIED',
            requiredForPackage: true,
            analysis: item.mappingAnalysisJson ?? undefined,
            mappings
          })
        }
      );

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error ?? 'Nie udało się zatwierdzić mapowania.');
      }

      setAdminMessage('Mapowanie formularza zostało zatwierdzone.');
      await loadAdminQueue(token);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Błąd mapowania');
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
      if (region.terytMunicipalityCode) body.terytMunicipalityCode = region.terytMunicipalityCode;
      if (region.terytLocalityCode) body.terytLocalityCode = region.terytLocalityCode;

      const res = await fetch(`${API}/v1/me/region`, {
        method: 'PUT',
        headers: authHeaders,
        body: JSON.stringify(body)
      });
      if (!res.ok) throw new Error('Nie udało się zapisać regionu.');
      setStep(authChannel === 'web' && email ? 'employment' : 'email');
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


  async function loadOfficialForms() {
    if (!caseId || !token) return;

    const res = await fetch(
      `${API}/v1/cases/${caseId}/official-forms`,
      { headers: authHeaders }
    );

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      if (data.error === 'FUNDING_CALL_SELECTION_REQUIRED') {
        setOfficialForms([]);
        return;
      }
      throw new Error('Nie udało się pobrać oficjalnych formularzy.');
    }

    const data = await res.json();
    setOfficialForms(data.forms ?? []);
  }

  async function openOfficialForm(templateId: string) {
    if (!caseId || !token) return;
    setBusy(true);
    setError(null);
    setRenderJob(null);

    try {
      const params = new URLSearchParams({ templateId });
      const res = await fetch(
        `${API}/v1/cases/${caseId}/form-questions?${params.toString()}`,
        { headers: authHeaders }
      );

      if (!res.ok) {
        throw new Error('Ten formularz nie jest gotowy do bezpiecznego wypełnienia.');
      }

      const data = await res.json();
      const questions: FormQuestion[] = data.questions ?? [];
      const initialAnswers: Record<string, unknown> = {};

      for (const question of questions) {
        if (question.value !== null && question.value !== undefined) {
          initialAnswers[question.fieldKey] = question.value;
        }
      }

      setSelectedTemplateId(templateId);
      setFormQuestions(questions);
      setFormAnswers(initialAnswers);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Błąd formularza');
    } finally {
      setBusy(false);
    }
  }

  async function saveAndRenderOfficialForm(templateId: string) {
    if (!caseId || !token) return;
    setBusy(true);
    setError(null);

    try {
      if (formQuestions.length > 0) {
        const answers = formQuestions.map((question) => ({
          fieldKey: question.fieldKey,
          value: formAnswers[question.fieldKey] ?? null
        }));

        const save = await fetch(
          `${API}/v1/cases/${caseId}/answers`,
          {
            method: 'PUT',
            headers: authHeaders,
            body: JSON.stringify({ answers })
          }
        );

        if (!save.ok) {
          throw new Error('Nie udało się zapisać odpowiedzi formularza.');
        }
      }

      const render = await fetch(
        `${API}/v1/cases/${caseId}/render`,
        {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({ templateId })
        }
      );

      if (!render.ok) {
        const data = await render.json().catch(() => ({}));

        if (data.error === 'REQUIRED_FORM_DATA_MISSING') {
          const labels = (data.missing ?? [])
            .map((item: { label?: string }) => item.label)
            .filter(Boolean)
            .join(', ');
          throw new Error(
            labels
              ? `Uzupełnij wymagane pola: ${labels}`
              : 'Uzupełnij wszystkie wymagane pola formularza.'
          );
        }

        if (data.error === 'FORM_TEMPLATE_FUNDING_CALL_MISMATCH') {
          throw new Error('Formularz nie należy do wybranego naboru.');
        }

        throw new Error('Nie udało się uruchomić generowania dokumentu.');
      }

      const data = await render.json();
      setRenderJob({
        id: data.job.id,
        status: data.job.status,
        outputName: data.job.outputName ?? null,
        errorCode: data.job.errorCode ?? null
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Błąd generowania dokumentu');
    } finally {
      setBusy(false);
    }
  }

  async function requestFinalPackage() {
    if (!caseId || !token) return;
    setBusy(true);
    setError(null);
    setPackageMessage(null);

    try {
      const res = await fetch(
        `${API}/v1/cases/${caseId}/package`,
        {
          method: 'POST',
          headers: authHeaders
        }
      );

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));

        if (data.error === 'PACKAGE_REQUIRED_DOCUMENTS_MISSING') {
          const names = (data.missing ?? [])
            .map((item: { name?: string }) => item.name)
            .filter(Boolean)
            .join(', ');
          throw new Error(
            names
              ? `Najpierw przygotuj wymagane dokumenty: ${names}`
              : 'Najpierw przygotuj wszystkie wymagane formularze.'
          );
        }

        if (data.error === 'VERIFIED_SUBMISSION_INSTRUCTION_REQUIRED') {
          throw new Error(
            'Instrukcja złożenia dla tego naboru nie została jeszcze zweryfikowana. Pakiet nie zostanie wysłany z niesprawdzonymi instrukcjami.'
          );
        }

        if (data.error === 'NO_VERIFIED_REQUIRED_FORMS') {
          throw new Error('Brak zweryfikowanego kompletu wymaganych formularzy.');
        }

        throw new Error('Nie udało się zlecić wysyłki pakietu.');
      }

      const data = await res.json();
      setPackageJob({
        id: data.job.id,
        status: data.job.status,
        outputName: data.job.outputName ?? null,
        errorCode: data.job.errorCode ?? null
      });
      setPackageMessage('Pakiet został przekazany do przygotowania.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Błąd wysyłki pakietu');
    } finally {
      setBusy(false);
    }
  }

  async function selectFundingCall(call: ActiveCall) {
    if (!caseId || !token) return;
    setBusy(true);
    setError(null);

    try {
      const res = await fetch(
        `${API}/v1/cases/${caseId}/select-call`,
        {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({ fundingCallId: call.id })
        }
      );

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data.error === 'CASE_CALL_LOCKED_BY_DOCUMENTS') {
          throw new Error('Nie można zmienić naboru po rozpoczęciu generowania dokumentów.');
        }
        if (data.error === 'FUNDING_CALL_NOT_AVAILABLE_FOR_CASE') {
          throw new Error('Ten nabór nie jest już dostępny dla tej sprawy.');
        }
        throw new Error('Nie udało się wybrać naboru.');
      }

      setSelectedFundingCallId(call.id);
      setSelectedCriterionSetId(null);
      setCriterionQuestions([]);
      setCriterionAnswers({});
      setCriterionAssessment(null);
      setOfficialForms([]);
      setSelectedTemplateId(null);
      setFormQuestions([]);
      setFormAnswers({});
      setRenderJob(null);
      setPackageJob(null);
      setPackageMessage(null);

      await loadOfficialForms();

      if (call.localCriteria) {
        const params = new URLSearchParams({
          criterionSetId: call.localCriteria.id
        });
        const criteriaResponse = await fetch(
          `${API}/v1/cases/${caseId}/local-criteria?${params.toString()}`,
          { headers: authHeaders }
        );

        if (criteriaResponse.ok) {
          const data = await criteriaResponse.json();
          setSelectedCriterionSetId(call.localCriteria.id);
          setCriterionQuestions(data.questions ?? []);
          setCriterionAnswers({});
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Błąd wyboru naboru');
    } finally {
      setBusy(false);
    }
  }

  async function loadCriteria(criterionSetId: string) {
    if (!caseId || !token) return;
    setBusy(true);
    setError(null);
    setCriterionAssessment(null);

    try {
      const params = new URLSearchParams({ criterionSetId });
      const res = await fetch(
        `${API}/v1/cases/${caseId}/local-criteria?${params.toString()}`,
        { headers: authHeaders }
      );

      if (!res.ok) {
        throw new Error('Nie udało się pobrać zweryfikowanych kryteriów.');
      }

      const data = await res.json();
      setSelectedCriterionSetId(criterionSetId);
      setCriterionQuestions(data.questions ?? []);

      const previousAnswers = data.latestAssessment?.answers;
      if (
        previousAnswers &&
        typeof previousAnswers === 'object' &&
        !Array.isArray(previousAnswers)
      ) {
        setCriterionAnswers(previousAnswers);
      } else {
        setCriterionAnswers({});
      }

      const previousResult = data.latestAssessment?.result;
      if (
        previousResult &&
        typeof previousResult === 'object' &&
        !Array.isArray(previousResult)
      ) {
        setCriterionAssessment(previousResult);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Błąd pobierania kryteriów');
    } finally {
      setBusy(false);
    }
  }

  async function assessCriteria(criterionSetId: string) {
    if (!caseId || !token) return;
    setBusy(true);
    setError(null);

    try {
      const res = await fetch(
        `${API}/v1/cases/${caseId}/local-criteria/assess`,
        {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({
            criterionSetId,
            answers: criterionAnswers
          })
        }
      );

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data.error === 'FUNDING_CALL_CLOSED') {
          throw new Error('Ten nabór został już zamknięty.');
        }
        if (data.error === 'FUNDING_CALL_NOT_ACTIVE_OR_VERIFIED') {
          throw new Error('Nabór nie jest obecnie aktywny albo nie został jeszcze zweryfikowany.');
        }
        throw new Error('Nie udało się policzyć punktacji.');
      }

      const data = await res.json();
      setCriterionAssessment(data.result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Błąd punktacji');
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

      const data = await res.json();
      const newCaseId = data.case.id;
      setCaseId(newCaseId);

      const qualificationResponse = await fetch(
        `${API}/v1/cases/${newCaseId}/qualify`,
        {
          method: 'POST',
          headers: authHeaders
        }
      );

      if (qualificationResponse.ok) {
        const result = await qualificationResponse.json();
        const firstPath = result.paths?.[0];
        if (firstPath) {
          setQualification({
            status: firstPath.status,
            summary: firstPath.summary,
            activeCalls: firstPath.activeCalls ?? [],
            programCandidates: result.programCandidates ?? []
          });
        }
      }

      setStep('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Błąd tworzenia sprawy');
    } finally {
      setBusy(false);
    }
  }

  const progressed: Record<Step, number> = {
    welcome: 0,
    legal: 0,
    region: 1,
    email: 2,
    employment: 3,
    business: 4,
    done: 5
  };
  const progressValue = progressed[step];

  return (
    <main className="shell">
      <section className="brand">
        <span className="eyebrow">DOTACJAPRO</span>
        <h1>Twoja droga do finansowania firmy</h1>
        <p>Ustalimy Twój region i sytuację, dopasujemy programy, a dokumenty przygotujemy wyłącznie na aktualnych, oficjalnych formularzach.</p>
      </section>

      {token && (
        <section className="session-toolbar">
          <span>{authChannel === 'telegram' ? 'Połączono przez Telegram' : 'Konto web'}</span>
          <button className="secondary compact" onClick={logout}>
            Wyloguj
          </button>
        </section>
      )}

      {isAdmin && (
        <section className="admin-toolbar">
          <button className="secondary" onClick={toggleAdminMode} disabled={busy}>
            {adminMode ? 'Ukryj panel weryfikacji' : 'Panel weryfikacji administratora'}
          </button>
        </section>
      )}

      {isAdmin && adminMode && (
        <section className="card admin-panel">
          <div className="admin-head">
            <div>
              <span className="eyebrow">ADMIN</span>
              <h2>Panel administratora</h2>
              <p>Weryfikacja źródeł urzędowych oraz bieżąca kontrola sprzedaży i rozliczeń.</p>
            </div>
            <button className="secondary compact" onClick={() => refreshAdminPanel()} disabled={busy}>
              Odśwież
            </button>
          </div>

          {adminAccounting && (
            <div className="accounting-summary">
              <div className="accounting-stat">
                <span>Sprzedaż należna · Q{adminAccounting.quarter.quarter} {adminAccounting.quarter.year}</span>
                <strong>{adminAccounting.quarter.dueRevenuePln} zł</strong>
              </div>
              <div className="accounting-stat">
                <span>Limit działalności nierejestrowanej</span>
                <strong>{adminAccounting.quarter.limitPln ?? 'wymaga aktualizacji'} zł</strong>
              </div>
              <div className={adminAccounting.quarter.thresholdExceeded ? 'accounting-stat danger-stat' : 'accounting-stat'}>
                <span>{adminAccounting.quarter.thresholdExceeded ? 'Przekroczenie limitu' : 'Pozostało do limitu'}</span>
                <strong>
                  {adminAccounting.quarter.thresholdExceeded
                    ? `${adminAccounting.quarter.exceededByPln} zł`
                    : adminAccounting.quarter.remainingPln
                      ? `${adminAccounting.quarter.remainingPln} zł`
                      : '—'}
                </strong>
              </div>
              <div className="accounting-stat">
                <span>PIT-36 · przychód otrzymany po korektach</span>
                <strong>{adminAccounting.pit36.revenueCandidatePln} zł</strong>
              </div>
              <div className="accounting-stat">
                <span>Udokumentowane koszty</span>
                <strong>{adminAccounting.pit36.deductibleCostsPln} zł</strong>
              </div>
              <div className="accounting-stat">
                <span>Dochód roboczy</span>
                <strong>{adminAccounting.pit36.incomeCandidatePln} zł</strong>
              </div>
              {adminAccounting.pit36.reviewRequired && (
                <p className="warning">
                  Księgowa oznaczyła pozycje wymagające weryfikacji: {adminAccounting.pit36.reviewReasons.join(', ')}
                </p>
              )}
            </div>
          )}

          <h3 className="admin-section-title">Kolejka weryfikacji</h3>
          {adminMessage && <p className="verified">{adminMessage}</p>}

          {!adminQueue ? (
            <p>Ładowanie kolejki…</p>
          ) : (
            <div className="admin-groups">
              <div className="admin-group">
                <h3>Nabory — {adminQueue.fundingCalls.length}</h3>
                {adminQueue.fundingCalls.map((item) => (
                  <div className="admin-item" key={item.id}>
                    <strong>{item.title}</strong>
                    <p>{item.institution?.name}</p>
                    {item.officialUrl && (
                      <a className="source-link" href={item.officialUrl} target="_blank" rel="noreferrer">
                        Oficjalne ogłoszenie
                      </a>
                    )}
                    <pre>{JSON.stringify(item.evidenceJson ?? {}, null, 2)}</pre>
                    <button
                      onClick={() => adminVerifyFundingCall(item)}
                      disabled={
                        busy ||
                        !['ANNOUNCED','OPEN','CLOSED','SUSPENDED'].includes(
                          item.evidenceJson?.candidateStatus
                        )
                      }
                    >
                      Zatwierdź wykryty status i terminy
                    </button>
                  </div>
                ))}
              </div>

              <div className="admin-group">
                <h3>Instrukcje złożenia — {adminQueue.submissionInstructions.length}</h3>
                {adminQueue.submissionInstructions.map((item) => (
                  <div className="admin-item" key={item.id}>
                    <strong>{item.fundingCall?.title}</strong>
                    <a className="source-link" href={item.sourceUrl} target="_blank" rel="noreferrer">
                      Źródło instrukcji
                    </a>
                    <pre>{JSON.stringify(item.instructionJson ?? {}, null, 2)}</pre>
                    <button onClick={() => adminVerifySubmissionInstruction(item)} disabled={busy}>
                      Zatwierdź instrukcję
                    </button>
                  </div>
                ))}
              </div>

              <div className="admin-group">
                <h3>Kryteria — {adminQueue.criterionSets.length}</h3>
                {adminQueue.criterionSets.map((item) => (
                  <div className="admin-item" key={item.id}>
                    <strong>{item.title}</strong>
                    <p>{item.fundingCall?.title ?? 'Bez przypisanego naboru'}</p>
                    <a
                      className="source-link"
                      href={item.sourceDocument?.source?.canonicalUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Oficjalny dokument kryteriów
                    </a>
                    <p>
                      Kryteriów: {item.criteria?.length ?? 0}
                      {' · '}
                      próg: {item.minimumPoints ?? 'brak'}
                      {' · '}
                      max: {item.maximumPoints ?? 'brak'}
                    </p>
                    <details>
                      <summary>Pokaż wykryte kryteria</summary>
                      <pre>{JSON.stringify(item.criteria ?? [], null, 2)}</pre>
                    </details>
                    <button onClick={() => adminVerifyCriterionSet(item)} disabled={busy}>
                      Zatwierdź zestaw kryteriów
                    </button>
                  </div>
                ))}
              </div>

              <div className="admin-group">
                <h3>Mapowania formularzy — {adminQueue.formTemplates.length}</h3>
                {adminQueue.formTemplates.map((item) => (
                  <div className="admin-item" key={item.id}>
                    <strong>{item.sourceDocument?.originalName}</strong>
                    <p>
                      Status: {item.mappingStatus}
                      {' · '}
                      pól: {item.fieldMappings?.length ?? 0}
                    </p>
                    <a
                      className="source-link"
                      href={item.sourceDocument?.source?.canonicalUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Oficjalny formularz
                    </a>
                    <details>
                      <summary>Pokaż mapowanie pól</summary>
                      <pre>{JSON.stringify(item.fieldMappings ?? [], null, 2)}</pre>
                    </details>
                    <button
                      onClick={() => adminVerifyTemplate(item)}
                      disabled={busy || item.mappingStatus !== 'DRAFT' || !item.fieldMappings?.length}
                    >
                      Zatwierdź mapowanie formularza
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      <section className="card">
        <div className="progress">
          {[1,2,3,4,5].map((n) => <span key={n} className={progressValue >= n ? 'active' : ''}></span>)}
        </div>

        {step === 'welcome' && <>
          <h2>Zaloguj się do DotacjaPRO</h2>
          <p>
            Możesz korzystać z aplikacji bez Telegrama. Konto web działa w Safari,
            Chrome i innych przeglądarkach, a Telegram możesz połączyć później.
          </p>

          <div className="auth-tabs">
            <button
              type="button"
              className={authMode === 'login' ? '' : 'secondary'}
              onClick={() => setAuthMode('login')}
              disabled={busy}
            >
              Mam konto
            </button>
            <button
              type="button"
              className={authMode === 'register' ? '' : 'secondary'}
              onClick={() => setAuthMode('register')}
              disabled={busy}
            >
              Załóż konto
            </button>
          </div>

          {authMode === 'register' && (
            <label>
              Imię <small>opcjonalnie</small>
              <input
                autoComplete="given-name"
                value={webFirstName}
                onChange={(e) => setWebFirstName(e.target.value)}
                placeholder="Twoje imię"
              />
            </label>
          )}

          <label>
            E-mail
            <input
              type="email"
              autoComplete="email"
              value={webEmail}
              onChange={(e) => setWebEmail(e.target.value)}
              placeholder="twoj@email.pl"
            />
          </label>

          <label>
            Hasło
            <input
              type="password"
              autoComplete={authMode === 'register' ? 'new-password' : 'current-password'}
              value={webPassword}
              onChange={(e) => setWebPassword(e.target.value)}
              placeholder="Minimum 10 znaków"
            />
          </label>

          {authMode === 'register' && (
            <div className="legal-consents">
              <label className="legal-check">
                <input
                  type="checkbox"
                  checked={legalTermsAccepted}
                  onChange={(e) => setLegalTermsAccepted(e.target.checked)}
                />
                <span>
                  Akceptuję <a href="/legal" target="_blank" rel="noreferrer">Regulamin DotacjaPRO</a>.
                </span>
              </label>
              <label className="legal-check">
                <input
                  type="checkbox"
                  checked={legalLicenseAccepted}
                  onChange={(e) => setLegalLicenseAccepted(e.target.checked)}
                />
                <span>
                  Akceptuję warunki licencji i zasady korzystania z materiałów.
                </span>
              </label>
              <label className="legal-check">
                <input
                  type="checkbox"
                  checked={legalPrivacyAcknowledged}
                  onChange={(e) => setLegalPrivacyAcknowledged(e.target.checked)}
                />
                <span>
                  Potwierdzam zapoznanie się z <a href="/legal" target="_blank" rel="noreferrer">Polityką prywatności i informacją RODO</a>.
                </span>
              </label>
              <small>
                Zgoda marketingowa nie jest częścią tych oświadczeń i nie jest warunkiem założenia konta.
              </small>
            </div>
          )}

          <button
            onClick={authenticateWeb}
            disabled={
              busy ||
              !webEmail.includes('@') ||
              webPassword.length < 10 ||
              (authMode === 'register' && (
                !legalVersion ||
                !legalTermsAccepted ||
                !legalLicenseAccepted ||
                !legalPrivacyAcknowledged
              ))
            }
          >
            {busy
              ? 'Łączenie…'
              : authMode === 'register'
                ? 'Załóż konto i przejdź dalej'
                : 'Zaloguj się'}
          </button>

          {telegramAvailable && (
            <>
              <div className="auth-divider"><span>lub</span></div>
              <button className="secondary" onClick={authenticate} disabled={busy}>
                Kontynuuj przez Telegram
              </button>
            </>
          )}

          <p className="auth-note">
            E-mail do wysyłki dokumentów potwierdzimy osobno przed generowaniem
            i wysyłką finalnego pakietu.
          </p>
        </>}

        {step === 'legal' && <>
          <h2>Aktualne warunki korzystania</h2>
          <p>
            Przed przejściem dalej potwierdź aktualną wersję Regulaminu,
            Licencji oraz informacji RODO. Ten ekran pojawi się ponownie tylko
            wtedy, gdy wersja dokumentów ulegnie zmianie.
          </p>

          <div className="legal-consents">
            <label className="legal-check">
              <input
                type="checkbox"
                checked={legalTermsAccepted}
                onChange={(e) => setLegalTermsAccepted(e.target.checked)}
              />
              <span>
                Akceptuję <a href="/legal" target="_blank" rel="noreferrer">Regulamin DotacjaPRO</a>.
              </span>
            </label>
            <label className="legal-check">
              <input
                type="checkbox"
                checked={legalLicenseAccepted}
                onChange={(e) => setLegalLicenseAccepted(e.target.checked)}
              />
              <span>Akceptuję warunki licencji i zasady korzystania z materiałów.</span>
            </label>
            <label className="legal-check">
              <input
                type="checkbox"
                checked={legalPrivacyAcknowledged}
                onChange={(e) => setLegalPrivacyAcknowledged(e.target.checked)}
              />
              <span>
                Potwierdzam zapoznanie się z <a href="/legal" target="_blank" rel="noreferrer">Polityką prywatności i informacją RODO</a>.
              </span>
            </label>
          </div>

          {legalVersion && <p className="auth-note">Wersja dokumentów: {legalVersion}</p>}

          <button
            onClick={acceptCurrentLegal}
            disabled={
              busy ||
              !legalVersion ||
              !legalTermsAccepted ||
              !legalLicenseAccepted ||
              !legalPrivacyAcknowledged
            }
          >
            {busy ? 'Zapisywanie…' : 'Akceptuję i przechodzę dalej'}
          </button>

          <button className="secondary" onClick={logout} disabled={busy}>
            Wyloguj
          </button>
        </>}

        {step === 'region' && <>
          <h2>Gdzie mieszkasz?</h2>
          <p>Na tej podstawie przypiszemy właściwy PUP, WUP, LGD oraz programy regionalne.</p>
          <label>Województwo<select value={region.voivodeship} onChange={e => setRegion({...region, voivodeship:e.target.value})}>
            <option value="">Wybierz</option>{VOIVODESHIPS.map(v => <option key={v}>{v}</option>)}
          </select></label>
          <label>Miasto / miejscowość<input value={region.city} onChange={e => {
            setRegion({
              ...region,
              city: e.target.value,
              terytMunicipalityCode: '',
              terytLocalityCode: ''
            });
            setSelectedPupName(null);
          }} placeholder="np. Sosnowiec" /></label>
          {regionSuggestions.length > 0 && <div className="suggestions">
            {regionSuggestions.map((item) => (
              <button
                type="button"
                className="suggestion"
                key={`${item.terytLocalityCode ?? item.label}-${item.pup?.id ?? 'no-pup'}`}
                onClick={() => {
                  setRegion({
                    ...region,
                    city: item.city,
                    municipality: item.municipality,
                    county: item.county ?? '',
                    terytMunicipalityCode: item.terytMunicipalityCode ?? '',
                    terytLocalityCode: item.terytLocalityCode ?? ''
                  });
                  setSelectedPupName(item.pup?.name ?? null);
                  setRegionSuggestions([]);
                }}
              >
                <strong>{item.label}</strong>
                <span>
                  {item.municipality}
                  {item.county ? ` · ${item.county}` : ''}
                  {item.terytVerified ? ' · TERYT ✓' : ''}
                </span>
                <span>{item.pup?.name ?? 'PUP do weryfikacji'}</span>
              </button>
            ))}
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
          {qualification ? <>
            <p className="qualification-status">{qualification.status}</p>
            <p>{qualification.summary}</p>

            {qualification.programCandidates.length > 0 && (
              <section className="program-candidates">
                <h2>Możliwe ścieżki finansowania</h2>
                <p className="call-meta">
                  To są kierunki do sprawdzenia na podstawie Twojego profilu. Sam wpis na liście nie oznacza aktywnego naboru ani przyznania finansowania.
                </p>
                <div className="calls">
                  {qualification.programCandidates.map((candidate) => (
                    <div className="call-card" key={candidate.code}>
                      <div className="call-head">
                        <strong>{candidate.program?.name ?? candidate.code}</strong>
                        <span className={
                          candidate.program?.verificationStatus === 'VERIFIED'
                            ? 'verified'
                            : 'qualification-status'
                        }>
                          {candidate.program?.verificationStatus === 'VERIFIED'
                            ? 'Źródło programu zweryfikowane'
                            : 'Wymaga sprawdzenia aktualnego naboru'}
                        </span>
                      </div>
                      <p>{candidate.reason}</p>
                      <p className="call-meta">
                        {candidate.requiresVerifiedCall
                          ? 'DotacjaPRO pokaże konkretny nabór dopiero po weryfikacji jego oficjalnych zasad.'
                          : 'Warunki tej ścieżki są weryfikowane przed przedstawieniem konkretnej oferty.'}
                      </p>
                      {candidate.program?.officialUrl && (
                        <a
                          className="source-link"
                          href={candidate.program.officialUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Oficjalne źródło programu
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {qualification.activeCalls.length > 0 ? (
              <div className="funding-list">
                {qualification.activeCalls.map((call) => (
                  <section className="funding-call" key={call.id}>
                    <div className="funding-call-head">
                      <span className="call-state">{call.status}</span>
                      <h3>{call.title}</h3>
                    </div>

                    <p className="call-meta">
                      {call.opensAt ? `Start: ${localDate(call.opensAt)}` : 'Start: wg ogłoszenia'}
                      {' · '}
                      {call.closesAt ? `Koniec: ${localDate(call.closesAt)}` : 'Koniec: wg ogłoszenia'}
                    </p>

                    {call.officialUrl && (
                      <a className="source-link" href={call.officialUrl} target="_blank" rel="noreferrer">
                        Oficjalne ogłoszenie
                      </a>
                    )}

                    <button
                      className={selectedFundingCallId === call.id ? 'secondary' : ''}
                      onClick={() => selectFundingCall(call)}
                      disabled={busy || selectedFundingCallId === call.id}
                    >
                      {selectedFundingCallId === call.id
                        ? 'Wybrany nabór ✓'
                        : 'Wybierz ten nabór'}
                    </button>

                    {selectedFundingCallId !== call.id ? (
                      <p className="muted-box">
                        Wybierz ten nabór, aby uruchomić jego kryteria i właściwe dokumenty.
                      </p>
                    ) : call.localCriteria ? (
                      <div className="criteria-panel">
                        <h3>Kryteria punktowe</h3>
                        <p>
                          {call.localCriteria.minimumPoints !== null
                            ? `Zweryfikowany próg: ${call.localCriteria.minimumPoints} pkt.`
                            : 'Brak zweryfikowanego progu punktowego.'}
                          {call.localCriteria.maximumPoints !== null
                            ? ` Maksymalnie: ${call.localCriteria.maximumPoints} pkt.`
                            : ''}
                        </p>

                        <a
                          className="source-link"
                          href={call.localCriteria.officialSourceUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Oficjalne źródło kryteriów
                        </a>

                        <button
                          className="secondary"
                          onClick={() => loadCriteria(call.localCriteria!.id)}
                          disabled={busy}
                        >
                          {selectedCriterionSetId === call.localCriteria.id
                            ? 'Odśwież pytania'
                            : 'Sprawdź moje kryteria'}
                        </button>

                        {selectedCriterionSetId === call.localCriteria.id && (
                          <div className="criteria-list">
                            {criterionQuestions.map((question) => (
                              <div className="criterion" key={question.code}>
                                <div className="criterion-title">
                                  <strong>{question.title}</strong>
                                  <span>
                                    {question.maxPoints !== null
                                      ? `max ${question.maxPoints} pkt`
                                      : 'ocena wg zasad urzędu'}
                                  </span>
                                </div>

                                {question.description && <p>{question.description}</p>}
                                <div className="criterion-flags">
                                  {question.required && <span>Wymagane</span>}
                                  {question.failIfZero && <span className="warning-chip">0 pkt może blokować ocenę</span>}
                                </div>
                                {question.evidenceHint && (
                                  <p className="assessment-note">{question.evidenceHint}</p>
                                )}

                                {question.inputType === 'BOOLEAN' && (
                                  <label>
                                    Odpowiedź
                                    <select
                                      value={
                                        criterionAnswers[question.code] === true
                                          ? 'true'
                                          : criterionAnswers[question.code] === false
                                            ? 'false'
                                            : ''
                                      }
                                      onChange={(e) => setCriterionAnswers({
                                        ...criterionAnswers,
                                        [question.code]: e.target.value === ''
                                          ? null
                                          : e.target.value === 'true'
                                      })}
                                    >
                                      <option value="">Wybierz</option>
                                      {(question.options ?? [
                                        { value: 'true', label: 'Tak' },
                                        { value: 'false', label: 'Nie' }
                                      ]).map((option) => (
                                        <option key={option.value} value={option.value}>
                                          {option.label}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                )}

                                {question.inputType === 'SELECT' && (
                                  <label>
                                    Odpowiedź
                                    <select
                                      value={String(criterionAnswers[question.code] ?? '')}
                                      onChange={(e) => setCriterionAnswers({
                                        ...criterionAnswers,
                                        [question.code]: e.target.value || null
                                      })}
                                    >
                                      <option value="">Wybierz</option>
                                      {(question.options ?? []).map((option) => (
                                        <option key={option.value} value={option.value}>
                                          {option.label}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                )}

                                {question.inputType === 'NUMBER' && (
                                  <label>
                                    Wartość
                                    <input
                                      type="number"
                                      value={
                                        typeof criterionAnswers[question.code] === 'number'
                                          ? String(criterionAnswers[question.code])
                                          : ''
                                      }
                                      onChange={(e) => setCriterionAnswers({
                                        ...criterionAnswers,
                                        [question.code]: e.target.value === ''
                                          ? null
                                          : Number(e.target.value)
                                      })}
                                    />
                                  </label>
                                )}

                                {question.inputType === 'EVIDENCE' && (
                                  <>
                                    <label>
                                      Informacja / dowód do oceny
                                      <textarea
                                        rows={3}
                                        value={
                                          typeof criterionAnswers[question.code] === 'string'
                                            ? criterionAnswers[question.code] as string
                                            : ''
                                        }
                                        onChange={(e) => setCriterionAnswers({
                                          ...criterionAnswers,
                                          [question.code]: e.target.value || null
                                        })}
                                        placeholder="Wpisz informację pomocną do późniejszej weryfikacji"
                                      />
                                    </label>
                                    <p className="manual-review">
                                      To kryterium nie otrzyma punktów automatycznie. Wymaga oceny zgodnej z zasadami urzędu.
                                    </p>
                                  </>
                                )}
                              </div>
                            ))}

                            <button
                              onClick={() => assessCriteria(call.localCriteria!.id)}
                              disabled={busy || criterionQuestions.length === 0}
                            >
                              {busy ? 'Liczenie…' : 'Policz zweryfikowaną część punktacji'}
                            </button>

                            {criterionAssessment && (
                              <div className="assessment">
                                <span className="qualification-status">
                                  {assessmentLabel(criterionAssessment.status)}
                                </span>
                                <h3>
                                  {criterionAssessment.knownPoints} pkt potwierdzonych
                                </h3>
                                <p>{criterionAssessment.summary}</p>
                                <p>
                                  Maksymalnie możliwe po rozstrzygnięciu pozostałych kryteriów:
                                  {' '}
                                  {criterionAssessment.possiblePoints} pkt.
                                </p>
                                {criterionAssessment.minimumPoints !== null && (
                                  <p>Opublikowany próg: {criterionAssessment.minimumPoints} pkt.</p>
                                )}
                                {criterionAssessment.blockingFailures.length > 0 && (
                                  <p className="warning">
                                    Niespełnione kryteria blokujące:
                                    {' '}
                                    {criterionAssessment.blockingFailures.join(', ')}
                                  </p>
                                )}
                                {criterionAssessment.unresolvedCriteria.length > 0 && (
                                  <p className="warning">
                                    Do dalszej oceny:
                                    {' '}
                                    {criterionAssessment.unresolvedCriteria.join(', ')}
                                  </p>
                                )}

                                <div className="assessment-details">
                                  {criterionAssessment.results.map((item) => (
                                    <p key={item.code}>
                                      <strong>{item.title}:</strong>
                                      {' '}
                                      {item.points === null ? 'bez automatycznej punktacji' : `${item.points} pkt`}
                                      {' — '}
                                      {item.reason}
                                    </p>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ) : (
                      <p className="muted-box">
                        Ten nabór jest wybrany, ale nie ma jeszcze zweryfikowanego zestawu kryteriów punktowych.
                      </p>
                    )}

                    {selectedFundingCallId === call.id && (
                      <>
                      <div className="forms-panel">
                        <h3>Oficjalne formularze</h3>

                        {officialForms.length === 0 ? (
                          <p className="muted-box">
                            Nie ma jeszcze zweryfikowanego mapowania formularza dla tego naboru. DotacjaPRO nie utworzy własnego zamiennika.
                          </p>
                        ) : (
                          <div className="forms-list">
                            {officialForms.map((form) => (
                              <div className="form-card" key={form.id}>
                                <strong>{form.officialSourceName ?? form.originalName}</strong>
                                <p className="call-meta">
                                  Oryginał: {form.originalName}
                                  {' · '}
                                  wersja {form.versionLabel ?? form.sha256.slice(0, 12)}
                                  {form.requiredForPackage ? ' · wymagany do paczki' : ' · opcjonalny'}
                                </p>
                                {form.latestRender && (
                                  <p className={form.latestRender.status === 'COMPLETED' ? 'verified' : 'call-meta'}>
                                    Ostatni status: {form.latestRender.status}
                                    {form.latestRender.outputName ? ` · ${form.latestRender.outputName}` : ''}
                                  </p>
                                )}
                                <a
                                  className="source-link"
                                  href={form.officialSourceUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  Otwórz źródło urzędowe
                                </a>
                                <button
                                  className="secondary"
                                  onClick={() => openOfficialForm(form.id)}
                                  disabled={busy}
                                >
                                  {selectedTemplateId === form.id
                                    ? 'Formularz otwarty'
                                    : 'Wypełnij ten formularz'}
                                </button>

                                {selectedTemplateId === form.id && (
                                  <div className="form-questions">
                                    {formQuestions.map((question) => (
                                      <label key={question.fieldKey}>
                                        {question.label}
                                        {question.required && <small> wymagane</small>}

                                        {question.inputType === 'BOOLEAN' ? (
                                          <select
                                            value={
                                              formAnswers[question.fieldKey] === true
                                                ? 'true'
                                                : formAnswers[question.fieldKey] === false
                                                  ? 'false'
                                                  : ''
                                            }
                                            onChange={(e) => setFormAnswers({
                                              ...formAnswers,
                                              [question.fieldKey]: e.target.value === ''
                                                ? null
                                                : e.target.value === 'true'
                                            })}
                                          >
                                            <option value="">Wybierz</option>
                                            <option value="true">Tak</option>
                                            <option value="false">Nie</option>
                                          </select>
                                        ) : question.inputType === 'TEXTAREA' ? (
                                          <textarea
                                            rows={4}
                                            value={String(formAnswers[question.fieldKey] ?? '')}
                                            onChange={(e) => setFormAnswers({
                                              ...formAnswers,
                                              [question.fieldKey]: e.target.value
                                            })}
                                          />
                                        ) : (
                                          <input
                                            type={
                                              question.inputType === 'NUMBER'
                                                ? 'number'
                                                : question.inputType === 'DATE'
                                                  ? 'date'
                                                  : question.inputType === 'EMAIL'
                                                    ? 'email'
                                                    : 'text'
                                            }
                                            value={String(formAnswers[question.fieldKey] ?? '')}
                                            onChange={(e) => setFormAnswers({
                                              ...formAnswers,
                                              [question.fieldKey]:
                                                question.inputType === 'NUMBER' && e.target.value !== ''
                                                  ? Number(e.target.value)
                                                  : e.target.value
                                            })}
                                          />
                                        )}

                                        {question.helpText && (
                                          <small>{question.helpText}</small>
                                        )}
                                      </label>
                                    ))}

                                    <button
                                      onClick={() => saveAndRenderOfficialForm(form.id)}
                                      disabled={busy || formQuestions.length === 0}
                                    >
                                      {busy ? 'Przygotowanie…' : 'Zapisz i przygotuj dokument urzędowy'}
                                    </button>

                                    {renderJob && (
                                      <div className="render-state">
                                        <strong>Status dokumentu: {renderJob.status}</strong>
                                        {renderJob.status === 'COMPLETED' && (
                                          <p>
                                            Gotowe: {renderJob.outputName ?? 'wypełniony formularz'}.
                                            Dokument zostanie dołączony do pakietu tej sprawy.
                                          </p>
                                        )}
                                        {renderJob.status === 'FAILED' && (
                                          <p className="error">
                                            Generowanie nie powiodło się ({renderJob.errorCode ?? 'DOCUMENT_RENDER_FAILED'}).
                                          </p>
                                        )}
                                        {['QUEUED', 'PROCESSING'].includes(renderJob.status) && (
                                          <p>DotacjaPRO wypełnia kopię aktualnego formularza urzędowego.</p>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="package-panel">
                        <h3>Gotowy komplet</h3>
                        <p>
                          DotacjaPRO wyśle ZIP z wymaganymi formularzami, instrukcją do wydruku
                          i manifestem wersji dokumentów na Twój zweryfikowany e-mail.
                        </p>
                        <button
                          onClick={requestFinalPackage}
                          disabled={
                            busy ||
                            !!packageJob && ['QUEUED', 'PROCESSING'].includes(packageJob.status)
                          }
                        >
                          {packageJob && ['QUEUED', 'PROCESSING'].includes(packageJob.status)
                            ? 'Przygotowywanie pakietu…'
                            : 'Wyślij kompletny pakiet na e-mail'}
                        </button>
                        {packageMessage && <p className="verified">{packageMessage}</p>}
                        {packageJob?.status === 'COMPLETED' && (
                          <p className="verified">
                            ✓ Pakiet wysłany: {packageJob.outputName ?? 'komplet dokumentów'}
                          </p>
                        )}
                        {packageJob?.status === 'FAILED' && (
                          <p className="error">
                            Wysyłka pakietu nie powiodła się ({packageJob.errorCode ?? 'PACKAGE_DELIVERY_FAILED'}).
                          </p>
                        )}
                      </div>
                      </>
                    )}
                  </section>
                ))}
              </div>
            ) : (
              <p className="muted-box">
                Nie ma obecnie zweryfikowanego aktywnego lub zapowiedzianego naboru dla tej ścieżki.
              </p>
            )}
          </> : <p>Profil jest gotowy do dalszej kwalifikacji i monitorowania aktualnych naborów.</p>}
        </>}

        {error && <p className="error">{error}</p>}
      </section>

      <footer className="legal-footer">
        <span>DotacjaPRO Bot</span>
        <a href="/legal">Regulamin · Licencja · RODO</a>
      </footer>
    </main>
  );
}
