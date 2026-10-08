export type LegalOperatorState = {
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

export function envBoolean(name: string, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return /^(1|true|yes|on)$/i.test(raw.trim());
}

export function getLegalOperatorState(): LegalOperatorState {
  const operatorType =
    process.env.LEGAL_OPERATOR_TYPE ?? 'UNREGISTERED_ACTIVITY';
  const representativeRequired = envBoolean(
    'LEGAL_OPERATOR_REQUIRES_REPRESENTATIVE',
    false
  );
  const taxClassificationConfirmed = envBoolean(
    'LEGAL_TAX_CLASSIFICATION_CONFIRMED',
    false
  );

  const seller = {
    brand: process.env.LEGAL_BRAND_NAME ?? 'doradcyPRO',
    name: process.env.LEGAL_SELLER_NAME ?? null,
    address: process.env.LEGAL_SELLER_ADDRESS ?? null,
    email: process.env.LEGAL_SELLER_EMAIL ?? process.env.EMAIL_FROM ?? null,
    nip: process.env.LEGAL_SELLER_NIP ?? null
  };

  const representative = {
    name: process.env.LEGAL_REPRESENTATIVE_NAME ?? null,
    email: process.env.LEGAL_REPRESENTATIVE_EMAIL ?? null
  };

  const nipRequired =
    operatorType !== 'UNREGISTERED_ACTIVITY' ||
    envBoolean('LEGAL_NIP_REQUIRED', false);

  const sellerIdentityComplete = Boolean(
    seller.name &&
    seller.address &&
    seller.email &&
    (!nipRequired || seller.nip)
  );

  const representativeComplete =
    !representativeRequired || Boolean(representative.name);

  const legalIdentityComplete =
    sellerIdentityComplete && representativeComplete;

  const checkoutAllowed =
    legalIdentityComplete && taxClassificationConfirmed;

  let checkoutBlockedReason: string | null = null;
  if (!sellerIdentityComplete) {
    checkoutBlockedReason = 'LEGAL_SELLER_IDENTITY_INCOMPLETE';
  } else if (!representativeComplete) {
    checkoutBlockedReason = 'LEGAL_REPRESENTATIVE_REQUIRED';
  } else if (!taxClassificationConfirmed) {
    checkoutBlockedReason = 'LEGAL_TAX_CLASSIFICATION_UNCONFIRMED';
  }

  return {
    operatorType,
    representativeRequired,
    representative,
    taxClassificationConfirmed,
    nipRequired,
    seller,
    legalIdentityComplete,
    checkoutAllowed,
    checkoutBlockedReason
  };
}
