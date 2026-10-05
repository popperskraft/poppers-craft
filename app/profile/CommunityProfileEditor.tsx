"use client";

import { FormEvent, useEffect, useReducer, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { CommunityProfile } from "@/lib/community";
import { HEADER_FLAG_OPTIONS, HEADER_PRESET_GROUPS, headerModeOf, normalizeHeaderFlag, type HeaderFlag, type HeaderMode } from "@/lib/header-flags";
import { emptyPixelHeaderArt, parsePixelHeaderArt, type PixelHeaderArt } from "@/lib/profile-header-art";
import { DEFAULT_FRAME_MS, DEFAULT_RING, headerFramesFor, joinClasses, plusClass, type PlusTier } from "@/lib/plus-style";
import { SOCIAL_LINK_FIELDS, collectSocialLinks, parseSocialLinks, socialLinksError, socialProfileUrl } from "@/lib/social-links";
import { SocialPixelIcon } from "@/app/SocialPixelIcon";
import { ProfileHeaderArt } from "@/app/ProfileHeaderArt";
import { MinecraftIcon } from "@/app/MinecraftIcon";
import { PixelHeaderEditor } from "./PixelHeaderEditor";
import { canUndoHeader, createHeaderHistory, headerHistoryReducer } from "@/lib/profile-header-history";

/* Вид шапки (просьба владельца, 2026-10-04): кнопки «Кастомная», «Цвет» и
   «Пресет»; под ними — то, что нужно для выбранного вида. */
const HEADER_MODES: Array<[HeaderMode, string]> = [
  ["custom", "КАСТОМНАЯ"],
  ["color", "ЦВЕТ"],
  ["preset", "ПРЕСЕТ"],
];

/* Цвета сайта — для быстрого выбора однотонной шапки. */
const HEADER_QUICK_COLORS = ["#1d44de", "#29c9ff", "#b8ff1f", "#1d8036", "#ffc400", "#ff8a1f", "#ff6fae", "#a66bff", "#b72c26", "#171717", "#6b6b6b", "#f8f5e9"];

/* Что редактор сообщает живой карточке студии. */
export type ProfilePreviewPatch = Partial<{
  display_name: string;
  bio: string;
  favorite_music: string;
  favorite_movies: string;
  social_links: string;
  header_color: string;
  header_flag: string;
  header_art: PixelHeaderArt | null;
  headerFrames: PixelHeaderArt[];
  headerFrameMs: number;
}>;

export function CommunityProfileEditor({
  profile,
  hidePrideFlags,
  canEditLogin,
  plus = false,
  tier = "plus",
  headerFrames = [],
  headerFrameMs = DEFAULT_FRAME_MS,
  ring = DEFAULT_RING,
  initialAppearance = false,
  onPreview,
  hidePreview = false,
  onSaved,
}: {
  profile: CommunityProfile;
  hidePrideFlags: boolean;
  canEditLogin: boolean;
  plus?: boolean;
  /* Тариф: анимированная шапка (до восьми кадров) — только у HYPE. */
  tier?: PlusTier;
  headerFrames?: PixelHeaderArt[];
  headerFrameMs?: number;
  ring?: string;
  initialAppearance?: boolean;
  /* Студия редактирования (ProfileEditStudio): каждое изменение сразу уходит
     в живую карточку слева, ещё до сохранения. */
  onPreview?: (patch: ProfilePreviewPatch) => void;
  /* В студии своя большая карточка — маленькая шапка здесь не нужна. */
  hidePreview?: boolean;
  /* Студия: после сохранения карточка берёт данные с сервера целиком. */
  onSaved?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [headerFlag, setHeaderFlag] = useState<HeaderFlag>(normalizeHeaderFlag(profile.header_flag));
  /* Режим шапки (r099): свой рисунок, цвет или пресет из галереи. Флаг
     сохраняется как раньше: custom, none или id пресета. */
  const [headerMode, setHeaderMode] = useState<HeaderMode>(headerModeOf(profile.header_flag));
  const chooseMode = (mode: HeaderMode) => {
    setHeaderMode(mode);
    if (mode === "custom") setHeaderFlag("custom");
    if (mode === "color") setHeaderFlag("none");
  };
  /* Кадры анимированной шапки: первый — обычная шапка, остальные — HYPE. */
  const [headerHistory, dispatchHeader] = useReducer(headerHistoryReducer, null, () => createHeaderHistory({
    frames: [parsePixelHeaderArt(profile.header_art) ?? emptyPixelHeaderArt(), ...headerFrames],
    frameIndex: 0,
    frameMs: headerFrameMs,
  }));
  const { frames, frameIndex, frameMs } = headerHistory.present;
  const headerArt = frames[frameIndex] ?? frames[0];
  const setHeaderArt = (art: PixelHeaderArt) => dispatchHeader({ type: "paint", art });
  const [headerColor, setHeaderColor] = useState(profile.header_color);
  const router = useRouter();
  const socialLinks = parseSocialLinks(profile.social_links);
  /* Шапка в живую карточку студии — при каждом изменении цвета, флага и
     рисунка. Первый запуск пропускаем: карточка уже показывает сохранённое. */
  const previewMounted = useRef(false);
  useEffect(() => {
    if (!previewMounted.current) { previewMounted.current = true; return; }
    onPreview?.({ header_color: headerColor, header_flag: headerFlag, header_art: frames[0] ?? null, headerFrames: frames.slice(1), headerFrameMs: frameMs });
  }, [onPreview, headerColor, headerFlag, frames, frameMs]);
  /* Поля формы — при каждом вводе. */
  const previewFields = (form: HTMLFormElement) => {
    if (!onPreview) return;
    const data = Object.fromEntries(new FormData(form)) as Record<string, string>;
    onPreview({
      display_name: data.displayName ?? profile.display_name,
      bio: data.bio ?? profile.bio,
      favorite_music: data.favoriteMusic ?? profile.favorite_music,
      favorite_movies: data.favoriteMovies ?? profile.favorite_movies,
      social_links: collectSocialLinks(data),
    });
  };
  /* Кнопка на самой шапке раскрывает её настройки и прокручивает к ним —
     раньше их приходилось искать в третьем свёрнутом блоке формы. */
  const headerGroupRef = useRef<HTMLDetailsElement>(null);
  const openHeaderSettings = () => {
    const group = headerGroupRef.current;
    if (!group) return;
    group.open = true;
    group.scrollIntoView({ behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    group.querySelector<HTMLElement>("summary")?.focus({ preventScroll: true });
  };
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage("");
    const formData = new FormData(event.currentTarget);
    const data = { ...Object.fromEntries(formData), hidePrideFlags: formData.get("hidePrideFlags") === "on" };
    const error = socialLinksError(collectSocialLinks(data), profile.social_links);
    if (error) { setMessage(error); setBusy(false); event.currentTarget.querySelector<HTMLDetailsElement>(".profile-contacts-details")?.setAttribute("open", ""); return; }
    try {
      const response = await fetch("/api/profile/community", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
      const result = await response.json();
      setMessage(response.ok ? "Профиль сохранён." : result.error ?? "Не удалось сохранить профиль.");
      if (response.ok) { onSaved?.(); router.refresh(); }
    } catch { setMessage("Нет связи с сервером. Попробуйте ещё раз."); }
    finally { setBusy(false); }
  }
  return <section className="profile-password community-editor" id="community-profile">
    <p>PLAYER_CARD.EXE</p><h2>{initialAppearance ? "ШАПКА И ОФОРМЛЕНИЕ" : "ПРОФИЛЬ ИГРОКА"}</h2>
    {hidePreview ? null : <div className={joinClasses("community-cover-preview profile-flag", `flag-${headerFlag}`, plusClass(plus, ring, tier))} style={{ backgroundColor: headerColor }}><ProfileHeaderArt art={headerFlag === "custom" ? frames[0] : null} frames={headerFlag === "custom" ? frames.slice(1) : []} frameMs={frameMs} />{plus ? <i className="plus-ring" aria-hidden="true" /> : null}<b translate="no">{profile.display_name}</b><span translate="no">@{profile.login}</span><button className="cover-settings-button" type="button" onClick={openHeaderSettings}><MinecraftIcon name="crafting_table" size="sm" /> НАСТРОИТЬ ШАПКУ</button></div>}
    <p className="immutable-login-note">{canEditLogin ? "Для защищённого владельца ник можно изменить вместе с данными входа." : `Игровой ник @${profile.login} привязан к лаунчеру и не изменяется.`}</p>
    <form className="profile-password-form" onSubmit={submit} onInput={(event) => previewFields(event.currentTarget)} onInvalidCapture={event => { (event.target as HTMLElement).closest("details")?.setAttribute("open", ""); }}>
      <details className="profile-edit-group" open={!initialAppearance}><summary>О СЕБЕ</summary><div className="profile-edit-fields">
      {canEditLogin ? <label>ИГРОВОЙ НИК<input name="login" defaultValue={profile.login} minLength={3} maxLength={24} pattern="[a-zA-Z0-9_.-]+" required /><small>Ник изменится в профиле, анкете и данных лаунчера.</small></label> : null}
      <label>ОТОБРАЖАЕМОЕ ИМЯ<input name="displayName" defaultValue={profile.display_name} minLength={2} maxLength={80} required /></label>
      <label>О СЕБЕ<textarea name="bio" defaultValue={profile.bio} maxLength={1200} rows={5} /></label>
      <label>ЛЮБИМАЯ МУЗЫКА<input name="favoriteMusic" defaultValue={profile.favorite_music} maxLength={500} /></label>
      <label>ЛЮБИМЫЕ ФИЛЬМЫ<input name="favoriteMovies" defaultValue={profile.favorite_movies} maxLength={500} /></label>
      </div></details>
      <details className="profile-edit-group profile-contacts-details"><summary>СОЦСЕТИ И КОНТАКТЫ</summary>
      <fieldset className="profile-social-editor">
        <legend>СОЦСЕТИ И КОНТАКТЫ</legend>
        <p>Введите ник или ссылку на профиль. В профиле будут видны только иконки — их видят все, кто открывает вашу карточку.</p>
        <p>Discord: укажите ссылку на профиль, приглашение или ID пользователя. По нику профиль не открывается.</p>
        <div className="profile-social-grid">
          {SOCIAL_LINK_FIELDS.map((field) => (
            <SocialContactField key={field.key} field={field} initial={socialLinks[field.key]} />
          ))}
          <label className="profile-social-other">
            <span className="social-field-label"><SocialPixelIcon name="other" />Другое</span>
            <textarea name="socialOther" defaultValue={socialLinks.other} maxLength={180} rows={3} placeholder="Сайт, Twitch, Steam или другая соцсеть — по одной на строку" />
          </label>
        </div>
      </fieldset>
      </details>
      <details className="profile-edit-group profile-header-settings" ref={headerGroupRef} open={initialAppearance}><summary>ШАПКА И ОФОРМЛЕНИЕ</summary><div className="profile-edit-fields">
      <input name="headerFlag" type="hidden" value={headerFlag} />
      <input name="headerColor" type="hidden" value={headerColor} />
      <input name="headerArt" type="hidden" value={JSON.stringify(frames[0])} />
      <input name="headerFrames" type="hidden" value={JSON.stringify(frames.slice(1))} />
      <input name="headerFrameMs" type="hidden" value={String(frameMs)} />
      <div className="header-mode-tabs" role="group" aria-label="Вид шапки">
        {HEADER_MODES.map(([mode, label]) => (
          <button type="button" key={mode} className={headerMode === mode ? "active" : ""} aria-pressed={headerMode === mode} onClick={() => chooseMode(mode)}>{label}</button>
        ))}
      </div>
      {headerMode === "color" ? (
        <div className="header-color-mode">
          <label>ЦВЕТ ШАПКИ<input type="color" value={headerColor} onChange={event => { setHeaderColor(event.target.value); setHeaderFlag("none"); }} /></label>
          <div className="header-color-chips" role="group" aria-label="Быстрый выбор цвета">
            {HEADER_QUICK_COLORS.map((color) => (
              <button type="button" key={color} className={headerColor.toLowerCase() === color ? "active" : ""} style={{ backgroundColor: color }} aria-label={`Цвет ${color}`} onClick={() => { setHeaderColor(color); setHeaderFlag("none"); }} />
            ))}
          </div>
        </div>
      ) : null}
      {headerMode === "preset" ? (
        <div className="header-preset-gallery">
          {HEADER_PRESET_GROUPS.map((group) => (
            <div className="header-preset-group" key={group.id}>
              <small>{group.label}</small>
              <div className="header-preset-grid" role="radiogroup" aria-label={`Пресеты шапки: ${group.label}`}>
                {HEADER_FLAG_OPTIONS.filter((option) => option.group === group.id).map((option) => (
                  <button type="button" role="radio" aria-checked={headerFlag === option.value} key={option.value} className={headerFlag === option.value ? "header-preset active" : "header-preset"} onClick={() => setHeaderFlag(option.value)}>
                    <span className="header-preset-swatch" aria-hidden="true"><span className={`profile-flag flag-${option.value}`} style={{ backgroundColor: headerColor }} /></span>
                    <span>{option.label}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {headerMode === "custom" ? <>
      <label className="header-custom-color">ЦВЕТ ПОД РИСУНКОМ<input type="color" value={headerColor} onChange={event => setHeaderColor(event.target.value)} /></label>
      <PixelHeaderEditor
        art={headerArt}
        onChange={setHeaderArt}
        canUndo={canUndoHeader(headerHistory)}
        canRedo={headerHistory.future.length > 0}
        onUndo={() => { dispatchHeader({ type: "undo" }); setHeaderFlag("custom"); }}
        onRedo={() => { dispatchHeader({ type: "redo" }); setHeaderFlag("custom"); }}
        onEditStart={() => dispatchHeader({ type: "begin" })}
        onEditEnd={() => dispatchHeader({ type: "end" })}
        onActivate={() => setHeaderFlag("custom")}
        animated={plus && tier === "hype"}
        maxFrames={headerFramesFor(tier)}
        frameCount={frames.length}
        frameIndex={frameIndex}
        frameMs={frameMs}
        onSelectFrame={(index) => dispatchHeader({ type: "select", index })}
        onFrameMs={(ms) => dispatchHeader({ type: "speed", ms })}
        onAddFrame={() => {
          if (frames.length >= headerFramesFor(tier)) return;
          dispatchHeader({ type: "add", maxFrames: headerFramesFor(tier) });
          setHeaderFlag("custom");
        }}
        onRemoveFrame={() => {
          if (frames.length < 2) return;
          dispatchHeader({ type: "remove" });
        }}
      />
      </> : null}
      <label className="profile-flag-filter"><span><input name="hidePrideFlags" type="checkbox" defaultChecked={hidePrideFlags} /> Я ГОМОФОБ</span><small>Не показывать ЛГБТК+ флаги. Вместо них будет обычный цвет.</small></label>
      </div></details>
      <div className="profile-save-bar">
      <button disabled={busy}>{busy ? "СОХРАНЯЮ..." : "СОХРАНИТЬ ПРОФИЛЬ"}</button>
      {message ? <p className="form-message" role="status">{message}</p> : null}
      </div>
    </form>
  </section>;
}

function SocialContactField({ field, initial }: { field: typeof SOCIAL_LINK_FIELDS[number]; initial: string }) {
  const [value, setValue] = useState(initial);
  const href = socialProfileUrl(field.key, value);
  return <div className="social-contact-field"><label>
    <span className="social-field-label"><SocialPixelIcon name={field.icon} />{field.label}</span>
    <input name={field.name} value={value} onChange={event => setValue(event.target.value)} maxLength={120} placeholder={field.placeholder} spellCheck={false} autoCapitalize="none" />
  </label>{href ? <a href={href} target="_blank" rel="noopener noreferrer">ПРОВЕРИТЬ ССЫЛКУ ↗</a> : value.trim() ? <small className="social-contact-warning">Нужна корректная ссылка или идентификатор профиля.</small> : null}</div>;
}
