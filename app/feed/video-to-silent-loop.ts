const MAX_SOURCE_BYTES = 60 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const MAX_DURATION_SECONDS = 5;

type ConversionProgress = (message: string) => void;

type VideoProfile = {
  maxSide: number;
  framesPerSecond: number;
  bitsPerSecond: number;
};

const PROFILES: VideoProfile[] = [
  { maxSide: 960, framesPerSecond: 24, bitsPerSecond: 3_200_000 },
  { maxSide: 720, framesPerSecond: 20, bitsPerSecond: 2_000_000 },
];

function waitForVideo(video: HTMLVideoElement, event: "loadedmetadata" | "loadeddata" | "seeked") {
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      video.removeEventListener(event, done);
      video.removeEventListener("error", failed);
    };
    const done = () => {
      cleanup();
      resolve();
    };
    const failed = () => {
      cleanup();
      reject(new Error("Не удалось прочитать видео. Попробуйте MP4, MOV или WEBM."));
    };
    video.addEventListener(event, done, { once: true });
    video.addEventListener("error", failed, { once: true });
  });
}

async function seekToStart(video: HTMLVideoElement) {
  if (video.currentTime < 0.01 && video.readyState >= 2) return;
  const ready = waitForVideo(video, "seeked");
  video.currentTime = 0;
  await ready;
}

function supportedOutputType() {
  const variants = [
    "video/mp4;codecs=avc1.42E01E",
    "video/mp4",
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ];
  return variants.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

async function recordProfile(video: HTMLVideoElement, profile: VideoProfile, onProgress: ConversionProgress) {
  const outputType = supportedOutputType();
  if (!outputType || typeof HTMLCanvasElement.prototype.captureStream !== "function") {
    throw new Error("Этот браузер не умеет подготавливать беззвучное видео. Обновите Safari или попробуйте Chrome.");
  }

  const scale = Math.min(1, profile.maxSide / Math.max(video.videoWidth, video.videoHeight));
  const width = Math.max(2, Math.round(video.videoWidth * scale));
  const height = Math.max(2, Math.round(video.videoHeight * scale));
  const duration = Math.min(video.duration, MAX_DURATION_SECONDS);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("Браузер не смог подготовить видео.");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";

  await seekToStart(video);
  context.drawImage(video, 0, 0, width, height);
  const stream = canvas.captureStream(profile.framesPerSecond);
  const chunks: Blob[] = [];
  const recorder = new MediaRecorder(stream, {
    mimeType: outputType,
    videoBitsPerSecond: profile.bitsPerSecond,
  });
  const stopped = new Promise<void>((resolve, reject) => {
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size) chunks.push(event.data);
    });
    recorder.addEventListener("stop", () => resolve(), { once: true });
    recorder.addEventListener("error", () => reject(new Error("Не удалось записать беззвучную копию видео.")), { once: true });
  });

  let recordingStarted = false;
  try {
    recorder.start(250);
    recordingStarted = true;
    await video.play();
    while (!video.ended && video.currentTime < duration) {
      context.drawImage(video, 0, 0, width, height);
      onProgress(`УБИРАЕМ ЗВУК: ${Math.min(100, Math.round((video.currentTime / duration) * 100))}%`);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
  } finally {
    video.pause();
    try {
      if (recordingStarted) {
        if (recorder.state !== "inactive") recorder.stop();
        await stopped;
      }
    } finally {
      stream.getTracks().forEach((track) => track.stop());
    }
  }

  const mimeType = (recorder.mimeType || outputType).split(";")[0].toLowerCase();
  return new Blob(chunks, { type: mimeType });
}

export async function videoFileToSilentLoop(file: File, onProgress: ConversionProgress) {
  if (!file.type.startsWith("video/")) throw new Error("Выбранный файл не похож на видео.");
  if (file.size > MAX_SOURCE_BYTES) throw new Error("Исходное видео должно быть не больше 60 МБ.");
  if (typeof MediaRecorder === "undefined") throw new Error("Обновите браузер, чтобы публиковать видео без звука.");

  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.preload = "auto";
  video.muted = true;
  video.defaultMuted = true;
  video.volume = 0;
  video.playsInline = true;
  video.src = url;
  video.style.cssText = "position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;left:-10px;top:-10px";
  document.body.append(video);

  try {
    if (video.readyState < 1) await waitForVideo(video, "loadedmetadata");
    if (video.readyState < 2) await waitForVideo(video, "loadeddata");
    if (!Number.isFinite(video.duration) || video.duration <= 0 || !video.videoWidth || !video.videoHeight) {
      throw new Error("Не удалось определить длину или размер видео.");
    }

    for (let attempt = 0; attempt < PROFILES.length; attempt += 1) {
      onProgress(attempt ? "ВИДЕО ПОЛУЧИЛОСЬ БОЛЬШИМ. УМЕНЬШАЕМ…" : "ГОТОВИМ БЕЗЗВУЧНОЕ ВИДЕО…");
      const blob = await recordProfile(video, PROFILES[attempt], onProgress);
      if (blob.size <= MAX_OUTPUT_BYTES) {
        const mimeType = blob.type === "video/mp4" ? "video/mp4" : "video/webm";
        const extension = mimeType === "video/mp4" ? "mp4" : "webm";
        const baseName = file.name.replace(/\.[^.]+$/, "").slice(0, 80) || "minecraft-video";
        return new File([blob], `${baseName}.${extension}`, { type: mimeType, lastModified: Date.now() });
      }
    }
    throw new Error("Видео получилось слишком большим. Выберите более короткий фрагмент.");
  } finally {
    video.pause();
    video.removeAttribute("src");
    video.load();
    video.remove();
    URL.revokeObjectURL(url);
  }
}
