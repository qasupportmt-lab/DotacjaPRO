# Security & Privacy

- Telegram initData musi być walidowane po stronie backendu.
- Poufne dokumenty nie są wysyłane jako treść wiadomości Telegram.
- Dane osobowe zbieramy progresywnie i tylko gdy są potrzebne do danej sprawy.
- Dane szczególnej kategorii są izolowane i dostępne tylko w ścieżkach, które ich wymagają.
- RBAC: applicant, advisor, accountant, support, legal_reviewer, content_editor, admin, superadmin.
- Każda zmiana formularza/reguły i każdy eksport dokumentu trafia do audit logu.
- Oryginalne formularze są immutable; modyfikujemy wyłącznie kopie robocze.
