import http from 'node:http';
import { Bot, InlineKeyboard } from 'grammy';

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) throw new Error('TELEGRAM_BOT_TOKEN is required');

const apiBaseUrl = process.env.API_BASE_URL ?? 'http://localhost:4000';
const appBaseUrl = process.env.APP_BASE_URL ?? 'http://localhost:3000';
const workerSecret = process.env.INTERNAL_WORKER_SECRET ?? '';
const cronSecret = process.env.CRON_SECRET ?? '';
const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET ?? '';
const publicWebhookUrl = process.env.TELEGRAM_WEBHOOK_URL ?? '';
const adminTelegramIds = new Set((process.env.ADMIN_TELEGRAM_USER_IDS ?? '').split(',').map(v => v.trim()).filter(Boolean));

function isAdminTelegram(userId: number | undefined) {
  return userId !== undefined && adminTelegramIds.has(String(userId));
}

const bot = new Bot(token);

const supportDrafts = new Map<number, string>();

function supportCategoryMenu() {
  return new InlineKeyboard()
    .text('Techniczny', 'support:TECHNICAL')
    .text('Logowanie / konto', 'support:LOGIN').row()
    .text('Płatność / zakup', 'support:PAYMENT')
    .text('Dokumenty', 'support:DOCUMENTS').row()
    .text('Dane / dotacja', 'support:DATA')
    .text('Inny', 'support:OTHER').row()
    .text('Anuluj', 'support:CANCEL');
}

async function recordAppActivity(action: string) {
  if (!workerSecret) return;
  try {
    await fetch(
      apiBaseUrl.replace(/\/$/, '') + '/v1/internal/supervisor/activity-event',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-worker-secret': workerSecret
        },
        body: JSON.stringify({ action }),
        signal: AbortSignal.timeout(5000)
      }
    );
  } catch (error) {
    console.error('Activity event failed', error);
  }
}

async function createTelegramSupportIssue(
  ctx: any,
  category: string,
  message: string
) {
  if (!workerSecret) {
    throw new Error('INTERNAL_WORKER_SECRET_NOT_CONFIGURED');
  }

  const telegramUserId = String(ctx.from?.id ?? '');
  if (!telegramUserId) {
    throw new Error('TELEGRAM_USER_ID_MISSING');
  }

  const response = await fetch(
    apiBaseUrl.replace(/\/$/, '') + '/v1/internal/support/issues',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-worker-secret': workerSecret
      },
      body: JSON.stringify({
        channel: 'TELEGRAM',
        category,
        message,
        telegramUserId,
        telegramUsername: ctx.from?.username,
        telegramFirstName: ctx.from?.first_name
      }),
      signal: AbortSignal.timeout(10_000)
    }
  );

  const data = await response.json().catch(() => ({})) as {
    reportId?: string;
    error?: string;
  };

  if (!response.ok || !data.reportId) {
    throw new Error(data.error ?? ('Support issue HTTP ' + response.status));
  }

  return data.reportId;
}

function mainMenu(isAdmin = false) {
  const keyboard = new InlineKeyboard()
    .webApp('doradcyPRO — otwórz aplikację', appBaseUrl).row()
    .text('Sprawdź dotacje', 'menu:dotacje')
    .text('Moja sprawa', 'menu:sprawa').row()
    .text('Formularze i dokumenty', 'menu:dokumenty').row()
    .text('Pakiety i materiały', 'menu:pakiety')
    .text('Pomoc', 'menu:pomoc').row()
    .text('Zgłoś problem', 'menu:problem');
  if (isAdmin) keyboard.row().text('Panel właściciela', 'menu:admin').text('Dostępy', 'menu:dostepy');
  return keyboard;
}

bot.command('start', async (ctx) => {
  void recordAppActivity('telegram:start');
  await ctx.reply(
    '<b>doradcyPRO</b>\n\nWybierz, co chcesz zrobić. doradcyPRO prowadzi Cię przez finansowanie, sprawę i dokumenty z jednego menu.',
    { parse_mode: 'HTML', reply_markup: mainMenu(isAdminTelegram(ctx.from?.id)) }
  );
});

bot.command('dotacje', async (ctx) => {
  await ctx.reply(
    '<b>doradcyPRO — dotacje</b>\n\nSprawdź dostępne finansowanie albo otwórz aplikację, aby przejść pełną ścieżkę.',
    { parse_mode: 'HTML', reply_markup: new InlineKeyboard().webApp('Sprawdź finansowanie', appBaseUrl).row().text('Wróć do menu', 'menu:home') }
  );
});

bot.callbackQuery('menu:home', async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.editMessageText('<b>doradcyPRO</b>\n\nWybierz, co chcesz zrobić.', { parse_mode: 'HTML', reply_markup: mainMenu(isAdminTelegram(ctx.from?.id)) });
});

bot.callbackQuery('menu:dotacje', async (ctx) => {
  void recordAppActivity('telegram:menu:dotacje');
  await ctx.answerCallbackQuery();
  await ctx.editMessageText('<b>Sprawdź dotacje</b>\n\ndoradcyPRO dopasuje dostępne finansowanie do Twojej sytuacji i regionu.', { parse_mode: 'HTML', reply_markup: new InlineKeyboard().webApp('Uruchom doradcyPRO', appBaseUrl).row().text('Wróć', 'menu:home') });
});

bot.callbackQuery('menu:sprawa', async (ctx) => {
  void recordAppActivity('telegram:menu:sprawa');
  await ctx.answerCallbackQuery();
  await ctx.editMessageText('<b>Moja sprawa</b>\n\nOtwórz konto doradcyPRO, aby zobaczyć swoją sprawę i jej aktualny etap.', { parse_mode: 'HTML', reply_markup: new InlineKeyboard().webApp('Otwórz moją sprawę', appBaseUrl).row().text('Wróć', 'menu:home') });
});

bot.callbackQuery('menu:dokumenty', async (ctx) => {
  void recordAppActivity('telegram:menu:dokumenty');
  await ctx.answerCallbackQuery();
  await ctx.editMessageText('<b>Formularze i dokumenty</b>\n\nDokumenty i formularze są dostępne na Twoim koncie doradcyPRO.', { parse_mode: 'HTML', reply_markup: new InlineKeyboard().webApp('Otwórz dokumenty', appBaseUrl).row().text('Wróć', 'menu:home') });
});

bot.callbackQuery('menu:pakiety', async (ctx) => {
  void recordAppActivity('telegram:menu:pakiety');
  await ctx.answerCallbackQuery();
  await ctx.editMessageText('<b>Pakiety i materiały</b>\n\nZobacz dostępne pakiety, materiały i przypisane zakupy.', { parse_mode: 'HTML', reply_markup: new InlineKeyboard().webApp('Zobacz pakiety', appBaseUrl).row().text('Wróć', 'menu:home') });
});

bot.callbackQuery('menu:pomoc', async (ctx) => {
  void recordAppActivity('telegram:menu:pomoc');
  await ctx.answerCallbackQuery();
  await ctx.editMessageText('<b>Pomoc doradcyPRO</b>\n\nWybierz funkcję z menu lub otwórz aplikację. Polecenie /help pokazuje także dostępne komendy.', { parse_mode: 'HTML', reply_markup: new InlineKeyboard().webApp('Otwórz doradcyPRO', appBaseUrl).row().text('Wróć', 'menu:home') });
});

bot.callbackQuery('menu:dostepy', async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!isAdminTelegram(ctx.from?.id)) return;

  void recordAppActivity('owner:access-audit');
  await ctx.editMessageText(
    '<b>doradcyPRO — dostępy użytkowników</b>\n\nOtwórz prywatny audyt dostępów. Panel pokaże pseudonimowy identyfikator użytkownika, aktywne pakiety, liczbę dokumentów i gotowych paczek.',
    {
      parse_mode: 'HTML',
      reply_markup: new InlineKeyboard()
        .webApp('Otwórz audyt dostępów', appBaseUrl + '?admin=access')
        .row()
        .text('Wróć', 'menu:home')
    }
  );
});

bot.command('dostepy', async (ctx) => {
  if (!isAdminTelegram(ctx.from?.id)) {
    return ctx.reply('Ta funkcja jest dostępna tylko dla administratora doradcyPRO.');
  }

  void recordAppActivity('owner:access-audit');
  await ctx.reply(
    '<b>doradcyPRO — dostępy użytkowników</b>\n\nPanel nie wymaga hasła, gdy otwierasz go z Telegrama jako właściciel.',
    {
      parse_mode: 'HTML',
      reply_markup: new InlineKeyboard().webApp(
        'Otwórz audyt dostępów',
        appBaseUrl + '?admin=access'
      )
    }
  );
});

bot.callbackQuery('menu:admin', async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!isAdminTelegram(ctx.from?.id)) return;
  await ctx.editMessageText('<b>doradcyPRO — panel właściciela</b>\n\nDostępne polecenia: /supervisor, /dostepy, /status, /ksiegowa.', { parse_mode: 'HTML', reply_markup: new InlineKeyboard().webApp('Audyt dostępów', appBaseUrl + '?admin=access').row().text('Wróć', 'menu:home') });
});

bot.command('whoami', async (ctx) => {
  await ctx.reply(
    [
      'Twój identyfikator Telegram:',
      `<code>${ctx.from?.id ?? 'brak'}</code>`,
      '',
      'Administrator DotacjaPRO może dodać ten numer do ADMIN_TELEGRAM_USER_IDS.'
    ].join('\n'),
    { parse_mode: 'HTML' }
  );
});

bot.command('ksiegowa', async (ctx) => {
  if (!workerSecret) {
    return ctx.reply('Moduł Księgowa nie jest jeszcze skonfigurowany.');
  }

  const telegramUserId = String(ctx.from?.id ?? '');
  if (!telegramUserId) {
    return ctx.reply('Nie mogę ustalić Twojego identyfikatora Telegram.');
  }

  try {
    const response = await fetch(
      apiBaseUrl.replace(/\/$/, '') +
        '/v1/internal/accounting/summary?telegramUserId=' +
        encodeURIComponent(telegramUserId),
      {
        headers: { 'x-worker-secret': workerSecret },
        signal: AbortSignal.timeout(10_000)
      }
    );

    if (response.status === 403) {
      return ctx.reply('Ta funkcja jest dostępna tylko dla administratora DotacjaPRO.');
    }
    if (!response.ok) {
      throw new Error('Accounting summary HTTP ' + response.status);
    }

    const data = await response.json() as {
      quarter: {
        year: number;
        quarter: number;
        dueRevenuePln: string;
        limitPln: string | null;
        remainingPln: string | null;
        thresholdExceeded: boolean | null;
        exceededByPln: string | null;
      };
      pit36: {
        year: number;
        revenueCandidatePln: string;
        deductibleCostsPln: string;
        incomeCandidatePln: string;
        reviewRequired: boolean;
      };
    };

    const q = data.quarter;
    const pit = data.pit36;
    const limitLine =
      q.limitPln === null
        ? 'Limit: wymaga aktualizacji prawnej'
        : q.thresholdExceeded
          ? `Limit przekroczony o: ${q.exceededByPln} zł`
          : `Do limitu zostało: ${q.remainingPln} zł`;

    await ctx.reply(
      [
        '<b>DotacjaPRO — Księgowa</b>',
        `Q${q.quarter} ${q.year}: ${q.dueRevenuePln} zł / ${q.limitPln ?? '—'} zł`,
        limitLine,
        '',
        `PIT-36 ${pit.year} — przychód: ${pit.revenueCandidatePln} zł`,
        `Koszty udokumentowane: ${pit.deductibleCostsPln} zł`,
        `Dochód roboczy: ${pit.incomeCandidatePln} zł`,
        pit.reviewRequired
          ? 'Status: wymagana weryfikacja pozycji oznaczonych przez silnik.'
          : 'Status: brak wykrytych wyjątków wymagających ręcznej weryfikacji.'
      ].join('\n'),
      { parse_mode: 'HTML' }
    );
  } catch (error) {
    console.error('Accounting command failed', error);
    await ctx.reply('Nie udało się pobrać podsumowania Księgowej. Spróbuj ponownie później.');
  }
});

bot.command('supervisor', async (ctx) => {
  if (!isAdminTelegram(ctx.from?.id)) return ctx.reply('Ta funkcja jest dostępna tylko dla administratora DotacjaPRO.');
  if (!workerSecret) return ctx.reply('Supervisor nie jest skonfigurowany.');
  try {
    const response = await fetch(apiBaseUrl.replace(/\/$/, '') + '/v1/internal/supervisor/summary', {
      headers: { 'x-worker-secret': workerSecret },
      signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok) throw new Error('Supervisor HTTP ' + response.status);
    const data = await response.json() as any;
    const top = data.commerce.ranking?.[0];
    const alerts = data.alerts?.length ? data.alerts.map((x: string) => '• ' + x).join('\n') : 'Brak aktywnych alertów.';
    await ctx.reply([
      '<b>DotacjaPRO — SUPERVISOR</b>',
      '',
      '<b>Użytkownicy</b>',
      `Łącznie: ${data.users.total} | nowe 24h: ${data.users.new24h}`,
      `Sprawy: ${data.cases.total} | nowe 7d: ${data.cases.new7d}`,
      '',
      '<b>Sprzedaż — 7 dni</b>',
      `Zamówienia: ${data.commerce.orders7d}`,
      `Przychód netto: ${(data.commerce.netRevenueGrosz / 100).toFixed(2)} zł`,
      `Najczęściej kupowane: ${top ? top.name + ' (' + top.purchases + ')' : 'brak sprzedaży'}`,
      `Produkty bez sprzedaży: ${data.commerce.noSales?.length ?? 0}`,
      '',
      '<b>Dostępy</b>',
      `Aktywne uprawnienia: ${data.access?.activeEntitlementsTotal ?? 0}`,
      `Dokumenty: ${data.access?.documentsTotal ?? 0}`,
      `Gotowe paczki: ${data.access?.completedPackagesTotal ?? 0}`,
      '',
      '<b>Operacje</b>',
      `Aktywność doradcyPRO/Telegram 24h: ${data.operations.auditEvents24h ?? 0}`,
      `Oczekujące powiadomienia: ${data.operations.pendingNotifications}`,
      `Błędy powiadomień: ${data.operations.failedNotifications}`,
      `Błędy dokumentów/paczek 7d: ${data.operations.renderFailures7d}/${data.operations.packageFailures7d}`,
      '',
      '<b>Alerty</b>',
      alerts
    ].join('\n'), { parse_mode: 'HTML' });
  } catch (error) {
    console.error('Supervisor command failed', error);
    await ctx.reply('Supervisor chwilowo nie może pobrać danych.');
  }
});

bot.command('status', async (ctx) => {
  if (!isAdminTelegram(ctx.from?.id)) return ctx.reply('Ta funkcja jest dostępna tylko dla administratora DotacjaPRO.');
  try {
    const [api, webhook] = await Promise.all([
      fetch(apiBaseUrl.replace(/\/$/, '') + '/ready', { signal: AbortSignal.timeout(10_000) }),
      bot.api.getWebhookInfo()
    ]);
    await ctx.reply([
      '<b>DotacjaPRO — STATUS</b>',
      `Bot: OK`,
      `API: ${api.ok ? 'OK' : 'BŁĄD ' + api.status}`,
      `Webhook: ${webhook.url ? 'OK' : 'BRAK'}`,
      `Oczekujące aktualizacje: ${webhook.pending_update_count}`,
      `Ostatni błąd webhooka: ${webhook.last_error_message ?? 'brak'}`
    ].join('\n'), { parse_mode: 'HTML' });
  } catch (error) {
    console.error('Status command failed', error);
    await ctx.reply('Nie udało się wykonać pełnego testu statusu.');
  }
});

bot.command('problem', async (ctx) => {
  void recordAppActivity('telegram:command:problem');
  await ctx.reply(
    '<b>Zgłoś problem</b>\n\nWybierz kategorię. Następnie wyślij jedną wiadomość z opisem tego, co nie działa.',
    { parse_mode: 'HTML', reply_markup: supportCategoryMenu() }
  );
});

bot.callbackQuery('menu:problem', async (ctx) => {
  void recordAppActivity('telegram:menu:problem');
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(
    '<b>Zgłoś problem</b>\n\nWybierz kategorię. Następnie wyślij jedną wiadomość z opisem tego, co nie działa.',
    { parse_mode: 'HTML', reply_markup: supportCategoryMenu() }
  );
});

bot.callbackQuery(/^support:(TECHNICAL|LOGIN|PAYMENT|DOCUMENTS|DATA|OTHER|CANCEL)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const userId = ctx.from?.id;
  if (!userId) return;

  const category = ctx.match?.[1];
  if (!category || category === 'CANCEL') {
    supportDrafts.delete(userId);
    await ctx.editMessageText(
      '<b>Zgłoszenie anulowane.</b>',
      { parse_mode: 'HTML', reply_markup: mainMenu(isAdminTelegram(userId)) }
    );
    return;
  }

  supportDrafts.set(userId, category);
  await ctx.editMessageText(
    '<b>Opisz problem</b>\n\nWyślij teraz jedną wiadomość: co robiłeś, co się stało i czego oczekiwałeś. Maksymalnie 4000 znaków.\n\nAby anulować: /anuluj',
    { parse_mode: 'HTML' }
  );
});

bot.command('anuluj', async (ctx) => {
  if (ctx.from?.id) supportDrafts.delete(ctx.from.id);
  await ctx.reply('Zgłoszenie anulowane.', {
    reply_markup: mainMenu(isAdminTelegram(ctx.from?.id))
  });
});

bot.on('message:text', async (ctx) => {
  const userId = ctx.from?.id;
  if (!userId) return;

  const category = supportDrafts.get(userId);
  if (!category) return;

  const message = ctx.message.text.trim();
  if (message.startsWith('/')) return;

  if (message.length < 5) {
    await ctx.reply('Opis jest za krótki. Napisz przynajmniej kilka słów.');
    return;
  }
  if (message.length > 4000) {
    await ctx.reply('Opis jest za długi. Skróć go do maksymalnie 4000 znaków.');
    return;
  }

  try {
    const reportId = await createTelegramSupportIssue(ctx, category, message);
    supportDrafts.delete(userId);
    await ctx.reply(
      '<b>Zgłoszenie przyjęte.</b>\nNumer: <code>' + escapeHtml(reportId) + '</code>\n\nDziękuję. Problem został zapisany do weryfikacji.',
      {
        parse_mode: 'HTML',
        reply_markup: mainMenu(isAdminTelegram(userId))
      }
    );
  } catch (error) {
    console.error('Telegram support issue failed', error);
    await ctx.reply('Nie udało się zapisać zgłoszenia. Spróbuj ponownie za chwilę.');
  }
});

bot.command('help', async (ctx) => {
  const keyboard = new InlineKeyboard().webApp('Otwórz DotacjaPRO', appBaseUrl);
  await ctx.reply(
    [
      '<b>DotacjaPRO</b>',
      '/start — otwórz aplikację',
      '/dotacje — sprawdź dostępne finansowanie',
      '/whoami — pokaż Twój Telegram ID',
      '/ksiegowa — sprzedaż, limit i podgląd PIT-36',
      '/problem — zgłoś problem z aplikacją lub obsługą',
      ...(isAdminTelegram(ctx.from?.id) ? ['/supervisor — prywatny panel nadzorczy', '/dostepy — audyt pakietów i dokumentów', '/status — stan bota, API i webhooka'] : []),
      '/help — lista poleceń'
    ].join('\n'),
    { parse_mode: 'HTML', reply_markup: keyboard }
  );
});

bot.catch((err) => console.error('Bot error', err));

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

async function reportDelivery(id: string, success: boolean, error?: string) {
  if (!workerSecret) return;

  await fetch(apiBaseUrl + '/v1/internal/notifications/' + id + '/delivery', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-worker-secret': workerSecret
    },
    body: JSON.stringify({ success, error })
  });
}

async function deliverPendingNotifications(limit = 100) {
  if (!workerSecret) throw new Error('INTERNAL_WORKER_SECRET is required');

  const safeLimit = Math.max(1, Math.min(limit, 200));
  const response = await fetch(
    apiBaseUrl + '/v1/internal/notifications/pending?limit=' + safeLimit,
    { headers: { 'x-worker-secret': workerSecret } }
  );

  if (!response.ok) {
    throw new Error('Notification queue HTTP ' + response.status);
  }

  const data = await response.json() as {
    notifications: Array<{
      id: string;
      telegramUserId: string;
      title: string;
      body: string;
    }>;
  };

  let sent = 0;
  let failed = 0;

  for (const item of data.notifications) {
    try {
      const keyboard = new InlineKeyboard().webApp('Otwórz DotacjaPRO', appBaseUrl);
      await bot.api.sendMessage(
        Number(item.telegramUserId),
        '<b>' + escapeHtml(item.title) + '</b>\n\n' + escapeHtml(item.body),
        { parse_mode: 'HTML', reply_markup: keyboard }
      );
      await reportDelivery(item.id, true);
      sent++;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await reportDelivery(item.id, false, message.slice(0, 1900));
      failed++;
    }
  }

  return { queued: data.notifications.length, sent, failed };
}

function json(
  response: http.ServerResponse,
  statusCode: number,
  payload: unknown
) {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8'
  });
  response.end(JSON.stringify(payload));
}

async function readJsonBody(request: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;

    if (bytes > 1_000_000) {
      throw new Error('REQUEST_BODY_TOO_LARGE');
    }

    chunks.push(buffer);
  }

  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function workerAuthorized(request: http.IncomingMessage) {
  return Boolean(
    workerSecret &&
    request.headers['x-worker-secret'] === workerSecret
  );
}

function cronAuthorized(request: http.IncomingMessage) {
  return Boolean(
    cronSecret &&
    request.headers.authorization === 'Bearer ' + cronSecret
  );
}

function webhookAuthorized(request: http.IncomingMessage) {
  return Boolean(
    webhookSecret &&
    request.headers['x-telegram-bot-api-secret-token'] === webhookSecret
  );
}

async function configureWebhook() {
  if (!publicWebhookUrl || !webhookSecret) {
    throw new Error(
      'TELEGRAM_WEBHOOK_URL and TELEGRAM_WEBHOOK_SECRET are required'
    );
  }

  return bot.api.setWebhook(publicWebhookUrl, {
    secret_token: webhookSecret,
    allowed_updates: ['message', 'callback_query', 'my_chat_member']
  });
}

const server = http.createServer(async (request, response) => {
  try {
    const host = request.headers.host ?? 'localhost';
    const url = new URL(request.url ?? '/', 'http://' + host);

    if (request.method === 'GET' && url.pathname === '/health') {
      return json(response, 200, {
        service: 'telegram-bot',
        status: 'ok',
        mode: 'webhook',
        webhookConfigured: Boolean(publicWebhookUrl && webhookSecret)
      });
    }

    if (request.method === 'GET' && url.pathname === '/ready') {
      const missing = [
        ['TELEGRAM_BOT_TOKEN', token],
        ['API_BASE_URL', apiBaseUrl],
        ['APP_BASE_URL', appBaseUrl],
        ['INTERNAL_WORKER_SECRET', workerSecret],
        ['CRON_SECRET', cronSecret],
        ['TELEGRAM_WEBHOOK_SECRET', webhookSecret],
        ['TELEGRAM_WEBHOOK_URL', publicWebhookUrl]
      ].filter(([, value]) => !value).map(([name]) => name);

      let apiReady = false;
      let apiStatus: number | null = null;
      let apiError: string | null = null;

      if (missing.length === 0) {
        try {
          const apiResponse = await fetch(
            apiBaseUrl.replace(/\/$/, '') + '/ready',
            { signal: AbortSignal.timeout(10_000) }
          );
          apiStatus = apiResponse.status;
          apiReady = apiResponse.ok;
        } catch (error) {
          apiError = error instanceof Error ? error.message : String(error);
        }
      }

      const ready = missing.length === 0 && apiReady;
      return json(response, ready ? 200 : 503, {
        service: 'telegram-bot',
        ready,
        apiReady,
        apiStatus,
        missingEnv: missing,
        apiError
      });
    }

    if (request.method === 'POST' && url.pathname === '/webhook') {
      if (!webhookAuthorized(request)) {
        return json(response, 401, {
          error: 'UNAUTHORIZED_TELEGRAM_WEBHOOK'
        });
      }

      const update = await readJsonBody(request) as Parameters<typeof bot.handleUpdate>[0];
      await bot.handleUpdate(update);
      return json(response, 200, { ok: true });
    }

    if (request.method === 'POST' && url.pathname === '/internal/deliver') {
      if (!workerAuthorized(request)) {
        return json(response, 401, { error: 'UNAUTHORIZED_WORKER' });
      }

      const limit = Number(url.searchParams.get('limit') ?? 100);
      return json(
        response,
        200,
        await deliverPendingNotifications(limit)
      );
    }

    if (request.method === 'GET' && url.pathname === '/cron/deliver') {
      if (!cronAuthorized(request)) {
        return json(response, 401, { error: 'UNAUTHORIZED_CRON' });
      }

      return json(
        response,
        200,
        await deliverPendingNotifications(100)
      );
    }

    if (
      request.method === 'POST' &&
      url.pathname === '/internal/configure-webhook'
    ) {
      if (!workerAuthorized(request)) {
        return json(response, 401, { error: 'UNAUTHORIZED_WORKER' });
      }

      const result = await configureWebhook();
      return json(response, 200, {
        ok: Boolean(result),
        webhookUrl: publicWebhookUrl
      });
    }

    return json(response, 404, { error: 'NOT_FOUND' });
  } catch (error) {
    console.error('Bot HTTP server error', error);
    return json(response, 500, {
      error: error instanceof Error ? error.message : 'INTERNAL_ERROR'
    });
  }
});

const port = Number(process.env.PORT ?? 4100);

async function startServer() {
  // Webhook mode still requires grammY to resolve botInfo before handleUpdate().
  await bot.init();

  server.listen(port, '0.0.0.0', () => {
    void configureWebhook()
      .then(() => {
        console.log('Telegram webhook configured');
      })
      .catch((error) => {
        console.error('Telegram webhook configuration failed', error);
      });
  });
}

void startServer().catch((error) => {
  console.error('Telegram bot startup failed', error);
  process.exitCode = 1;
});
