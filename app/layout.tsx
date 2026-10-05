import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { headers } from "next/headers";
import { PwaRegistration } from "./PwaRegistration";
import { PlatformUpdateToast } from "./PlatformUpdateToast";
import { CookieConsent } from "./CookieConsent";
import { MobileDesktopHint } from "./MobileDesktopHint";
import { BugReport } from "./BugReport";
import { PoppersAssistant } from "./PoppersAssistant";
import { GrammarAssistant } from "./GrammarAssistant";
import { SiteCrashGuard } from "./SiteCrashGuard";
import { NavigationHistory } from "./NavigationHistory";
import { ReferralCapture } from "./ReferralCapture";
import { SiteHeader } from "./SiteHeader";
import { SiteRatingPrompt } from "./SiteRatingPrompt";
import { UserAgreementGate } from "./UserAgreementGate";
import { PlusCelebration } from "./PlusCelebration";
import { GuestScreenshotShield } from "./GuestScreenshotShield";
import { OpeningGate } from "./OpeningGate";
import { LanguageRuntime } from "./LanguageRuntime";
import { cookies } from "next/headers";
import { LOCALE_COOKIE, normalizeLocale, type Locale } from "@/lib/i18n/config";
import { ErrorMonitor } from "./ErrorMonitor";
import { AGREEMENT_VERSION } from "@/lib/user-agreement";
import { getAcceptedAgreementVersion } from "@/lib/user-agreement-store";
import { getSiteSettings, getViewerIdentity } from "@/lib/waitlist";
import type { NavViewer } from "@/lib/site-navigation";
import { navViewerFor } from "@/lib/site-navigation-viewer";
import { after } from "next/server";
import { currentSessionId, rememberDevice } from "@/lib/session-devices";
import { clientAddressFrom } from "@/lib/request-security";
import "./globals.css";
/* Подключается после globals.css: при равной специфичности выигрывает
   правило, объявленное последним. */
import "./text-containment.css";
import "./opening.css";
/* Режим приложения для iPhone: действует только при html[data-pc-app]. */
import "./app-mode.css";
import "./online-status.css";
import "./profile-ux.css";
import "./player-marks.css";
import "./card-themes.css";
/* Общая шапка внутренних страниц (app/SiteHeader.tsx). */
import "./site-nav.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#1c44da",
};

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ??
    requestHeaders.get("host") ??
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/^https?:\/\//, "") ??
    "popperscraft.vercel.app";
  const protocol =
    requestHeaders.get("x-forwarded-proto") === "http" ? "http" : "https";
  let metadataBase: URL;
  try {
    metadataBase = new URL(`${protocol}://${host}`);
  } catch {
    metadataBase = new URL(
      process.env.NEXT_PUBLIC_SITE_URL ?? "https://popperscraft.vercel.app",
    );
  }

  const title = "PoppersCraft - minecraft server";
  const description = normalizeLocale((await cookies()).get(LOCALE_COOKIE)?.value) === "en"
    ? "Minecraft server"
    : "Майнкрафт сервер";

  return {
    metadataBase,
    title,
    description,
    manifest: "/manifest.webmanifest",
    applicationName: "PoppersCraft",
    alternates: { canonical: "/" },
    appleWebApp: {
      capable: true,
      title: "PoppersCraft",
      statusBarStyle: "black-translucent",
    },
    icons: {
      icon: "/popperscraft-p.svg?v=2",
      shortcut: "/popperscraft-p.svg?v=2",
      apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
    },
    openGraph: {
      title,
      description,
      type: "website",
      images: [{ url: "/og.png", width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: ["/og.png"],
    },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  let crashModeActive = false;
  let ratingPromptId: string | null = null;
  let viewerId: string | null = null;
  let needsAgreement = false;
  let openingAt: string | null = null;
  let navViewer: NavViewer | null = null;
  /* Язык: cookie из настроек профиля, а на новом устройстве — выбор,
     сохранённый в профиле. */
  const localeCookie = (await cookies()).get(LOCALE_COOKIE)?.value;
  let locale: Locale = normalizeLocale(localeCookie);
  try {
    const [settings, viewer] = await Promise.all([
      getSiteSettings(),
      getViewerIdentity(),
    ]);
    const isOwner = viewer?.adminProfile?.role === "owner";
    crashModeActive = settings.crashMode && !isOwner;
    ratingPromptId = settings.ratingPromptId;
    /* Опрос об оценке сайта показывается только вошедшим пользователям. */
    viewerId = viewer?.user.id ?? null;
    if (!localeCookie && viewer?.user.user_metadata?.language) locale = normalizeLocale(viewer.user.user_metadata.language);
    /* Отсчёт до открытия закрывает сайт для всех, кроме администраторов. */
    const isAdmin = Boolean(viewer?.adminProfile?.active) && !viewer?.needsMfa;
    openingAt = isAdmin ? null : settings.openingAt;
    /* Соглашение спрашивается у вошедшего, пока он не принял текущую
       редакцию. Сбой чтения не должен закрывать сайт, поэтому при ошибке
       окно просто не показывается. */
    if (viewer) {
      needsAgreement = (await getAcceptedAgreementVersion(viewer.user.id)) !== AGREEMENT_VERSION;
    }
    navViewer = await navViewerFor(viewer);
    /* Запомнить устройство этой сессии (Профиль → Настройки → Устройства):
       пишется после ответа и не чаще раза в 15 минут. */
    if (viewer) {
      const requestHeaders = await headers();
      const device = {
        sessionId: await currentSessionId(viewer.user.id).catch(() => null),
        userId: viewer.user.id,
        userAgent: requestHeaders.get("user-agent") ?? "",
        ip: clientAddressFrom(requestHeaders),
      };
      after(() => rememberDevice(device).catch(() => undefined));
    }
  } catch {
    // A settings outage must not make the public site unavailable.
  }

  return (
    <html lang={locale} className={locale === "en" ? "i18n-pending" : undefined} suppressHydrationWarning>
      {locale === "en" ? (
        <head>
          {/* Страница скрыта до перевода, но не дольше 2,5 секунды — даже если
              скрипт перевода не загрузится, сайт останется доступен. */}
          <script
            dangerouslySetInnerHTML={{
              __html: "setTimeout(function(){document.documentElement.classList.remove('i18n-pending')},2500)",
            }}
          />
        </head>
      ) : null}
      <body className={crashModeActive ? "site-crash-mode" : undefined}>
        <LanguageRuntime locale={locale} />
        <ErrorMonitor />
        <Suspense fallback={null}><NavigationHistory /></Suspense>
        <Suspense fallback={null}><ReferralCapture /></Suspense>
        <OpeningGate openingAt={openingAt} serverNow={Date.now()}><SiteHeader viewer={navViewer} />{children}</OpeningGate>
        <PlatformUpdateToast />
        <PwaRegistration />
        <CookieConsent />
        <MobileDesktopHint />
        <BugReport />
        <PoppersAssistant />
        <GrammarAssistant />
        <SiteCrashGuard initialActive={crashModeActive} />
        <SiteRatingPrompt initialPromptId={ratingPromptId} viewerId={viewerId} />
        <UserAgreementGate needsAcceptance={needsAgreement} />
        {/* Подаренный или выданный PLUS встречает игрока торжественным окном. */}
        <PlusCelebration enabled={viewerId !== null && !needsAgreement} />
        {/* Помеха снимку экрана действует только до входа в аккаунт. */}
        <GuestScreenshotShield active={viewerId === null} />
      </body>
    </html>
  );
}
