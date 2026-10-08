'use client';

import { useEffect, useState } from 'react';

export type PlatformProduct = {
  code: string;
  label: string;
  description: string;
  engine: string;
  availability: 'ACTIVE' | 'PLANNED' | 'CONFIGURATION_REQUIRED';
  requiresRegulatedPartner: boolean;
};

export default function ProductGateway({
  apiBaseUrl,
  onSelect
}: {
  apiBaseUrl: string;
  onSelect: (product: PlatformProduct) => void;
}) {
  const [products, setProducts] = useState<PlatformProduct[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${apiBaseUrl}/v1/platform/products`, { cache: 'no-store' })
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((payload) => setProducts(Array.isArray(payload?.products) ? payload.products : []))
      .finally(() => setLoading(false));
  }, [apiBaseUrl]);

  return (
    <section className="product-gateway">
      <div className="guide-hero" aria-hidden="true">
        <div className="guide-head">
          <span className="guide-hair" />
          <span className="guide-mustache" />
        </div>
        <div className="guide-suit">
          <span className="guide-shirt" />
          <span className="guide-tie" />
          <span className="guide-arm" />
        </div>
      </div>

      <div className="gateway-copy">
        <span className="eyebrow">doradcyPRO</span>
        <h2>Czego potrzebujesz?</h2>
        <p>Wybierz obszar. Dostępne moduły uruchomią właściwy silnik, a pozostałe pokażą się dopiero po przejściu wymaganych gate’ów.</p>
      </div>

      {loading ? (
        <p>Ładowanie dostępnych możliwości…</p>
      ) : (
        <div className="gateway-grid">
          {products.map((product) => (
            <button
              key={product.code}
              type="button"
              className="gateway-product"
              disabled={product.availability !== 'ACTIVE'}
              onClick={() => onSelect(product)}
            >
              <span className="gateway-product-head">
                <strong>{product.label}</strong>
                <small>
                  {product.availability === 'ACTIVE'
                    ? 'dostępne'
                    : product.availability === 'CONFIGURATION_REQUIRED'
                      ? 'wymaga danych'
                      : 'w przygotowaniu'}
                </small>
              </span>
              <span>{product.description}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
