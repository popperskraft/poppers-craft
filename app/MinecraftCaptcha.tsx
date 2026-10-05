/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useState } from "react";
import "./minecraft-icons.css";

/* Вариант описывается только идентификатором: что на картинке — знает сервер,
   и картинку он же отдаёт по этому идентификатору. Раньше в ответе стояло имя
   предмета, и капчу проходил любой скрипт, не глядя на изображение. */
type Challenge = { prompt: string; options: Array<{ id: string; label: string }> };

export function MinecraftCaptcha({ active = true, refreshKey = 0 }: { active?: boolean; refreshKey?: number }) {
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [selected, setSelected] = useState("");

  useEffect(() => {
    if (!active) return;
    fetch("/api/auth/captcha", { cache: "no-store" })
      .then((response) => response.json())
      .then(setChallenge)
      .catch(() => setChallenge(null));
  }, [active, refreshKey]);

  const validSelected = challenge?.options.some((option) => option.id === selected) ? selected : "";

  return (
    <fieldset className="minecraft-captcha">
      <legend>ПРОВЕРКА ИГРОКА</legend>
      <p>{challenge?.prompt ?? "Загружаем мир…"}</p>
      <div>
        {challenge?.options.map((option) => (
          <button className={validSelected === option.id ? "selected" : ""} type="button" key={option.id} aria-label={option.label} onClick={() => setSelected(option.id)}>
            <img
              className="minecraft-icon mc-png-icon mc-icon-sm"
              src={`/api/auth/captcha/image?o=${encodeURIComponent(option.id)}`}
              width={128}
              height={128}
              alt=""
              aria-hidden="true"
              draggable={false}
              decoding="async"
            />
          </button>
        ))}
      </div>
      <input type="hidden" name="captchaAnswer" value={validSelected} required />
    </fieldset>
  );
}
