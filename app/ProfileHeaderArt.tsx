"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_FRAME_MS } from "@/lib/plus-style";
import {
  hasPixelHeaderArt,
  parsePixelHeaderArt,
  pixelHeaderArtToColors,
  PROFILE_HEADER_ART_HEIGHT,
  PROFILE_HEADER_ART_WIDTH,
  type PixelHeaderArt,
} from "@/lib/profile-header-art";

/* Пиксельная шапка профиля. У подписчиков HYPE она бывает анимированной:
   кадры сменяются по кругу. Если в системе выключены анимации, остаётся
   только первый кадр. В списке игроков анимация идёт, только пока на
   карточку наведён курсор (playing), — иначе десятки шапок двигаются разом. */
export function ProfileHeaderArt({
  art,
  frames = [],
  frameMs = DEFAULT_FRAME_MS,
  playing = true,
}: {
  art: PixelHeaderArt | null;
  frames?: PixelHeaderArt[];
  frameMs?: number;
  playing?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [index, setIndex] = useState(0);
  const serialized = JSON.stringify(
    [art, ...frames]
      .map((frame) => parsePixelHeaderArt(frame))
      .filter((frame): frame is PixelHeaderArt => Boolean(frame && hasPixelHeaderArt(frame))),
  );
  const list = useMemo(() => JSON.parse(serialized) as PixelHeaderArt[], [serialized]);

  useEffect(() => setIndex(0), [serialized]);

  useEffect(() => {
    if (!playing) {
      setIndex(0);
      return;
    }
    if (list.length < 2) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const delay = Math.min(1500, Math.max(120, Math.round(frameMs) || DEFAULT_FRAME_MS));
    const timer = window.setInterval(() => setIndex((value) => (value + 1) % list.length), delay);
    return () => window.clearInterval(timer);
  }, [list, frameMs, playing]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const frame = list[index % Math.max(1, list.length)];
    const context = canvas?.getContext("2d");
    if (!canvas || !context || !frame) return;
    context.clearRect(0, 0, PROFILE_HEADER_ART_WIDTH, PROFILE_HEADER_ART_HEIGHT);
    pixelHeaderArtToColors(frame).forEach((color, pixel) => {
      if (!color) return;
      context.fillStyle = color;
      context.fillRect(pixel % PROFILE_HEADER_ART_WIDTH, Math.floor(pixel / PROFILE_HEADER_ART_WIDTH), 1, 1);
    });
  }, [list, index]);

  if (!list.length) return null;
  return <canvas className="profile-header-art" ref={canvasRef} width={PROFILE_HEADER_ART_WIDTH} height={PROFILE_HEADER_ART_HEIGHT} aria-hidden="true" />;
}
