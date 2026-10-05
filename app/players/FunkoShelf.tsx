"use client";

import { useEffect, useRef, useState } from "react";
import { FUNKO_RARITY, FUNKO_SKIN_LOGIN, type FunkoFigureId, type OwnedFunko } from "@/lib/funko-meta";
import "./funko.css";

/* Полка фанкопопов — раздел FANKOPOP в профиле (просьба владельца, 2026-10-03). Фигурка
   рисуется из скина прототипа в пропорциях Funko Pop: голова в полтора раза
   шире тела и занимает половину роста. Раздела нет вовсе, если фигурок у
   игрока нет. Холст — 24×48 клеток. */
const UNIT = 4;

type Part = { sx: number; sy: number; w: number; h: number; dx: number; dy: number; scale: number; mirror?: boolean };

/* Лицевые стороны частей тела в развёртке скина 64×64 и место на фигурке
   (в клетках; голова — в масштабе 3). Старые скины 64×32 не хранят левую руку
   и ногу — их отражаем с правых. */
function partsFor(legacy: boolean): Part[] {
  const base: Part[] = [
    { sx: 4, sy: 20, w: 4, h: 12, dx: 8, dy: 36, scale: 1 },
    legacy ? { sx: 4, sy: 20, w: 4, h: 12, dx: 12, dy: 36, scale: 1, mirror: true } : { sx: 20, sy: 52, w: 4, h: 12, dx: 12, dy: 36, scale: 1 },
    { sx: 20, sy: 20, w: 8, h: 12, dx: 8, dy: 24, scale: 1 },
    { sx: 44, sy: 20, w: 4, h: 12, dx: 4, dy: 24, scale: 1 },
    legacy ? { sx: 44, sy: 20, w: 4, h: 12, dx: 16, dy: 24, scale: 1, mirror: true } : { sx: 36, sy: 52, w: 4, h: 12, dx: 16, dy: 24, scale: 1 },
    { sx: 8, sy: 8, w: 8, h: 8, dx: 0, dy: 0, scale: 3 },
  ];
  if (legacy) return [...base, { sx: 40, sy: 8, w: 8, h: 8, dx: 0, dy: 0, scale: 3 }];
  return [
    ...base,
    { sx: 4, sy: 36, w: 4, h: 12, dx: 8, dy: 36, scale: 1 },
    { sx: 4, sy: 52, w: 4, h: 12, dx: 12, dy: 36, scale: 1 },
    { sx: 20, sy: 36, w: 8, h: 12, dx: 8, dy: 24, scale: 1 },
    { sx: 44, sy: 36, w: 4, h: 12, dx: 4, dy: 24, scale: 1 },
    { sx: 52, sy: 52, w: 4, h: 12, dx: 16, dy: 24, scale: 1 },
    { sx: 40, sy: 8, w: 8, h: 8, dx: 0, dy: 0, scale: 3 },
  ];
}

function FunkoFigureCanvas({ figure, title }: { figure: FunkoFigureId; title: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    let active = true;
    /* Пиксели холста не читаем, поэтому картинке не нужен CORS: так её не
       сломает закэшированный ответ без разрешающего заголовка. */
    const image = new Image();
    image.onload = () => {
      if (!active) return;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.imageSmoothingEnabled = false;
      for (const part of partsFor(image.height === 32)) {
        const width = part.w * part.scale * UNIT;
        const height = part.h * part.scale * UNIT;
        context.save();
        if (part.mirror) {
          context.translate(part.dx * UNIT + width, part.dy * UNIT);
          context.scale(-1, 1);
          context.drawImage(image, part.sx, part.sy, part.w, part.h, 0, 0, width, height);
        } else {
          context.drawImage(image, part.sx, part.sy, part.w, part.h, part.dx * UNIT, part.dy * UNIT, width, height);
        }
        context.restore();
      }
    };
    image.src = `/api/skins/${FUNKO_SKIN_LOGIN[figure]}`;
    return () => { active = false; };
  }, [figure]);
  return <canvas ref={canvasRef} width={24 * UNIT} height={48 * UNIT} role="img" aria-label={`Фигурка «${title}»`} />;
}

/* Пиксельная стрелка для листания полки: символы ◀ ▶ на iPhone рисуются
   цветными эмодзи. */
function ShelfArrow({ back }: { back?: boolean }) {
  return (
    <svg viewBox="0 0 5 7" width="10" height="14" aria-hidden="true" shapeRendering="crispEdges">
      <path fill="currentColor" d={back ? "M3 0h2v1H3zM2 1h2v1H2zM1 2h2v1H1zM0 3h2v1H0zM1 4h2v1H1zM2 5h2v1H2zM3 6h2v1H3z" : "M0 0h2v1H0zM1 1h2v1H1zM2 2h2v1H2zM3 3h2v1H3zM2 4h2v1H2zM1 5h2v1H1zM0 6h2v1H0z"} />
    </svg>
  );
}

/* Раздел FANKOPOP: по одной коробке, если фигурок несколько — листаются
   стрелками (и пальцем на телефоне), сбоку счётчик «1 / 3» (r098). */
export function FunkoShelf({ items }: { items: OwnedFunko[] }) {
  const trackRef = useRef<HTMLUListElement>(null);
  const [index, setIndex] = useState(0);
  if (!items.length) return null;
  const many = items.length > 1;
  const current = Math.min(index, items.length - 1);

  function go(step: number) {
    const track = trackRef.current;
    if (!track) return;
    const next = Math.max(0, Math.min(items.length - 1, current + step));
    const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    track.scrollTo({ left: next * track.clientWidth, behavior: smooth ? "smooth" : "auto" });
    setIndex(next);
  }

  function onScroll() {
    const track = trackRef.current;
    if (!track || !track.clientWidth) return;
    setIndex(Math.round(track.scrollLeft / track.clientWidth));
  }

  return (
    <div className="funko-carousel">
      <div className="funko-carousel-head">
        <h3>FANKOPOP</h3>
        {many ? (
          <div className="funko-carousel-nav">
            <button type="button" aria-label="Предыдущая фигурка" disabled={current === 0} onClick={() => go(-1)}><ShelfArrow back /></button>
            <span aria-live="polite">{current + 1} / {items.length}</span>
            <button type="button" aria-label="Следующая фигурка" disabled={current === items.length - 1} onClick={() => go(1)}><ShelfArrow /></button>
          </div>
        ) : null}
      </div>
      <ul className={many ? "funko-shelf is-carousel" : "funko-shelf"} ref={trackRef} onScroll={many ? onScroll : undefined}>
        {items.map((item) => (
          <li className="funko-slide" key={item.figure}>
            <div className={`funko-box funko-${item.figure}`}>
              <div className="funko-box-top"><b>POP!</b><em>#{item.number}</em></div>
              <div className="funko-box-window"><FunkoFigureCanvas figure={item.figure} title={item.title} /></div>
              <div className="funko-box-label">
                <strong>{item.title.toUpperCase()}</strong>
                <small>POPPERSCRAFT · {FUNKO_RARITY[item.figure]}</small>
                <small>ЕДИНСТВЕННЫЙ ЭКЗЕМПЛЯР</small>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
