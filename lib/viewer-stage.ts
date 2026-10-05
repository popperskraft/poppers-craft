/* Кто смотрит главную и куда ведут её кнопки. Один источник правды для
   первого экрана, блока доната/PLUS, «Скоро» и меню — чтобы надпись на
   кнопке всегда совпадала с тем, что откроется. */

import type { PlusTier } from "@/lib/plus-style";

export type ViewerAccess = {
  approved: boolean;
  serverAccess: boolean;
  passRequired: boolean;
  passForSale: boolean;
  paymentsOpen: boolean;
  test: boolean;
  /* tier — тариф прямо сейчас, renewTier — тариф автопродления. */
  plus: { active: boolean; renewsItself: boolean; tier?: PlusTier; renewTier?: PlusTier } | null;
};

export type ViewerStage =
  | "guest" // не вошёл
  | "mfa" // вошёл, но не подтвердил код 2FA
  | "member" // одобренная анкета и доступ к серверу (пропуск есть или не нужен)
  | "needs-pass" // анкета одобрена, пропуск обязателен и не оплачен
  | "admin" // администратор без анкеты игрока
  | "no-access"; // вошёл, но анкеты нет или она закрыта

export type StageViewer = {
  authenticated: boolean;
  needsMfa?: boolean;
  isAdmin: boolean;
  isMember: boolean;
  access?: ViewerAccess | null;
};

export type StageAction = { label: string; href: string; external?: boolean };

export const SUPPORT_BOT_URL = "https://t.me/PoppersCraftAuthBot";
export const NEWS_CHANNEL_URL = "https://t.me/popperskraft";

export function viewerStage(viewer: StageViewer | null): ViewerStage | null {
  if (!viewer) return null;
  if (!viewer.authenticated) return "guest";
  if (viewer.needsMfa) return "mfa";
  if (viewer.isMember) return viewer.access && !viewer.access.serverAccess ? "needs-pass" : "member";
  return viewer.isAdmin ? "admin" : "no-access";
}

/* Раздел доната у игрока с доступом — «Выбери план»: пропуск у него уже
   есть, остаётся выбрать подписку PLUS или HYPE (r100). */
export const donationTitle = (stage: ViewerStage | null) => (stage === "member" ? "ВЫБЕРИ ПЛАН" : "ДОНАТ");

/* Главная кнопка первого экрана. Игрок с доступом попадает в раздел
   «Играть» (/members): там лаунчер, шаги и IP, и он открывается с телефона,
   а страница лаунчера — только с компьютера. Стрелки — как в
   lib/site-navigation.ts: → страница сайта, ↓ раздел ниже, ↗ другой сайт. */
export function heroAction(stage: ViewerStage): StageAction {
  switch (stage) {
    case "guest": return { label: "ПОДАТЬ ЗАЯВКУ ↓", href: "#waitlist" };
    case "mfa": return { label: "ПОДТВЕРДИТЬ ВХОД →", href: "/mfa?next=/" };
    case "member": return { label: "ЗАЙТИ В МИР →", href: "/members" };
    case "needs-pass": return { label: "ОПЛАТИТЬ ПРОПУСК →", href: "/donation?plan=pass" };
    case "admin": return { label: "СКАЧАТЬ ЛАУНЧЕР →", href: "/launcher" };
    case "no-access": return { label: "ПОДДЕРЖКА ↗", href: SUPPORT_BOT_URL, external: true };
  }
}

/* Блок «Скоро»: текст под заголовком и кнопка. */
export function soonCopy(stage: ViewerStage): { text: string; action: StageAction } {
  switch (stage) {
    case "guest": return { text: "Оставьте заявку. Напишем, когда можно будет зайти.", action: { label: "ПОДАТЬСЯ В ВАЙТЛИСТ →", href: "#waitlist" } };
    case "mfa": return { text: "Подтвердите вход кодом 2FA — и здесь появится ваш доступ.", action: { label: "ПОДТВЕРДИТЬ ВХОД →", href: "/mfa?next=/" } };
    case "member": return { text: "Анкета одобрена — вы в списке. Лаунчер и шаги для входа — в разделе «Играть».", action: { label: "ИГРАТЬ →", href: "/members" } };
    case "needs-pass": return { text: "Анкета одобрена. Остался пропуск — 499 ₽ один раз, и можно заходить.", action: { label: "ОПЛАТИТЬ ПРОПУСК →", href: "/donation?plan=pass" } };
    case "admin": return { text: "Новые анкеты ждут решения администраторов.", action: { label: "К АНКЕТАМ →", href: "/admin" } };
    case "no-access": return { text: "У этого аккаунта сейчас нет доступа к серверу. Если это ошибка — напишите в поддержку.", action: { label: "ПОДДЕРЖКА ↗", href: SUPPORT_BOT_URL, external: true } };
  }
}

/* Кнопка PLUS. Окна «оплата скоро» с записью почты больше нет (r100):
   кнопка всегда ведёт к оплате, а закрытую оплату объясняет окно оплаты. */
export function plusAction(stage: ViewerStage, access: ViewerAccess | null | undefined): StageAction {
  const plus = access?.plus;
  /* Идёт HYPE — PLUS уже входит в него. */
  if (plus?.active && plus.tier === "hype") return { label: "HYPE АКТИВЕН ✓", href: "/profile?tab=subscription" };
  if (plus?.active && ((plus.renewsItself && (plus.renewTier ?? "plus") === "plus") || !access?.paymentsOpen)) return { label: "PLUS АКТИВЕН ✓", href: "/profile?tab=subscription" };
  if (plus?.active) return { label: "ПРОДЛИТЬ PLUS →", href: "/donation?plan=plus" };
  if (stage === "needs-pass") return { label: "СНАЧАЛА ПРОПУСК →", href: "/donation?plan=pass" };
  return { label: "ОФОРМИТЬ PLUS →", href: "/donation?plan=plus" };
}

/* Кнопка HYPE — у того, что есть только в HYPE (пластинки, пони). */
export function hypeAction(stage: ViewerStage, access: ViewerAccess | null | undefined): StageAction {
  const plus = access?.plus;
  const hype = Boolean(plus?.active && plus.tier === "hype");
  if (hype && ((plus?.renewsItself && plus.renewTier === "hype") || !access?.paymentsOpen)) return { label: "HYPE АКТИВЕН ✓", href: "/profile?tab=subscription" };
  if (hype) return { label: "ПРОДЛИТЬ HYPE →", href: "/donation?plan=hype" };
  if (stage === "needs-pass") return { label: "СНАЧАЛА ПРОПУСК →", href: "/donation?plan=pass" };
  if (plus?.active) return { label: "ПЕРЕЙТИ НА HYPE →", href: "/donation?plan=hype" };
  return { label: "ОФОРМИТЬ HYPE →", href: "/donation?plan=hype" };
}

/* Пропуск. У игрока с доступом это не предложение, а отметка
   для сравнения (href = null). */
export function passAction(stage: ViewerStage, access: ViewerAccess | null | undefined): { label: string; href: string | null } {
  if (stage === "member") return { label: access?.passRequired ? "ПРОПУСК УЖЕ ЕСТЬ ✓" : "ДОСТУП УЖЕ ОТКРЫТ ✓", href: null };
  if (stage === "needs-pass") return { label: "ОПЛАТИТЬ ПРОПУСК →", href: "/donation?plan=pass" };
  return { label: "ПОДРОБНЕЕ О ПРОПУСКЕ", href: "/donation" };
}
