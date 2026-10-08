# doradcyPRO — production release gate

A production release is allowed only when all items below are satisfied.

## Code and containers

- GitHub CI is green on the exact release commit.
- Docker smoke is green for API, Telegram bot, Update Engine and Document Worker.
- Prisma migrations committed in `packages/db/prisma/migrations` match production.
- No official form can become user-visible before mapping status is `VERIFIED`.
- No funding call, local criteria or submission instruction can be used before `VERIFIED`.

## Database

Supabase project: `DotacjaPRO` (`gptdlusypuuozubebjub`).

Required:
- `DATABASE_URL` must use TLS.
- Run committed Prisma migrations only; do not use destructive `db push` in production.
- RLS / Data API exposure must have an explicit security decision before public launch.
- Application database credentials must never be committed to Git.

## Shared secrets

Generate independent high-entropy values for:

- `INTERNAL_WORKER_SECRET`
- `APP_SESSION_SECRET`
- `EMAIL_VERIFICATION_SECRET`
- `DOCUMENT_SIGNING_SECRET`
- `CRON_SECRET`
- `TELEGRAM_WEBHOOK_SECRET`

Never reuse the Telegram bot token, SMTP password or database password as an application secret.

## API service

Required:
- `DATABASE_URL`
- `PUBLIC_API_BASE_URL`
- `APP_SESSION_SECRET`
- `INTERNAL_WORKER_SECRET`
- `EMAIL_VERIFICATION_SECRET`
- `DOCUMENT_SIGNING_SECRET`
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_SECURE`
- `SMTP_USER`
- `SMTP_PASS`
- `SMTP_FROM`
- `OBJECT_STORAGE_MODE=api`

Health: `/health`
Readiness: `/ready`

## Telegram bot service

Required:
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_BOT_USERNAME=DotacjaPRO_bot`
- `TELEGRAM_WEBHOOK_SECRET`
- `TELEGRAM_WEBHOOK_URL=https://<bot-host>/webhook`
- `API_BASE_URL=https://<api-host>`
- `APP_BASE_URL=https://<miniapp-host>`
- `INTERNAL_WORKER_SECRET`
- `CRON_SECRET`

After deployment call `POST /internal/configure-webhook` with the worker secret.

Health: `/health`
Readiness: `/ready`

## Update Engine

Required:
- `API_BASE_URL`
- `INTERNAL_WORKER_SECRET`
- `CRON_SECRET`
- `OBJECT_STORAGE_MODE=api`

Optional TERYT channels:
- `TERYT_TERC_FULL_URL` + `TERYT_SIMC_FULL_URL`, or
- `TERYT_WS1_USERNAME` + `TERYT_WS1_PASSWORD`

Health: `/health`
Readiness: `/ready`

## Document Worker

Required:
- `API_BASE_URL`
- `INTERNAL_WORKER_SECRET`
- `OBJECT_STORAGE_MODE=api`
- SMTP variables identical to API.

Health: `/health`
Readiness: `/ready`

## Mini App

Required:
- `NEXT_PUBLIC_API_BASE_URL=https://<api-host>`

After deployment set the Telegram Mini App URL to the production Mini App URL.

## Admin

Add trusted Telegram numeric IDs to:
- `ADMIN_TELEGRAM_USER_IDS`

The bot command `/whoami` returns the user's numeric Telegram ID.

## End-to-end release test

1. Open `@DotacjaPRO_bot` and run `/start`.
2. Open Mini App.
3. Authenticate using Telegram initData.
4. Verify region / PUP routing.
5. Verify email code delivery.
6. Create a case.
7. Select a `VERIFIED` funding call.
8. Complete verified local criteria.
9. Fill a mapped original official form.
10. Render it and verify the source SHA is preserved in audit metadata.
11. Generate final ZIP.
12. Receive ZIP or signed link by email.
13. Check included submission instruction and manifest.
14. Verify morning digest and a test notification through Telegram.
15. Verify admin DRAFT -> VERIFIED workflow.

