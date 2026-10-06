'use client';

import { useEffect, useMemo, useState } from 'react';
import styles from './platform-preview.module.css';

type Product = {
  code: string;
  label: string;
  description: string;
  engine: string;
  availability: 'ACTIVE' | 'PLANNED';
  requiresRegulatedPartner: boolean;
};

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';

const FALLBACK: Product[] = [
  { code: 'GRANTS', label: 'Dotacje', description: 'Programy publiczne i dokumenty.', engine: 'GRANT_ENGINE', availability: 'ACTIVE', requiresRegulatedPartner: false },
  { code: 'BUSINESS_FINANCE', label: 'Finansowanie firmy', description: 'Mapa źródeł finansowania.', engine: 'FINANCIAL_PARTNER_ENGINE', availability: 'PLANNED', requiresRegulatedPartner: true },
  { code: 'LEASING', label: 'Leasing', description: 'Analiza potrzeby i routing.', engine: 'LEASING_ROUTER', availability: 'PLANNED', requiresRegulatedPartner: true },
  { code: 'CREDIT', label: 'Kredyty', description: 'Wstępna analiza potrzeb.', engine: 'CREDIT_ROUTER', availability: 'PLANNED', requiresRegulatedPartner: true },
  { code: 'INSURANCE', label: 'Ubezpieczenia', description: 'Kategorie ochrony i partner.', engine: 'INSURANCE_ROUTER', availability: 'PLANNED', requiresRegulatedPartner: true },
  { code: 'PROPERTY', label: 'Nieruchomości', description: 'Potrzeba, region i partner.', engine: 'PROPERTY_ROUTER', availability: 'PLANNED', requiresRegulatedPartner: true },
  { code: 'DOCUMENTS', label: 'Dokumenty', description: 'Formalności i dokumenty.', engine: 'DOCUMENT_ENGINE', availability: 'ACTIVE', requiresRegulatedPartner: false }
];

export default function PlatformPreview() {
  const [products, setProducts] = useState<Product[]>(FALLBACK);
  const [selected, setSelected] = useState<Product | null>(null);
  const [phase, setPhase] = useState<'WELCOME' | 'SELECTING' | 'TRANSFER' | 'ENGINE'>('WELCOME');
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener?.('change', update);

    fetch(`${API}/v1/platform/products`)
      .then((response) => response.ok ? response.json() : Promise.reject(new Error('catalog unavailable')))
      .then((payload) => {
        if (Array.isArray(payload?.products) && payload.products.length > 0) {
          setProducts(payload.products);
        }
      })
      .catch(() => {
        // Preview intentionally keeps a local fallback; production router will fail closed.
      });

    const intro = window.setTimeout(() => setPhase('SELECTING'), reducedMotion ? 0 : 650);
    return () => {
      window.clearTimeout(intro);
      media.removeEventListener?.('change', update);
    };
  }, [reducedMotion]);

  const activeLabel = useMemo(
    () => selected?.label ?? 'wybrany produkt',
    [selected]
  );

  function choose(product: Product) {
    setSelected(product);
    if (reducedMotion) {
      setPhase('ENGINE');
      return;
    }
    setPhase('TRANSFER');
    window.setTimeout(() => setPhase('ENGINE'), 900);
  }

  function reset() {
    setSelected(null);
    setPhase('SELECTING');
  }

  return (
    <main className={styles.shell}>
      <section className={styles.stage} aria-live="polite">
        <div className={styles.guideWrap} aria-label="Przewodnik platformy">
          <div className={styles.guide}>
            <div className={styles.hair} />
            <div className={styles.face}>
              <span className={styles.mustache} />
            </div>
            <div className={styles.suit}>
              <span className={styles.shirt} />
              <span className={styles.tie} />
            </div>
            <div className={styles.arm} data-phase={phase} />
          </div>
        </div>

        <div className={styles.copy}>
          <span className={styles.kicker}>PLATFORM PREVIEW</span>
          <h1>{phase === 'ENGINE' ? `${activeLabel}: zaczynamy` : 'Czego potrzebujesz?'}</h1>
          <p>
            {phase === 'ENGINE'
              ? 'Silnik produktu pobierze wyłącznie potrzebne dane z Profilu 360 i poprosi o brakujące informacje.'
              : 'Wybierz obszar. Każdy moduł ma własny silnik, QA i zasady prawne.'}
          </p>
        </div>

        {phase === 'SELECTING' && (
          <div className={styles.grid}>
            {products.map((product, index) => (
              <button
                key={product.code}
                type="button"
                className={styles.product}
                style={{ animationDelay: reducedMotion ? '0ms' : `${index * 70}ms` }}
                onClick={() => choose(product)}
              >
                <span className={styles.productTop}>
                  <strong>{product.label}</strong>
                  <em>{product.availability === 'ACTIVE' ? 'aktywne' : 'w przygotowaniu'}</em>
                </span>
                <span>{product.description}</span>
              </button>
            ))}
          </div>
        )}

        {phase === 'TRANSFER' && selected && (
          <div className={styles.transfer} aria-label={`Przekazuję do modułu ${selected.label}`}>
            <div className={styles.capsule}>{selected.label}</div>
            <div className={styles.station}>
              <span />
            </div>
          </div>
        )}

        {phase === 'ENGINE' && selected && (
          <div className={styles.engineCard}>
            <span className={styles.engineCode}>{selected.engine}</span>
            <h2>{selected.label}</h2>
            <p>
              {selected.availability === 'ACTIVE'
                ? 'Ten moduł może zostać podpięty do istniejącej infrastruktury.'
                : 'Moduł pozostaje zablokowany produkcyjnie do czasu przejścia wymaganych gate’ów.'}
            </p>
            {selected.requiresRegulatedPartner && (
              <div className={styles.gate}>REGULATORY PARTNER GATE</div>
            )}
            <button type="button" className={styles.reset} onClick={reset}>Wybierz inny obszar</button>
          </div>
        )}

        {phase !== 'ENGINE' && phase !== 'SELECTING' && reducedMotion && (
          <button type="button" className={styles.skip} onClick={() => setPhase('SELECTING')}>Pomiń animację</button>
        )}
      </section>
    </main>
  );
}
