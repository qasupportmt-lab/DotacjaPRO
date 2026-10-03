import { Bot, InlineKeyboard } from 'grammy';

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) throw new Error('TELEGRAM_BOT_TOKEN is required');

const apiBaseUrl = process.env.API_BASE_URL ?? 'http://localhost:4000';
const appBaseUrl = process.env.APP_BASE_URL ?? 'https://example.com';
const workerSecret = process.env.INTERNAL_WORKER_SECRET ?? '';

const bot = new Bot(token);

bot.command('start', async (ctx) => {
  const keyboard = new InlineKeyboard().webApp('Otwórz DotacjaPRO', appBaseUrl);

  await ctx.reply(
    'DotacjaPRO sprawdzi dostępne finansowanie i poprowadzi Twoją sprawę na aktualnych, oficjalnych formularzach urzędowych.',
    { reply_markup: keyboard }
  );
});

bot.command('dotacje', async (ctx) => {
  const keyboard = new InlineKeyboard().webApp('Sprawdź finansowanie', appBaseUrl);
  await ctx.reply('Otwórz DotacjaPRO, aby sprawdzić programy dopasowane do Twojego regionu i sytuacji.', {
    reply_markup: keyboard
  });
});

async function reportDelivery(id: string, success: boolean, error?: string) {
  if (!workerSecret) return;
  await fetch(`${apiBaseUrl}/v1/internal/notifications/${id}/delivery`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-worker-secret': workerSecret
    },
    body: JSON.stringify({ success, error })
  });
}

async function deliverPendingNotifications() {
  if (!workerSecret) return;

  const response = await fetch(`${apiBaseUrl}/v1/internal/notifications/pending?limit=100`, {
    headers: { 'x-worker-secret': workerSecret }
  });
  if (!response.ok) throw new Error(`Notification queue HTTP ${response.status}`);

  const data = await response.json() as {
    notifications: Array<{
      id: string;
      telegramUserId: string;
      title: string;
      body: string;
    }>;
  };

  for (const item of data.notifications) {
    try {
      const keyboard = new InlineKeyboard().webApp('Otwórz DotacjaPRO', appBaseUrl);
      await bot.api.sendMessage(
        Number(item.telegramUserId),
        `<b>${item.title}</b>\n\n${item.body}`,
        { parse_mode: 'HTML', reply_markup: keyboard }
      );
      await reportDelivery(item.id, true);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await reportDelivery(item.id, false, message.slice(0, 1900));
    }
  }
}

let delivering = false;
setInterval(async () => {
  if (delivering) return;
  delivering = true;
  try {
    await deliverPendingNotifications();
  } catch (error) {
    console.error('Notification worker error', error);
  } finally {
    delivering = false;
  }
}, 30_000);

bot.catch((err) => console.error('Bot error', err));
void bot.start();
