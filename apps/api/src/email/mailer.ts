import nodemailer from 'nodemailer';

function senderAddress() {
  return process.env.EMAIL_FROM || process.env.SMTP_FROM;
}

async function sendViaResend(input: {
  to: string;
  subject: string;
  text: string;
  html: string;
  idempotencyKey: string;
}) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = senderAddress();
  if (!apiKey || !from) return false;

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
      'idempotency-key': input.idempotencyKey
    },
    body: JSON.stringify({
      from,
      to: [input.to],
      subject: input.subject,
      text: input.text,
      html: input.html
    }),
    signal: AbortSignal.timeout(20_000)
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 2000);
    throw new Error(`RESEND_SEND_FAILED:${response.status}:${detail}`);
  }

  return true;
}

function smtpConfig() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT ?? 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = senderAddress();

  if (!host || !user || !pass || !from) {
    return null;
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

export function emailProviderConfigured() {
  const resend = Boolean(process.env.RESEND_API_KEY && senderAddress());
  const smtp = Boolean(
    process.env.SMTP_HOST &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASS &&
    senderAddress()
  );
  return resend || smtp;
}

export async function sendEmailVerificationCode(email: string, code: string) {
  const subject = 'DotacjaPRO — kod weryfikacyjny';
  const text = `Twój kod weryfikacyjny DotacjaPRO: ${code}\n\nKod jest ważny przez 10 minut.`;
  const html = `<p>Twój kod weryfikacyjny DotacjaPRO:</p><p style="font-size:24px;font-weight:700;letter-spacing:4px">${code}</p><p>Kod jest ważny przez 10 minut.</p>`;

  if (await sendViaResend({
    to: email,
    subject,
    text,
    html,
    idempotencyKey: `email-verification/${email.toLowerCase()}/${code}`
  })) {
    return;
  }

  const smtp = smtpConfig();
  if (!smtp) {
    throw new Error('EMAIL_PROVIDER_NOT_CONFIGURED');
  }

  await smtp.transport.sendMail({
    from: smtp.from,
    to: email,
    subject,
    text,
    html
  });
}
