import { Bot, InlineKeyboard } from 'grammy';

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) throw new Error('TELEGRAM_BOT_TOKEN is required');

const bot = new Bot(token);

bot.command('start', async (ctx) => {
  const keyboard = new InlineKeyboard()
    .webApp('Otwórz DotacjaPRO', process.env.APP_BASE_URL ?? 'https://example.com');

  await ctx.reply(
    'DotacjaPRO sprawdzi dostępne finansowanie i poprowadzi Twoją sprawę na aktualnych, oficjalnych formularzach urzędowych.',
    { reply_markup: keyboard }
  );
});

bot.catch((err) => console.error('Bot error', err));
bot.start();
