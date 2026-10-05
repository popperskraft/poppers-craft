/* Окно профиля (/profile) — три раздела, как просил владелец (2026-10-02):
     «Профиль»   — предпросмотр карточки и кнопка «Редактировать»
                   (?edit=1: о себе, шапка, обводка, фон, скин, модели, гардероб);
     «Настройки» — аккаунт и почта, вход и безопасность, устройства, язык,
                   приглашения (?tab=settings&section=…);
     «Подписка»  — срок, ближайшее списание, автопродление, что даёт подписка,
                   история платежей (?tab=subscription).
   Старые адреса вкладок (?tab=payments, ?tab=referrals…) ведут в новые места. */

export type ProfileTab = "profile" | "settings" | "subscription";
export const SETTINGS_SECTIONS = ["account", "security", "devices", "language", "referrals", "ai"] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

export type ProfileView = { tab: ProfileTab; editing: boolean; section: SettingsSection | null };

const TABS: Record<string, { tab: ProfileTab; edit?: boolean; section?: SettingsSection }> = {
  profile: { tab: "profile" },
  settings: { tab: "settings" },
  subscription: { tab: "subscription" },
  /* Адреса вкладок до r089. */
  payments: { tab: "subscription" },
  plus: { tab: "profile", edit: true },
  appearance: { tab: "profile", edit: true },
  referrals: { tab: "settings", section: "referrals" },
  security: { tab: "settings", section: "security" },
  language: { tab: "settings", section: "language" },
  ai: { tab: "settings", section: "ai" },
};

export function resolveProfileView(params: { tab?: unknown; edit?: unknown; section?: unknown }): ProfileView {
  const base = TABS[typeof params.tab === "string" ? params.tab : ""] ?? TABS.profile;
  const requested = typeof params.section === "string" && (SETTINGS_SECTIONS as readonly string[]).includes(params.section)
    ? params.section as SettingsSection
    : null;
  return {
    tab: base.tab,
    editing: base.tab === "profile" && (Boolean(base.edit) || params.edit === "1"),
    section: base.tab === "settings" ? requested ?? base.section ?? null : null,
  };
}

export function profileViewHref(view: Partial<ProfileView> & { tab: ProfileTab }) {
  if (view.tab === "subscription") return "/profile?tab=subscription";
  if (view.tab === "settings") return view.section ? `/profile?tab=settings&section=${view.section}` : "/profile?tab=settings";
  return view.editing ? "/profile?edit=1" : "/profile";
}
