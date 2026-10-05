import "server-only";

/* Письма уходят через Brevo по их HTTP API: бесплатный тариф, домен
   подтверждён DKIM, отдельный почтовый сервер держать не нужно. */

export type MailLocale = "ru" | "en";

const BREVO_ENDPOINT = "https://api.brevo.com/v3/smtp/email";
const DEFAULT_SENDER_EMAIL = "noreply@popperscraft.org";
const DEFAULT_SENDER_NAME = "PoppersCraft";
const SUPPORT_LINK = "https://t.me/PoppersCraftAuthBot";

export type MailContent = {
  to: string;
  toName?: string;
  subject: string;
  heading: string;
  lines: string[];
  button?: { label: string; url: string };
  note?: string;
  locale?: MailLocale;
};

export function mailLocale(value: unknown): MailLocale {
  return String(value ?? "").toLowerCase() === "en" ? "en" : "ru";
}

export function mailEnabled() {
  return Boolean(process.env.BREVO_API_KEY);
}

/* Ящики вида login@users.popperscraft.org создаются для входа через Telegram —
   почты у них нет, писать туда некуда. */
export function isRealEmail(email: string | null | undefined) {
  const value = String(email ?? "").trim().toLowerCase();
  return value.includes("@") && !value.endsWith("@users.popperscraft.org");
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const FOOTER: Record<MailLocale, string> = {
  ru: `Письмо отправлено сайтом popperscraft.org. Если вы ничего не запрашивали — просто удалите его. Ответить на это письмо нельзя, поддержка живёт в Telegram: ${SUPPORT_LINK}`,
  en: `This letter was sent by popperscraft.org. If you did not request anything, just delete it. Replies to this address are not read — support lives in Telegram: ${SUPPORT_LINK}`,
};

/* Почтовые клиенты выбрасывают внешние стили и современные селекторы, поэтому
   вся вёрстка — таблицы и инлайновые стили. Шрифт сайта Monocraft письмо
   подгружает с popperscraft.org: Почта на iPhone и Mac его показывает, а Gmail
   и Outlook веб-шрифты не поддерживают и берут запасной Courier New. */
function renderHtml(content: MailContent, locale: MailLocale) {
  const font = "Monocraft, 'Courier New', Courier, ui-monospace, monospace";
  const body = content.lines
    .map(
      (line) =>
        `<p style="margin:0 0 14px;font:400 15px/1.55 ${font};color:#111111;">${escapeHtml(line)}</p>`,
    )
    .join("");
  const button = content.button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0 6px;">
        <tr><td style="background:#c6f432;border:3px solid #111111;box-shadow:4px 4px 0 #111111;">
          <a href="${escapeHtml(content.button.url)}" style="display:block;padding:13px 26px;font:700 15px/1 ${font};letter-spacing:1px;color:#111111;text-decoration:none;text-transform:uppercase;">${escapeHtml(content.button.label)}</a>
        </td></tr>
      </table>
      <p style="margin:14px 0 0;font:400 12px/1.5 ${font};color:#555555;word-break:break-all;">${escapeHtml(content.button.url)}</p>`
    : "";
  const note = content.note
    ? `<p style="margin:18px 0 0;padding:12px 14px;border:2px solid #111111;background:#fdf6b5;font:400 13px/1.5 ${font};color:#111111;">${escapeHtml(content.note)}</p>`
    : "";

  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(content.subject)}</title>
<style>@font-face{font-family:"Monocraft";src:url("${siteUrl()}/Monocraft.ttf") format("truetype");font-weight:100 900;font-style:normal;}</style></head>
<body style="margin:0;padding:24px 12px;background:#f2efe6;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;margin:0 auto;">
    <tr><td style="background:#ffffff;border:3px solid #111111;box-shadow:6px 6px 0 #111111;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
        <tr><td style="background:#111111;padding:10px 16px;font:700 13px/1 ${font};letter-spacing:2px;color:#c6f432;text-transform:uppercase;">POPPERSCRAFT</td></tr>
        <tr><td style="padding:26px 24px 28px;">
          <h1 style="margin:0 0 18px;font:700 22px/1.25 ${font};letter-spacing:1px;color:#111111;text-transform:uppercase;">${escapeHtml(content.heading)}</h1>
          ${body}${button}${note}
        </td></tr>
      </table>
    </td></tr>
    <tr><td style="padding:16px 6px 0;font:400 12px/1.5 ${font};color:#555555;">${escapeHtml(FOOTER[locale])}</td></tr>
  </table>
</body></html>`;
}

function renderText(content: MailContent, locale: MailLocale) {
  const parts = [content.heading.toUpperCase(), "", ...content.lines];
  if (content.button) parts.push("", `${content.button.label}: ${content.button.url}`);
  if (content.note) parts.push("", content.note);
  parts.push("", FOOTER[locale]);
  return parts.join("\n");
}

export async function sendSiteMail(content: MailContent): Promise<{ ok: boolean; error?: string }> {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) return { ok: false, error: "mail_disabled" };
  if (!isRealEmail(content.to)) return { ok: false, error: "no_real_email" };

  const locale = content.locale ?? "ru";
  const payload = {
    sender: {
      email: process.env.BREVO_SENDER_EMAIL || DEFAULT_SENDER_EMAIL,
      name: process.env.BREVO_SENDER_NAME || DEFAULT_SENDER_NAME,
    },
    to: [{ email: content.to, ...(content.toName ? { name: content.toName } : {}) }],
    subject: content.subject,
    htmlContent: renderHtml(content, locale),
    textContent: renderText(content, locale),
  };

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    const response = await fetch(BREVO_ENDPOINT, {
      method: "POST",
      headers: {
        "api-key": apiKey,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timer);
    if (response.ok) return { ok: true };
    const detail = await response.text().catch(() => "");
    /* Ключ и адреса игроков в логи не попадают — только код ответа. */
    console.error("brevo send failed", { status: response.status, detail: detail.slice(0, 300) });
    return { ok: false, error: `http_${response.status}` };
  } catch (error) {
    console.error("brevo send crashed", { message: error instanceof Error ? error.message : "unknown" });
    return { ok: false, error: "network" };
  }
}

export function siteUrl() {
  const base = process.env.NEXT_PUBLIC_SITE_URL || "https://popperscraft.org";
  return base.replace(/\/+$/, "");
}
