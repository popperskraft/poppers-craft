"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { loginPageUrl } from "@/lib/login-return";
import type { WikiRating as Rating } from "@/lib/wiki-discussion";
import { StarRatingPicker } from "@/app/PixelStars";

export function WikiRating({ articleId, initial, canRate }: { articleId: number; initial: Rating; canRate: boolean }) {
  const router = useRouter();
  const path = usePathname();
  const [rating, setRating] = useState(initial);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [message, setMessage] = useState("");
  async function rate(score: number) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/wiki/articles/${articleId}/rating`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ score }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Не удалось сохранить оценку.");
      setRating(result.rating); setMessage("Оценка сохранена. Её можно изменить."); router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Не удалось сохранить оценку."); }
    finally { lock.current = false; setBusy(false); }
  }
  return <section className="wiki-rating" aria-labelledby="wiki-rating-title">
    <div><h2 id="wiki-rating-title">ОЦЕНИТЬ СТАТЬЮ</h2><p>{rating.count ? `${rating.average.toFixed(1)} / 5 · Оценок: ${rating.count}` : "Пока нет оценок. Станьте первым."}</p></div>
    <div>
      <div aria-busy={busy}><StarRatingPicker value={rating.mine ?? rating.average} disabled={!canRate || busy} onChange={score => void rate(score)} /></div>
      {canRate ? <><p>{rating.mine ? `Ваша оценка: ${rating.mine} из 5` : "Выберите оценку от 0,5 до 5 с шагом 0,5."}</p><p>Левая половина звезды — половина балла, правая — целый балл.</p></> : <Link href={loginPageUrl(path)}>Войти, чтобы оценить</Link>}
    </div>
    {message ? <p className="wiki-notice" role="status">{message}</p> : null}
  </section>;
}
