import nodemailer from 'nodemailer';

function smtpConfig() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT ?? 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM;

  if (!host || !user || !pass || !from) {
    throw new Error('SMTP is not configured');
  }

  return {
    from,
    transport: nodemailer.createTransport({
      host,
      port,
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user, pass }
    })
  };
}

export async function sendEmailVerificationCode(email: string, code: string) {
  const { from, transport } = smtpConfig();

  await transport.sendMail({
    from,
    to: email,
    subject: 'DotacjaPRO — kod weryfikacyjny',
    text: `Twój kod weryfikacyjny DotacjaPRO: ${code}\n\nKod jest ważny przez 10 minut.`,
    html: `<p>Twój kod weryfikacyjny DotacjaPRO:</p><p style="font-size:24px;font-weight:700;letter-spacing:4px">${code}</p><p>Kod jest ważny przez 10 minut.</p>`
  });
}
