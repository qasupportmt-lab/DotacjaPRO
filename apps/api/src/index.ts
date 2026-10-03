import Fastify from 'fastify';

const app = Fastify({ logger: true });

app.get('/health', async () => ({
  service: 'dotacjapro-api',
  status: 'ok',
  officialFormOnly: true
}));

app.get('/v1/system/policy', async () => ({
  official_form_only: true,
  regional_routing: true,
  legal_snapshot_required: true,
  source_verification_required: true
}));

const port = Number(process.env.PORT ?? 4000);
await app.listen({ port, host: '0.0.0.0' });
