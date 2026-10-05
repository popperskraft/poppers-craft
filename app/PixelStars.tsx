"use client";

import { useId, useState } from "react";
import { starFill } from "@/lib/star-rating";
import "./pixel-stars.css";

const STAR_PATH = "M7 0h2v3h2v2h5v4h-2v2h-2v5H9v-2H7v2H4v-5H2V9H0V5h5V3h2z";

export function PixelStar({ fill }: { fill: number }) {
  const id = useId();
  return <svg viewBox="0 0 16 16" aria-hidden="true" shapeRendering="crispEdges" className="pixel-star-icon">
    <defs><clipPath id={id}><rect width={Math.max(0, Math.min(1, fill)) * 16} height="16" /></clipPath></defs>
    <path fill="#a7a597" d={STAR_PATH} /><path fill="#ffc900" d={STAR_PATH} clipPath={`url(#${id})`} />
  </svg>;
}

export function PixelStars({ rating }: { rating: number }) {
  return <span className="pixel-stars-display" aria-hidden="true">{[1, 2, 3, 4, 5].map(star => <PixelStar key={star} fill={starFill(rating, star)} />)}</span>;
}

export function StarRatingPicker({ value, disabled = false, onChange }: {
  value: number; disabled?: boolean; onChange: (value: number) => void;
}) {
  const [hover, setHover] = useState<number | null>(null);
  return <div className="pixel-rating-picker" role="group" aria-label="Оценка от 0,5 до 5 звёзд" onPointerLeave={() => setHover(null)}>
    {[1, 2, 3, 4, 5].map(star => <span className="pixel-rating-star" key={star}>
      <PixelStar fill={starFill(hover ?? value, star)} />
      {[star - 0.5, star].map((score, index) => <button key={score} type="button"
        className={`pixel-rating-half ${index ? "is-right" : "is-left"}`}
        disabled={disabled} aria-pressed={value === score} aria-label={`Оценить на ${score} из 5`}
        title={`Оценить на ${score} из 5`} onPointerEnter={() => setHover(score)}
        onFocus={() => setHover(score)} onBlur={() => setHover(null)}
        onClick={() => { setHover(null); onChange(score); }} />)}
    </span>)}
  </div>;
}
