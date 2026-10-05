"use client";

/* eslint-disable @next/next/no-img-element */
import dynamic from "next/dynamic";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { BackButton } from "@/app/BackButton";
import { LoginModal } from "@/app/LoginModal";
import { ProfileHeaderArt } from "@/app/ProfileHeaderArt";
import type { MinecraftItemIconName } from "@/lib/minecraft-icons";
import {
  faceStyle,
  SHOWCASE_HEADER,
  SHOWCASE_HEADER_FRAMES,
  SHOWCASE_HUMAN_TEXTURE,
  SHOWCASE_PLAIN_HEADER_COLOR,
  SHOWCASE_PONY_TEXTURE,
} from "./showcase-data";
import { PaymentDialog, type PaymentSummary, type Plan } from "./PaymentDialog";
import "./plans.css";

const ShowcaseModel = dynamic(() => import("./ShowcaseModel").then((module) => module.ShowcaseModel), {
  ssr: false,
  loading: () => <div className="dp-model"><p className="dp-model-note" role="status">ЗАГРУЖАЕМ 3D…</p></div>,
});

/* Настоящий предмет Minecraft из набора сайта (public/minecraft-items). */
function Item({ name, className = "dp-item" }: { name: MinecraftItemIconName; className?: string }) {
  return <img className={className} src={`/minecraft-items/${name}.png`} width={128} height={128} alt="" aria-hidden="true" draggable={false} decoding="async" />;
}

/* Значки «человек» и «пони» — те же, что в переключателе 3D на странице игрока. */
const HumanGlyph = () => (
  <svg className="dp-glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false" shapeRendering="crispEdges"><path fill="currentColor" d="M9 2h6v6H9zM5 9h14v8h-3v-5h-1v10h-3v-6h-1v6H8V12H7v5H4V9z" /></svg>
);
const PonyGlyph = () => (
  <svg className="dp-glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false" shapeRendering="crispEdges"><path fill="currentColor" fillRule="evenodd" d="M15 2h3v3h3v3h2v5h-6v3h-1v6h-3v-6H8v6H5V12H3v5H1V9h4V8h9V5h1zM7 10v4h8v-3h6V9h-2V7h-3v3z" /></svg>
);

/* Страница доната: пропуск POPPERSCRAFT и подписка PLUS / HYPE. Вёрстка и
   движение — из макета «Donate Page». Кнопки покупки открывают окно оплаты
   через ЮKassa (PaymentDialog); если оплата выключена, оно так и скажет. */

const SUPPORT_URL = "https://t.me/PoppersCraftAuthBot";
const MAX_TILT = 6;

const SPARKS = [
  { x: "6%", y: "12%", color: "#c6f432", delay: "0ms" },
  { x: "88%", y: "8%", color: "#f8f5e9", delay: "120ms" },
  { x: "18%", y: "82%", color: "#33cddb", delay: "240ms" },
  { x: "74%", y: "64%", color: "#c6f432", delay: "360ms" },
  { x: "46%", y: "4%", color: "#f8f5e9", delay: "480ms" },
  { x: "94%", y: "44%", color: "#c6f432", delay: "600ms" },
  { x: "4%", y: "48%", color: "#ff6fae", delay: "180ms" },
  { x: "60%", y: "92%", color: "#33cddb", delay: "300ms" },
];

/* Свои пластинки — те же, что в разделе доната на главной. */
const CUSTOM_RECORDS = [
  { src: "/donation/record-red.png", alt: "Красная пиксельная пластинка" },
  { src: "/donation/record-gaga.png", alt: "Пиксельная пластинка Lady Gaga" },
  { src: "/donation/record-brat.png", alt: "Зелёная пиксельная пластинка brat" },
];

const PASS_PERKS: Array<[MinecraftItemIconName, string]> = [
  ["ender_pearl", "Доступ к серверу"],
  ["writable_book", "Место в вайтлисте после одобрения анкеты"],
  ["book", "Профиль на сайте"],
  ["cake", "Лента и сообщество"],
];

const PLUS_PERKS: Array<[MinecraftItemIconName, string]> = [
  ["nether_star", "Значок у ника и значки стажа"],
  ["diamond", "Обводка профиля на выбор"],
  ["enchanted_book", "Семь тем для карточки игрока"],
  ["writable_book", "Пиксельная шапка профиля"],
  ["cake", "Стикеры в ленте и Wiki"],
];

/* В игре HYPE даёт гардероб в лаунчере, префикс и цвет ника, свои строки в
   списке серверов, сообщение о смерти и размер персонажа (просьба владельца, 2026-10-03). */
const HYPE_PERKS: Array<[MinecraftItemIconName, string]> = [
  ["totem_of_undying", "Всё, что есть в PLUS"],
  ["golden_apple", "Гардероб в лаунчере: пять скинов человека и пять скинов пони"],
  ["lapis_lazuli", "Префикс в чате, цвет ника с градиентом и флаг"],
  ["knowledge_book", "Две свои строки в списке серверов Minecraft"],
  ["bone", "Своё сообщение о смерти"],
  ["potion", "Размер персонажа от 25% до 300%"],
  ["music_disc_pigstep", "Своя пластинка каждый день вместо одной в неделю"],
  ["ender_pearl", "Анимированная шапка профиля — до восьми кадров"],
  ["experience_bottle", "Радужная обводка, которой больше ни у кого нет"],
  ["book", "Закреплённый пост в профиле"],
  ["compass", "Новые функции сайта раньше остальных"],
];

const FLOATERS: MinecraftItemIconName[] = ["diamond", "music_disc_cat", "emerald", "totem_of_undying", "golden_apple"];

const COMPARE_ROWS: Array<{ label: string; base: string; plus: string; hype: string }> = [
  { label: "Доступ к серверу", base: "✔", plus: "✔", hype: "✔" },
  { label: "Место в вайтлисте", base: "✔", plus: "✔", hype: "✔" },
  { label: "Профиль и лента", base: "✔", plus: "✔", hype: "✔" },
  { label: "Значок у ника и значки стажа", base: "—", plus: "✔", hype: "✔" },
  { label: "Обводка профиля", base: "—", plus: "5 цветов", hype: "5 цветов + радужная" },
  { label: "Темы карточки игрока", base: "—", plus: "✔", hype: "✔" },
  { label: "Стикеры в ленте и Wiki", base: "—", plus: "✔", hype: "✔" },
  { label: "Шапка профиля", base: "—", plus: "своя картинка", hype: "анимация до 8 кадров" },
  { label: "Гардероб в лаунчере", base: "1 скин", plus: "1 скин", hype: "5 человека + 5 пони" },
  { label: "Префикс, цвет ника и флаг в чате", base: "—", plus: "—", hype: "✔" },
  { label: "Свои строки в списке серверов", base: "—", plus: "—", hype: "✔" },
  { label: "Своё сообщение о смерти", base: "—", plus: "—", hype: "✔" },
  { label: "Размер персонажа 25–300%", base: "—", plus: "—", hype: "✔" },
  { label: "Свои пластинки", base: "1 в неделю", plus: "1 в неделю", hype: "1 в день" },
  { label: "Закреплённый пост в профиле", base: "—", plus: "—", hype: "✔" },
  { label: "Новые функции сайта раньше всех", base: "—", plus: "—", hype: "✔" },
  /* Готовый скин загружают сколько угодно раз все; в гардеробе лаунчера без HYPE — один скин (2026-10-04). */
  { label: "Загрузка готового скина", base: "сколько угодно", plus: "сколько угодно", hype: "сколько угодно" },
];

const FAQ = [
  {
    q: "Чем HYPE отличается от PLUS?",
    a: "В HYPE входит всё из PLUS, а сверху — то, что заметно в игре и в профиле: гардероб в лаунчере на пять скинов человека и пять скинов пони, префикс в чате и цвет ника с градиентом, две свои строки в списке серверов, своё сообщение о смерти, размер персонажа от 25% до 300%, своя пластинка каждый день, анимированная шапка, радужная обводка, закреплённый пост и новые функции сайта раньше остальных.",
  },
  {
    q: "Что будет, если отменить подписку?",
    a: "Пропуск остаётся, играешь как обычно. Подписка работает до конца оплаченного срока, потом оформление снимается: вместо пони снова обычный скин, пластинок — одна в неделю, профиль без обводки и значка. Настройки сохраняются: продлишь подписку — всё вернётся.",
  },
  {
    q: "Как отключить автопродление?",
    a: "«Профиль» → «Подписка» → «Отключить автопродление». Там же отвязывается карта. Больше ничего не спишется, подписка доработает оплаченный срок. У годовой оплаты автопродления нет вообще: если платишь за год, помесячное автопродление выключается, а за три дня до конца мы напомним на почту из профиля.",
  },
  {
    q: "Подписка даёт преимущество в игре?",
    a: "Нет. Подписка меняет только внешний вид: урона, ресурсов и телепортов она не даёт.",
  },
  {
    q: "Можно перейти с PLUS на HYPE?",
    a: "Да, в любой момент. HYPE включается сразу, а оставшиеся дни PLUS не сгорают — они переносятся на время после HYPE. Обратно не нужно ничего делать: когда HYPE закончится, доработают дни PLUS.",
  },
  {
    q: "Куда идут деньги?",
    a: "На работу сервера: аренду хостинга, домен, резервные копии мира и платные плагины.",
  },
  {
    q: "Как оплатить?",
    a: "Нажми кнопку на карточке — откроется защищённая страница ЮKassa: карта, СБП и другие способы. Пропуск оплачивается после одобрения анкеты. Если оплата ещё не открыта, окно предложит оставить почту — напишем, как только можно будет заплатить.",
  },
  {
    q: "Можно вернуть деньги?",
    a: "Да, в течение 14 дней с оплаты — напиши в поддержку в Telegram. Пропуск возвращаем полностью, если после оплаты ты ещё не заходил на сервер. За подписку возвращаем стоимость неиспользованных дней. Подробно — в условиях оплаты.",
  },
  {
    q: "Можно подарить подписку другу?",
    a: "Да. На карточке игрока есть кнопка «Подарить подписку»: платишь ты, подписку получает он. Тариф (PLUS или HYPE) и срок выбираются в окне оплаты, автопродления у подарка нет, а получатель должен быть одобренным игроком сервера.",
  },
  {
    q: "Можно взять подписку без пропуска?",
    a: "Нет, подписка работает поверх пропуска. Сначала пропуск, потом оформление.",
  },
];


const PASS_SOURCE_NOTE: Record<string, string> = {
  payment: "Оплачен — спасибо, что держите сервер!",
  legacy: "Выдан бесплатно: ты играл до запуска оплаты.",
  admin: "Выдан администрацией.",
  founder: "Выдан бесплатно: ты среди первых 10 игроков сервера.",
  pioneer: "Выдан бесплатно: ты первооткрыватель сервера.",
};

export function DonationPlansPage({ initialSummary = null, initialPlan = null, initialGift = null, initialGiftTier = "plus" }: {
  initialSummary?: PaymentSummary | null;
  initialPlan?: Plan | null;
  /* Ник игрока, которому дарят подписку (?plan=gift&to=ник[&tier=hype]). */
  initialGift?: string | null;
  initialGiftTier?: "plus" | "hype";
}) {
  const pageRef = useRef<HTMLElement>(null);
  const plusRef = useRef<HTMLElement>(null);
  const shineRef = useRef<HTMLDivElement>(null);
  const [sparksOn, setSparksOn] = useState(false);
  const [openFaq, setOpenFaq] = useState(0);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [session, setSession] = useState<PaymentSummary | null>(initialSummary);
  const [loginOpen, setLoginOpen] = useState(false);
  /* Окно, которое открыть снова после входа. */
  const [loginPlan, setLoginPlan] = useState<Plan | null>(null);
  const [gift, setGift] = useState<string | null>(null);
  const initialPlanHandled = useRef(false);

  /* Состояние оплаты: вошёл ли игрок, одобрен ли, есть ли пропуск и PLUS.
     Обычно его уже передал сервер; запрос нужен, если сервер не смог, и
     когда страницу вернули из кэша браузера (например, кнопкой «Назад»
     со страницы ЮKassa) — там оно могло устареть. */
  useEffect(() => {
    const load = () => fetch("/api/payments", { cache: "no-store" })
      .then((response) => response.json())
      .then((data: PaymentSummary) => setSession({ ...data, authenticated: Boolean(data.authenticated), available: Boolean(data.available) }))
      .catch(() => setSession((current) => current ?? { authenticated: false, available: false }));
    if (!initialSummary) void load();
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) void load();
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, [initialSummary]);

  /* Пропуск у игрока уже есть (или сервер открыт всем одобренным): раздел
     называется PLUS, а карточка пропуска остаётся только для сравнения. */
  const owned = Boolean(session?.serverAccess);
  const plusRenewsItself = Boolean(session?.plus?.active && (session.plus.renewsItself ?? session.plus.autoRenew));
  /* Автопродление помнит свой тариф: «активен ✓» — только у того, что продлевается сам. */
  const renewTier = session?.plus?.renewTier ?? session?.plus?.tier ?? "plus";
  /* Цены приходят с сервера: здесь только запасные значения. */
  const prices = session?.prices;
  const passPrice = prices?.pass ?? 499;
  const plusPrice = prices?.plus ?? 199;
  const hypePrice = prices?.hype ?? 599;
  const plusYear = prices?.plusYear ?? 1910;
  const hypeYear = prices?.hypeYear ?? 5750;
  const yearOff = prices?.yearDiscount ?? 20;
  const tier = session?.plus?.active ? session.plus.tier ?? "plus" : null;
  const hypeRenews = tier === "hype" && plusRenewsItself && renewTier === "hype";
  const plusLabel = tier === "hype"
    ? "Уже включено в HYPE ✓"
    : plusRenewsItself && renewTier === "plus" ? "PLUS активен ✓" : session?.plus?.active ? "Продлить PLUS" : "Оформить PLUS";
  const hypeLabel = tier === "hype"
    ? (hypeRenews ? "HYPE активен ✓" : "Продлить HYPE")
    : tier === "plus" ? "Перейти на HYPE" : "Оформить HYPE";

  /* ?plan=pass|plus открывает окно сразу; параметр убирается из адреса,
     чтобы окно не всплывало снова при обновлении или возврате. */
  useEffect(() => {
    if ((!initialPlan && !initialGift) || initialPlanHandled.current || !session) return;
    initialPlanHandled.current = true;
    if (initialGift) {
      setGift(initialGift);
      setPlan(initialGiftTier);
    } else if (initialPlan && !(initialPlan === "pass" && owned && !session.passForSale)) {
      setPlan(initialPlan);
    }
    const url = new URL(window.location.href);
    if (url.pathname !== "/donation") return;
    url.searchParams.delete("plan");
    url.searchParams.delete("to");
    url.searchParams.delete("tier");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, [initialPlan, initialGift, initialGiftTier, session, owned]);

  const openLogin = (next: Plan | null) => {
    setPlan(null);
    setLoginPlan(next);
    setLoginOpen(true);
  };

  const closeDialog = () => {
    setPlan(null);
    setGift(null);
  };

  /* Движение: появление блоков, наклон карточки PLUS и пластинки. Предметы
     на фоне стоят на месте. На сенсорных экранах наклона нет, при
     «уменьшить движение» — нет ничего. */
  useEffect(() => {
    const page = pageRef.current;
    if (!page) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)").matches && window.innerWidth > 760;
    const cleanup: Array<() => void> = [];
    const on = (el: EventTarget, type: string, fn: (event: never) => void) => {
      el.addEventListener(type, fn as EventListener);
      cleanup.push(() => el.removeEventListener(type, fn as EventListener));
    };

    // появление при прокрутке
    if (!reduce && "IntersectionObserver" in window) {
      const reveals = Array.from(page.querySelectorAll<HTMLElement>("[data-reveal]"));
      page.classList.add("dp-reveal-ready");
      const show = (el: Element) => el.classList.add("is-shown");
      const observer = new IntersectionObserver((entries) => entries.forEach((entry) => {
        if (entry.isIntersecting) {
          show(entry.target);
          observer.unobserve(entry.target);
        }
      }), { rootMargin: "0px 0px -8% 0px", threshold: 0.01 });
      reveals.forEach((el) => observer.observe(el));
      const frame = requestAnimationFrame(() => reveals.forEach((el) => {
        const rect = el.getBoundingClientRect();
        if (rect.top < window.innerHeight && rect.bottom > 0) show(el);
      }));
      /* Страховка: если наблюдатель не сработал, всё равно показать всё.
         Строки таблицы сравнения она не трогает — они должны выкатываться
         по мере прокрутки, а не появиться разом через секунду. */
      const guard = window.setTimeout(() => reveals.forEach((el) => {
        if (el.tagName !== "TR") show(el);
      }), 1200);
      cleanup.push(() => {
        cancelAnimationFrame(frame);
        window.clearTimeout(guard);
        observer.disconnect();
        page.classList.remove("dp-reveal-ready");
      });
    }

    // наклон за курсором — у карточек PLUS и HYPE, у каждой свой.
    // Размеры берутся один раз при входе (до наклона), а выход определяется по этой
    // неподвижной рамке: иначе наклонённый край уходит из-под курсора и карточка дёргается.
    const tiltCards = fine && !reduce ? Array.from(page.querySelectorAll<HTMLElement>("[data-tilt]")) : [];
    for (const tiltCard of tiltCards) {
      let rect: DOMRect | null = null;
      let tx = 0, ty = 0, tl = 0;
      let cx = 0, cy = 0, cl = 0;
      let raf = 0;
      const render = () => {
        cx += (tx - cx) * 0.14;
        cy += (ty - cy) * 0.14;
        cl += (tl - cl) * 0.14;
        tiltCard.style.transform = `rotateY(${(cx * MAX_TILT * 2).toFixed(3)}deg) rotateX(${(-cy * MAX_TILT * 2).toFixed(3)}deg) translate3d(0, ${(-6 * cl).toFixed(3)}px, 0)`;
        const settled = Math.abs(tx - cx) < 0.001 && Math.abs(ty - cy) < 0.001 && Math.abs(tl - cl) < 0.001;
        if (settled && !rect) {
          tiltCard.style.transform = "";
          tiltCard.style.transition = "";
          raf = 0;
          return;
        }
        raf = settled ? 0 : requestAnimationFrame(render);
      };
      const kick = () => { if (!raf) raf = requestAnimationFrame(render); };
      const leave = () => {
        rect = null;
        tx = 0; ty = 0; tl = 0;
        kick();
      };
      const outside = (box: DOMRect, x: number, y: number) =>
        x < box.left - 2 || x > box.right + 2 || y < box.top - 8 || y > box.bottom + 2;
      // Мерим рамку без наклона; если курсор над ней — включаем наклон.
      const enter = (x: number, y: number) => {
        const saved = tiltCard.style.transform;
        tiltCard.style.transform = "";
        const box = tiltCard.getBoundingClientRect();
        tiltCard.style.transform = saved;
        if (outside(box, x, y)) return false;
        tiltCard.style.transition = "none";
        rect = box;
        tl = 1;
        return true;
      };
      on(document, "mousemove", (event: MouseEvent) => {
        const { clientX: x, clientY: y } = event;
        if (!rect) {
          if (!(event.target instanceof Node) || !tiltCard.contains(event.target) || !enter(x, y)) return;
        } else if (outside(rect, x, y)) {
          leave();
          return;
        }
        const box = rect as DOMRect | null;
        if (!box) return;
        tx = Math.max(-0.5, Math.min(0.5, (x - box.left) / box.width - 0.5));
        ty = Math.max(-0.5, Math.min(0.5, (y - box.top) / box.height - 0.5));
        kick();
      });
      on(document, "mouseleave", leave);
      on(window, "scroll", () => { if (rect) leave(); });
      on(window, "resize", () => { if (rect) leave(); });
      cleanup.push(() => cancelAnimationFrame(raf));
    }

    // блик и искры на PLUS
    const plus = plusRef.current;
    const shine = shineRef.current;
    if (plus && !reduce) {
      const fire = () => {
        setSparksOn(true);
        if (shine) {
          shine.classList.remove("run");
          void shine.offsetWidth;
          shine.classList.add("run");
        }
      };
      on(plus, "mouseenter", fire);
      on(plus, "touchstart", fire);
      on(plus, "mouseleave", () => setSparksOn(false));
      if (shine) on(shine, "animationend", () => shine.classList.remove("run"));
    }

    // пластинки: медленно крутятся, при наведении разгоняются
    const discs = Array.from(page.querySelectorAll<HTMLElement>("[data-disc]"))
      .map((el, index) => ({ el, angle: index * 40, speed: 12, target: 12 }));
    discs.forEach((disc) => {
      const box = disc.el.parentElement;
      if (!box) return;
      on(box, "mouseenter", () => { disc.target = 300; });
      on(box, "mouseleave", () => { disc.target = 12; });
      on(box, "touchstart", () => { disc.target = disc.target > 100 ? 12 : 300; });
    });
    if (discs.length && !reduce) {
      let last = performance.now();
      let raf = 0;
      const loop = (now: number) => {
        const dt = Math.min(64, now - last) / 1000;
        last = now;
        discs.forEach((disc) => {
          disc.speed += (disc.target - disc.speed) * 0.06;
          disc.angle = (disc.angle + disc.speed * dt) % 360;
          disc.el.style.transform = `rotate(${disc.angle.toFixed(1)}deg)`;
        });
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
      cleanup.push(() => cancelAnimationFrame(raf));
    }

    return () => cleanup.forEach((fn) => fn());
  }, []);

  useEffect(() => {
    if (!plan) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setPlan(null); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [plan]);

  const choose = (next: Plan) => {
    setPlan(next);
  };

  return (
    <main className="dp-page" ref={pageRef}>
      {/* После входа окно оплаты открывается снова — как и обещает диалог. */}
      <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} successRedirect={gift ? `/donation?plan=gift&to=${encodeURIComponent(gift)}${loginPlan === "hype" ? "&tier=hype" : ""}` : loginPlan ? `/donation?plan=${loginPlan}` : "/donation"} />

      <div className="dp-floaters" aria-hidden="true">
        {FLOATERS.map((name, index) => (
          <span className={`dp-floater f${index + 1}`} key={name}><Item name={name} className="dp-floater-item" /></span>
        ))}
      </div>

      <div className="dp-shell">
        <nav className="dp-topbar" aria-label="Навигация">
          <BackButton fallback="/" />
        </nav>

        <section className="dp-hero">
          <div className="dp-window" data-reveal="">
            <div className="dp-bar">
              <span>donate.exe</span>
              <span className="dp-bar-buttons" aria-hidden="true"><span>_</span><span>□</span><span>×</span></span>
            </div>
            <div className="dp-hero-body">
              <div className="dp-kicker">PoppersCraft // приватный сервер</div>
              {/* Пропуск уже куплен — выбирают подписку (r100, просьба владельца). */}
              <h1 className={owned ? "dp-hero-plan" : undefined}>{owned ? "ВЫБЕРИ ПЛАН" : "ДОНАТ"}</h1>
              {owned
                ? <p>Пропуск у тебя уже есть — осталось выбрать подписку. PLUS оформляет профиль на сайте. HYPE — всё из PLUS и то, что видно в игре: пони, своя пластинка каждый день, префикс в чате и гардероб в лаунчере. Деньги идут на сервер: хостинг, карта, бэкапы.</p>
                : <p>Деньги идут на сервер: хостинг, карта, бэкапы. Ничего волшебного — просто счётчик за электричество и наши нервы. Спасибо, что держите шахты открытыми.</p>}
              {session?.available && session.test
                ? <div className="dp-soon"><Item name="clock" className="dp-soon-item" />Тестовый режим: оплату видят только администраторы, деньги не списываются.</div>
                : null}
            </div>
          </div>

          <div className="dp-tariffs">
            <article className={owned ? "dp-card is-owned" : "dp-card"} data-reveal="">
              <div className="dp-bar dp-card-bar">
                <span>pass.exe</span>
                <span className="dp-bar-buttons plain" aria-hidden="true"><span /><span /><span /></span>
              </div>
              <div className="dp-card-body">
                <div className="dp-badges">
                  <Item name="crafting_table" className="dp-block" />
                  <span className="dp-tag" style={{ background: "#33cddb" }}>ПРОПУСК</span>
                  {owned ? <span className="dp-tag small">ДЛЯ СРАВНЕНИЯ</span> : null}
                </div>
                <h2>POPPERSCRAFT</h2>
                <div className="dp-price">
                  <b>{passPrice} ₽</b>
                  <span style={{ background: "#c6f432" }}>один раз</span>
                </div>
                <p className="dp-card-lead">Оплатил один раз — играешь. Без подписок и напоминалок.</p>
                <div className="dp-rule" />
                <ul className="dp-list">
                  {PASS_PERKS.map(([icon, text]) => <li key={text}><Item name={icon} className="dp-li-item" />{text}</li>)}
                </ul>
                {owned ? (
                  <>
                    {/* Не кнопка покупки, а отметка: этот пропуск уже у игрока. */}
                    <div className="dp-owned" role="status">✓ {session?.hasPass ? "ПРОПУСК УЖЕ ТВОЙ" : "ДОСТУП УЖЕ ОТКРЫТ"}</div>
                    <p className="dp-fine">
                      {session?.hasPass
                        ? PASS_SOURCE_NOTE[session.passSource ?? "payment"] ?? PASS_SOURCE_NOTE.payment
                        : "Пока пропуск не обязателен, сервер открыт всем одобренным игрокам. Если его введут — ты получишь его бесплатно."}
                    </p>
                    {session?.test && session.passForSale ? (
                      <button className="dp-test-link" type="button" onClick={() => choose("pass")}>Тест для администратора: проверить оплату пропуска</button>
                    ) : null}
                  </>
                ) : (
                  <>
                    <button className="dp-buy" type="button" onClick={() => choose("pass")}>Оплатить {passPrice} ₽</button>
                    <p className="dp-fine">Оплата разовая, после одобрения анкеты. Вопросы по оплате — <a href={SUPPORT_URL} target="_blank" rel="noreferrer">в поддержку в Telegram</a>.</p>
                  </>
                )}
              </div>
            </article>

            <article className="dp-card is-plus" data-tilt="" data-reveal="" ref={plusRef}>
              <div className={sparksOn ? "dp-sparks on" : "dp-sparks"} aria-hidden="true">
                {SPARKS.map((spark) => (
                  <i key={`${spark.x}-${spark.y}`} style={{ left: spark.x, top: spark.y, background: spark.color, animationDelay: spark.delay }} />
                ))}
              </div>
              <div className="dp-shine-wrap" aria-hidden="true"><div className="dp-shine" ref={shineRef} /></div>
              <div className="dp-card-plus-layer">
                <div className="dp-bar dp-card-bar">
                  <span>plus.exe</span>
                  <span className="dp-bar-buttons plain" aria-hidden="true"><span /><span /><span /></span>
                </div>
                <div className="dp-card-body">
                  <div className="dp-badges">
                    <Item name="nether_star" className="dp-block" />
                    <span className="dp-tag blink" style={{ background: "#c6f432" }}>ДЛЯ СТИЛЯ</span>
                    <span className="dp-tag small">ПОПУЛЯРНОЕ</span>
                  </div>
                  <h2>POPPERS+</h2>
                  <div className="dp-price">
                    <b>{plusPrice} ₽</b>
                    <span style={{ background: "#f8f5e9" }}>в месяц</span>
                  </div>
                  {/* Год — один платёж со скидкой; срок выбирается в окне оплаты. */}
                  <p className="dp-year-hint">или <b>{plusYear} ₽ за год</b> — на {yearOff}% дешевле</p>
                  <p className="dp-card-lead">Оформление профиля на сайте. В игре ничего не меняется: ни урона, ни ресурсов, ни телепортов.</p>
                  <div className="dp-rule" />
                  <ul className="dp-list">
                    {PLUS_PERKS.map(([icon, text]) => <li key={text}><Item name={icon} className="dp-li-item" />{text}</li>)}
                  </ul>
                  <button className="dp-buy blue" type="button" disabled={tier === "hype"} onClick={() => choose("plus")}>{plusLabel}</button>
                  <div className="dp-note"><Item name="compass" className="dp-note-item" />{owned
                    ? "Подписка работает поверх пропуска — он у тебя уже есть."
                    : "Подписка работает поверх пропуска: сначала пропуск, потом оформление."}</div>
                </div>
              </div>
            </article>

            {/* HYPE — старший тариф: всё из PLUS и то, что видно в игре. */}
            <article className="dp-card is-hype" data-tilt="" data-reveal="">
              <div className="dp-hype-glow" aria-hidden="true" />
              <div className="dp-card-plus-layer">
                <div className="dp-bar dp-card-bar">
                  <span>hype.exe</span>
                  <span className="dp-bar-buttons plain" aria-hidden="true"><span /><span /><span /></span>
                </div>
                <div className="dp-card-body">
                  <div className="dp-badges">
                    <Item name="totem_of_undying" className="dp-block" />
                    <span className="dp-tag blink" style={{ background: "#9fb4ff", color: "#0b1160" }}>МАКСИМУМ</span>
                    <span className="dp-tag small" style={{ background: "#f2f5ff", color: "#0b1160" }}>ВСЁ СРАЗУ</span>
                  </div>
                  <h2>POPPERS HYPE</h2>
                  <div className="dp-price">
                    <b>{hypePrice} ₽</b>
                    <span style={{ background: "#0b1160", color: "#9fb4ff" }}>в месяц</span>
                  </div>
                  <p className="dp-year-hint hype">или <b>{hypeYear} ₽ за год</b> — на {yearOff}% дешевле</p>
                  <p className="dp-card-lead">Всё из PLUS плюс то, что видно в игре: пони, своя пластинка каждый день и живая шапка профиля.</p>
                  <div className="dp-rule" />
                  <ul className="dp-list">
                    {HYPE_PERKS.map(([icon, text]) => <li key={text}><Item name={icon} className="dp-li-item" />{text}</li>)}
                  </ul>
                  <button className="dp-buy hype" type="button" disabled={hypeRenews} onClick={() => choose("hype")}>{hypeLabel}</button>
                  <div className="dp-note"><Item name="nether_star" className="dp-note-item" />{tier === "plus"
                    ? "Перейти можно в любой момент: оставшиеся дни PLUS никуда не денутся."
                    : "Игровых преимуществ нет и здесь — только внешний вид."}</div>
                </div>
              </div>
            </article>
          </div>
        </section>

        <section className="dp-section dp-window dp-showcase" data-reveal="">
          <div className="dp-bar">
            <span>cosmetics_viewer.exe</span>
          </div>
          <div className="dp-section-body">
            <h2>Как это выглядит</h2>
            <p className="dp-showcase-lead">Слева обычный профиль, справа — с подпиской HYPE. Разница только во внешнем виде: пони, своя пластинка каждый день, значок у ника и живая шапка.</p>

            <div className="dp-compare-grid">
              <div className="dp-side">
                <div className="dp-side-bar"><b>БЕЗ ПОДПИСКИ</b><small>vanilla.cfg</small></div>
                <div className="dp-cell skin">
                  <div className="dp-figure-stage">
                    <ShowcaseModel kind="human" label="3D-модель обычного скина игрока" />
                  </div>
                  <span className="dp-label"><HumanGlyph />СТАНДАРТНЫЙ СКИН</span>
                </div>
                <div className="dp-cell discs">
                  <span className="dp-disc-box vanilla" aria-hidden="true">
                    <Item name="music_disc_13" className="dp-disc-item" />
                  </span>
                  <span className="dp-label">ОДНА ПЛАСТИНКА В НЕДЕЛЮ</span>
                  <p>Свой трек можно загрузить раз в неделю.</p>
                </div>
                <div className="dp-cell">
                  <div className="dp-hat" style={{ backgroundColor: SHOWCASE_PLAIN_HEADER_COLOR }}><span>ОБЫЧНАЯ ШАПКА</span></div>
                  <div className="dp-nick"><i aria-hidden="true" style={faceStyle(SHOWCASE_HUMAN_TEXTURE)} /><span translate="no">tomac_777</span></div>
                  <p className="left">Профиль без значка.</p>
                </div>
              </div>

              {/* Правая колонка — тариф HYPE, в его ультрамарине (просьба владельца, 2026-10-04). */}
              <div className="dp-side plus hype">
                <div className="dp-side-bar"><b>С ПОДПИСКОЙ HYPE</b><small>поводи курсором</small></div>
                <div className="dp-cell skin">
                  <div className="dp-figure-stage">
                    <ShowcaseModel kind="pony" label="3D-модель пони игрока" />
                  </div>
                  <span className="dp-label hype"><PonyGlyph />СКИН «ПОНИ» · HYPE</span>
                </div>
                <div className="dp-cell discs">
                  <div className="dp-discs">
                    {CUSTOM_RECORDS.map((record) => (
                      <span className="dp-disc-box" key={record.src}>
                        <Image className="dp-record" data-disc="" src={record.src} width={1024} height={1024} sizes="68px" alt={record.alt} draggable={false} />
                      </span>
                    ))}
                  </div>
                  <span className="dp-label hype">ПЛАСТИНКА КАЖДЫЙ ДЕНЬ · HYPE</span>
                  <p>Загружаешь трек — он играет из твоего проигрывателя. Без подписки и с PLUS — одна пластинка в неделю.</p>
                </div>
                <div className="dp-cell">
                  <div className="dp-hat custom profile-flag flag-custom" style={{ backgroundColor: SHOWCASE_HEADER.color }}>
                    <ProfileHeaderArt art={SHOWCASE_HEADER.art} frames={SHOWCASE_HEADER_FRAMES} frameMs={700} />
                    <span>ЖИВАЯ ШАПКА</span>
                  </div>
                  <div className="dp-nick is-plus is-hype"><i aria-hidden="true" style={faceStyle(SHOWCASE_PONY_TEXTURE)} /><span translate="no">tomac_777</span><b><Item name="totem_of_undying" className="dp-badge-item" />HYPE</b></div>
                  <p className="left">Значок HYPE у ника, обводка профиля и анимированная шапка до 8 кадров.</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="dp-section dp-window" data-reveal="">
          <div className="dp-bar"><span>compare.xls</span></div>
          <div className="dp-section-body">
            <h2>Что где</h2>
            <div className="dp-table-wrap">
              <table className="dp-table dp-table-three">
                <thead>
                  <tr>
                    <th aria-label="Возможность" />
                    <th className="base">{owned ? "POPPERSCRAFT ✓" : "POPPERSCRAFT"}</th>
                    <th className="plus">PLUS</th>
                    <th className="hype">HYPE</th>
                  </tr>
                </thead>
                <tbody>
                  {/* Строки выкатываются по мере прокрутки — каждая со своей задержкой. */}
                  {COMPARE_ROWS.map((row, index) => (
                    <tr key={row.label} data-reveal="" style={{ transitionDelay: `${Math.min(index, 8) * 45}ms` }}>
                      <td>{row.label}</td>
                      <td>{row.base}</td>
                      <td>{row.plus}</td>
                      <td>{row.hype}</td>
                    </tr>
                  ))}
                  <tr data-reveal="" style={{ transitionDelay: "405ms" }}>
                    <td>Оплата</td>
                    <td>{owned ? "уже есть ✓" : `${passPrice} ₽ один раз`}</td>
                    <td>{plusPrice} ₽ в месяц<br />или {plusYear} ₽ за год</td>
                    <td>{hypePrice} ₽ в месяц<br />или {hypeYear} ₽ за год</td>
                  </tr>
                </tbody>
              </table>
            </div>
            {owned ? <p className="dp-table-note">Колонка POPPERSCRAFT — то, что у тебя уже есть.</p> : null}
          </div>
        </section>

        <section className="dp-section dp-window dp-faq" data-reveal="">
          <div className="dp-bar"><span>faq.txt</span></div>
          <div className="dp-section-body">
            <h2>Вопросы</h2>
            <div className="dp-faq-list">
              {FAQ.map((item, index) => {
                const open = openFaq === index;
                return (
                  <div className={open ? "dp-faq-item open" : "dp-faq-item"} key={item.q}>
                    <button type="button" aria-expanded={open} onClick={() => setOpenFaq(open ? -1 : index)}>
                      <i aria-hidden="true">{open ? "–" : "+"}</i>
                      <span>{item.q}</span>
                    </button>
                    {open ? <div className="dp-faq-answer">{item.a}</div> : null}
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section className="dp-section dp-window dp-final" data-reveal="">
          <p>Пропуск — чтобы играть. Подписка — чтобы тебя было видно.</p>
          <div className="dp-final-actions">
            {owned ? null : <button className="dp-buy" type="button" onClick={() => choose("pass")}>Оплатить {passPrice} ₽</button>}
            <button className="dp-buy pink" type="button" disabled={tier === "hype"} onClick={() => choose("plus")}>{plusLabel}</button>
            <button className="dp-buy hype" type="button" disabled={hypeRenews} onClick={() => choose("hype")}>{hypeLabel}</button>
          </div>
        </section>
      </div>

      {/* Окна «Оплата скоро» с записью почты больше нет (r100): сервер откроется
          сразу с оплатой. Если оплата закрыта, окно оплаты само скажет об этом. */}
      {plan && session ? (
        <PaymentDialog
          plan={plan}
          summary={session}
          giftTo={gift}
          onClose={closeDialog}
          onLogin={() => openLogin(plan)}
          onSwitch={(next) => { setGift(null); setPlan(next); }}
          onGiftTier={(next) => setPlan(next)}
        />
      ) : null}
    </main>
  );
}
