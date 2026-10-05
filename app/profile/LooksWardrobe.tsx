"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useRef, useState } from "react";
import { MinecraftSkinPreview } from "@/app/MinecraftSkinPreview";
import { LOOKS_LIMIT, LOOKS_LIMIT_HYPE, LOOKS_LIMIT_PLUS, type PlusTier } from "@/lib/plus-style";

type LookKind = "human" | "pony";

type Look = {
  id: string;
  name: string;
  kind: LookKind;
  updatedAt: string;
  model?: "classic" | "slim";
  payload: { skinBase64?: string; pixelsBase64?: string };
  /* Место сверх лимита нынешнего тарифа — надеть нельзя. */
  locked?: boolean;
};

/* Текстура пони — сырые пиксели 64×64, поэтому предпросмотр рисуем сами;
   у человека есть готовый 2D-просмотрщик скина. */
function PonyTexture({ pixelsBase64, name }: { pixelsBase64: string; name: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const context = canvasRef.current?.getContext("2d");
    if (!context) return;
    try {
      const raw = atob(pixelsBase64);
      const bytes = Uint8ClampedArray.from(raw, (char) => char.charCodeAt(0));
      if (bytes.length !== 16_384) return;
      context.putImageData(new ImageData(bytes, 64, 64), 0, 0);
    } catch {
      /* Повреждённый образ просто не рисуется. */
    }
  }, [pixelsBase64]);

  return <canvas className="look-card-texture" ref={canvasRef} width={64} height={64} role="img" aria-label={`Текстура образа ${name}`} />;
}

export function LooksWardrobe({ onApplied }: { onApplied?: () => void } = {}) {
  const router = useRouter();
  const [looks, setLooks] = useState<Look[] | null>(null);
  const [max, setMax] = useState(LOOKS_LIMIT);
  const [plus, setPlus] = useState(false);
  /* Тариф подписки: от него зависят лимит и то, что предложить дальше. */
  const [tier, setTier] = useState<PlusTier | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState("");
  /* Окно «что даёт подписка» — когда закончились бесплатные места. */
  const [upsell, setUpsell] = useState(false);

  const load = async () => {
    try {
      const response = await fetch("/api/profile/looks", { cache: "no-store" });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        setError(true);
        setMessage(result?.error ?? "Не удалось загрузить образы.");
        setLooks([]);
        return;
      }
      setLooks(result.looks ?? []);
      setMax(Number(result.max) || LOOKS_LIMIT);
      setPlus(Boolean(result.plus));
      setTier(result.tier === "hype" || result.tier === "plus" ? result.tier : null);
    } catch {
      setError(true);
      setMessage("Сервер не ответил. Обновите страницу.");
      setLooks([]);
    }
  };

  useEffect(() => { void load(); }, []);

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const kind = String(data.get("kind") ?? "pony");
    setBusy("save");
    setMessage("");
    try {
      const response = await fetch("/api/profile/looks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, name: data.get("name") }),
      });
      const result = await response.json().catch(() => null);
      /* Места кончились у игрока без подписки — показываем не ошибку,
         а что именно даёт подписка. */
      if (!response.ok && result?.plusRequired) {
        setUpsell(true);
        setError(false);
        setMessage("");
        return;
      }
      setError(!response.ok);
      setMessage(result?.message ?? result?.error ?? "Не удалось сохранить образ.");
      if (response.ok) {
        form.reset();
        await load();
      }
    } catch {
      setError(true);
      setMessage("Сервер не ответил. Попробуйте ещё раз.");
    } finally {
      setBusy("");
    }
  };

  const act = async (id: string, action: "apply" | "delete") => {
    setBusy(`${action}:${id}`);
    setMessage("");
    try {
      const response = action === "apply"
        ? await fetch("/api/profile/looks/apply", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
        })
        : await fetch(`/api/profile/looks?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const result = await response.json().catch(() => null);
      setError(!response.ok);
      setMessage(result?.message ?? result?.error ?? "Не удалось выполнить действие.");
      if (response.ok && action === "delete") await load();
      /* Надетый образ меняет скин — карточка и живой предпросмотр обновятся. */
      if (response.ok && action === "apply") { router.refresh(); onApplied?.(); }
    } catch {
      setError(true);
      setMessage("Сервер не ответил. Попробуйте ещё раз.");
    } finally {
      setBusy("");
    }
  };

  const full = (looks?.length ?? 0) >= max;

  return (
    <div className="looks-wardrobe">
      <p className="looks-counter">{`СОХРАНЕНО: ${looks ? looks.length : "…"} ИЗ ${max}`}{plus ? <span className={tier === "hype" ? "plus-tag is-hype" : "plus-tag"}>{tier === "hype" ? "HYPE" : "PLUS"}</span> : null}</p>
      {!plus ? <p className="looks-empty">С <Link href="/donation?plan=plus">POPPERS+</Link> можно хранить до {LOOKS_LIMIT_PLUS} образов, с <Link href="/donation?plan=hype">HYPE</Link> — до {LOOKS_LIMIT_HYPE}.</p> : null}
      {plus && tier !== "hype" ? <p className="looks-empty">С <Link href="/donation?plan=hype">POPPERS HYPE</Link> мест вдвое больше — {LOOKS_LIMIT_HYPE}.</p> : null}

      {upsell && plus ? (
        /* У PLUS места кончились — дальше только HYPE. */
        <div className="looks-upsell" role="status">
          <b>МЕСТА ЗАКОНЧИЛИСЬ</b>
          <p>С PLUS в гардеробе {LOOKS_LIMIT_PLUS} образов. В тарифе HYPE их {LOOKS_LIMIT_HYPE}, а ещё:</p>
          <ul>
            <li>скин пони и своя пластинка каждый день</li>
            <li>анимированная шапка профиля до восьми кадров</li>
            <li>радужная обводка и закреплённый пост</li>
          </ul>
          <p className="looks-upsell-hype">Оставшиеся дни PLUS не пропадут: HYPE включится сразу, а они перенесутся на время после него.</p>
          <div className="looks-upsell-actions">
            <Link className="looks-upsell-button" href="/donation?plan=hype">ПЕРЕЙТИ НА HYPE →</Link>
            <button type="button" onClick={() => setUpsell(false)}>ПОЗЖЕ</button>
          </div>
        </div>
      ) : upsell ? (
        <div className="looks-upsell" role="status">
          <b>МЕСТА ЗАКОНЧИЛИСЬ</b>
          <p>Без подписки в гардеробе {LOOKS_LIMIT} образа. С POPPERS+ их становится {LOOKS_LIMIT_PLUS} — и это не всё, что она открывает:</p>
          <ul>
            <li>шесть образов вместо трёх — а с HYPE двенадцать</li>
            <li>значок у ника и обводка профиля</li>
            <li>семь тем для карточки игрока</li>
            <li>своя пиксельная шапка профиля</li>
            <li>стикеры в ленте и Wiki</li>
          </ul>
          <p className="looks-upsell-hype">А в тарифе HYPE образов вдвое больше — двенадцать, и сверху скин пони, своя пластинка каждый день, анимированная шапка и радужная обводка.</p>
          <div className="looks-upsell-actions">
            <Link className="looks-upsell-button" href="/donation?plan=plus">ПОСМОТРЕТЬ ПОДПИСКУ →</Link>
            <button type="button" onClick={() => setUpsell(false)}>ПОЗЖЕ</button>
          </div>
        </div>
      ) : null}

      {looks === null ? <p className="looks-empty">Загружаем образы…</p> : null}

      {looks && looks.length === 0 ? (
        <p className="looks-empty">
          Пока ничего не сохранено. Создайте образ в редакторе моделей, а потом сохраните его сюда —
          так можно держать наготове несколько скинов и переключаться между ними.
        </p>
      ) : null}

      {looks && looks.length > 0 ? (
        <ul className="looks-list">
          {looks.map((look) => (
            <li className={look.locked ? "look-card is-locked" : "look-card"} key={look.id}>
              <div className="look-card-preview">
                {look.kind === "human" && look.payload.skinBase64 ? (
                  <MinecraftSkinPreview src={`data:image/png;base64,${look.payload.skinBase64}`} alt={`Скин образа ${look.name}`} />
                ) : null}
                {look.kind === "pony" && look.payload.pixelsBase64 ? (
                  <PonyTexture pixelsBase64={look.payload.pixelsBase64} name={look.name} />
                ) : null}
              </div>
              <div className="look-card-body">
                <strong>{look.name}</strong>
                <small>{look.kind === "human" ? "ЧЕЛОВЕК" : "ПОНИ"}{look.locked ? (plus ? " · МЕСТО ИЗ HYPE" : " · МЕСТО ИЗ ПОДПИСКИ") : ""}</small>
              </div>
              <div className="look-card-actions">
                <button type="button" onClick={() => void act(look.id, "apply")} disabled={Boolean(busy) || look.locked}>
                  {busy === `apply:${look.id}` ? "НАДЕВАЕМ…" : look.locked ? (plus ? "НУЖЕН HYPE" : "НУЖНА ПОДПИСКА") : "НАДЕТЬ"}
                </button>
                <button type="button" className="look-card-remove" onClick={() => void act(look.id, "delete")} disabled={Boolean(busy)}>
                  {busy === `delete:${look.id}` ? "УДАЛЯЕМ…" : "УДАЛИТЬ"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      <form className="looks-form" onSubmit={save}>
        <label>
          НАЗВАНИЕ ОБРАЗА
          <input name="name" maxLength={40} placeholder="Например: зимний" disabled={full} />
        </label>
        <label>
          ЧТО СОХРАНИТЬ
          <select name="kind" defaultValue="pony" disabled={full}>
            <option value="pony">Пони из редактора</option>
            <option value="human">Скин человека</option>
          </select>
        </label>
        <button type="submit" disabled={full || Boolean(busy)}>
          {busy === "save" ? "СОХРАНЯЕМ…" : "СОХРАНИТЬ ТЕКУЩИЙ ОБРАЗ"}
        </button>
      </form>

      {full ? (
        <p className="looks-empty">{`Больше ${max} образов сохранить нельзя. Удалите ненужный, чтобы освободить место.`}</p>
      ) : null}

      {message ? (
        <p className={error ? "form-message error-message" : "form-message success-message"}>{message}</p>
      ) : null}
    </div>
  );
}
