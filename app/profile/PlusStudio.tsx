"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { MinecraftIcon } from "@/app/MinecraftIcon";
import { PlusPreview, type PlusPreviewProfile } from "./PlusPreview";
import {
  MAX_HEADER_FRAMES_HYPE,
  nextTenureTier,
  PLUS_RINGS,
  PLUS_THEMES,
  tenureTier,
  type PlusRing,
  type PlusTheme,
  type PlusTier,
} from "@/lib/plus-style";
import "./plus-studio.css";

/* Подписка и оформление PLUS. С r089 части живут в окне профиля
   (app/profile/page.tsx): статус, «что даёт подписка», стаж и ранний доступ —
   во вкладке «Подписка», обводка, тема (фон карточки) и закреплённый пост —
   в «Профиль → Редактировать». Какие части показать, задаёт parts.
   Раньше всё было на странице /plus и во вкладке «Оформление PLUS».
   Сверху — статус и предпросмотр карточки, рядом список всего, что даёт
   подписка, с отметкой «доступно / в HYPE» и ссылкой туда, где это
   настраивается. Ниже — цвет обводки, тема карточки, закреплённый пост, стаж
   и ранний доступ. Обводка, тема и стикеры — с любой подпиской; радужная
   обводка, закреплённый пост, живая шапка и ранний доступ — с HYPE.
   Выбранные настройки сохраняются и ждут продления. */

/* Что даёт подписка: need — какой тариф нужен (free — есть у всех). */
type Need = "free" | "plus" | "hype";
type Perk = { title: string; need: Need; detail: (state: { active: boolean; hype: boolean; looks: { used: number; limit: number } }) => string; href?: string; place: string };

/* Редактирование профиля — там настраивается почти всё, что даёт подписка. */
const PROFILE_EDIT_HREF = "/profile?edit=1";
const EDIT = PROFILE_EDIT_HREF;

const PERKS: Perk[] = [
  { title: "Значок тарифа у ника и обводка профиля", need: "plus", detail: () => "пять цветов", href: `${EDIT}#plus-ring`, place: "настроить" },
  { title: "Радужная обводка, светится ярче", need: "hype", detail: () => "только HYPE", href: `${EDIT}#plus-ring`, place: "настроить" },
  { title: "Темы карточки игрока", need: "plus", detail: () => "семь тем", href: `${EDIT}#plus-theme`, place: "настроить" },
  { title: "Своя пиксельная шапка", need: "plus", detail: () => "одна картинка", href: `${EDIT}#community-profile`, place: "настроить" },
  { title: "Анимированная шапка", need: "hype", detail: () => `до ${MAX_HEADER_FRAMES_HYPE} кадров`, href: `${EDIT}#community-profile`, place: "настроить" },
  /* Гардероб скинов — в лаунчере (с HYPE пять скинов человека и пять пони). */
  { title: "Гардероб в лаунчере", need: "hype", detail: () => "пять скинов человека и пять скинов пони", place: "в игре" },
  { title: "Скин пони", need: "hype", detail: () => "в игре и на сайте", href: "/models", place: "редактор моделей" },
  { title: "Префикс, цвет ника и флаг в чате", need: "hype", detail: () => "цвет ника — один или градиент", place: "в игре" },
  { title: "Свои строки в списке серверов", need: "hype", detail: () => "две строки, равные шансы для всех с HYPE", place: "в игре" },
  { title: "Своё сообщение о смерти", need: "hype", detail: () => "срабатывает в 10% смертей", place: "в игре" },
  { title: "Размер персонажа", need: "hype", detail: () => "от 25% до 300%", place: "в игре" },
  { title: "Загрузка готового скина файлом", need: "free", detail: ({ hype }) => (hype ? "сколько угодно раз, в гардеробе пять человека и пять пони" : "сколько угодно раз, в гардеробе лаунчера — один скин"), href: `${EDIT}#plus-skin`, place: "настроить" },
  { title: "Свои пластинки", need: "free", detail: ({ hype }) => (hype ? "одна каждый день" : "одна в неделю, с HYPE — каждый день"), place: "в игре" },
  { title: "Стикеры в ленте и Wiki", need: "plus", detail: () => "под постами и статьями", href: "/feed", place: "лента" },
  { title: "Закреплённый пост в профиле", need: "hype", detail: () => "свой пост на карточке", href: `${EDIT}#plus-pinned`, place: "настроить" },
  { title: "Новые функции раньше всех", need: "hype", detail: () => "ранний доступ", href: "#plus-early", place: "ниже" },
];

/* Части раздела: status — плашка статуса, preview — «так вас видят другие»,
   perks — что даёт подписка, ring/theme/pinned — оформление, tenure — стаж,
   early — ранний доступ. */
export type StudioPart = "status" | "preview" | "perks" | "ring" | "theme" | "pinned" | "tenure" | "early";
const ALL_PARTS: StudioPart[] = ["status", "preview", "perks", "ring", "theme", "pinned", "tenure", "early"];

const perkOpen = (need: Need, active: boolean, hype: boolean) => need === "free" || (need === "plus" && active) || (need === "hype" && hype);

type Studio = {
  plus: { active: boolean; until: string | null; hypeUntil: string | null; tier: PlusTier; hype: boolean };
  tenure: number;
  ring: PlusRing;
  theme: PlusTheme;
  pinnedPost: { id: number; title: string } | null;
  ownPosts?: Array<{ id: number; title: string }> | null;
  animatedHeader: boolean;
  looks: { used: number; limit: number };
  early: Array<{ key: string; title: string; description: string; audience: string; open: boolean }>;
};

const date = new Intl.DateTimeFormat("ru-RU", { dateStyle: "long" });
const until = (value: string | null) => (value && Number.isFinite(Date.parse(value)) ? date.format(new Date(value)) : "—");
const monthsWord = (months: number) => {
  const tail = months % 100 >= 11 && months % 100 <= 14 ? 0 : months % 10;
  return tail === 1 ? "месяц" : tail >= 2 && tail <= 4 ? "месяца" : "месяцев";
};

/* Обводка и тема для живой карточки студии редактирования. */
export type PlusLookPreview = { active: boolean; hype: boolean; ring: PlusRing; theme: PlusTheme };

export function PlusStudio({ login, preview, integrated = false, parts = ALL_PARTS, onPreview }: { login: string; preview?: PlusPreviewProfile; integrated?: boolean; parts?: StudioPart[]; onPreview?: (look: PlusLookPreview) => void }) {
  const show = (part: StudioPart) => parts.includes(part);
  const [studio, setStudio] = useState<Studio | null>(null);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [selectedPost, setSelectedPost] = useState("");

  async function pinPost() {
    if (!selectedPost || busy) return;
    setBusy("pin"); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/feed/posts/${selectedPost}/pin`, { method: "PUT" });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error ?? "Не удалось закрепить пост.");
      setMessage(result?.pinned ? "Пост закреплён в профиле." : "Пост откреплён.");
      setSelectedPost("");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось закрепить пост.");
    } finally { setBusy(""); }
  }

  async function load() {
    try {
      const response = await fetch("/api/profile/plus", { cache: "no-store" });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error ?? "Не удалось загрузить оформление.");
      setStudio(result as Studio);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось загрузить оформление.");
    }
  }

  useEffect(() => { void load(); }, []);

  /* Живая карточка студии: обводка и тема после загрузки и каждого сохранения. */
  useEffect(() => {
    if (studio) onPreview?.({ active: studio.plus.active, hype: studio.plus.active && studio.plus.hype, ring: studio.ring, theme: studio.theme });
  }, [studio, onPreview]);

  async function save(patch: Record<string, unknown>, done: string, key: string) {
    setBusy(key);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/profile/plus", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error ?? "Не удалось сохранить.");
      setMessage(done);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось сохранить.");
    } finally {
      setBusy("");
    }
  }

  if (!studio) return error ? <p className="form-message error-message">{error}</p> : <p>Загружаем…</p>;
  const active = studio.plus.active;
  const hype = active && studio.plus.hype;
  const tierName = hype ? "POPPERS HYPE" : "POPPERS+";
  const badge = tenureTier(studio.tenure);
  const next = nextTenureTier(studio.tenure);
  /* HYPE закончится раньше подписки — дальше до конца идёт PLUS. */
  const plusAfterHype = hype && studio.plus.hypeUntil && studio.plus.until && Date.parse(studio.plus.hypeUntil) < Date.parse(studio.plus.until);

  return (
    <div className="plus-studio">
      {show("status") ? <article className={joinStatus(active, hype)}>
        <div>
          <small>{active ? tierName : "ПОДПИСКА"}</small>
          <strong>{!active
            ? "Сейчас не активна"
            : hype
              ? `HYPE до ${until(studio.plus.hypeUntil)}`
              : `Активна до ${until(studio.plus.until)}`}</strong>
          <span>{!active
            ? "Оформление сохранится и включится, как только подписка снова заработает."
            : plusAfterHype
              ? `Дальше до ${until(studio.plus.until)} — PLUS. Оформление ниже видно всем игрокам сайта.`
              : "Оформление ниже видно всем игрокам сайта."}</span>
        </div>
        {active
          ? <Link className="plus-studio-link" href={`/players/${login}`}>МОЯ КАРТОЧКА →</Link>
          : <Link className="plus-studio-link" href="/donation">ОФОРМИТЬ ПОДПИСКУ →</Link>}
      </article> : null}

      {show("preview") || show("perks") ? <div className={preview && show("preview") && show("perks") ? "plus-studio-overview" : "plus-studio-overview is-single"}>
        {preview && show("preview") ? (
          <PlusPreview profile={preview} active={active} tier={hype ? "hype" : "plus"} ring={studio.ring} theme={studio.theme} tenureLabel={badge?.label ?? null} />
        ) : null}
        {show("perks") ? <article className="plus-studio-card plus-perk-card">
          <small>ЧТО ВАМ ДОСТУПНО</small>
          <ul className="plus-perk-list">
            {PERKS.map((perk) => {
              const open = perkOpen(perk.need, active, hype);
              /* В самом редакторе профиля ссылки ведут к разделам на этой же странице. */
              const localHref = integrated && perk.href?.startsWith(`${EDIT}#`) ? perk.href.slice(EDIT.length) : undefined;
              return (
                <li className={open ? "is-open" : "is-locked"} key={perk.title}>
                  <span className="plus-perk-mark" aria-hidden="true">{open ? "✓" : "🔒"}</span>
                  <span className="plus-perk-text">
                    <b>{perk.title}</b>
                    <small>{open ? perk.detail({ active, hype, looks: studio.looks }) : perk.need === "hype" ? "в тарифе POPPERS HYPE" : "с подпиской POPPERS+"}</small>
                  </span>
                  {open && perk.href
                    ? <Link className="plus-perk-link" href={localHref ?? perk.href}>{localHref ? "ниже" : perk.place} →</Link>
                    : open
                      ? <span className="plus-perk-link is-static">{perk.place}</span>
                      : <Link className="plus-perk-link is-upsell" href={perk.need === "hype" ? "/donation?plan=hype" : "/donation?plan=plus"}>{perk.need === "hype" ? "HYPE →" : "PLUS →"}</Link>}
                </li>
              );
            })}
          </ul>
        </article> : null}
      </div> : null}


      {show("ring") ? <article className="plus-studio-card" id="plus-ring">
        <small>ОБВОДКА ПРОФИЛЯ</small>
        <p className="plus-studio-note">Цвет рамки вокруг карточки в поиске игроков, ленте, Wiki и отзывах. Радужная — только в HYPE.</p>
        <div className="plus-swatches" role="group" aria-label="Цвет обводки">
          {PLUS_RINGS.map((option) => {
            const hypeOnly = option.id === "rainbow";
            return (
              <button
                className={`plus-swatch ring-${option.id}${studio.ring === option.id ? " active" : ""}`}
                type="button"
                key={option.id}
                disabled={Boolean(busy) || !active || (hypeOnly && !hype)}
                aria-pressed={studio.ring === option.id}
                title={hypeOnly && !hype ? "Радужная обводка — в тарифе HYPE" : undefined}
                onClick={() => { onPreview?.({ active, hype, ring: option.id, theme: studio.theme }); void save({ ring: option.id }, `Обводка: ${option.label.toLowerCase()}.`, `ring-${option.id}`); }}
              >
                <i aria-hidden="true" />
                {option.label}{hypeOnly && !hype ? " · HYPE" : ""}
              </button>
            );
          })}
        </div>
        {studio.ring === "rainbow" && active && !hype ? <p className="plus-studio-note">Радужная обводка сохранена и вернётся с HYPE, а пока карточку обводит розовая.</p> : null}
      </article> : null}

      {show("theme") ? <article className="plus-studio-card" id="plus-theme">
        <small>ТЕМА КАРТОЧКИ</small>
        <p className="plus-studio-note">Фон карточки игрока — его видят все, кто открывает ваш профиль.</p>
        {/* Каждая тема — маленькая карточка в своих цветах (2026-10-03: владелец
            попросил сделать выбор оформления нагляднее). */}
        <div className="plus-theme-tiles" role="group" aria-label="Тема карточки">
          {PLUS_THEMES.map((option) => (
            <button
              className={`plus-theme-tile theme-${option.id}${studio.theme === option.id ? " active" : ""}`}
              type="button"
              key={option.id}
              disabled={Boolean(busy) || !active}
              aria-pressed={studio.theme === option.id}
              onClick={() => { onPreview?.({ active, hype, ring: studio.ring, theme: option.id }); void save({ theme: option.id }, `Тема карточки: ${option.label.toLowerCase()}.`, `theme-${option.id}`); }}
            >
              <span className="plus-theme-preview" aria-hidden="true">
                <i className="plus-theme-head" />
                <i className="plus-theme-face" />
                <i className="plus-theme-line" />
                <i className="plus-theme-line is-short" />
              </span>
              <b>{option.label}</b>
              {studio.theme === option.id ? <em>✓ ВЫБРАНА</em> : null}
            </button>
          ))}
        </div>
      </article> : null}

      {show("pinned") ? <article className="plus-studio-card" id="plus-pinned">
        <small>ЗАКРЕПЛЁННЫЙ ПОСТ · HYPE</small>
        {studio.pinnedPost ? (
          <>
            <p><b>{studio.pinnedPost.title}</b></p>
            {!hype ? <p className="plus-studio-note">Пост сохранён, но на карточке он появится только с HYPE.</p> : null}
            <div className="profile-actions">
              <button type="button" disabled={Boolean(busy)} onClick={() => void save({ unpin: true }, "Пост откреплён.", "unpin")}>
                {busy === "unpin" ? "ОТКРЕПЛЯЕМ…" : "ОТКРЕПИТЬ"}
              </button>
            </div>
          </>
        ) : hype && integrated
          ? <p className="plus-studio-note">Ничего не закреплено.</p>
          : hype
          ? <p className="plus-studio-note">Ничего не закреплено. Закрепить свой пост можно в <Link href="/feed">ленте</Link> — кнопка «Закрепить в профиле» под постом.</p>
          : <p className="plus-studio-note">Свой пост из ленты на карточке игрока — возможность <Link href="/donation?plan=hype">POPPERS HYPE</Link>.</p>}
        {integrated && hype ? <div className="plus-pin-picker">
          {studio.ownPosts == null ? <p>Не удалось загрузить ваши посты.</p> : studio.ownPosts.length ? <>
            <label htmlFor="plus-post">ВАШИ ПОСЛЕДНИЕ ПОСТЫ</label>
            <select id="plus-post" value={selectedPost} onChange={event => setSelectedPost(event.target.value)} disabled={Boolean(busy)}>
              <option value="">Выберите пост</option>
              {studio.ownPosts.filter(post => post.id !== studio.pinnedPost?.id).map(post => <option key={post.id} value={post.id} translate="no">{post.title}</option>)}
            </select>
            <div className="profile-actions"><button type="button" disabled={!selectedPost || Boolean(busy)} onClick={() => void pinPost()}>{busy === "pin" ? "СОХРАНЯЕМ…" : "ЗАКРЕПИТЬ В ПРОФИЛЕ"}</button></div>
          </> : <p>У вас пока нет постов. Создайте первый в <Link href="/feed">ленте</Link>.</p>}
        </div> : null}
      </article> : null}

      {show("tenure") ? <article className="plus-studio-card">
        <small>СТАЖ</small>
        {badge ? (
          <p className="plus-tenure"><MinecraftIcon name={badge.icon} size="sm" /><b>{badge.label}</b></p>
        ) : <p>Пока нет месяцев с подпиской.</p>}
        <p className="plus-studio-note">
          Всего с подпиской: {studio.tenure} {monthsWord(studio.tenure)}.
          {next ? ` До значка «${next.label}» — ещё ${next.months - studio.tenure} ${monthsWord(next.months - studio.tenure)}.` : " Это максимальный значок — спасибо!"}
        </p>
      </article> : null}

      {show("tenure") && !hype && studio.animatedHeader ? <p className="plus-studio-note">Кадры анимированной шапки сохранены и вернутся вместе с HYPE.</p> : null}
      {show("tenure") ? <p className="plus-studio-note">Подписку можно подарить другу — кнопка «Подарить подписку» на его карточке игрока.</p> : null}

      {show("early") ? <article className="plus-studio-card" id="plus-early">
        <small>РАННИЙ ДОСТУП · HYPE</small>
        <p className="plus-studio-note">Новые функции сайта сначала открываются подписчикам HYPE.</p>
        <ul className="plus-studio-list">
          {studio.early.map((feature) => (
            <li key={feature.key}>
              <b>{feature.title}</b> — {feature.description}{" "}
              <span className={feature.open ? "plus-early-open" : "plus-early-soon"}>{feature.open ? "уже доступно" : feature.audience === "plus" ? "для подписчиков HYPE" : "скоро"}</span>
            </li>
          ))}
        </ul>
      </article> : null}

      {message ? <p className="form-message success-message">{message}</p> : null}
      {error ? <p className="form-message error-message">{error}</p> : null}
      {!active && (show("ring") || show("theme")) ? <p className="plus-studio-note">Выбирать оформление можно с активной подпиской. <Link href="/donation">Оформить подписку →</Link></p> : null}
      {active && !hype && (show("ring") || show("perks")) ? <p className="plus-studio-note">Хотите радужную обводку, пони и живую шапку? <Link href="/donation?plan=hype">Перейти на HYPE →</Link> Оставшиеся дни PLUS не пропадут.</p> : null}
    </div>
  );
}

function joinStatus(active: boolean, hype: boolean) {
  return ["plus-studio-status", active ? "is-active" : "", hype ? "is-hype" : ""].filter(Boolean).join(" ");
}
