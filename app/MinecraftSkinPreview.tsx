"use client";

import { useEffect, useRef, useState } from "react";

export function MinecraftSkinPreview({
  src,
  className = "",
  alt = "2D-модель скина Minecraft",
}: {
  src: string | null | undefined;
  className?: string;
  alt?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context || !src) return;
    let active = true;
    setFailed(false);
    const image = new Image();
    image.onload = () => {
      if (!active) return;
      context.clearRect(0, 0, 16, 32);
      context.imageSmoothingEnabled = false;
      const modern = image.naturalHeight >= 64;
      const draw = (sx: number, sy: number, sw: number, sh: number, dx: number, dy: number) =>
        context.drawImage(image, sx, sy, sw, sh, dx, dy, sw, sh);
      const drawMirrored = (sx: number, sy: number, sw: number, sh: number, dx: number, dy: number) => {
        context.save();
        context.translate(dx + sw, dy);
        context.scale(-1, 1);
        context.drawImage(image, sx, sy, sw, sh, 0, 0, sw, sh);
        context.restore();
      };

      draw(8, 8, 8, 8, 4, 0);
      draw(20, 20, 8, 12, 4, 8);
      draw(44, 20, 4, 12, 0, 8);
      draw(4, 20, 4, 12, 4, 20);
      if (modern) {
        draw(36, 52, 4, 12, 12, 8);
        draw(20, 52, 4, 12, 8, 20);
        draw(40, 8, 8, 8, 4, 0);
        draw(20, 36, 8, 12, 4, 8);
        draw(44, 36, 4, 12, 0, 8);
        draw(52, 52, 4, 12, 12, 8);
        draw(4, 36, 4, 12, 4, 20);
        draw(4, 52, 4, 12, 8, 20);
      } else {
        drawMirrored(44, 20, 4, 12, 12, 8);
        drawMirrored(4, 20, 4, 12, 8, 20);
        draw(40, 8, 8, 8, 4, 0);
      }
      setFailed(false);
    };
    image.onerror = () => active && setFailed(true);
    image.src = src;
    return () => {
      active = false;
    };
  }, [src]);

  const showPlaceholder = !src || failed;
  return (
    <div className={`minecraft-skin-preview ${showPlaceholder ? "is-placeholder" : ""} ${className}`.trim()}>
      <canvas ref={canvasRef} width={16} height={32} role="img" aria-label={alt} hidden={showPlaceholder} />
      {showPlaceholder ? <span aria-label="Скин не загружен">?</span> : null}
    </div>
  );
}
