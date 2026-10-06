# eBook + Access Commerce Architecture

Status: DESIGN / TAX CLEARANCE REQUIRED
Data: 2026-10-06

## 1. Krytyczna zasada

Nie zakładamy, że każdy produkt zapakowany jako "e-book" automatycznie ma 5% VAT.

Klasyfikujemy rzeczywistą treść świadczenia.

Każdy CommerceProduct dostaje:
- supplyModel
- taxClassificationStatus
- taxRateCandidate
- WIS reference (jeżeli uzyskana)
- legalVersion
- deliveryContractVersion

ACTIVE = możliwe dopiero po TAX_GATE_PASS.

## 2. Typy produktu

### PUBLICATION_ONLY
Samodzielna publikacja elektroniczna.

### PUBLICATION_WITH_INTEGRAL_DIGITAL_COMPONENT
Publikacja + integralny, funkcjonalnie związany element cyfrowy.
Wymaga indywidualnej klasyfikacji.

### DIGITAL_SERVICE
Dostęp do portalu / narzędzia / interaktywnego procesu.

### HYBRID
Publikacja + usługa/dostęp.
Nie zakładamy 5% dla całości bez podstawy.

## 3. eBook Factory

Źródła:
- wynik engine,
- verified source refs,
- user profile snapshot,
- document outputs,
- risk analysis,
- checklist,
- instructions.

Pipeline:
DATA_FREEZE
-> CONTENT_ASSEMBLY
-> SOURCE_VALIDATION
-> LEGAL_QA
-> PDF_RENDER
-> HASH
-> SIGNED_MANIFEST
-> DELIVERY_READY.

Każdy eBook:
- ebookId,
- version,
- productId,
- userId,
- generatedAt,
- sha256,
- sourceRefs,
- legalVersion,
- taxClassificationRef,
- entitlementId.

## 4. Oficjalne formularze

Nie "wklejamy" formularzy przypadkowo do PDF.

Model:
- eBook jest publikacją przewodnią,
- w rozdziale "Dokumenty" wskazuje wygenerowane urzędowe formularze,
- formularze zachowują oryginalny układ i wersję,
- mogą być dostarczone w tej samej paczce dokumentów albo jako załączniki powiązane z eBookiem,
- manifest opisuje każdy plik.

Jeśli technicznie i prawnie właściwe:
eBook PDF + official form PDFs/DOCX + manifest ZIP.

Nie modyfikujemy oficjalnego wzoru w sposób mogący sugerować, że jest to inny dokument urzędowy.

## 5. Klucz dostępu

Termin techniczny: Access Redemption Token.
Termin dla klienta rekomendowany: "Klucz dostępu".

Nie jest:
- kryptowalutą,
- tokenem inwestycyjnym,
- środkiem płatniczym.

Właściwości:
- 128+ bit entropy,
- przechowujemy wyłącznie hash,
- single-use,
- expiry,
- product-bound,
- order-bound,
- entitlement-bound,
- user binding po redemption,
- revocable,
- audytowalny.

Klucz NIGDY nie jest jedynym hasłem konta.

Flow:
PAYMENT_CONFIRMED
-> ENTITLEMENT_GRANTED
-> ACCESS_KEY_CREATED
-> eBook contains QR / claim code
-> user authenticates
-> redeems code once
-> entitlement linked
-> token invalidated.

## 6. Dlaczego klucz nie jest loginem

Jeśli PDF zostanie przekazany innej osobie, kod nie może dać pełnego przejęcia konta.
Dlatego:
- konto = email/Telegram auth,
- klucz = aktywacja produktu/uprawnienia.

## 7. Consumer flow

Checkout:
1. product description
2. real nature of supply
3. total gross price
4. tax handled internally
5. functional requirements
6. compatibility/interoperability where relevant
7. immediate delivery consent where required
8. withdrawal acknowledgement where legally applicable
9. payment
10. confirmation on durable medium
11. delivery.

## 8. E-book compliance gate

Before sale:
- Content owner / rights verified
- Product description accurate
- Digital functionality disclosed
- Delivery method disclosed
- Withdrawal flow configured
- Complaint / conformity flow configured
- Tax classification confirmed
- Privacy basis confirmed
- Retention defined
- accessibility/readability verified.

## 9. WIS

Dla kluczowego modelu "personalized eBook + access key + portal" rekomendowany jest własny WIS przed skalowaniem sprzedaży.

W kodzie:
TAX_CLASSIFICATION_PENDING => product.active=false.

## 10. Accounting

CommerceOrder musi przechowywać snapshot:
- net candidate,
- VAT rate actually applied,
- VAT amount,
- gross,
- tax classification version,
- WIS/id/reference if applicable.

Nie wyliczamy historycznej faktury na podstawie aktualnej konfiguracji produktu.

## 11. Returns / withdrawal

System zapisuje:
- consent timestamp,
- exact legal text version,
- immediate delivery request,
- withdrawal acknowledgement,
- delivery timestamp,
- download/redemption timestamp.

To musi być dowodem, nie tylko checkboxem UI.
