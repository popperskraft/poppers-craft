"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { MinecraftIcon, type MinecraftIconName } from "./MinecraftIcon";
import "./plus-celebration.css";

/* Торжественное окно про подписку.

   Показывается один раз тому, кому PLUS или HYPE достался не за свою
   оплату: подарил
   друг или выдала команда. Сначала сцена с прожекторами и скином игрока,
   который кивает, потом короткий гид по возможностям подписки.

   Музыка включается только по нажатию «ОТКРЫТЬ» — браузеры не дают запускать
   звук без действия игрока, да и внезапный звук был бы грубым. */

type Celebration = {
  id: number;
  kind: "gift" | "admin";
  from: string | null;
  months: number;
  until: string | null;
  tier?: "plus" | "hype";
  skin: string | null;
};

type Perk = { icon: MinecraftIconName; title: string; text: string };

/* Гид по тарифу: у PLUS — то, что есть в PLUS, у HYPE — всё сразу. */
const PLUS_PERKS: Perk[] = [
  { icon: "nether_star", title: "Обводка профиля", text: "Светящийся контур везде на сайте. Пять цветов на выбор." },
  { icon: "writable_book", title: "Своя шапка", text: "Нарисуйте пиксельную шапку профиля в настройках." },
  { icon: "enchanted_book", title: "Темы карточки", text: "Семь оформлений карточки игрока: ночь, небо, Незер, Энд и другие." },
  { icon: "clock", title: "Значки стажа", text: "Месяц, три, полгода, год — отметка растёт вместе с подпиской." },
  { icon: "cake", title: "Стикеры", text: "Пиксельные реакции под постами в ленте и статьями Wiki." },
];

const HYPE_PERKS: Perk[] = [
  { icon: "golden_apple", title: "Гардероб в лаунчере", text: "Пять скинов человека и пять скинов пони — выбирайте в игре." },
  { icon: "lapis_lazuli", title: "Префикс и цвет ника", text: "Префикс в чате, цвет ника с градиентом и флаг." },
  { icon: "knowledge_book", title: "Сервер твоими словами", text: "Две свои строки в списке серверов Minecraft." },
  { icon: "bone", title: "Сообщение о смерти", text: "Своя фраза, когда ваш персонаж погибает." },
  { icon: "potion", title: "Размер персонажа", text: "От 25% до 300% — броня и предметы меняются вместе с ним." },
  { icon: "music_disc_cat", title: "Больше пластинок", text: "Своя пластинка каждый день, а не раз в неделю." },
  { icon: "writable_book", title: "Живая шапка", text: "Шапка профиля оживает: до восьми кадров анимации." },
  { icon: "nether_star", title: "Радужная обводка", text: "Переливающийся контур, а у HYPE он ещё и светится ярче." },
  { icon: "cake", title: "И всё из PLUS", text: "Темы карточки, стикеры, значки стажа, закреплённый пост и ранний доступ." },
];

const TERMS: Record<number, string> = { 1: "месяц", 3: "три месяца", 6: "полгода", 12: "год" };
const term = (months: number) => TERMS[months] ?? `${months} мес.`;

/* Маленький чиптюн-фанфар на Web Audio: отдельный файл музыки не нужен,
   и он не грузит страницу. */
function createMusic() {
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  const ctx = new Ctx();
  const master = ctx.createGain();
  master.gain.value = 0.0001;
  master.connect(ctx.destination);
  master.gain.exponentialRampToValueAtTime(0.16, ctx.currentTime + 0.4);

  const tone = (frequency: number, at: number, length: number, type: OscillatorType, level: number) => {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = type;
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime + at);
    gain.gain.exponentialRampToValueAtTime(level, ctx.currentTime + at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + length);
    oscillator.connect(gain);
    gain.connect(master);
    oscillator.start(ctx.currentTime + at);
    oscillator.stop(ctx.currentTime + at + length + 0.05);
  };

  /* Фанфар, а следом спокойный перебор — пока окно открыто. */
  const C5 = 523.25, E5 = 659.25, G5 = 783.99, A5 = 880, C6 = 1046.5, E6 = 1318.5;
  const fanfare: Array<[number, number, number]> = [
    [C5, 0, 0.16], [E5, 0.16, 0.16], [G5, 0.32, 0.16], [C6, 0.48, 0.5],
    [G5, 1.05, 0.16], [C6, 1.21, 0.16], [E6, 1.37, 0.8],
  ];
  for (const [frequency, at, length] of fanfare) {
    tone(frequency, at, length, "square", 0.3);
    tone(frequency / 2, at, length, "triangle", 0.22);
  }

  const loop: Array<[number, number]> = [[C5, 0], [E5, 0.24], [G5, 0.48], [A5, 0.72], [G5, 0.96], [E5, 1.2]];
  let bar = 0;
  const timer = window.setInterval(() => {
    bar += 1;
    if (bar > 16) return;
    for (const [frequency, at] of loop) {
      tone(frequency, at, 0.18, "square", 0.12);
    }
    tone(C5 / 2, 0, 0.6, "triangle", 0.16);
    tone(G5 / 2, 0.72, 0.6, "triangle", 0.14);
  }, 1440);

  return {
    stop() {
      window.clearInterval(timer);
      try {
        master.gain.cancelScheduledValues(ctx.currentTime);
        master.gain.setValueAtTime(master.gain.value, ctx.currentTime);
        master.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.3);
        window.setTimeout(() => void ctx.close(), 400);
      } catch {
        void ctx.close();
      }
    },
  };
}

/* Скин игрока: голову рисуем отдельно от туловища, чтобы она кивала. */
function drawSkin(canvas: HTMLCanvasElement, image: HTMLImageElement, part: "head" | "body") {
  const context = canvas.getContext("2d");
  if (!context) return;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = false;
  const modern = image.naturalHeight >= 64;
  const draw = (sx: number, sy: number, sw: number, sh: number, dx: number, dy: number) =>
    context.drawImage(image, sx, sy, sw, sh, dx, dy, sw, sh);
  if (part === "head") {
    draw(8, 8, 8, 8, 0, 0);
    draw(40, 8, 8, 8, 0, 0);
    return;
  }
  draw(20, 20, 8, 12, 4, 0);
  draw(44, 20, 4, 12, 0, 0);
  draw(4, 20, 4, 12, 4, 12);
  if (modern) {
    draw(36, 52, 4, 12, 12, 0);
    draw(20, 52, 4, 12, 8, 12);
    draw(20, 36, 8, 12, 4, 0);
    draw(44, 36, 4, 12, 0, 0);
    draw(52, 52, 4, 12, 12, 0);
    draw(4, 36, 4, 12, 4, 12);
    draw(4, 52, 4, 12, 8, 12);
  } else {
    draw(44, 20, 4, 12, 12, 0);
    draw(4, 20, 4, 12, 8, 12);
  }
}

function SkinStage({ skin, nodding }: { skin: string | null; nodding: boolean }) {
  const headRef = useRef<HTMLCanvasElement>(null);
  const bodyRef = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(!skin);

  useEffect(() => {
    if (!skin) return;
    let active = true;
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      if (!active || !headRef.current || !bodyRef.current) return;
      drawSkin(headRef.current, image, "head");
      drawSkin(bodyRef.current, image, "body");
    };
    image.onerror = () => { if (active) setFailed(true); };
    image.src = skin;
    return () => { active = false; };
  }, [skin]);

  if (failed) {
    return (
      <div className="plus-party-hero-star" aria-hidden="true">
        <MinecraftIcon name="nether_star" size="lg" />
      </div>
    );
  }

  return (
    <div className={nodding ? "plus-party-skin is-nodding" : "plus-party-skin"} aria-hidden="true">
      <canvas className="plus-party-skin-head" ref={headRef} width={8} height={8} />
      <canvas className="plus-party-skin-body" ref={bodyRef} width={16} height={24} />
    </div>
  );
}

export function PlusCelebration({ enabled }: { enabled: boolean }) {
  const [data, setData] = useState<Celebration | null>(null);
  const [stage, setStage] = useState<"sealed" | "show" | "guide">("sealed");
  const [muted, setMuted] = useState(false);
  const musicRef = useRef<{ stop: () => void } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    /* Небольшая пауза: сначала страница, потом праздник. */
    const timer = window.setTimeout(() => {
      fetch("/api/profile/plus/celebration", { cache: "no-store" })
        .then((response) => (response.ok ? response.json() : null))
        .then((result) => { if (active && result?.celebration) setData(result.celebration as Celebration); })
        .catch(() => { /* Поздравление не важнее сайта — молча пропускаем. */ });
    }, 1200);
    return () => { active = false; window.clearTimeout(timer); };
  }, [enabled]);

  const stopMusic = useCallback(() => {
    musicRef.current?.stop();
    musicRef.current = null;
  }, []);

  const close = useCallback(() => {
    const id = data?.id;
    setData(null);
    setStage("sealed");
    stopMusic();
    if (!id) return;
    void fetch("/api/profile/plus/celebration", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    }).catch(() => { /* Не закрылось на сервере — покажем в другой раз. */ });
  }, [data?.id, stopMusic]);

  const open = () => {
    setStage("show");
    if (!muted) {
      try {
        musicRef.current = createMusic();
      } catch {
        /* Без звука окно всё равно работает. */
      }
    }
    window.setTimeout(() => setStage((current) => (current === "show" ? "guide" : current)), 6500);
  };

  useEffect(() => () => stopMusic(), [stopMusic]);

  useEffect(() => {
    if (!data) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    document.body.classList.add("plus-party-open");
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.classList.remove("plus-party-open");
    };
  }, [data, close]);

  if (!data) return null;

  const fromFriend = data.kind === "gift" && data.from;
  const hype = data.tier === "hype";
  const name = hype ? "HYPE" : "PLUS";
  const perks = hype ? HYPE_PERKS : PLUS_PERKS;
  const heading = fromFriend ? `ВАМ ПОДАРИЛИ ${name}` : `${name} ВАШ`;
  const subheading = fromFriend
    ? `@${data.from} дарит вам ${term(data.months)} ${hype ? "POPPERS HYPE" : "POPPERS+"}`
    : `Команда PoppersCraft выдала вам ${term(data.months)} ${hype ? "POPPERS HYPE" : "POPPERS+"}`;

  return (
    <div className={hype ? "plus-party is-hype" : "plus-party"} role="dialog" aria-modal="true" aria-label={heading}>
      <div className="plus-party-lights" aria-hidden="true"><i /><i /><i /></div>
      <div className="plus-party-sparks" aria-hidden="true">
        {Array.from({ length: 14 }, (_, index) => <b key={index} style={{ "--spark": index } as CSSProperties} />)}
      </div>

      <div className="plus-party-window">
        <div className="window-bar">
          <MinecraftIcon name="nether_star" size="sm" />
          <span>{hype ? "hype.exe" : "plus.exe"} — подарок</span>
          <div className="window-actions">
            <button
              type="button"
              className="plus-party-mute"
              aria-label={muted ? "Включить музыку" : "Выключить музыку"}
              onClick={() => {
                setMuted((value) => {
                  if (!value) stopMusic();
                  return !value;
                });
              }}
            >
              {muted ? "♪ ВЫКЛ" : "♪ ВКЛ"}
            </button>
            <button type="button" className="plus-party-close" aria-label="Закрыть" onClick={close}>×</button>
          </div>
        </div>

        {stage === "sealed" ? (
          <div className="plus-party-sealed">
            <div className="plus-party-box" aria-hidden="true"><MinecraftIcon name="chest" size="lg" /></div>
            <h2>ДЛЯ ВАС ЕСТЬ ПОДАРОК</h2>
            <p>{fromFriend ? `@${data.from} кое-что вам оставил(а).` : "Команда PoppersCraft кое-что вам оставила."}</p>
            <button type="button" className="plus-party-primary" onClick={open}>ОТКРЫТЬ ПОДАРОК</button>
            <small>Будет музыка — если она сейчас некстати, выключите её кнопкой ♪ вверху.</small>
          </div>
        ) : (
          <div className="plus-party-stage">
            <div className="plus-party-hero">
              <SkinStage skin={data.skin} nodding />
              <div className="plus-party-hero-text">
                <h2>{heading}</h2>
                <p>{subheading}</p>
                {data.until ? (
                  <p className="plus-party-until">
                    Действует до {new Intl.DateTimeFormat("ru-RU", { dateStyle: "long" }).format(new Date(data.until))}
                  </p>
                ) : null}
              </div>
            </div>

            {stage === "show" ? (
              <button type="button" className="plus-party-primary" onClick={() => setStage("guide")}>ЧТО ТЕПЕРЬ ДОСТУПНО →</button>
            ) : (
              <div className="plus-party-guide">
                <h3>ЧТО ДАЁТ {name}</h3>
                <ul>
                  {perks.map((perk) => (
                    <li key={perk.title}>
                      <MinecraftIcon name={perk.icon} size="md" />
                      <div>
                        <strong>{perk.title}</strong>
                        <span>{perk.text}</span>
                      </div>
                    </li>
                  ))}
                </ul>
                <p className="plus-party-note">
                  {hype
                    ? "Оформление настраивается в «Профиль → Редактировать профиль»: цвет обводки, фон карточки, кадры шапки и закреплённый пост. Пони — в редакторе моделей."
                    : "Оформление настраивается в «Профиль → Редактировать профиль»: цвет обводки, фон карточки и своя шапка."}
                </p>
                <div className="plus-party-actions">
                  <Link className="plus-party-primary" href="/profile?edit=1#plus-ring" onClick={close}>НАСТРОИТЬ ОФОРМЛЕНИЕ →</Link>
                  <button type="button" className="plus-party-secondary" onClick={close}>ПОЗЖЕ</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
