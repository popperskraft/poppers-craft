import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCommunityViewer } from "@/lib/community";
import { marksFor } from "@/lib/player-marks";
import { getViewerIdentity } from "@/lib/waitlist";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Подписка — PoppersCraft",
  robots: { index: false, follow: false },
};

/* PLUS в основном меню. Без подписки — тарифы. С подпиской — раздел
   «Подписка» в окне профиля (r089): срок, списания, что даёт подписка.
   Оформление (обводка, фон, шапка, скин) теперь в «Профиль → Редактировать».
   Доступ проверяется на сервере при каждом открытии, включая старые ссылки. */
export default async function PlusPage() {
  const identity = await getViewerIdentity();
  if (!identity) redirect("/donation");
  if (identity.needsMfa) redirect("/mfa?next=/plus");
  const viewer = await getCommunityViewer({ identity, allowAuthenticated: true });
  if (!viewer) redirect("/");
  const marks = await marksFor(viewer.user.id);
  if (!marks.plus) redirect("/donation");
  redirect("/profile?tab=subscription");
}
