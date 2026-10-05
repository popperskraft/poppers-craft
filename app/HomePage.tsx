"use client";

import { FormEvent, useEffect, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import { LanguageSwitch } from "@/app/profile/LanguageSwitch";
import Link from "next/link";
import Image from "next/image";
import { MinecraftIcon, type MinecraftIconName } from "./MinecraftIcon";
import { MinecraftCaptcha } from "./MinecraftCaptcha";
import { UpdateLike } from "./UpdateLike";
import { DonationSection } from "./donation/DonationSection";
import { LoginModal } from "./LoginModal";
import { ProfileMenu } from "./ProfileMenu";
import { ReleaseStamp } from "./ReleaseStamp";
import { JoinProcess } from "./JoinProcess";
import { SiteBoard } from "./SiteBoard";
import { SkinUploadField } from "./SkinUploadField";
import { ReferralField } from "./ReferralField";
import { SocialPixelIcon } from "./SocialPixelIcon";
import { SOCIAL_LINK_FIELDS } from "@/lib/social-links";
import type { SiteBoardData, UpdateColor } from "@/lib/waitlist";
import { UpdateBadge } from "./UpdateBadge";
import "./home-actions.css";
import { HOME_SECTION_KEY, HOME_SECTIONS } from "@/lib/navigation-trail";
import { SELLER_SHORT } from "@/lib/user-agreement";
import { mainNavItems, whitelistBadgeLabel } from "@/lib/site-navigation";
import {
  heroAction,
  viewerStage,
  SUPPORT_BOT_URL,
  type StageAction,
  type ViewerAccess,
} from "@/lib/viewer-stage";

const paintTools: MinecraftIconName[] = [
  "water_bucket",
  "lava_bucket",
  "diamond",
  "chest",
  "redstone",
  "lapis_lazuli",
  "writable_book",
  "golden_apple",
];

const paintPalette = [
  { id: "black", label: "Чёрный", color: "#000" },
  { id: "white", label: "Белый", color: "#fff" },
  { id: "red", label: "Красный", color: "#ff2400" },
  { id: "yellow", label: "Жёлтый", color: "#ffe600" },
  { id: "green", label: "Зелёный", color: "#17da63" },
  { id: "cyan", label: "Голубой", color: "#00d5df" },
  { id: "blue", label: "Синий", color: "#0748ff" },
  { id: "magenta", label: "Пурпурный", color: "#ff22d1" },
  { id: "purple", label: "Фиолетовый", color: "#9b39ff" },
  { id: "orange", label: "Оранжевый", color: "#ff7a00" },
  { id: "lime", label: "Салатовый", color: "#9bff00" },
  { id: "pink", label: "Розовый", color: "#ff467e" },
] as const;

/* Черновик анкеты хранится в браузере, чтобы уход на правила и обратно не
   стирал написанное.

   Пароль, файл скина и ответ капчи в черновик не попадают намеренно:
   пароль нельзя класть в localStorage, файловое поле браузер по соображениям
   безопасности всё равно не даст заполнить программно, а ответ капчи
   одноразовый и привязан к отдельной cookie. */
const WAITLIST_DRAFT_KEY = "popperscraft-waitlist-draft";
const WAITLIST_DRAFT_SKIP = new Set(["password", "skin", "captchaAnswer", "referralCode"]);

const nyanPaletteSequence = ["red", "orange", "yellow", "green", "cyan", "blue", "purple"];
const nyanCats = Array.from({ length: 18 }, (_, index) => ({
  direction: index % 2 === 0 ? "east" : "west",
  y: `${3 + ((index * 17) % 86)}vh`,
  delay: `${(index % 9) * 0.17}s`,
  duration: `${3.1 + (index % 5) * 0.55}s`,
  scale: `${0.38 + (index % 4) * 0.14}`,
  drift: `${[-24, 18, -12, 26][index % 4]}vh`,
}));

type PublicUpdate = {
  id: number;
  badge: string;
  title: string;
  body: string;
  color: UpdateColor;
  created_at: string;
  author_name: string;
  board?: SiteBoardData;
  likes?: number;
  likedByMe?: boolean;
};

/* isMember — одобренная анкета. Доступ к серверу и оплата — в access. */
export type HomeViewer = {
  authenticated: boolean;
  needsMfa?: boolean;
  isAdmin: boolean;
  isMember: boolean;
  hidePrideFlags: boolean;
  access?: ViewerAccess | null;
  /* Анкеты в вайтлисте без голоса этого игрока — число у пункта меню. */
  whitelistToVote?: number;
};

/* Кнопка-действие: якорь на этой странице, внешняя ссылка или раздел сайта. */
function ActionLink({ action, className }: { action: StageAction; className: string }) {
  if (action.external) return <a className={className} href={action.href} target="_blank" rel="noreferrer">{action.label}</a>;
  if (action.href.startsWith("#")) return <a className={className} href={action.href}>{action.label}</a>;
  return <Link className={className} href={action.href}>{action.label}</Link>;
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error());
    reader.onerror = () => reject(reader.error ?? new Error());
    reader.readAsDataURL(file);
  });
}

const fallbackUpdates: PublicUpdate[] = [
  {
    id: -1,
    badge: "СТАТУС",
    created_at: "2026-07-27T12:00:00.000Z",
    title: "Сайт работает",
    body: "Домен popperscraft.org подключён. Здесь будем писать о запуске сервера.",
    color: "lime",
    author_name: "PoppersCraft",
  },
  {
    id: -2,
    badge: "VOICE",
    created_at: "2026-07-27T11:00:00.000Z",
    title: "Голосовой чат готов",
    body: "Simple Voice Chat уже работает. Осталось настроить расстояние и группы.",
    color: "pink",
    author_name: "PoppersCraft",
  },
  {
    id: -3,
    badge: "NEXT",
    created_at: "2026-07-27T10:00:00.000Z",
    title: "Настраиваем сервер",
    body: "Сейчас проверяем экономику, приваты, магазины, чат и защиту мира.",
    color: "cyan",
    author_name: "PoppersCraft",
  },
];

function renderBoards(updates: PublicUpdate[], placement: SiteBoardData["placement"]) {
  return updates.filter((update) => update.board?.placement === placement).map((update) => (
    <SiteBoard board={update.board!} boardId={update.id} key={update.id} />
  ));
}

export default function Home({
  initialViewer = null,
  openLogin = false,
  loginNext = "",
}: {
  initialViewer?: HomeViewer | null;
  openLogin?: boolean;
  loginNext?: string;
}) {
  const [clock, setClock] = useState("00:00:00");
  const [menuOpen, setMenuOpen] = useState(false);
  const [applicationMessage, setApplicationMessage] = useState("");
  const [applicationError, setApplicationError] = useState(false);
  const [applicationBusy, setApplicationBusy] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  /* Куда вернуть после входа, если окно открыли по ссылке «войдите». */
  const [loginTarget, setLoginTarget] = useState("");
  const [updates, setUpdates] = useState<PublicUpdate[]>(fallbackUpdates);
  const [updatesLoaded, setUpdatesLoaded] = useState(false);
  const [viewer, setViewer] = useState<HomeViewer | null>(initialViewer);
  const [waitlistCaptchaKey, setWaitlistCaptchaKey] = useState(0);
  const [headerCompact, setHeaderCompact] = useState(false);
  const [nyanPartyActive, setNyanPartyActive] = useState(false);
  const [nyanPartyRun, setNyanPartyRun] = useState(0);
  const nyanPaletteStep = useRef(0);
  const nyanAudioRef = useRef<HTMLAudioElement | null>(null);
  const applicationFormRef = useRef<HTMLFormElement>(null);
  const draftRestoredRef = useRef(false);
  const needsSessionFetch = useRef(initialViewer === null);
  const loginHandledRef = useRef(false);
  const userScrolledRef = useRef(false);
  const stage = viewerStage(viewer);
  const hero = stage ? heroAction(stage) : null;
  const navItems = mainNavItems(viewer ? { authenticated: viewer.authenticated, needsMfa: viewer.needsMfa, approved: viewer.isMember, admin: viewer.isAdmin, whitelistToVote: viewer.whitelistToVote } : null);

  /* Приложение PoppersCraft для iPhone открывает главную только ради окна
     входа (вход через Telegram): html[data-pc-app-view="login"]. */
  useEffect(() => {
    if (document.documentElement.dataset.pcAppView === "login") setLoginOpen(true);
  }, []);

  /* «/?login=1&next=…» (и старые ссылки «/#login») открывают окно входа
     гостю. Уже вошедший просто остаётся на главной: сюда его могла
     отправить страница, которую ему открывать нельзя, и обратный переход
     замкнул бы круг. Параметры убираются из адреса, чтобы окно не
     открылось снова при обновлении или возврате. */
  useEffect(() => {
    if (!viewer || loginHandledRef.current) return;
    const url = new URL(window.location.href);
    if (!openLogin && url.hash !== "#login") return;
    loginHandledRef.current = true;
    if (!viewer.authenticated) {
      setLoginTarget(loginNext);
      setLoginOpen(true);
    }
    if (url.pathname !== "/") return;
    url.searchParams.delete("login");
    url.searchParams.delete("next");
    if (url.hash === "#login") url.hash = "";
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, [viewer, openLogin, loginNext]);

  /* Раздел главной, на котором человек сейчас, — чтобы «Назад» с другой
     страницы вернул его сюда же, а не в самый верх. */
  useEffect(() => {
    let frame = 0;
    const save = () => {
      frame = 0;
      let current: string = HOME_SECTIONS[0];
      for (const id of HOME_SECTIONS) {
        const section = document.getElementById(id);
        if (section && section.getBoundingClientRect().top <= window.innerHeight * 0.35) current = id;
      }
      try {
        window.sessionStorage.setItem(HOME_SECTION_KEY, current);
      } catch {
        // Без хранилища «Назад» просто вернёт наверх главной.
      }
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(save);
    };
    /* Переход по ссылке случается раньше следующего кадра — в момент клика
       и ухода со страницы раздел записывается сразу. */
    const saveNow = () => {
      window.cancelAnimationFrame(frame);
      save();
    };
    save();
    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("click", saveNow, true);
    window.addEventListener("pagehide", saveNow);
    return () => {
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("click", saveNow, true);
      window.removeEventListener("pagehide", saveNow);
      window.cancelAnimationFrame(frame);
    };
  }, []);

  /* Переход на раздел (#donate и т. п.): браузер прокручивает к нему сразу,
     но потом загружаются обновления и растягиваются анимации — раздел
     уезжает. Когда всё загрузилось, докручиваем ещё раз, если человек
     сам не начал листать. */
  useEffect(() => {
    const stop = () => { userScrolledRef.current = true; };
    const events = ["wheel", "touchstart", "keydown", "mousedown"] as const;
    events.forEach((name) => window.addEventListener(name, stop, { passive: true }));
    return () => events.forEach((name) => window.removeEventListener(name, stop));
  }, []);

  useEffect(() => {
    if (!updatesLoaded) return;
    const id = window.location.hash.slice(1);
    if (id === "top" || !(HOME_SECTIONS as readonly string[]).includes(id)) return;
    const timer = window.setTimeout(() => {
      if (!userScrolledRef.current) document.getElementById(id)?.scrollIntoView({ block: "start", behavior: "instant" as ScrollBehavior });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [updatesLoaded]);

  useEffect(() => {
    const tick = () =>
      setClock(
        new Intl.DateTimeFormat("ru-RU", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
        }).format(new Date()),
    );
    tick();
    const timer = window.setInterval(tick, 1000);
    fetch("/api/updates")
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((result) => {
        if (Array.isArray(result.updates) && result.updates.length) {
          setUpdates(result.updates);
        }
      })
      .catch(() => {
        // Keep the built-in entries visible if the database is unavailable.
      })
      .finally(() => setUpdatesLoaded(true));
    /* Обычно сервер уже передал, кто зашёл. Запрос нужен, только если
       база не ответила при отрисовке страницы. */
    if (needsSessionFetch.current) {
      fetch("/api/session", { cache: "no-store" })
        .then((response) => (response.ok ? response.json() : Promise.reject()))
        .then((result) => {
          const approved = Boolean(result.isApproved ?? result.isMember);
          const serverAccess = Boolean(result.isMember);
          setViewer({
            authenticated: Boolean(result.authenticated),
            isAdmin: Boolean(result.isAdmin),
            isMember: approved,
            hidePrideFlags: Boolean(result.hidePrideFlags),
            /* Без сведений об оплате: кнопки PLUS ведут на страницу доната,
               а она сама покажет, что доступно. */
            access: { approved, serverAccess, passRequired: approved && !serverAccess, passForSale: approved && !serverAccess, paymentsOpen: false, test: false, plus: null },
          });
        })
        .catch(() => {
          setViewer({ authenticated: false, isAdmin: false, isMember: false, hidePrideFlags: true });
        });
    }
    return () => window.clearInterval(timer);
  }, []);

  /* Шапка сжимается вдвое, как только страницу начали листать вниз, и
     возвращается к полному размеру только когда пользователь домотал обратно
     до самого верха. Пороги разные намеренно: сжатие при 90px, разжатие при
     возврате на 0. Иначе шапка дёргалась бы туда-сюда возле границы. */
  useEffect(() => {
    const onScroll = () => {
      setHeaderCompact((compact) => (compact ? window.scrollY > 1 : window.scrollY > 90));
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  /* Восстановление и автосохранение черновика анкеты.

     Форма неуправляемая: значения читаются из неё только при отправке.
     Поэтому черновик пишется напрямую в поля и читается из них же, без
     перевода всей анкеты на состояние React. */
  useEffect(() => {
    const form = applicationFormRef.current;
    if (!form) return;

    const savableFields = () =>
      Array.from(form.elements).filter(
        (element): element is HTMLInputElement | HTMLTextAreaElement =>
          (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)
          && Boolean(element.name)
          && !WAITLIST_DRAFT_SKIP.has(element.name)
          && element.type !== "password"
          && element.type !== "file"
          && element.type !== "hidden",
      );

    try {
      const raw = draftRestoredRef.current ? null : window.localStorage.getItem(WAITLIST_DRAFT_KEY);
      draftRestoredRef.current = true;
      if (raw) {
        const draft = JSON.parse(raw) as Record<string, unknown>;
        for (const field of savableFields()) {
          const value = draft[field.name];
          if (value === undefined) continue;
          if (field instanceof HTMLInputElement && field.type === "checkbox") {
            field.checked = value === true;
          } else if (typeof value === "string") {
            field.value = value;
          }
        }
      }
    } catch {
      // Испорченный или недоступный черновик просто игнорируется.
    }

    const writeDraft = () => {
      const draft: Record<string, string | boolean> = {};
      for (const field of savableFields()) {
        draft[field.name] = field instanceof HTMLInputElement && field.type === "checkbox"
          ? field.checked
          : field.value;
      }
      try {
        window.localStorage.setItem(WAITLIST_DRAFT_KEY, JSON.stringify(draft));
      } catch {
        // Переполненное или отключённое хранилище не должно ломать анкету.
      }
    };

    /* Обычная запись отложена, чтобы не дёргать хранилище на каждой букве. */
    let timer: number | undefined;
    const save = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(writeDraft, 400);
    };

    /* Но уход со страницы не должен зависеть от того, успела ли сработать
       отложенная запись. Ссылка на правила стоит прямо внутри анкеты, и клик
       по ней через долю секунды после набора иначе потерял бы последние
       символы. Поэтому при уходе черновик записывается сразу. */
    const flush = () => {
      window.clearTimeout(timer);
      writeDraft();
    };

    form.addEventListener("input", save);
    form.addEventListener("change", save);
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", flush);

    return () => {
      form.removeEventListener("input", save);
      form.removeEventListener("change", save);
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", flush);
      /* Переход на другую страницу размонтирует форму — записываем последнее
         состояние синхронно, пока поля ещё доступны. */
      flush();
    };
    /* Секция анкеты отрисовывается только после ответа /api/session, поэтому
       эффект обязан перезапуститься, когда форма наконец появится в разметке.
       С пустым списком зависимостей он отрабатывал до её появления и молча
       ничего не подключал. */
  }, [viewer]);


  /* Звук пасхалки полностью отсоединяется, когда мелодия закончилась.

     Раньше элемент <audio> с загруженным файлом постоянно висел в разметке.
     После проигрывания система продолжала считать его активным источником
     звука, и аппаратная кнопка воспроизведения на клавиатуре (на макбуке —
     F8) снова запускала мелодию посреди работы с сайтом.

     Снять источник недостаточно поставить на паузу: пока у элемента есть src,
     он остаётся законной целью для системного плеера. Поэтому src убирается,
     вызывается load(), и заодно очищается запись в системном плеере. */
  const stopNyanAudio = () => {
    const audio = nyanAudioRef.current;
    nyanAudioRef.current = null;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    if (typeof navigator !== "undefined" && "mediaSession" in navigator) {
      try {
        navigator.mediaSession.playbackState = "none";
        navigator.mediaSession.metadata = null;
      } catch {
        // Системный плеер недоступен — ничего снимать не нужно.
      }
    }
  };

  /* Уход со страницы посреди анимации не должен оставлять звук играть
     и висеть в системном плеере. */
  useEffect(() => stopNyanAudio, []);

  const startNyanParty = () => {
    setNyanPartyRun((value) => value + 1);
    setNyanPartyActive(true);
    /* Повторный запуск не должен оставлять предыдущий звук висеть. */
    stopNyanAudio();
    const audio = new Audio("/easter-eggs/nyan-cat.mp3");
    audio.volume = 0.62;
    audio.addEventListener("ended", () => {
      stopNyanAudio();
      setNyanPartyActive(false);
    }, { once: true });
    nyanAudioRef.current = audio;
    void audio.play().catch(() => {
      stopNyanAudio();
      setNyanPartyActive(false);
    });
  };

  const selectPaletteColor = (colorId: string) => {
    const expectedColor = nyanPaletteSequence[nyanPaletteStep.current];
    if (colorId === expectedColor) {
      nyanPaletteStep.current += 1;
      if (nyanPaletteStep.current === nyanPaletteSequence.length) {
        nyanPaletteStep.current = 0;
        startNyanParty();
      }
      return;
    }
    nyanPaletteStep.current = colorId === nyanPaletteSequence[0] ? 1 : 0;
  };

  const closeMenu = () => setMenuOpen(false);

  /* Переход по пункту меню к разделу главной. Браузер прыгает к разделу
     сразу, а потом выше догружаются обновления и картинки, и раздел уезжает —
     поэтому докручиваем ещё несколько раз, пока человек сам не начал листать.
     Закреплённый GSAP-раздел доната меряем по его обёртке pin-spacer: она
     стоит в потоке страницы, а сам раздел во время закрепления «висит». */
  const jumpToSection = (event: MouseEvent<HTMLAnchorElement>, id: string) => {
    const target = document.getElementById(id);
    closeMenu();
    if (!target) return;
    event.preventDefault();
    let cancelled = false;
    const cancel = () => { cancelled = true; };
    const events = ["wheel", "touchstart", "keydown"] as const;
    events.forEach((name) => window.addEventListener(name, cancel, { passive: true, once: true }));
    const anchor = target.parentElement?.classList.contains("pin-spacer") ? target.parentElement : target;
    const margin = Number.parseFloat(getComputedStyle(target).scrollMarginTop) || 0;
    const go = () => {
      if (cancelled) return;
      const top = anchor.getBoundingClientRect().top + window.scrollY - margin;
      window.scrollTo({ top: Math.max(0, top), behavior: "instant" as ScrollBehavior });
    };
    go();
    requestAnimationFrame(go);
    [250, 600, 1200].forEach((delay) => window.setTimeout(go, delay));
    window.setTimeout(() => events.forEach((name) => window.removeEventListener(name, cancel)), 1300);
    window.history.replaceState(null, "", `#${id}`);
  };

  const submitApplication = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setApplicationBusy(true);
    setApplicationMessage("");
    const form = event.currentTarget;
    const data = new FormData(form);
    const skin = data.get("skin");
    if (!(skin instanceof File) || !skin.size) {
      setApplicationError(true);
      setApplicationMessage("Добавьте PNG-скин Minecraft.");
      setApplicationBusy(false);
      return;
    }
    const payload = Object.fromEntries(data) as Record<string, FormDataEntryValue | string>;
    delete payload.skin;
    try {
      payload.skinData = await fileToDataUrl(skin);
    } catch {
      setApplicationError(true);
      setApplicationMessage("Не удалось прочитать файл скина.");
      setApplicationBusy(false);
      return;
    }
    try {
      const response = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      setWaitlistCaptchaKey((value) => value + 1);
      setApplicationError(!response.ok);
      setApplicationMessage(result.message ?? result.error ?? "Что-то пошло не так.");
      if (response.ok) {
        form.reset();
        /* Анкета принята — черновик больше не нужен. */
        try {
          window.localStorage.removeItem(WAITLIST_DRAFT_KEY);
        } catch {
          // Недоступное хранилище не мешает отправленной анкете.
        }
        if (new URLSearchParams(window.location.search).get("donationInterest") === "1") {
          window.location.href = "/donation?from=waitlist";
        }
      }
    } catch {
      setApplicationError(true);
      setApplicationMessage("Не удалось отправить анкету. Проверь соединение и попробуй ещё раз — заполненные поля сохранены.");
    } finally {
      setApplicationBusy(false);
    }
  };

  return (
    <main>
      <div className="desktop-noise" aria-hidden="true" />
      {nyanPartyActive ? (
        <>
          <div className="nyan-rainbow-wash" aria-hidden="true" />
          <div className="nyan-party-layer" aria-hidden="true" key={nyanPartyRun}>
            {nyanCats.map((cat, index) => (
              <Image
                className={`nyan-cat nyan-cat-${cat.direction}`}
                src="/easter-eggs/nyan-cat.gif"
                alt=""
                width={350}
                height={160}
                unoptimized
                loading="eager"
                key={index}
                style={{
                  "--nyan-y": cat.y,
                  "--nyan-delay": cat.delay,
                  "--nyan-duration": cat.duration,
                  "--nyan-scale": cat.scale,
                  "--nyan-drift": cat.drift,
                } as CSSProperties}
              />
            ))}
          </div>
        </>
      ) : null}
      <header className={headerCompact ? "site-header is-compact" : "site-header"}>
        <a className="mini-logo" href="#top" aria-label="PoppersCraft — наверх">
          <span>POPPERSCRAFT</span>
          <Image className="platform-logo" src="/popperscraft-p.svg" alt="" width={38} height={38} priority />
        </a>
        <button
          className="mobile-menu-button win-button"
          type="button"
          aria-label="Открыть меню"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((value) => !value)}
        >
          меню
        </button>
        <nav className={menuOpen ? "main-nav is-open" : "main-nav"} aria-label="Основное меню">
          {/* Те же пункты, что в шапке остальных страниц (lib/site-navigation.ts);
              разделы главной здесь прокручиваются, а не открываются заново. */}
          {navItems.map((item) => {
            const section = item.section;
            return section ? (
              <a key={item.href} href={`#${section}`} onClick={(event) => jumpToSection(event, section)}>{item.label}</a>
            ) : (
              <Link key={item.href} href={item.href} onClick={closeMenu} className={item.badge ? "has-nav-badge" : undefined} title={item.badge ? whitelistBadgeLabel(item.badge) : undefined}>
                {item.label}
                {item.badge ? <span className="nav-badge" aria-label={whitelistBadgeLabel(item.badge)}>{item.badge}</span> : null}
              </Link>
            );
          })}
          {/* Язык сайта можно выбрать сразу, ещё до входа в аккаунт. */}
          <LanguageSwitch compact />
        </nav>
        {viewer === null ? (
          <span className="header-session-placeholder" aria-hidden="true" />
        ) : viewer.authenticated ? (
          <ProfileMenu approved={viewer.isMember || viewer.isAdmin} needsMfa={viewer.needsMfa} />
        ) : (
          <button className="header-login-button" type="button" onClick={() => setLoginOpen(true)}>ВХОД →</button>
        )}
      </header>
      <div className="site-header-spacer" aria-hidden="true" />
      <LoginModal
        open={loginOpen}
        onClose={() => { setLoginOpen(false); setLoginTarget(""); }}
        successRedirect={loginTarget || undefined}
      />

      <section className="hero" id="top">
        <div className="paint-window hero-window">
          <div className="window-bar">
            <MinecraftIcon name="grass" size="sm" />
            <span>popperscraft_final_FINAL_2.png — Paint</span>
            <div className="window-actions" aria-hidden="true">
              <i>_</i><i>□</i><i>×</i>
            </div>
          </div>
          <div className="menu-strip">
            <span>Файл</span><span>Правка</span><span>Вид</span><span>Мир</span><span>Помощь</span>
          </div>
          <div className="paint-body">
            <aside className="toolbox" aria-label="Панель декоративных инструментов">
              {paintTools.map((tool) => (
                <span key={tool}><MinecraftIcon name={tool} size="sm" /></span>
              ))}
            </aside>
            <div className="hero-canvas">
              <p className="eyebrow">MINECRAFT SURVIVAL · ВХОД ПО ЗАЯВКЕ</p>
              <h1>
                <span>POPPERS</span>
                <em>CRAFT</em>
              </h1>
              {/* Надпись скрыта у игроков с настройкой «Я гомофоб». Пока сайт не знает,
                  кто зашёл, она тоже невидима — иначе успела бы мелькнуть. Место
                  под ней остаётся, чтобы первый экран не прыгал. */}
              <p
                className="hero-copy"
                style={viewer === null || (viewer.authenticated && viewer.hidePrideFlags) ? { visibility: "hidden" } : undefined}
              >
                pedik warning*
              </p>
              <div className="server-row">
                {/* Кнопки «IP сервера» больше нет (r090): зайти можно только через лаунчер PoppersCraft. */}
                {/* Гостю — анкета, игроку без пропуска — оплата, игроку
                    с доступом — лаунчер. Пока неизвестно, кто зашёл,
                    кнопка держит место, но не видна. */}
                {hero ? <ActionLink className="join-button" action={hero} /> : <span className="join-button" aria-hidden="true" style={{ visibility: "hidden" }}>ЗАЙТИ В МИР →</span>}
              </div>
              <span className="tiny-note">Вход по вайтлисту · Simple Voice Chat</span>
              <div className="pixel-cloud cloud-a" />
              <div className="pixel-cloud cloud-b" />
              <div className="pixel-sun">☼</div>
              <div className="ground">
                <i className="tree tree-one" />
                <i className="tree tree-two" />
                <i className="house" />
              </div>
            </div>
          </div>
          <div className="palette" role="group" aria-label="Палитра Paint">
            {paintPalette.map((color) => (
              <button
                type="button"
                key={color.id}
                aria-label={color.label}
                onClick={() => selectPaletteColor(color.id)}
                style={{ background: color.color }}
              />
            ))}
          </div>
          <div className="status-bar">
            {/* IP на сайте больше нет (r090): в игру заходят через лаунчер. */}
            <span>Играть — через лаунчер PoppersCraft.</span>
            <span>{clock}</span>
          </div>
        </div>
      </section>

      {renderBoards(updates, "after-hero")}

      <section className="overview-section" id="overview">
        <div className="section-heading">
          <span className="heading-number">01</span>
          <div>
            <p className="kicker">КАК УСТРОЕН СЕРВЕР</p>
            <h2>ОБЗОР МИРА</h2>
          </div>
        </div>

        <div className="overview-grid">
          <div className="manifesto">
            <p className="big-lead">Землю покупают за игровые ресурсы, а дороги и метро строят сами игроки.</p>
            <div className="feature-cards">
              <article className="feature-card yellow-card">
                <span>01.</span>
                <h3>ЭКОНОМИКА</h3>
                <p>Главная валюта сервера — попперсы. 1 алмаз = 100 попперсов.</p>
              </article>
              <article className="feature-card blue-card">
                <span>02.</span>
                <h3>ПРИВАТЫ</h3>
                <p>Приваты за попперсы</p>
              </article>
              <article className="feature-card pink-card">
                <span>03.</span>
                <h3>ЖИВОЕ МЕТРО</h3>
                <p>Плагин на метро заставит вас копать метро.</p>
              </article>
            </div>
          </div>

          <div className="map-wrap">
            <div className="map-title-row">
              <div>
                <span className="live-badge"><i /> LIVE</span>
                <h3>КАРТА СЕЙЧАС</h3>
              </div>
              <a className="map-external-link" href="https://map.popperscraft.org" target="_blank" rel="noreferrer">НА ВЕСЬ ЭКРАН ↗</a>
            </div>
            <div className="live-map">
              <iframe
                className="live-map-frame"
                src="https://map.popperscraft.org"
                title="Интерактивная карта мира PoppersCraft"
                loading="lazy"
                allow="fullscreen"
                allowFullScreen
                referrerPolicy="strict-origin-when-cross-origin"
              />
            </div>
            <p className="mobile-map-note">На телефоне карта открывается отдельной вкладкой — так она работает быстрее и не мешает прокрутке.</p>
            <div className="map-footer">
              <p><span className="status-dot" /> КАРТА ПОДКЛЮЧЕНА</p>
              <p>Двигайте, приближайте и смотрите игроков онлайн</p>
            </div>
          </div>
        </div>
      </section>

      {renderBoards(updates, "after-overview")}

      {viewer !== null && !viewer.authenticated ? (
      <section className="waitlist-section" id="waitlist">
        <div className="section-heading">
          <span className="heading-number">02</span>
          <div>
            <p className="kicker">WHITELIST.EXE</p>
            <h2>ЛИСТ ОЖИДАНИЯ</h2>
          </div>
          <span className="waitlist-sticker">ВХОД ПО АНКЕТЕ</span>
        </div>
        {/* Весь путь от анкеты до игры: голосование игроков, решение
            администрации, оплата входа и лаунчер. */}
        <JoinProcess />

        <div className="waitlist-grid">
          <div className="paint-window application-window">
            <div className="window-bar">
              <span className="window-title-with-icon"><MinecraftIcon name="book" size="sm" /> new_player_form.exe</span>
              <div className="window-actions" aria-hidden="true"><i>_</i><i>□</i><i>×</i></div>
            </div>
            <div className="menu-strip"><span>Анкета</span><span>Черновик</span><span>Отправить</span></div>
            <form className="waitlist-form" ref={applicationFormRef} onSubmit={submitApplication}>
              <div className="form-title">
                <span>НОВАЯ ЗАЯВКА</span>
                <small>необязательные поля отмечены отдельно</small>
              </div>
              <div className="credentials-row">
                <label>
                  <span>Логин / игровой ник</span>
                  <input
                    name="login"
                    autoComplete="username"
                    minLength={3}
                    maxLength={24}
                    pattern="[A-Za-z0-9_.-]+"
                    placeholder="steve_2007"
                    required
                  />
                </label>
                <label className="application-email-field">
                  <span>Почта</span>
                  <input
                    name="email"
                    type="email"
                    autoComplete="email"
                    maxLength={254}
                    placeholder="player@example.com"
                    required
                  />
                </label>
                <p className="mail-spam-note">
                  На неё придёт письмо с подтверждением от noreply@popperscraft.org. Если его нет во «Входящих» —
                  проверьте папку «Спам». Без подтверждённой почты нельзя будет восстановить пароль.
                </p>
                <label>
                  <span>Придумай пароль</span>
                  <input
                    name="password"
                    type="password"
                    autoComplete="new-password"
                    minLength={8}
                    maxLength={128}
                    placeholder="минимум 8 символов"
                    required
                  />
                </label>
              </div>
              <p className="login-match-note">Ник и пароль на платформе должны полностью совпадать с данными для входа на сервер Minecraft. Почта появится в профиле после одобрения заявки.</p>
              <ReferralField />
              <SkinUploadField required confirmSelection />
              <label>
                <span>01 / Напиши про себя в свободной форме</span>
                <textarea name="who" minLength={3} maxLength={1200} placeholder="Расскажи то, что считаешь важным: чем увлекаешься, как играешь, что любишь строить…" required />
              </label>
              <label>
                <span>02 / Откуда ты?</span>
                <textarea name="fromWhere" minLength={3} maxLength={1200} placeholder="Город, страна или просто часовой пояс" required />
              </label>
              <label>
                <span>03 / Почему хочешь быть на сервере?</span>
                <textarea name="whyServer" minLength={3} maxLength={1200} placeholder="Что тебе интересно в PoppersCraft?" required />
              </label>
              <label>
                <span>04 / Почему именно ты должен на него попасть?</span>
                <textarea name="whyYou" minLength={3} maxLength={1200} placeholder="Например: люблю строить, вести магазин или помогать новичкам" required />
              </label>
              <label>
                <span>05 / Любимые музыкальные альбомы</span>
                <input name="favoriteMusic" maxLength={300} placeholder="Напиши названия альбомов" autoComplete="off" />
              </label>
              <fieldset className="waitlist-socials">
                <legend>06 / Социальные сети</legend>
                <p className="form-field-help">Заполни любые поля. Можно оставить сразу несколько соцсетей. Их наполненность и достоверность повлияют на решение по заявке.</p>
                <div className="waitlist-social-grid">
                  {SOCIAL_LINK_FIELDS.map((field) => (
                    <label className={`waitlist-social-field social-${field.name}`} key={field.name}>
                      <span className="social-field-label"><SocialPixelIcon name={field.icon} />{field.label}</span>
                      <input name={field.name} maxLength={120} placeholder={field.placeholder} />
                    </label>
                  ))}
                  <label className="waitlist-social-field social-other">
                    <span className="social-field-label"><SocialPixelIcon name="other" />Другое</span>
                    <textarea name="socialOther" maxLength={180} placeholder="Сайт, Twitch, Steam или другая соцсеть — по одной на строку" />
                  </label>
                </div>
              </fieldset>
              <p className="password-note"><MinecraftIcon name="chest" size="sm" /> Пароль хранится в зашифрованном виде. Мы не можем его посмотреть.</p>
              <MinecraftCaptcha refreshKey={waitlistCaptchaKey} />
              <div className="registration-consent">
                <input id="accept-rules" name="acceptRules" type="checkbox" required />
                <label htmlFor="accept-rules">
                  Я прочитал <Link href="/rules">правила PoppersCraft</Link> и согласен на обработку данных из анкеты.
                </label>
              </div>
              {applicationMessage ? (
                <p className={applicationError ? "form-message error-message" : "form-message success-message"} role="status">
                  {applicationMessage}
                </p>
              ) : null}
              <button className="submit-application" type="submit" disabled={applicationBusy}>
                {applicationBusy ? "ОТПРАВЛЯЕМ…" : "ОТПРАВИТЬ АНКЕТУ →"}
              </button>
            </form>
            <div className="status-bar"><span>Решение принимают минимум 2 администратора</span><span>READY</span></div>
          </div>

        </div>
      </section>
      ) : null}

      {renderBoards(updates, "after-waitlist")}

      <section className="updates-section" id="updates">
        <div className="section-heading light-heading">
          {/* Лист ожидания (02) виден только гостям — у вошедших обновления идут вторыми. */}
          <span className="heading-number">{viewer !== null && !viewer.authenticated ? "03" : "02"}</span>
          <div>
            <p className="kicker">CHANGELOG.TXT</p>
            <h2>ОБНОВЛЕНИЯ</h2>
          </div>
        </div>
        <div className="updates-window paint-window">
          <div className="window-bar">
            <MinecraftIcon name="book" size="sm" />
            <span>что_мы_натворили.txt — Блокнот</span>
            <div className="window-actions" aria-hidden="true"><i>_</i><i>□</i><i>×</i></div>
          </div>
          <div className="menu-strip"><span>Файл</span><span>Правка</span><span>Поиск</span><span>Справка</span></div>
          <div className="updates-list">
            {updates.filter((update) => !update.board || update.board.placement === "updates").map((update) => update.board ? (
              <SiteBoard board={update.board} boardId={update.id} key={update.id} />
            ) : (
              <article className="update-row" key={update.id}>
                <UpdateBadge color={update.color} label={update.badge} />
                <time>
                  {new Intl.DateTimeFormat("ru-RU", {
                    day: "2-digit",
                    month: "2-digit",
                    year: "2-digit",
                  }).format(new Date(update.created_at))}
                </time>
                <div>
                  <h3>{update.title}</h3>
                  <p>{update.body}</p>
                </div>
                <UpdateLike id={update.id} count={update.likes ?? 0} liked={Boolean(update.likedByMe)} canLike={Boolean(viewer?.authenticated && !viewer.needsMfa)} />
              </article>
            ))}
          </div>
          <div className="status-bar"><span>Записей: {updates.length}</span><span>UTF-8</span></div>
        </div>
      </section>

      <DonationSection key={stage ?? "session-loading"} stage={stage} access={viewer?.access ?? null} />

      {renderBoards(updates, "after-donate")}

      {/* Блока «Сервер ещё настраиваем» больше нет (r100): сервер откроется сразу готовым. */}
      {renderBoards(updates, "before-discord")}

      <footer className="site-footer">
        <div className="footer-topline">
          <div>
            <p className="footer-kicker">MINECRAFT SERVER</p>
            <p className="footer-note">PLAY.POPPERSCRAFT.ORG</p>
          </div>
          <nav className="footer-links" aria-label="Ссылки внизу страницы">
            <a href="#top">Наверх ↑</a>
            <Link href="/rules">Правила</Link>
            <Link href="/wiki">Wiki</Link>
            {/* Ведёт в бота поддержки, а не в канал (r100, просьба владельца). */}
            <a href={SUPPORT_BOT_URL} target="_blank" rel="noreferrer">Telegram ↗</a>
          </nav>
        </div>

        <div className="footer-brand-stage">
          <span className="footer-pixel-tree footer-pixel-tree-one" aria-hidden="true"><i /><b /></span>
          <span className="footer-pixel-tree footer-pixel-tree-two" aria-hidden="true"><i /><b /></span>
          <span className="footer-pixel-tree footer-pixel-tree-three" aria-hidden="true"><i /><b /></span>
          <div className="footer-logo" aria-label="PoppersCraft">POPPERSCRAFT</div>
        </div>
        <p className="footer-credit">САЙТ СДЕЛАН БЫВАЛЫМ РЕДИСОМ<ReleaseStamp /><span className="footer-seller">{SELLER_SHORT} · <Link href="/rules#offer">Оферта</Link></span></p>
      </footer>
    </main>
  );
}
