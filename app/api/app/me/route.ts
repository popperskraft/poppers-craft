import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { readSupporter } from "@/lib/app-store";
import { canFullyEditCommunityProfile, getCommunityViewer } from "@/lib/community";
import { LOCALE_COOKIE, normalizeLocale } from "@/lib/i18n/config";
import { emptyPixelHeaderArt } from "@/lib/profile-header-art";
import { SOCIAL_LINK_FIELDS, parseSocialLinks } from "@/lib/social-links";
import { isPrideHeaderFlag } from "@/lib/header-flags";
import { AGREEMENT_DATE, AGREEMENT_SECTIONS, AGREEMENT_SUMMARY, AGREEMENT_VERSION } from "@/lib/user-agreement";
import { getAcceptedAgreementVersion } from "@/lib/user-agreement-store";
import { getApprovedMember, getViewerIdentity } from "@/lib/waitlist";

export const dynamic = "force-dynamic";

/* Кто вошёл — для приложения PoppersCraft на iPhone.

   Приложение пользуется той же cookie-сессией, что и сайт, поэтому здесь нет
   ничего, чего вошедший пользователь не видит на своих страницах: ник, имя,
   цвет шапки, скин и роли. Текст соглашения отдаётся, только если его нужно
   принять, — как UserAgreementGate в layout.tsx. */
export async function GET() {
  const identity = await getViewerIdentity();
  if (!identity || identity.needsMfa) {
    return NextResponse.json({ error: "Войдите в аккаунт." }, { status: 401, headers: { "Cache-Control": "private, no-store" } });
  }

  const [viewer, member, acceptedVersion] = await Promise.all([
    getCommunityViewer({ identity, allowAuthenticated: true }).catch(() => null),
    getApprovedMember().catch(() => null),
    getAcceptedAgreementVersion(identity.user.id).catch(() => AGREEMENT_VERSION),
  ]);
  const needsAgreement = acceptedVersion !== AGREEMENT_VERSION;
  const localeCookie = (await cookies()).get(LOCALE_COOKIE)?.value;
  const language = normalizeLocale(localeCookie ?? identity.user.user_metadata?.language);
  const socials = parseSocialLinks(viewer?.profile.social_links);
  const email = String(identity.user.email ?? "");
  const hidePrideFlags = Boolean(identity.user.app_metadata?.hide_pride_flags);
  const flag = viewer?.profile.header_flag ?? "none";
  const supporter = readSupporter(identity.user.app_metadata);

  return NextResponse.json(
    {
      userId: identity.user.id,
      login: viewer?.profile.login ?? String(identity.user.email ?? "").split("@")[0],
      displayName: viewer?.profile.display_name ?? "",
      headerColor: viewer?.profile.header_color ?? null,
      headerFlag: hidePrideFlags && isPrideHeaderFlag(flag) ? "none" : flag,
      skinUrl: viewer?.profile.skin_url ?? null,
      isAdmin: Boolean(identity.adminProfile?.active),
      isMember: Boolean(member),
      /* Подписка «Поддержка сервера» из App Store: значок ♥ у ника в приложении. */
      supporter: supporter?.active ?? false,
      supporterUntil: supporter?.expiresAt ?? null,
      needsAgreement,
      agreementVersion: AGREEMENT_VERSION,
      agreement: needsAgreement
        ? { version: AGREEMENT_VERSION, date: AGREEMENT_DATE, summary: AGREEMENT_SUMMARY, sections: AGREEMENT_SECTIONS }
        : null,
      /* Поля редактора профиля в приложении — те же, что у CommunityProfileEditor.
         Контакты отдаются по полям PATCH /api/profile/community (socialTelegram…). */
      editable: viewer
        ? {
            login: viewer.profile.login,
            canEditLogin: canFullyEditCommunityProfile(viewer),
            displayName: viewer.profile.display_name,
            bio: viewer.profile.bio,
            favoriteMusic: viewer.profile.favorite_music,
            favoriteMovies: viewer.profile.favorite_movies,
            headerColor: viewer.profile.header_color,
            headerFlag: viewer.profile.header_flag,
            headerArt: viewer.profile.header_art ?? emptyPixelHeaderArt(),
            hidePrideFlags,
            socials: [
              ...SOCIAL_LINK_FIELDS.map((field) => ({ field: field.name, label: field.label, placeholder: field.placeholder, value: socials[field.key] })),
              { field: "socialOther", label: "Другое", placeholder: "Любые ссылки, по одной в строке", value: socials.other },
            ],
            language,
            email: email.endsWith("@users.popperscraft.org") ? "" : email,
          }
        : null,
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
