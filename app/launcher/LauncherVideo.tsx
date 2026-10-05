"use client";

import { useEffect, useRef, useState } from "react";

export type LauncherVideoPlatform = "macos" | "windows";

/* Ролики лежат вне релизов, в /home/stepan/popperscraft/media
   (app/media/[name]/route.ts). aspect — пропорции кадра: место под видео
   занято заранее, и страница не прыгает, пока оно грузится. */
const VIDEOS: Record<LauncherVideoPlatform, { file: string; poster: string; title: string; text: string; label: string; aspect: string }> = {
  macos: {
    file: "/media/launcher-install-macos.mp4",
    poster: "/media/launcher-install-macos.jpg",
    title: "install_macos_video.mp4",
    text: "Установка лаунчера на Mac — от скачивания до первого запуска.",
    label: "Как установить лаунчер PoppersCraft на macOS",
    aspect: "3024 / 1964",
  },
  windows: {
    file: "/media/launcher-install-windows.mp4",
    poster: "/media/launcher-install-windows.jpg",
    title: "install_windows_video.mp4",
    text: "Установка лаунчера на Windows — от скачивания до первого запуска.",
    label: "Как установить лаунчер PoppersCraft на Windows",
    aspect: "16 / 9",
  },
};

/* Видео-инструкция установки лаунчера. Играет само и по кругу, без звука —
   браузеры разрешают автозапуск только беззвучного видео. Своих кнопок две:
   пауза и «ещё раз» с начала. */
export function LauncherVideo({ platform }: { platform: LauncherVideoPlatform }) {
  const clip = VIDEOS[platform];
  const videoRef = useRef<HTMLVideoElement>(null);
  const [paused, setPaused] = useState(false);
  const [waiting, setWaiting] = useState(true);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onPlay = () => setPaused(false);
    const onPause = () => setPaused(true);
    const onWaiting = () => setWaiting(true);
    const onReady = () => setWaiting(false);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("waiting", onWaiting);
    video.addEventListener("playing", onReady);
    video.addEventListener("canplay", onReady);
    /* Некоторые браузеры игнорируют autoplay до первого кадра — подталкиваем. */
    void video.play().catch(() => setPaused(true));
    return () => {
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("playing", onReady);
      video.removeEventListener("canplay", onReady);
    };
  }, []);

  const togglePause = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play().catch(() => undefined);
    else video.pause();
  };

  const restart = () => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = 0;
    void video.play().catch(() => undefined);
  };

  return (
    <section className="paint-window launcher-video" aria-label="Видео-инструкция установки лаунчера">
      <div className="window-bar"><span>{clip.title}</span></div>
      <div className="launcher-video-body">
        <h2>ВИДЕО-ИНСТРУКЦИЯ</h2>
        <p>{clip.text}</p>
        <div className="launcher-video-frame" style={{ aspectRatio: clip.aspect }}>
          <video
            ref={videoRef}
            src={clip.file}
            poster={clip.poster}
            autoPlay
            muted
            loop
            playsInline
            preload="auto"
            disablePictureInPicture
            aria-label={clip.label}
          />
          {waiting ? <span className="launcher-video-loading" aria-live="polite">ЗАГРУЖАЕМ ВИДЕО…</span> : null}
        </div>
        <div className="launcher-video-controls">
          <button type="button" onClick={togglePause} aria-pressed={paused}>
            {paused ? "▶ ПРОДОЛЖИТЬ" : "❚❚ ПАУЗА"}
          </button>
          <button type="button" onClick={restart}>↺ ЕЩЁ РАЗ</button>
        </div>
      </div>
    </section>
  );
}
