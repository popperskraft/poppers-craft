import Link from "next/link";
import { getPublicProfile, type CommunityViewer } from "@/lib/community";
import { toProfileCardData } from "@/lib/profile-card";
import { ProfileCard } from "./ProfileCard";

/* «Профиль» в окне профиля: карточка так, как её видят другие игроки
   (те же стили, что у /players/<ник>), и кнопка «Редактировать». */
export async function ProfileOverview({ viewer }: { viewer: CommunityViewer }) {
  const profile = await getPublicProfile(viewer.profile.login, viewer).catch(() => null);
  if (!profile) {
    return <p className="form-message error-message">Не удалось загрузить карточку. Обновите страницу.</p>;
  }
  return (
    <section className="profile-overview" aria-label="Предпросмотр профиля">
      <div className="profile-overview-actions">
        <Link className="profile-primary-action profile-edit-button" href="/profile?edit=1">✎ РЕДАКТИРОВАТЬ ПРОФИЛЬ</Link>
      </div>
      {/* Кнопки «Как видят другие» больше нет (r092): она уводила на карточку
          в разделе «Лента», а предпросмотр ниже и так показывает её целиком. */}
      <p className="profile-overview-note">Так вашу карточку видят другие игроки. Описание, шапку, обводку, фон и скин можно изменить кнопкой «Редактировать профиль».</p>
      <ProfileCard card={toProfileCardData(profile)} />
    </section>
  );
}
