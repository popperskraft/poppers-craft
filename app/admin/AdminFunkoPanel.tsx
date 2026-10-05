"use client";

import { useEffect, useState, type FormEvent } from "react";
import "./admin-funko.css";

type Figure = { figure: "step" | "platon" | "tomac"; number: number; title: string; rarityWeight: number; ownerLogin: string | null; awardedAt: string | null; deliveredAt: string | null };
type EventWin = { id: number; login: string; note: string | null; created_at: string; created_by: string | null };

const dt = new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short" });

/* «Управление → FANKOPOP»: у кого какая фигурка. Каждая существует в одном
   экземпляре; случайная выдача берёт свободную, Томас — самый редкий.
   В игре их выдаёт мод за задания (/api/game/funko), здесь — владелец вручную. */
export function AdminFunkoPanel({ owner }: { owner: boolean }) {
  const [figures, setFigures] = useState<Figure[] | null>(null);
  const [wins, setWins] = useState<EventWin[]>([]);
  const [winLogin, setWinLogin] = useState("");
  const [winNote, setWinNote] = useState("");
  const [login, setLogin] = useState("");
  const [figure, setFigure] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function load() {
    const response = await fetch("/api/admin/funko", { cache: "no-store" });
    const result = await response.json().catch(() => null);
    if (!response.ok) throw new Error(result?.error ?? "Не удалось загрузить фигурки.");
    setFigures(result.figures as Figure[]);
    setWins((result.wins ?? []) as EventWin[]);
  }

  useEffect(() => { load().catch((caught) => setError(caught instanceof Error ? caught.message : "Не удалось загрузить фигурки.")); }, []);

  async function change(body: Record<string, unknown>, done: string) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/admin/funko", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error ?? "Не удалось изменить фигурку.");
      setMessage(result?.figure ? `@${result.login} получил фигурку «${figures?.find((item) => item.figure === result.figure)?.title ?? result.figure}».` : done);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось изменить фигурку.");
    } finally {
      setBusy(false);
    }
  }

  function award(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!window.confirm(figure ? `Выдать @${login.replace(/^@/, "")} эту фигурку?` : `Выдать @${login.replace(/^@/, "")} случайную свободную фигурку?`)) return;
    void change({ action: "award", login, figure: figure || null }, "Фигурка выдана.");
  }

  const totalWeight = (figures ?? []).filter((item) => !item.ownerLogin).reduce((sum, item) => sum + item.rarityWeight, 0);
  return (
    <section className="admin-panel admin-funko">
      <div className="admin-panel-heading">
        <div><small>FANKOPOP.EXE</small><h2>FANKOPOP</h2></div>
      </div>
      <p className="admin-funko-note">Фигурки Степана, Платона и Томаса — каждая в одном экземпляре. Игрок видит их в профиле в разделе FANKOPOP; без фигурок раздела нет. В игре фигурку выдаёт мод за задания, здесь — владелец вручную.</p>
      {error ? <p className="form-message error-message">{error}</p> : null}
      {message ? <p className="form-message success-message">{message}</p> : null}
      {!figures ? <p className="communication-empty">Загружаем…</p> : (
        <ol className="admin-funko-list">
          {figures.map((item) => (
            <li key={item.figure}>
              <b>#{item.number}</b>
              <strong>{item.title}</strong>
              <span>{item.ownerLogin ? `у @${item.ownerLogin}${item.awardedAt ? ` с ${dt.format(new Date(item.awardedAt))}` : ""} · ${item.deliveredAt ? "предмет в игре выдан" : "ждёт /fankopop в игре"}` : `свободна · шанс ${totalWeight ? Math.round(item.rarityWeight / totalWeight * 100) : 0}%`}</span>
              {owner && item.ownerLogin && item.deliveredAt ? (
                <button type="button" disabled={busy} onClick={() => { if (window.confirm(`Выдать @${item.ownerLogin} предмет «${item.title}» заново? Он получит его командой /fankopop в игре.`)) void change({ action: "redeliver", figure: item.figure }, "Предмет можно забрать заново командой /fankopop."); }}>ВЫДАТЬ ПРЕДМЕТ ЗАНОВО</button>
              ) : null}
              {owner && item.ownerLogin ? (
                <button type="button" className="undo" disabled={busy} onClick={() => { if (window.confirm(`Забрать «${item.title}» у @${item.ownerLogin}? Фигурка снова станет свободной.`)) void change({ action: "revoke", figure: item.figure }, "Фигурка снова свободна."); }}>ЗАБРАТЬ</button>
              ) : null}
            </li>
          ))}
        </ol>
      )}
      {owner ? (
        <form className="admin-funko-form" onSubmit={award}>
          <label>НИК ИГРОКА<input value={login} onChange={(event) => setLogin(event.target.value)} placeholder="nickname" required /></label>
          <label>ФИГУРКА
            <select value={figure} onChange={(event) => setFigure(event.target.value)}>
              <option value="">Случайная из свободных</option>
              {(figures ?? []).filter((item) => !item.ownerLogin).map((item) => <option key={item.figure} value={item.figure}>{item.title}</option>)}
            </select>
          </label>
          <button type="submit" disabled={busy || !login.trim()}>{busy ? "ВЫДАЁМ…" : "ВЫДАТЬ ФИГУРКУ"}</button>
        </form>
      ) : <p className="admin-funko-note">Выдаёт и забирает фигурки только владелец.</p>}
      <h3 className="admin-funko-subtitle">ЗАДАНИЯ И ПОБЕДЫ В ИВЕНТАХ</h3>
      <p className="admin-funko-note">Задания FANKOPOP: заходить 180 дней подряд, наиграть 300 часов и выиграть официальный ивент. Серию и часы сайт считает сам, победу в ивенте отмечает владелец здесь. Когда всё выполнено, игрок пишет в игре /fankopop и забирает случайную свободную фигурку.</p>
      {owner ? (
        <form className="admin-funko-form" onSubmit={(event) => { event.preventDefault(); if (!window.confirm(`Засчитать @${winLogin.replace(/^@/, "")} победу в ивенте?`)) return; void change({ action: "event-win", login: winLogin, note: winNote }, "Победа в ивенте засчитана."); }}>
          <label>НИК ПОБЕДИТЕЛЯ<input value={winLogin} onChange={(event) => setWinLogin(event.target.value)} placeholder="nickname" required /></label>
          <label>ИВЕНТ<input value={winNote} onChange={(event) => setWinNote(event.target.value)} placeholder="Например: гонка на вагонетках" maxLength={200} /></label>
          <button type="submit" disabled={busy || !winLogin.trim()}>ЗАСЧИТАТЬ ПОБЕДУ</button>
        </form>
      ) : null}
      {wins.length ? (
        <ol className="admin-funko-list admin-funko-wins">
          {wins.map((win) => <li key={win.id}><strong>@{win.login}</strong><span>{win.note || "ивент"} · {dt.format(new Date(win.created_at))}{win.created_by ? ` · ${win.created_by}` : ""}</span></li>)}
        </ol>
      ) : <p className="admin-funko-note">Побед в ивентах пока нет.</p>}
    </section>
  );
}
