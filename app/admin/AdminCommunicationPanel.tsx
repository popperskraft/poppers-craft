"use client";

import { useMemo, useState } from "react";
import type { BugReportRow, CommunicationOverview } from "@/lib/waitlist";

function formatMetric(value: number) {
  return new Intl.NumberFormat("ru-RU").format(value);
}

export function AdminCommunicationPanel({ initialCommunication }: { initialCommunication: CommunicationOverview }) {
  const [communication, setCommunication] = useState(initialCommunication);
  const [busyKey, setBusyKey] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const activityPercent = useMemo(() => communication.metrics.registered_accounts
    ? Math.min(100, Math.round(communication.metrics.active_last_30_days / communication.metrics.registered_accounts * 100))
    : 0, [communication]);
  const ratingPercent = Math.min(100, Math.round(communication.metrics.average_rating / 5 * 100));

  async function request(url: string, init?: RequestInit) {
    const response = await fetch(url, init);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "Действие не выполнено.");
    return result;
  }

  async function refresh() {
    setBusyKey("refresh"); setError(""); setMessage("");
    try {
      const result = await request("/api/admin/communication", { cache: "no-store" });
      setCommunication(result.communication as CommunicationOverview);
      setMessage("Данные обновлены.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось обновить данные.");
    } finally { setBusyKey(""); }
  }

  async function requestRating() {
    setBusyKey("rating"); setError(""); setMessage("");
    try {
      await request("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ triggerRatingPrompt: true }),
      });
      setMessage("Опрос включён. Пользователи увидят его после обновления страницы.");
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось включить опрос.");
    } finally { setBusyKey(""); }
  }

  async function updateBugStatus(id: number, status: BugReportRow["status"]) {
    setBusyKey(`bug-${id}`); setError(""); setMessage("");
    try {
      await request("/api/admin/bugs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
      });
      setCommunication((current) => {
        const reports = current.bug_reports.map((report) => report.id === id ? { ...report, status } : report);
        return { ...current, bug_reports: reports, metrics: { ...current.metrics, unresolved_bugs: reports.filter((report) => report.status !== "resolved").length } };
      });
      setMessage("Статус баг-репорта обновлён.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось обновить баг-репорт.");
    } finally { setBusyKey(""); }
  }

  const metrics = communication.metrics;
  return (
    <section className="admin-panel communication-dashboard">
      <div className="admin-panel-heading communication-heading">
        <div><small>COMMUNICATION_CENTER.EXE</small><h2>КОММУНИКАЦИЯ</h2></div>
        <button type="button" className="communication-refresh" disabled={busyKey === "refresh"} onClick={() => void refresh()}>
          {busyKey === "refresh" ? "ОБНОВЛЯЕМ…" : "↻ ОБНОВИТЬ"}
        </button>
      </div>
      {error ? <p className="form-message error-message">{error}</p> : null}
      {message ? <p className="form-message success-message">{message}</p> : null}
      <p className="communication-intro">Сообщения пользователей и живая статистика Supabase. Активными считаются аккаунты, входившие за последние 30 дней.</p>
      <div className="communication-metrics-grid" aria-label="Статистика платформы">
        <article className="communication-metric-card cyan"><small>ВСЕ АККАУНТЫ</small><strong>{formatMetric(metrics.registered_accounts)}</strong><span>зарегистрировано</span></article>
        <article className="communication-metric-card lime"><small>АКТИВНЫ ЗА 30 ДНЕЙ</small><strong>{formatMetric(metrics.active_last_30_days)}</strong><span>{activityPercent}% от всех аккаунтов</span><div className="communication-meter"><i style={{ width: `${activityPercent}%` }} /></div></article>
        <article className="communication-metric-card blue"><small>ИГРОКИ СЕРВЕРА</small><strong>{formatMetric(metrics.approved_players)}</strong><span>анкеты одобрены</span></article>
        <article className="communication-metric-card yellow"><small>ЖДУТ РЕШЕНИЯ</small><strong>{formatMetric(metrics.pending_applications)}</strong><span>новые анкеты</span></article>
        <article className="communication-metric-card pink"><small>ПОСТЫ В ЛЕНТЕ</small><strong>{formatMetric(metrics.feed_posts)}</strong><span>публикаций</span></article>
        <article className="communication-metric-card white"><small>КОММЕНТАРИИ</small><strong>{formatMetric(metrics.feed_comments)}</strong><span>ответов под постами</span></article>
        <article className="communication-metric-card rating"><small>ОЦЕНКА ПЛАТФОРМЫ</small><strong>{metrics.rating_count ? metrics.average_rating.toFixed(1) : "—"}<em>/5</em></strong><span>{formatMetric(metrics.rating_count)} оценок</span><div className="communication-meter"><i style={{ width: `${ratingPercent}%` }} /></div></article>
        <article className={`communication-metric-card ${metrics.unresolved_bugs ? "danger" : "lime"}`}><small>БАГИ В РАБОТЕ</small><strong>{formatMetric(metrics.unresolved_bugs)}</strong><span>{metrics.unresolved_bugs ? "нужно проверить" : "всё разобрано"}</span></article>
      </div>
      <article className="communication-rating-trigger">
        <div><span className="application-status">ОПРОС ДЛЯ ВСЕХ</span><h3>ПОПРОСИТЬ ОЦЕНИТЬ САЙТ</h3><p>Пользователи увидят окно с пятью звёздами и комментарием. Ответы появятся ниже.</p></div>
        <button type="button" disabled={busyKey === "rating"} onClick={() => void requestRating()}>{busyKey === "rating" ? "ВКЛЮЧАЕМ…" : "ПОКАЗАТЬ ОПРОС"}</button>
      </article>
      <div className="communication-section communication-section-wide">
        <div className="communication-section-title"><div><small>BUG_REPORTS.LOG</small><h3>БАГ-РЕПОРТЫ</h3></div><span>{metrics.unresolved_bugs} АКТИВНЫХ</span></div>
        <div className="bug-report-list">
          {communication.bug_reports.length ? communication.bug_reports.map((report) => <article className="bug-report-card" key={report.id}>
            <div><small>#{report.id} · {new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short" }).format(new Date(report.created_at))}{report.reporter_email ? ` · ${report.reporter_email}` : " · БЕЗ EMAIL"}</small><h3>{report.page_url}</h3><p>{report.description}</p>{report.log_ids.length ? <div className="bug-report-log-links"><b>ЛОГИ ЗА 30 МИНУТ:</b>{report.log_ids.map((id) => <code key={id}>LOG-{String(id).padStart(6, "0")}</code>)}</div> : null}<small>{report.user_agent}</small></div>
            <select value={report.status} disabled={busyKey === `bug-${report.id}`} onChange={(event) => void updateBugStatus(report.id, event.target.value as BugReportRow["status"])}><option value="new">НОВЫЙ</option><option value="in_progress">В РАБОТЕ</option><option value="resolved">ИСПРАВЛЕН</option></select>
          </article>) : <p className="communication-empty">Баг-репортов пока нет.</p>}
        </div>
      </div>
      <div className="communication-columns">
        <section className="communication-section"><div className="communication-section-title"><div><small>RATINGS.JSON</small><h3>ОЦЕНКИ</h3></div><span>{communication.ratings.length}</span></div><div className="communication-card-list">
          {communication.ratings.length ? communication.ratings.map((rating) => <article className="communication-rating-card" key={rating.id}><div><b>{"★".repeat(rating.stars)}{"☆".repeat(5 - rating.stars)}</b><strong>{rating.stars}/5</strong></div><p>{rating.feedback || "Без комментария."}</p><small>{new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short" }).format(new Date(rating.created_at))}{rating.email ? ` · ${rating.email}` : " · АНОНИМНО"}{rating.page_url ? ` · ${rating.page_url}` : ""}</small></article>) : <p className="communication-empty">Оценок пока нет.</p>}
        </div></section>
        <section className="communication-section"><div className="communication-section-title"><div><small>SYSTEM_FEED.LOG</small><h3>УВЕДОМЛЕНИЯ</h3></div><span>{communication.notifications.length}</span></div><div className="communication-card-list">
          {communication.notifications.length ? communication.notifications.map((item) => <article className={`communication-notification-card ${item.kind}`} key={item.id}><div><strong>{item.title}</strong><span>{item.status}</span></div><p>{item.body}</p><small>{new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short" }).format(new Date(item.created_at))}</small></article>) : <p className="communication-empty">Системных сообщений пока нет.</p>}
        </div></section>
      </div>
      <div className="communication-section communication-section-wide"><div className="communication-section-title"><div><small>DONATION_WAITLIST.CSV</small><h3>ЖДУТ ЗАПУСКА ДОНАТА</h3></div><span>{communication.donation_interests.length}</span></div>
        {communication.donation_interests.length ? <div className="donation-interest-list">{communication.donation_interests.map((interest) => <article key={interest.id}><strong>{interest.email}</strong><span>{interest.account}</span><small>{interest.status === "member" ? "ИГРОК" : interest.status === "account" ? "АККАУНТ" : "ГОСТЬ"} · {new Intl.DateTimeFormat("ru-RU").format(new Date(interest.created_at))}</small></article>)}</div> : <p className="communication-empty">Пока никто не оставил почту.</p>}
      </div>
    </section>
  );
}
