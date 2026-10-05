"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

/* Торжественное окно обратного отсчёта до открытия платформы.

   Ночное небо с пиксельными фейерверками, лучи прожекторов, сияющий
   логотип и плитки отсчёта в стиле логотипа. Через экран натянута красная
   ленточка с бантом. Последние десять секунд — гигантские цифры, а в
   момент открытия ленточка разрезается, небо взрывается залпом и сайт
   открывается сам.

   Время считается по часам сервера: offset — разница между сервером и
   браузером, иначе у посетителя с неверными часами сайт «открылся» бы
   раньше или позже остальных. */

type Phase = "countdown" | "final" | "open";

const PALETTE = ["#d7ff24", "#ff4ead", "#33e7ff", "#ffe14d", "#ffffff", "#4d6dff"];

function pick() {
  return PALETTE[Math.floor(Math.random() * PALETTE.length)];
}

type Rocket = { x: number; y: number; vx: number; vy: number; color: string; trail: Array<[number, number]> };
type Spark = { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; size: number };

/* Небо на canvas: мерцающие звёзды и фейерверки из квадратных «пикселей».
   Режим задаёт частоту залпов: спокойно, чаще в последние секунды и
   сплошной салют в момент открытия. */
const OpeningSky = memo(function OpeningSky({ mode }: { mode: "calm" | "final" | "finale" }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const modeRef = useRef(mode);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let width = 0;
    let height = 0;
    let frame = 0;
    let lastLaunch = 0;
    let finaleFired = false;
    const stars = Array.from({ length: 150 }, () => ({
      x: Math.random(),
      y: Math.random() * 0.78,
      size: Math.random() < 0.15 ? 3 : 2,
      phase: Math.random() * Math.PI * 2,
      speed: 0.6 + Math.random() * 1.8,
    }));
    const rockets: Rocket[] = [];
    const sparks: Spark[] = [];
    const snap = (value: number) => Math.round(value / 2) * 2;

    const resize = () => {
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.imageSmoothingEnabled = false;
    };

    const launch = () => {
      const targetY = height * (0.1 + Math.random() * 0.36);
      rockets.push({
        x: width * (0.1 + Math.random() * 0.8),
        y: height,
        vx: (Math.random() - 0.5) * 1.4,
        vy: -Math.sqrt(2 * 0.12 * (height - targetY)),
        color: pick(),
        trail: [],
      });
    };

    const explode = (rocket: Rocket) => {
      const count = 48 + Math.floor(Math.random() * 44);
      const second = Math.random() < 0.45 ? pick() : rocket.color;
      const power = 2.2 + Math.random() * 2.4;
      for (let index = 0; index < count; index += 1) {
        const angle = (index / count) * Math.PI * 2 + Math.random() * 0.12;
        const speed = power * (0.55 + Math.random() * 0.45);
        sparks.push({
          x: rocket.x,
          y: rocket.y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: 0,
          max: 55 + Math.random() * 40,
          color: index % 2 ? rocket.color : second,
          size: Math.random() < 0.3 ? 4 : 3,
        });
      }
      if (sparks.length > 2600) sparks.splice(0, sparks.length - 2600);
    };

    const drawStars = (time: number) => {
      context.fillStyle = "#fff";
      for (const star of stars) {
        context.globalAlpha = reduceMotion ? 0.7 : 0.3 + 0.7 * (0.5 + 0.5 * Math.sin((time / 1000) * star.speed + star.phase));
        context.fillRect(snap(star.x * width), snap(star.y * height), star.size, star.size);
      }
      context.globalAlpha = 1;
    };

    resize();
    window.addEventListener("resize", resize);

    /* Без анимации — только неподвижные звёзды. */
    if (reduceMotion) {
      drawStars(0);
      return () => window.removeEventListener("resize", resize);
    }

    const draw = (time: number) => {
      frame = window.requestAnimationFrame(draw);
      context.clearRect(0, 0, width, height);
      drawStars(time);

      const current = modeRef.current;
      if (current === "finale" && !finaleFired) {
        finaleFired = true;
        for (let index = 0; index < 16; index += 1) launch();
      }
      const interval = current === "finale" ? 150 : current === "final" ? 420 : 1200;
      if (time - lastLaunch > interval * (0.6 + Math.random() * 0.8)) {
        lastLaunch = time;
        launch();
        if (current !== "calm" && Math.random() < 0.5) launch();
      }

      for (let index = rockets.length - 1; index >= 0; index -= 1) {
        const rocket = rockets[index];
        rocket.trail.push([rocket.x, rocket.y]);
        if (rocket.trail.length > 7) rocket.trail.shift();
        rocket.x += rocket.vx;
        rocket.y += rocket.vy;
        rocket.vy += 0.12;
        if (rocket.vy >= -0.4) {
          explode(rocket);
          rockets.splice(index, 1);
          continue;
        }
        context.fillStyle = rocket.color;
        rocket.trail.forEach(([x, y], step) => {
          context.globalAlpha = ((step + 1) / rocket.trail.length) * 0.85;
          context.fillRect(snap(x), snap(y), 3, 3);
        });
      }

      for (let index = sparks.length - 1; index >= 0; index -= 1) {
        const spark = sparks[index];
        spark.life += 1;
        spark.vx *= 0.985;
        spark.vy = spark.vy * 0.985 + 0.045;
        spark.x += spark.vx;
        spark.y += spark.vy;
        const left = 1 - spark.life / spark.max;
        if (left <= 0) {
          sparks.splice(index, 1);
          continue;
        }
        /* Под конец искры мерцают, как в настоящем салюте. */
        context.globalAlpha = Math.min(1, left * 1.4) * (left < 0.3 && spark.life % 6 < 3 ? 0.4 : 1);
        context.fillStyle = spark.color;
        context.fillRect(snap(spark.x), snap(spark.y), spark.size, spark.size);
      }
      context.globalAlpha = 1;
    };

    frame = window.requestAnimationFrame(draw);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return <canvas className="opening-sky" ref={canvasRef} aria-hidden="true" />;
});

function pad(value: number) {
  return String(value).padStart(2, "0");
}

export function OpeningCountdown({
  opensAt,
  offset,
  preview = false,
  openedEarly = false,
  onExitPreview,
}: {
  opensAt: string;
  offset: number;
  preview?: boolean;
  openedEarly?: boolean;
  onExitPreview?: () => void;
}) {
  const target = useMemo(() => Date.parse(opensAt), [opensAt]);
  /* До монтирования времени нет: сервер и браузер иначе нарисовали бы
     разные секунды. */
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => setNow(Date.now() + offset);
    tick();
    const timer = window.setInterval(tick, 250);
    return () => window.clearInterval(timer);
  }, [offset]);

  useEffect(() => {
    document.documentElement.classList.add("opening-lock");
    return () => document.documentElement.classList.remove("opening-lock");
  }, []);

  const remaining = now === null ? null : Math.max(0, target - now);
  const phase: Phase = openedEarly || remaining === 0 ? "open" : remaining !== null && remaining <= 10_000 ? "final" : "countdown";
  const totalSeconds = remaining === null ? 0 : Math.ceil(remaining / 1000);
  const units = [
    { label: "ДНЕЙ", value: Math.floor(totalSeconds / 86_400), key: "days" },
    { label: "ЧАСОВ", value: Math.floor((totalSeconds % 86_400) / 3_600), key: "hours" },
    { label: "МИНУТ", value: Math.floor((totalSeconds % 3_600) / 60), key: "minutes" },
    { label: "СЕКУНД", value: totalSeconds % 60, key: "seconds" },
  ];

  const dateLabel = useMemo(() => {
    if (now === null || !Number.isFinite(target)) return "";
    return new Intl.DateTimeFormat("ru-RU", {
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(new Date(target));
    // Дата не меняется каждую секунду — пересчитывается только после монтирования.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, now === null]);

  const enter = useCallback(() => {
    if (preview) onExitPreview?.();
    else window.location.reload();
  }, [preview, onExitPreview]);

  /* После церемонии все попадают на сайт. Небольшой запас нужен, чтобы
     сервер к моменту перезагрузки тоже считал отсчёт завершённым. */
  useEffect(() => {
    if (phase !== "open") return;
    const timer = window.setTimeout(enter, 7_500);
    return () => window.clearTimeout(timer);
  }, [phase, enter]);

  const skyMode = phase === "open" ? "finale" : phase === "final" ? "final" : "calm";
  const bubble = phase === "open" ? "УРА!" : phase === "final" ? "!!!" : "СКОРО!";

  return (
    <div className={`opening-stage phase-${phase}`} role="dialog" aria-modal="true" aria-label="Обратный отсчёт до открытия PoppersCraft">
      <div className="opening-rays" aria-hidden="true" />
      <OpeningSky mode={skyMode} />

      <div className="opening-ribbon" aria-hidden="true">
        <span className="opening-ribbon-left" />
        <span className="opening-ribbon-right" />
        <span className="opening-bow" />
        <span className="opening-snip" />
      </div>

      <div className="opening-content">
        <p className="opening-eyebrow">★ ГРАНД-ОТКРЫТИЕ ★</p>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="opening-logo" src="/popperscraft-p.svg" width={96} height={96} alt="" />
        <h1 className="opening-title">POPPERSCRAFT</h1>
        <p className="opening-subtitle">{phase === "open" ? "МЫ ОТКРЫТЫ!" : "ОТКРЫТИЕ ПЛАТФОРМЫ"}</p>
        {dateLabel && phase !== "open" ? <p className="opening-date">{dateLabel}</p> : null}

        {phase === "countdown" ? (
          <div className="opening-timer">
            {units.map((unit) => (
              <div className={`opening-unit ${unit.key}`} key={unit.key}>
                <span className="opening-digits" key={remaining === null ? "empty" : unit.value}>
                  {remaining === null ? "--" : pad(unit.value)}
                </span>
                <small>{unit.label}</small>
              </div>
            ))}
          </div>
        ) : null}

        {phase === "open" ? (
          <button className="opening-enter" type="button" onClick={enter}>
            {preview ? "ЗАКРЫТЬ ПРЕДПРОСМОТР" : "ВОЙТИ НА САЙТ →"}
          </button>
        ) : (
          <p className="opening-tagline">Мир уже построен, фонари зажжены. Осталось перерезать ленточку.</p>
        )}
        <p className="opening-ip">IP: PLAY.POPPERSCRAFT.ORG</p>
      </div>

      {phase === "final" ? (
        <div className="opening-final" aria-live="assertive">
          <span key={totalSeconds}>{totalSeconds}</span>
        </div>
      ) : null}

      <div className="opening-ground" aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="opening-villager" src="/poppers-villager.png" width={88} height={88} alt="" />
        <span className="opening-villager-bubble">{bubble}</span>
      </div>

      {preview ? (
        <button className="opening-preview-chip" type="button" onClick={onExitPreview}>ПРЕДПРОСМОТР · ЗАКРЫТЬ ×</button>
      ) : (
        <a className="opening-admin-link" href="/admin">вход для админов</a>
      )}
    </div>
  );
}
