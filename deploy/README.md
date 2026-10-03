# DotacjaPRO deployment

Production services are intentionally split:

- API — `deploy/api.Dockerfile`, health: `/health`
- Telegram bot webhook — `deploy/bot.Dockerfile`, health: `/health`
- Update Engine — `deploy/update-engine.Dockerfile`, health: `/health`
- Document Worker — `deploy/document-worker.Dockerfile`, health: `/health`
- Mini App — `apps/miniapp` on Vercel

All secrets must be configured in the hosting provider. Never commit production values.

Launch storage defaults to `OBJECT_STORAGE_MODE=api`, so the workers store immutable
official documents and generated packages through the internal API in PostgreSQL.
S3 remains an optional later migration path.
