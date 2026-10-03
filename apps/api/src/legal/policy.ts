import crypto from 'node:crypto';

export const LEGAL_VERSION = '2026-10-03.1';

export const LEGAL_STATEMENTS = {
  terms:
    'Zapoznałem(-am) się z Regulaminem DotacjaPRO i akceptuję jego postanowienia.',
  license:
    'Zapoznałem(-am) się z warunkami licencji. Zakup nie przenosi autorskich praw majątkowych, a materiały nie mogą być odsprzedawane ani rozpowszechniane poza dozwolonym zakresem.',
  privacy:
    'Potwierdzam zapoznanie się z Polityką prywatności i klauzulą informacyjną RODO. To potwierdzenie zapoznania się, a nie zgoda marketingowa.',
  digitalImmediate:
    'Żądam rozpoczęcia dostarczania odpłatnej treści cyfrowej przed upływem terminu do odstąpienia od umowy.',
  withdrawalAcknowledgement:
    'Przyjmuję do wiadomości, że po rozpoczęciu dostarczania odpłatnej treści cyfrowej, po spełnieniu ustawowych warunków, mogę utracić prawo odstąpienia od umowy.'
} as const;

const canonical = JSON.stringify({
  version: LEGAL_VERSION,
  statements: LEGAL_STATEMENTS
});

export const LEGAL_STATEMENTS_SHA256 = crypto
  .createHash('sha256')
  .update(canonical)
  .digest('hex');
