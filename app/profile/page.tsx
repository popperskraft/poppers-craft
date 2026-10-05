import Link from "next/link";
import { redirect } from "next/navigation";
import { loginPageUrl } from "@/lib/login-return";
import { MinecraftIcon } from "@/app/MinecraftIcon";
import { canFullyEditCommunityProfile, getCommunityViewer, getPublicProfile } from "@/lib/community";
import { LogoutButton } from "@/app/members/LogoutButton";
import { PasswordForm } from "./PasswordForm";
import { EmailForm } from "./EmailForm";
import { EmailStatus } from "./EmailStatus";
import { skinUploadsUsed } from "@/lib/player-skins";
import { MfaSetup } from "./MfaSetup";
import { TelegramLoginButton } from "@/app/TelegramLoginButton";
import { getViewerIdentity } from "@/lib/waitlist";
import { marksFor } from "@/lib/player-marks";
import { WindowCloseLink } from "@/app/WindowCloseLink";
import { BackButton } from "@/app/BackButton";
import { LanguageSwitch } from "./LanguageSwitch";
import { ProfileSettings } from "./ProfileSettings";
import { PaymentsPanel } from "./PaymentsPanel";
import { ReferralPanel } from "./ReferralPanel";
import { AiConnectionsPanel } from "./AiConnectionsPanel";
import { canUseAiConnect } from "@/lib/ai-connect/config";
import { PlusStudio } from "./PlusStudio";
import { DevicesPanel } from "./DevicesPanel";
import { DeleteAccount } from "./DeleteAccount";
import { isRealEmail } from "@/lib/mail";
import { ProfileOverview } from "./ProfileOverview";
import { ProfileEditStudio } from "./ProfileEditStudio";
import { toProfileCardData } from "@/lib/profile-card";
import { cookies } from "next/headers";
import { LOCALE_COOKIE, normalizeLocale } from "@/lib/i18n/config";
import { profileViewHref, resolveProfileView, type ProfileTab } from "@/lib/profile-view";
import "./profile-window.css";

export const dynamic = "force-dynamic";

const TABS: Array<{ id: ProfileTab; label: string; icon: "totem" | "crafting_table" | "nether_star" }> = [
  { id: "profile", label: "ПРОФИЛЬ", icon: "totem" },
  { id: "settings", label: "НАСТРОЙКИ", icon: "crafting_table" },
  { id: "subscription", label: "ПОДПИСКА", icon: "nether_star" },
];

/* Окно профиля: «Профиль» (предпросмотр и редактирование карточки),
   «Настройки» (аккаунт, вход, устройства, язык) и «Подписка». Разбор адреса
   и старые ссылки — lib/profile-view.ts. */
export default async function ProfilePage({ searchParams }: { searchParams: Promise<{ tab?: string; edit?: string; section?: string }> }) {
  const view = resolveProfileView(await searchParams);
  const here = profileViewHref(view);
  const identity = await getViewerIdentity();
  if (!identity) redirect(loginPageUrl(here));
  if (identity.needsMfa) redirect(`/mfa?next=${encodeURIComponent(here)}`);
  const viewer = await getCommunityViewer({ identity, allowAuthenticated: true });
  if (!viewer) redirect("/");

  const locale = normalizeLocale((await cookies()).get(LOCALE_COOKIE)?.value ?? viewer.user.user_metadata?.language);
  const marks = await marksFor(viewer.user.id, { frames: true });
  const hype = marks.plus && marks.tier === "hype";
  /* Готовый файл скина загружается один раз; менять его дальше — тариф HYPE. */
  const canUploadSkin = hype ? true : skinUploadsUsed(viewer.user.id, viewer.user.user_metadata, viewer.user.app_metadata) < 1;
  const canEditLogin = canFullyEditCommunityProfile(viewer);
  /* Студия редактирования: живая карточка начинается с сохранённой. */
  const editProfile = view.tab === "profile" && view.editing ? await getPublicProfile(viewer.profile.login, viewer).catch(() => null) : null;
  const editCard = editProfile ? toProfileCardData(editProfile) : null;

  return (
    <main className="profile-page profile-page-with-tabs">
      {/* Разделы профиля — над окном (просьба владельца, 2026-10-04). */}
      <nav className="profile-tabs profile-page-tabs" aria-label="Разделы профиля">
        {TABS.map((tab) => (
          <Link key={tab.id} href={profileViewHref({ tab: tab.id })} aria-current={view.tab === tab.id ? "page" : undefined}>
            <MinecraftIcon name={tab.icon} size="sm" /> {tab.label}
          </Link>
        ))}
      </nav>
      <div className="paint-window profile-window">
        <div className="window-bar">
          <span className="window-title-with-icon">
            <MinecraftIcon name="totem" size="sm" /> profile.exe
          </span>
          <BackButton />
          <div className="window-actions"><i aria-hidden="true">_</i><i aria-hidden="true">□</i><WindowCloseLink /></div>
        </div>
        <div className="profile-content">
          <span className="profile-role">
            {viewer.adminProfile
              ? viewer.adminProfile.role === "owner"
                ? "ВЛАДЕЛЕЦ"
                : "АДМИНИСТРАТОР"
              : "ИГРОК"}
          </span>
          <h1 className="profile-window-name"><span translate="no">{viewer.profile.display_name}</span> <small translate="no">@{viewer.profile.login}</small></h1>

          {view.tab === "profile" && !view.editing ? <ProfileOverview viewer={viewer} /> : null}

          {view.tab === "profile" && view.editing ? (
            editCard ? (
              <ProfileEditStudio
                card={editCard}
                editor={{
                  profile: viewer.profile,
                  hidePrideFlags: Boolean(viewer.user.app_metadata?.hide_pride_flags),
                  canEditLogin,
                  plus: marks.plus,
                  tier: marks.tier,
                  ring: marks.ring,
                  headerFrames: marks.headerFrames,
                  headerFrameMs: marks.headerFrameMs,
                  canUploadSkin,
                  hype,
                }}
              />
            ) : <p className="form-message error-message">Не удалось загрузить карточку. Обновите страницу.</p>
          ) : null}

          {view.tab === "settings" ? (
            <ProfileSettings initialSection={view.section} sections={[
              {
                id: "account",
                label: "АККАУНТ И ПОЧТА",
                content: <>
                  <section className="profile-password">
                    <p>ACCOUNT.INI</p>
                    <h2>АККАУНТ</h2>
                    <div className="profile-identity">
                      <div><small>ИГРОВОЙ НИК</small><strong translate="no">@{viewer.profile.login}</strong></div>
                      <div><small>ПОЧТА</small><strong>{viewer.user.email}</strong></div>
                    </div>
                    {canEditLogin ? null : <p>Ник привязан к игре и лаунчеру — на нём держатся инвентарь, дом и статистика, поэтому сменить его нельзя.</p>}
                  </section>
                  <section className="profile-password">
                    <p>EMAIL_CHANGE.EXE</p>
                    <h2>СМЕНА ПОЧТЫ</h2>
                    <EmailStatus email={viewer.user.email ?? ""} confirmed={Boolean(viewer.user.app_metadata?.email_verified_at)} />
                    <EmailForm currentEmail={viewer.user.email ?? ""} />
                  </section>
                  <section className="profile-password delete-account-section" id="delete-account">
                    <p>ACCOUNT_DELETE.EXE</p>
                    <h2>УДАЛЕНИЕ АККАУНТА</h2>
                    <DeleteAccount hasEmail={isRealEmail(viewer.user.email)} staff={Boolean(viewer.adminProfile)} />
                  </section>
                </>,
              },
              {
                id: "security",
                label: "ВХОД И БЕЗОПАСНОСТЬ",
                content: <>
                  <section className="profile-password">
                    <p>SECURITY.EXE</p>
                    <h2>СМЕНА ПАРОЛЯ</h2>
                    <PasswordForm />
                  </section>
                  <section className="profile-password">
                    <p>2FA_SETUP.EXE</p>
                    <h2>ДВУХФАКТОРНАЯ ЗАЩИТА</h2>
                    <MfaSetup />
                  </section>
                  <section className="profile-password">
                    <p>TELEGRAM_LOGIN.EXE</p>
                    <h2>ВХОД ЧЕРЕЗ TELEGRAM</h2>
                    <p>После привязки можно будет входить через Telegram.</p>
                    <TelegramLoginButton
                      mode="link"
                      initiallyLinked={Boolean(viewer.user.app_metadata?.telegram_sub || viewer.user.app_metadata?.telegram_id)}
                    />
                  </section>
                </>,
              },
              {
                id: "devices",
                label: "АКТИВНЫЕ УСТРОЙСТВА",
                content: <section className="profile-password">
                  <p>DEVICES.LOG</p>
                  <h2>АКТИВНЫЕ УСТРОЙСТВА</h2>
                  <p>Где сейчас открыт ваш аккаунт: браузеры, приложение и лаунчер.</p>
                  <DevicesPanel />
                </section>,
              },
              {
                id: "language",
                label: "ЯЗЫК САЙТА",
                content: <section className="profile-password profile-language">
                  <p>LANGUAGE.INI</p>
                  <h2>ЯЗЫК САЙТА</h2>
                  <p>Язык интерфейса. Чат с поддержкой остаётся на русском.</p>
                  <LanguageSwitch current={locale} />
                </section>,
              },
              { id: "referrals", label: "ПРИГЛАСИТЬ ДРУГА", content: <ReferralPanel /> },
              /* Подключение ChatGPT и Claude (lib/ai-connect) — только владельцу. */
              {
                id: "ai",
                label: "НЕЙРОСЕТИ",
                content: canUseAiConnect(viewer.user.id) ? <section className="profile-password">
                  <p>AI_CONNECT.EXE</p>
                  <h2>НЕЙРОСЕТИ</h2>
                  <AiConnectionsPanel />
                </section> : undefined,
              },
            ]} />
          ) : null}

          {view.tab === "subscription" ? (
            <section className="profile-password profile-subscription">
              <p>SUBSCRIPTION.EXE</p>
              <h2>ПОДПИСКА</h2>
              <p>Срок подписки, ближайшее списание и автопродление. Оформление, которое даёт подписка, настраивается в <Link href="/profile?edit=1">редактировании профиля</Link>.</p>
              <PaymentsPanel afterPlan={<PlusStudio login={viewer.profile.login} parts={["perks", "tenure", "early"]} />} />
            </section>
          ) : null}

          <div className="profile-logout-bottom"><LogoutButton /></div>
        </div>
        <div className="status-bar"><span>SESSION_ACTIVE</span><span>POPPERSCRAFT</span></div>
      </div>
    </main>
  );
}
