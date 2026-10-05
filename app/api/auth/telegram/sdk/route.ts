import { NextResponse } from "next/server";

const officialTelegramSdk = "https://oauth.telegram.org/js/telegram-login.js?5";

export async function GET() {
  try {
    const response = await fetch(officialTelegramSdk, {
      redirect: "error",
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`Telegram SDK returned ${response.status}`);

    const source = await response.text();
    const originLine = "var OIDC_ORIGIN = getScriptOrigin('https://oauth.telegram.org', 'https://oauth.tg.dev');";
    const redirectLine = "var redirectUri = location.origin + location.pathname;";
    if (!source.includes(originLine) || !source.includes(redirectLine)) {
      throw new Error("Telegram SDK markers changed");
    }
    const sameOriginSource = source
      .replace(originLine, "var OIDC_ORIGIN = 'https://oauth.telegram.org';")
      .replace(redirectLine, "var redirectUri = opts.redirect_uri || location.origin + location.pathname;");

    return new NextResponse(sameOriginSource, {
      headers: {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "public, max-age=0, s-maxage=3600, must-revalidate",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new NextResponse("throw new Error('Telegram SDK is temporarily unavailable');", {
      status: 503,
      headers: {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
}
