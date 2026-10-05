"use client";
import { useState } from "react";
import type { SkinSlot, SkinWardrobe } from "@/lib/character-models";

export function SkinCarousel({ kind, wardrobe, equipped, selectedId, busy, dirty, onChoose, onApply, onDelete, onUpload, onDiscard }: {
  kind: "human" | "pony"; equipped: boolean; wardrobe?: SkinWardrobe; selectedId: string | null; busy: boolean; dirty: boolean;
  onChoose: (id: string | null) => void; onApply: () => void; onDelete: () => void; onUpload: () => void; onDiscard: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const limit = wardrobe?.limit === 5 ? 5 : 1;
  const slots = wardrobe?.[kind] ?? [], current = slots.findIndex(slot => slot.id === selectedId);
  const index = current >= 0 ? current : Math.min(slots.length, limit - 1);
  const activeId = equipped ? (kind === "human" ? wardrobe?.activeHumanId : wardrobe?.activePonyId) : null;
  const selected = slots.find(slot => slot.id === selectedId);
  const choose = (slot?: SkinSlot) => { setConfirmDelete(false); onChoose(slot?.id ?? null); };
  function step(direction: number) { const count = Math.min(limit, slots.length + 1); choose(slots[(index + direction + count) % count]); }
  if (kind === "pony" && wardrobe && limit === 1) return <section className="skin-wardrobe"><h2>POPPERS HYPE</h2><p>Скин пони доступен только с активной подпиской POPPERS HYPE.</p><a href="/donation?plan=hype">Оформить подписку →</a></section>;
  return <section className="skin-wardrobe" aria-label="Сохранённые скины" aria-roledescription="Карусель">
    <div className="skin-wardrobe-heading"><h2>Мои скины</h2><p>{limit === 1 ? "Один скин человека. Пять скинов — с POPPERS HYPE." : kind === "human" ? "До пяти скинов человека" : "До пяти скинов пони"}</p><span>{slots.length} / {limit}</span></div>
    <div className="skin-carousel">
      <button className="skin-carousel-arrow" aria-label="Предыдущий скин" disabled={busy || !wardrobe || slots.length === 0 || limit === 1} onClick={() => step(-1)}>←</button>
      <div className="skin-carousel-slots" role="group" aria-label="Слоты скинов">
        {Array.from({length: limit}, (_, i) => { const slot = slots[i], chosen = slot ? slot.id === selectedId : !selectedId && i === slots.length;
          return <button className="skin-carousel-slot" key={slot?.id ?? i} aria-pressed={chosen} aria-label={slot ? `Скин ${i + 1}` : `Добавить скин ${i + 1}`} disabled={busy || !wardrobe || (!slot && i > slots.length)} onClick={() => choose(slot)}>
            {slot ? <><img src={slot.skinUrl} alt="" width="64" height="64" /><span>{i + 1}</span>{slot.id === activeId ? <small>Надет</small> : null}</> : <><b aria-hidden="true">+</b><small>Добавить</small></>}
          </button>;
        })}
      </div>
      <button className="skin-carousel-arrow" aria-label="Следующий скин" disabled={busy || !wardrobe || slots.length === 0 || limit === 1} onClick={() => step(1)}>→</button>
    </div>
    <div className="skin-wardrobe-actions">
      {selected ? <><button disabled={busy || dirty || selected.id === activeId} onClick={onApply}>{selected.id === activeId ? "Скин надет" : "Надеть скин"}</button><button disabled={busy} onClick={onUpload}>Заменить PNG</button><button disabled={busy} onClick={() => setConfirmDelete(true)}>Удалить скин</button></> : <button disabled={busy || !wardrobe || slots.length >= limit} onClick={onUpload}>+ Добавить PNG</button>}
      {dirty ? <button disabled={busy} onClick={onDiscard}>Сбросить изменения</button> : null}
      <p>{selected ? "Листайте скины стрелками. Нажмите «Надеть скин», чтобы сменить его в игре." : slots.length >= limit ? limit === 1 ? "Вы можете заменить текущий скин. Дополнительные места доступны с POPPERS HYPE." : "Все пять мест заняты. Выберите скин для замены или удалите ненужный." : "Загрузите PNG или нарисуйте скин и сохраните его в свободное место."}</p>
    </div>
    {confirmDelete && selected ? <div className="skin-delete-confirm" role="alert"><span>Удалить этот скин из аккаунта?</span><button disabled={busy} onClick={() => { setConfirmDelete(false); onDelete(); }}>Да, удалить</button><button disabled={busy} onClick={() => setConfirmDelete(false)}>Отмена</button></div> : null}
  </section>;
}
