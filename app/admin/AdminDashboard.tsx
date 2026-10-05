"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BackButton } from "@/app/BackButton";
import type {
  AdminProfile,
  AdminVote,
  ApplicationRow,
  ModerationAction,
  ModerationProposalRow,
  CommunicationOverview,
  SiteSettings,
  SiteUpdateRow,
} from "@/lib/waitlist";
import { BlockBuilder } from "./BlockBuilder";
import { MinecraftSkinPreview } from "@/app/MinecraftSkinPreview";
import type { AgreementAcceptance } from "@/lib/user-agreement";
import { AdminCommunicationPanel } from "./AdminCommunicationPanel";
import { AdminPoppersPanel } from "./AdminPoppersPanel";
import { AdminPaymentsPanel } from "./AdminPaymentsPanel";
import { AdminLauncherPanel } from "./AdminLauncherPanel";
import { AdminCachePanel } from "./AdminCachePanel";
import type { LauncherRelease } from "@/lib/launcher-releases";
import type { SiteErrorLog } from "@/lib/error-logs";
import { AdminErrorLogsPanel } from "./AdminErrorLogsPanel";
import { AdminAgreementPanel } from "./AdminAgreementPanel";
import { UPDATE_FLAG_OPTIONS, UPDATE_SOLID_COLOR_OPTIONS } from "@/lib/update-styles";
import { UpdateBadge } from "@/app/UpdateBadge";

/* Время для поля datetime-local с секундами: 2026-09-15T18:00:00. */
function toLocalDateTimeInput(time: number) {
  const date = new Date(time);
  const two = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}T${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}`;
}

type Panel = "applications" | "users" | "updates" | "builder" | "launchers" | "communication" | "poppers" | "payments" | "agreement" | "logs" | "admins" | "settings";

const statusLabels = {
  pending: "НА РАССМОТРЕНИИ",
  approved: "ОДОБРЕН",
  rejected: "ОТКЛОНЁН",
} as const;

const panelLabels: Array<[Panel, string]> = [
  ["applications", "АНКЕТЫ"],
  ["users", "ПОЛЬЗОВАТЕЛИ"],
  ["updates", "ОБНОВЛЕНИЯ"],
  ["builder", "КОНСТРУКТОР"],
  ["launchers", "ЛАУНЧЕРЫ"],
  ["communication", "КОММУНИКАЦИЯ"],
  ["poppers", "ПОППЕРС"],
  ["payments", "ОПЛАТА"],
  ["agreement", "СОГЛАСИЯ"],
  ["logs", "ЛОГИ"],
  ["admins", "АДМИНЫ"],
  ["settings", "НАСТРОЙКИ"],
];

function decisionLabel(application: ApplicationRow) {
  if (application.is_deleted) return "УДАЛЁН";
  if (application.is_banned) return "ЗАБАНЕН";
  return statusLabels[application.status];
}

export function AdminDashboard({
  currentAdmin,
  currentUserId,
  initialApplications,
  initialAdmins,
  initialUpdates,
  initialCommunication,
  initialProposals,
  initialSettings,
  initialLauncherReleases,
  initialErrorLogs,
  initialErrorLogsAt,
  initialAgreementAcceptances,
}: {
  currentAdmin: AdminProfile;
  currentUserId: string;
  initialApplications: ApplicationRow[];
  initialAdmins: AdminProfile[];
  initialUpdates: SiteUpdateRow[];
  initialCommunication: CommunicationOverview;
  initialProposals: ModerationProposalRow[];
  initialSettings: SiteSettings;
  initialLauncherReleases: LauncherRelease[];
  initialErrorLogs: SiteErrorLog[];
  initialErrorLogsAt: string;
  initialAgreementAcceptances: AgreementAcceptance[];
}) {
  const [panel, setPanel] = useState<Panel>("applications");
  const [applications, setApplications] = useState(initialApplications);
  const [admins, setAdmins] = useState(initialAdmins);
  const [updates, setUpdates] = useState(initialUpdates);
  const [proposals, setProposals] = useState(initialProposals);
  const [settings, setSettings] = useState(initialSettings);
  const [maintenanceMinutes, setMaintenanceMinutes] = useState("60");
  /* Время открытия в поле datetime-local: местное время браузера, до секунд.
     Значение по умолчанию ставится после монтирования, чтобы сервер и
     браузер не нарисовали разное время. */
  const [openingInput, setOpeningInput] = useState("");
  useEffect(() => {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60_000);
    tomorrow.setMinutes(0, 0, 0);
    setOpeningInput(toLocalDateTimeInput(tomorrow.getTime()));
  }, []);
  const [reasons, setReasons] = useState<Record<number, string>>({});
  const [renameLogins, setRenameLogins] = useState<Record<number, string>>({});
  const [busyKey, setBusyKey] = useState("");
  const [confirmDeleteUpdateId, setConfirmDeleteUpdateId] = useState<number | null>(null);
  const [confirmDeleteAdminId, setConfirmDeleteAdminId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const activeMembers = useMemo(
    () =>
      applications.filter(
        (application) =>
          !application.is_deleted &&
          (application.status === "approved" || application.is_banned),
      ),
    [applications],
  );
  const currentApplication = applications.find((application) => application.user_id === currentUserId);
  const currentAccountNeedsRepair = !currentApplication || currentApplication.is_deleted || currentApplication.status !== "approved";
  const adminUserIds = useMemo(
    () => new Set(admins.filter((admin) => admin.active && admin.user_id).map((admin) => admin.user_id as string)),
    [admins],
  );

  const pendingCount = applications.filter(
    (application) => application.status === "pending",
  ).length;

  const request = async (
    url: string,
    init?: RequestInit,
  ): Promise<Record<string, unknown>> => {
    const response = await fetch(url, init);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "Действие не выполнено.");
    return result;
  };

  const refreshApplications = async () => {
    const result = await request("/api/admin/applications");
    setApplications(result.applications as ApplicationRow[]);
  };

  const refreshProposals = async () => {
    const result = await request("/api/admin/moderation");
    setProposals(result.proposals as ModerationProposalRow[]);
  };

  const voteApplication = async (
    id: number,
    vote: AdminVote | "clear",
  ) => {
    setBusyKey(`application-${id}`);
    setError("");
    setNotice("");
    try {
      const result = await request("/api/admin/applications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, vote }),
      });
      setApplications((current) =>
        current.map((application) =>
          application.id === id
            ? {
                ...application,
                status: result.status as ApplicationRow["status"],
                approvals: Number(result.approvals),
                rejections: Number(result.rejections),
                my_vote: (result.my_vote as AdminVote | null) ?? null,
              }
            : application,
        ),
      );
      setNotice("Голос сохранён. Для решения нужны два администратора.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Ошибка.");
    } finally {
      setBusyKey("");
    }
  };

  const approveImmediately = async (id: number) => {
    setBusyKey(`application-${id}`);
    setError("");
    try {
      const result = await request("/api/admin/applications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action: "force_approve" }),
      });
      setApplications((current) => current.map((item) => item.id === id ? { ...item, status: "approved", reviewed_at: new Date().toISOString() } : item));
      setNotice(result.needsPass
        ? "Игрок принят решением администратора. Играть он сможет после оплаты пропуска."
        : "Игрок принят сразу решением администратора.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Ошибка.");
    } finally {
      setBusyKey("");
    }
  };

  const createModeration = async (
    applicationId: number,
    action: ModerationAction,
  ) => {
    const reason = (reasons[applicationId] ?? "").trim();
    if (reason.length < 3) {
      setError("Сначала укажите причину бана или удаления.");
      return;
    }
    setBusyKey(`moderation-${applicationId}`);
    setError("");
    setNotice("");
    try {
      await request("/api/admin/moderation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applicationId, action, reason }),
      });
      await Promise.all([refreshApplications(), refreshProposals()]);
      setNotice("Голосование создано. Нужен голос второго администратора.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Ошибка.");
    } finally {
      setBusyKey("");
    }
  };

  const voteModeration = async (
    proposalId: number,
    vote: AdminVote | "clear",
  ) => {
    setBusyKey(`proposal-${proposalId}`);
    setError("");
    setNotice("");
    try {
      await request("/api/admin/moderation", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposalId, vote }),
      });
      await Promise.all([refreshApplications(), refreshProposals()]);
      setNotice("Решение пересчитано.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Ошибка.");
    } finally {
      setBusyKey("");
    }
  };

  const submitUpdate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusyKey("new-update");
    setError("");
    setNotice("");
    const form = event.currentTarget;
    const formData = new FormData(form);
    try {
      const result = await request("/api/admin/updates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.fromEntries(formData)),
      });
      setUpdates((current) => [result.update as SiteUpdateRow, ...current]);
      form.reset();
      setNotice("Обновление опубликовано на главной странице.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Ошибка.");
    } finally {
      setBusyKey("");
    }
  };

  const deleteUpdate = async (id: number) => {
    setBusyKey(`update-${id}`);
    setError("");
    try {
      await request("/api/admin/updates", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      setUpdates((current) => current.filter((update) => update.id !== id));
      setConfirmDeleteUpdateId(null);
      setNotice("Обновление удалено.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Ошибка.");
    } finally {
      setBusyKey("");
    }
  };

  const submitAdmin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusyKey("new-admin");
    setError("");
    setNotice("");
    const form = event.currentTarget;
    const formData = new FormData(form);
    try {
      const result = await request("/api/admin/admins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.fromEntries(formData)),
      });
      const added = result.admin as AdminProfile;
      setAdmins((current) => [
        ...current.filter((admin) => admin.id !== added.id),
        added,
      ]);
      form.reset();
      setNotice("Администратор добавлен. Передайте ему почту и временный пароль.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Ошибка.");
    } finally {
      setBusyKey("");
    }
  };

  const submitPlayer = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusyKey("new-player");
    setError("");
    const form = event.currentTarget;
    const result = await request("/api/admin/players", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(new FormData(form))),
    }).catch((caught) => {
      setError(caught instanceof Error ? caught.message : "Ошибка.");
      return null;
    });
    if (result) {
      form.reset();
      await refreshApplications();
      setNotice("Игрок создан и уже имеет доступ к серверу.");
    }
    setBusyKey("");
  };

  const renamePlayer = async (applicationId: number, currentLogin: string) => {
    const login = (renameLogins[applicationId] ?? currentLogin).trim();
    setBusyKey(`rename-${applicationId}`);
    setError("");
    try {
      await request("/api/admin/players", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applicationId, login }),
      });
      await refreshApplications();
      setNotice(`Ник изменён на @${login}. Посты и подписки сохранены.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось изменить ник.");
    } finally {
      setBusyKey("");
    }
  };

  const restoreOwnPlayer = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const login = String(new FormData(form).get("login") ?? "").trim();
    setBusyKey("restore-self");
    setError("");
    setNotice("");
    try {
      await request("/api/admin/players", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ login, restoreSelf: true }),
      });
      await refreshApplications();
      setNotice(`Ваш игровой аккаунт восстановлен. Новый ник: @${login}.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось восстановить аккаунт.");
    } finally {
      setBusyKey("");
    }
  };

  /* Скрыть игрока из общего списка игроков (например, тестовый аккаунт)
     или вернуть. Карточка по прямой ссылке остаётся. */
  const togglePlayerHidden = async (application: ApplicationRow) => {
    const hidden = !application.hidden_from_directory;
    setBusyKey(`hide-player-${application.id}`);
    setError("");
    setNotice("");
    try {
      await request("/api/admin/players", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applicationId: application.id, hidden }),
      });
      setApplications((current) => current.map((item) => (item.id === application.id ? { ...item, hidden_from_directory: hidden } : item)));
      setNotice(hidden ? `@${application.login} скрыт из списка игроков.` : `@${application.login} снова в списке игроков.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось изменить видимость игрока.");
    } finally {
      setBusyKey("");
    }
  };

  const deletePlayerImmediately = async (application: ApplicationRow) => {
    if (!window.confirm(`Удалить игрока @${application.login}? Он сразу потеряет доступ, а его профиль и публикации будут удалены.`)) return;
    setBusyKey(`delete-player-${application.id}`);
    setError("");
    setNotice("");
    try {
      await request("/api/admin/players", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applicationId: application.id }),
      });
      setApplications((current) => current.filter((item) => item.id !== application.id));
      setProposals((current) => current.filter((proposal) => proposal.application_id !== application.id));
      setNotice(`Игрок @${application.login} удалён.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось удалить игрока.");
    } finally {
      setBusyKey("");
    }
  };

  const toggleAdmin = async (admin: AdminProfile) => {
    setBusyKey(`admin-${admin.id}`);
    setError("");
    try {
      await request("/api/admin/admins", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: admin.id, active: !admin.active }),
      });
      setAdmins((current) =>
        current.map((item) =>
          item.id === admin.id ? { ...item, active: !item.active } : item,
        ),
      );
      setNotice(admin.active ? "Доступ администратора отключён." : "Доступ администратора включён.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Ошибка.");
    } finally {
      setBusyKey("");
    }
  };

  const promotePlayerToAdmin = async (application: ApplicationRow) => {
    setBusyKey(`promote-admin-${application.id}`);
    setError("");
    setNotice("");
    try {
      const result = await request("/api/admin/admins", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applicationId: application.id }),
      });
      const promoted = result.admin as AdminProfile;
      setAdmins((current) => [
        ...current.filter((admin) => admin.id !== promoted.id && admin.user_id !== promoted.user_id),
        promoted,
      ]);
      setNotice(`@${application.login} теперь администратор и имеет доступ к управлению.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось назначить администратора.");
    } finally {
      setBusyKey("");
    }
  };

  const deleteAdmin = async (admin: AdminProfile) => {
    setBusyKey(`delete-admin-${admin.id}`);
    setError("");
    setNotice("");
    try {
      await request("/api/admin/admins", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: admin.id }),
      });
      setAdmins((current) => current.filter((item) => item.id !== admin.id));
      setConfirmDeleteAdminId(null);
      setNotice(`${admin.display_name} удалён из списка администраторов. Игровой аккаунт сохранён.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось удалить администратора.");
    } finally {
      setBusyKey("");
    }
  };

  const toggleMaintenance = async () => {
    setBusyKey("maintenance");
    setError("");
    setNotice("");
    try {
      const result = await request("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          maintenanceMode: !settings.maintenanceMode,
          endsAt:
            !settings.maintenanceMode && maintenanceMinutes !== "none"
              ? new Date(Date.now() + Number(maintenanceMinutes) * 60_000).toISOString()
              : null,
        }),
      });
      setSettings(result.settings as SiteSettings);
      setNotice(
        settings.maintenanceMode
          ? "Технический режим выключен. Сайт снова открыт."
          : "Технический режим включён. Сайт виден только владельцу.",
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Ошибка.");
    } finally {
      setBusyKey("");
    }
  };

  const saveOpening = async (opensAt: string | null) => {
    setBusyKey("opening");
    setError("");
    setNotice("");
    try {
      const result = await request("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ openingAt: opensAt }),
      });
      setSettings(result.settings as SiteSettings);
      setNotice(
        opensAt
          ? "Отсчёт запущен. Посетители видят окно открытия, администраторы — сайт как обычно."
          : "Отсчёт остановлен. Сайт открыт для всех.",
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Ошибка.");
    } finally {
      setBusyKey("");
    }
  };

  const startOpening = (time: number) => {
    if (!Number.isFinite(time)) {
      setError("Укажите дату и время открытия.");
      return;
    }
    const label = new Intl.DateTimeFormat("ru-RU", { dateStyle: "long", timeStyle: "medium" }).format(new Date(time));
    if (!window.confirm(`Запустить отсчёт до ${label}? До этого момента сайт будет закрыт для всех, кроме администраторов.`)) return;
    void saveOpening(new Date(time).toISOString());
  };

  /* Быстрый запуск для проверки церемонии: отсчёт на несколько секунд вперёд. */
  const startOpeningIn = (seconds: number) => {
    const time = Date.now() + seconds * 1000;
    setOpeningInput(toLocalDateTimeInput(time));
    startOpening(time);
  };

  const stopOpening = () => {
    if (!window.confirm("Остановить отсчёт? Сайт сразу откроется для всех.")) return;
    void saveOpening(null);
  };

  const openingPreviewTime = settings.openingAt ?? (openingInput ? new Date(openingInput).toISOString() : "");

  const toggleCrashMode = async () => {
    setBusyKey("crash-mode");
    setError("");
    setNotice("");
    try {
      const result = await request("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ crashMode: !settings.crashMode }),
      });
      setSettings(result.settings as SiteSettings);
      setNotice(
        settings.crashMode
          ? "Краш-режим выключен. Сайт снова работает нормально для всех."
          : "Краш-режим включён. Для владельца сайт остался обычным.",
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Ошибка.");
    } finally {
      setBusyKey("");
    }
  };

  return (
    <main className="admin-shell">
      <header className="admin-header">
        <div>
          <p>POPPERSCRAFT CONTROL PANEL</p>
          <h1>УПРАВЛЕНИЕ</h1>
          <span>
            {currentAdmin.display_name} · {currentAdmin.role === "owner" ? "ВЛАДЕЛЕЦ" : "АДМИН"}
          </span>
        </div>
        <div className="admin-header-links">
          <Link href="/profile">ПРОФИЛЬ</Link>
          <BackButton />
        </div>
      </header>

      <nav className="admin-tabs" aria-label="Разделы управления">
        {panelLabels.map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={panel === value ? "active" : ""}
            onClick={() => setPanel(value)}
          >
            {label}
            {value === "applications" && pendingCount ? <i>{pendingCount}</i> : null}
          </button>
        ))}
      </nav>

      {/* Правило двух факелов касается только анкет и пользователей. */}
      {panel === "applications" || panel === "users" ? <div className="admin-rule-banner">
        <b>ПРАВИЛО ДВУХ ФАКЕЛОВ:</b>
        <span>принятие и бан срабатывают после 2 голосов «за». Удаление игрока во вкладке «Пользователи» выполняется сразу после подтверждения.</span>
      </div> : null}

      {error ? <p className="form-message error-message">{error}</p> : null}
      {notice ? <p className="form-message success-message">{notice}</p> : null}

      {panel === "applications" ? (
        <section className="admin-panel">
          <div className="admin-panel-heading">
            <div><small>QUEUE.EXE</small><h2>АНКЕТЫ</h2></div>
            <span>{applications.length} ШТ.</span>
          </div>
          <div className="admin-list">
            {applications.length === 0 ? (
              <div className="empty-applications">Заявок пока нет.</div>
            ) : (
              applications.map((application) => (
                <article className="application-card" key={application.id}>
                  <div className="application-topline">
                    <div>
                      <span className={`application-status ${application.status}`}>
                        {decisionLabel(application)}
                      </span>
                      <h2>@{application.login}</h2>
                    </div>
                    <time>
                      {new Intl.DateTimeFormat("ru-RU", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      }).format(new Date(application.created_at))}
                    </time>
                  </div>
                  <div className="vote-meter" aria-label="Голоса администраторов">
                    <span className="vote-yes">✓ ЗА: {application.approvals}/2</span>
                    <span className="vote-no">× ПРОТИВ: {application.rejections}/2</span>
                    <span>МОЙ: {application.my_vote === "approve" ? "ЗА" : application.my_vote === "reject" ? "ПРОТИВ" : "—"}</span>
                  </div>
                  <div className="player-opinion-meter">
                    ИГРОКИ: <b>ЗА {application.player_approvals}</b> · <b>ПРОТИВ {application.player_rejections}</b>
                  </div>
                  <div className="application-details">
                    <div className="application-skin-card">
                      <MinecraftSkinPreview src={application.skin_url} alt={`Скин игрока ${application.login}`} />
                      <b>2D SKIN</b>
                    </div>
                    <dl>
                      <div><dt>Кто ты?</dt><dd>{application.who}</dd></div>
                      <div><dt>Откуда?</dt><dd>{application.from_where}</dd></div>
                      <div><dt>Почему хочешь быть на сервере?</dt><dd>{application.why_server}</dd></div>
                      <div><dt>Почему именно ты должен попасть?</dt><dd>{application.why_you}</dd></div>
                      {application.favorite_music ? <div><dt>Любимая музыка</dt><dd>{application.favorite_music}</dd></div> : null}
                      {application.social_links ? <div><dt>Социальные сети</dt><dd>{application.social_links}</dd></div> : null}
                    </dl>
                  </div>
                  {application.is_protected ? (
                    <p className="owner-note">OWNER LOCK · ВЛАДЕЛЕЦ ВСЕГДА СОХРАНЯЕТ ДОСТУП</p>
                  ) : (
                  <div className="admin-actions">
                    <button
                      type="button"
                      className={application.my_vote === "approve" ? "selected" : ""}
                      disabled={busyKey === `application-${application.id}` || application.is_deleted}
                      onClick={() => voteApplication(application.id, "approve")}
                    >
                      ✓ ГОЛОС ЗА
                    </button>
                    <button
                      type="button"
                      className={application.my_vote === "reject" ? "selected" : ""}
                      disabled={busyKey === `application-${application.id}` || application.is_deleted}
                      onClick={() => voteApplication(application.id, "reject")}
                    >
                      × ГОЛОС ПРОТИВ
                    </button>
                    <button
                      type="button"
                      disabled={busyKey === `application-${application.id}` || !application.my_vote}
                      onClick={() => voteApplication(application.id, "clear")}
                    >
                      ↺ СНЯТЬ ГОЛОС
                    </button>
                    {application.status === "pending" ? (
                      <button
                        type="button"
                        className="force-approve-button"
                        disabled={busyKey === `application-${application.id}`}
                        onClick={() => approveImmediately(application.id)}
                      >
                        ⚡ СДЕЛАТЬ ИГРОКОМ СЕЙЧАС
                      </button>
                    ) : null}
                  </div>
                  )}
                </article>
              ))
            )}
          </div>
        </section>
      ) : null}

      {panel === "users" ? (
        <section className="admin-panel">
          <div className="admin-panel-heading">
            <div><small>PLAYERS.DAT</small><h2>ПОЛЬЗОВАТЕЛИ</h2></div>
            <span>{activeMembers.length} ШТ.</span>
          </div>
          <form className="admin-editor admin-add-player" onSubmit={submitPlayer}>
            <div className="window-bar">ДОБАВИТЬ ИГРОКА НАПРЯМУЮ</div>
            <div className="admin-editor-grid">
              <label>ИГРОВОЙ НИК<input name="login" minLength={3} maxLength={24} pattern="[A-Za-z0-9_.-]+" required /></label>
              <label>ИМЯ<input name="displayName" minLength={2} maxLength={120} required /></label>
            </div>
            <label>ВРЕМЕННЫЙ ПАРОЛЬ<input name="password" type="password" minLength={8} maxLength={128} autoComplete="new-password" required /></label>
            <button type="submit" disabled={busyKey === "new-player"}>+ ДОБАВИТЬ ИГРОКА</button>
          </form>
          {currentAccountNeedsRepair ? (
            <form className="admin-editor admin-add-player" onSubmit={restoreOwnPlayer}>
              <div className="window-bar">ВОССТАНОВИТЬ МОЙ ИГРОВОЙ АККАУНТ</div>
              <p>Аккаунт администратора существует, но его запись игрока была удалена старой версией сайта.</p>
              <label>
                НОВЫЙ ИГРОВОЙ НИК
                <input
                  name="login"
                  defaultValue={currentApplication?.login ?? ""}
                  minLength={3}
                  maxLength={24}
                  pattern="[A-Za-z0-9_.-]+"
                  required
                />
              </label>
              <button type="submit" disabled={busyKey === "restore-self"}>
                {busyKey === "restore-self" ? "ВОССТАНАВЛИВАЕМ…" : "ВОССТАНОВИТЬ И СМЕНИТЬ НИК"}
              </button>
            </form>
          ) : null}
          <div className="admin-user-grid">
            {activeMembers.map((application) => (
              <article className="admin-user-card" key={application.id}>
                {!application.is_protected ? (
                  <button
                    className="admin-player-delete"
                    type="button"
                    disabled={busyKey === `delete-player-${application.id}`}
                    onClick={() => deletePlayerImmediately(application)}
                    aria-label={`Удалить игрока ${application.login}`}
                    title="Удалить игрока"
                  >
                    ×
                  </button>
                ) : null}
                <div>
                  <span className={`application-status ${application.status}`}>
                    {decisionLabel(application)}
                  </span>
                  <h3>@{application.login}</h3>
                  <p>{application.who}</p>
                  {currentAdmin.role === "owner" && !application.is_protected && !application.is_deleted ? (
                    <div className="admin-rename-player">
                      <input
                        aria-label={`Новый ник для ${application.login}`}
                        value={renameLogins[application.id] ?? application.login}
                        minLength={3}
                        maxLength={24}
                        pattern="[A-Za-z0-9_.-]+"
                        onChange={(event) => setRenameLogins((current) => ({ ...current, [application.id]: event.target.value }))}
                      />
                      <button type="button" disabled={busyKey === `rename-${application.id}`} onClick={() => renamePlayer(application.id, application.login)}>
                        {busyKey === `rename-${application.id}` ? "МЕНЯЕМ…" : "СМЕНИТЬ НИК"}
                      </button>
                    </div>
                  ) : null}
                </div>
                {currentAdmin.role === "owner" && application.user_id && !adminUserIds.has(application.user_id) ? (
                  <button
                    className="promote-admin-button"
                    type="button"
                    disabled={busyKey === `promote-admin-${application.id}`}
                    onClick={() => promotePlayerToAdmin(application)}
                  >
                    {busyKey === `promote-admin-${application.id}` ? "НАЗНАЧАЕМ…" : "★ СДЕЛАТЬ АДМИНОМ"}
                  </button>
                ) : null}
                {application.user_id && !application.is_deleted ? (
                  <button
                    className="promote-admin-button admin-player-visibility"
                    type="button"
                    disabled={busyKey === `hide-player-${application.id}`}
                    onClick={() => togglePlayerHidden(application)}
                  >
                    {busyKey === `hide-player-${application.id}`
                      ? "…"
                      : application.hidden_from_directory ? "ПОКАЗАТЬ В СПИСКЕ ИГРОКОВ" : "СКРЫТЬ ИЗ СПИСКА ИГРОКОВ"}
                  </button>
                ) : null}
                {application.ban_reason ? (
                  <p className="ban-reason">ПРИЧИНА: {application.ban_reason}</p>
                ) : null}
                {application.is_protected ? (
                  <p className="owner-note">OWNER LOCK · ВЛАДЕЛЕЦ ЗАЩИЩЁН ОТ БАНА И УДАЛЕНИЯ</p>
                ) : !application.is_deleted ? (
                  <>
                    <label>
                      ПРИЧИНА
                      <input
                        value={reasons[application.id] ?? ""}
                        onChange={(event) =>
                          setReasons((current) => ({
                            ...current,
                            [application.id]: event.target.value,
                          }))
                        }
                        maxLength={500}
                        placeholder="Например: гриферство"
                      />
                    </label>
                    <div className="admin-actions compact-actions">
                      {!application.is_banned ? (
                        <button
                          type="button"
                          disabled={busyKey === `moderation-${application.id}`}
                          onClick={() => createModeration(application.id, "ban")}
                        >
                          ⛏ ПРЕДЛОЖИТЬ БАН
                        </button>
                      ) : null}
                    </div>
                  </>
                ) : null}
              </article>
            ))}
          </div>

          <div className="admin-panel-heading subheading">
            <div><small>VOTES.LOG</small><h2>ГОЛОСОВАНИЯ</h2></div>
          </div>
          <div className="proposal-list">
            {proposals.length === 0 ? <p>Активных решений пока нет.</p> : null}
            {proposals.map((proposal) => {
              const application = applications.find(
                (item) => item.id === proposal.application_id,
              );
              return (
                <article className="proposal-card" key={proposal.id}>
                  <div>
                    <span>{proposal.action === "ban" ? "БАН" : "УДАЛЕНИЕ"}</span>
                    <h3>@{application?.login ?? "неизвестно"}</h3>
                    <p>{proposal.reason}</p>
                  </div>
                  <div className="proposal-votes">
                    <b>ЗА {proposal.approvals}/2</b>
                    <b>ПРОТИВ {proposal.rejections}/2</b>
                    <span>{proposal.status.toUpperCase()}</span>
                  </div>
                  {proposal.status === "pending" ? (
                    <div className="admin-actions compact-actions">
                      <button
                        type="button"
                        disabled={busyKey === `proposal-${proposal.id}`}
                        onClick={() => voteModeration(proposal.id, "approve")}
                      >
                        ✓ ПОДТВЕРДИТЬ
                      </button>
                      <button
                        type="button"
                        disabled={busyKey === `proposal-${proposal.id}`}
                        onClick={() => voteModeration(proposal.id, "reject")}
                      >
                        × ОТКЛОНИТЬ
                      </button>
                      <button
                        type="button"
                        disabled={busyKey === `proposal-${proposal.id}` || !proposal.my_vote}
                        onClick={() => voteModeration(proposal.id, "clear")}
                      >
                        ↺ СНЯТЬ
                      </button>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      {panel === "updates" ? (
        <section className="admin-panel">
          <div className="admin-panel-heading">
            <div><small>CHANGELOG.TXT</small><h2>ОБНОВЛЕНИЯ</h2></div>
          </div>
          <form className="admin-editor" onSubmit={submitUpdate}>
            <div className="window-bar">НОВАЯ ЗАПИСЬ — БЛОКНОТ</div>
            <div className="admin-editor-grid">
              <label>
                МЕТКА
                <input name="badge" minLength={2} maxLength={16} placeholder="NEWS" required />
              </label>
              <label>
                ЦВЕТ
                <select name="color" defaultValue="lime">
                  <optgroup label="ЦВЕТА">
                    {UPDATE_SOLID_COLOR_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </optgroup>
                  <optgroup label="ФЛАГИ ИЗ ПРОФИЛЯ">
                    {UPDATE_FLAG_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label.toLocaleUpperCase("ru-RU")}</option>)}
                  </optgroup>
                </select>
              </label>
            </div>
            <label>
              ЗАГОЛОВОК
              <input name="title" minLength={3} maxLength={120} required />
            </label>
            <label>
              ТЕКСТ
              <textarea name="body" minLength={3} maxLength={1200} required />
            </label>
            <button type="submit" disabled={busyKey === "new-update"}>
              {busyKey === "new-update" ? "ПУБЛИКУЕМ…" : "ОПУБЛИКОВАТЬ →"}
            </button>
          </form>
          <div className="admin-update-list">
            {updates.map((update) => (
              <article key={update.id}>
                <UpdateBadge color={update.color} label={update.badge} />
                <div>
                  <small>
                    {new Intl.DateTimeFormat("ru-RU").format(new Date(update.created_at))}
                    {" · "}
                    {update.author_name}
                  </small>
                  <h3>{update.board ? `ДОСКА · ${update.board.status === "draft" ? "ЧЕРНОВИК" : update.board.status === "scheduled" ? "ПО РАСПИСАНИЮ" : "ОПУБЛИКОВАНО"}` : update.title}</h3>
                  <p>{update.board ? `${update.board.blocks.length} блоков · ${update.board.placement === "after-donate" ? "после доната" : "в обновлениях"}${update.board.publishAt ? ` · ${new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short" }).format(new Date(update.board.publishAt))}` : ""}` : update.body}</p>
                </div>
                <button
                  type="button"
                  disabled={busyKey === `update-${update.id}`}
                  className={confirmDeleteUpdateId === update.id ? "confirm-delete" : undefined}
                  onClick={() => {
                    if (confirmDeleteUpdateId === update.id) {
                      void deleteUpdate(update.id);
                    } else {
                      setConfirmDeleteUpdateId(update.id);
                    }
                  }}
                >
                  {busyKey === `update-${update.id}`
                    ? "УДАЛЯЕМ…"
                    : confirmDeleteUpdateId === update.id
                      ? "ТОЧНО УДАЛИТЬ?"
                      : "УДАЛИТЬ"}
                </button>
              </article>
            ))}
          </div>
          {/* Список «ждут запуска доната» — во вкладке «Связь» (AdminCommunicationPanel); здесь был дубль. */}
        </section>
      ) : null}

      {panel === "builder" ? <BlockBuilder savedBoards={updates.filter((update) => Boolean(update.board))} onCreated={(update) => setUpdates((current) => [update, ...current])} onDelete={deleteUpdate} /> : null}

      {panel === "launchers" ? <AdminLauncherPanel initialReleases={initialLauncherReleases} /> : null}

      {panel === "admins" ? (
        <section className="admin-panel">
          <div className="admin-panel-heading">
            <div><small>OPS.JSON</small><h2>АДМИНИСТРАТОРЫ</h2></div>
          </div>
          {currentAdmin.role === "owner" ? (
            <form className="admin-editor admin-add-form" onSubmit={submitAdmin}>
              <label>
                ИМЯ
                <input name="displayName" minLength={2} maxLength={80} placeholder="Новый админ" required />
              </label>
              <label>
                ПОЧТА
                <input name="email" type="email" placeholder="admin@example.com" required />
              </label>
              <label>
                ВРЕМЕННЫЙ ПАРОЛЬ
                <input
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  maxLength={128}
                  placeholder="минимум 8 символов"
                  required
                />
              </label>
              <button type="submit" disabled={busyKey === "new-admin"}>
                + ДОБАВИТЬ АДМИНА
              </button>
            </form>
          ) : (
            <p className="owner-note">Добавлять и отключать админов может только владелец.</p>
          )}
          <div className="admin-people-list">
            {admins.map((admin) => (
              <article key={admin.id}>
                <span className={admin.active ? "admin-online" : "admin-offline"} />
                <div>
                  <h3>{admin.display_name}</h3>
                  <p>{admin.email}</p>
                </div>
                <b>{admin.role === "owner" ? (admin.is_protected ? "ВЛАДЕЛЕЦ · OWNER LOCK" : "ВЛАДЕЛЕЦ") : admin.is_protected ? "АДМИН · PROTECTED" : "АДМИН"}</b>
                <div className="admin-admin-actions">
                  {currentAdmin.role === "owner" && admin.role !== "owner" && !admin.is_protected ? (
                    <button
                      type="button"
                      disabled={busyKey === `admin-${admin.id}`}
                      onClick={() => toggleAdmin(admin)}
                    >
                      {admin.active ? "ОТКЛЮЧИТЬ" : "ВКЛЮЧИТЬ"}
                    </button>
                  ) : null}
                  {currentAdmin.role === "owner" && !admin.is_protected && admin.role !== "owner" && admin.id !== currentAdmin.id ? (
                    <button
                      type="button"
                      className={confirmDeleteAdminId === admin.id ? "confirm-delete" : "delete-admin-button"}
                      disabled={busyKey === `delete-admin-${admin.id}`}
                      onClick={() => {
                        if (confirmDeleteAdminId === admin.id) void deleteAdmin(admin);
                        else setConfirmDeleteAdminId(admin.id);
                      }}
                    >
                      {busyKey === `delete-admin-${admin.id}`
                        ? "УДАЛЯЕМ…"
                        : confirmDeleteAdminId === admin.id
                          ? "ТОЧНО УДАЛИТЬ?"
                          : "УДАЛИТЬ АДМИНА"}
                    </button>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {panel === "communication" ? <AdminCommunicationPanel initialCommunication={initialCommunication} /> : null}

      {panel === "poppers" ? <AdminPoppersPanel /> : null}
      {panel === "payments" ? <AdminPaymentsPanel /> : null}

      {panel === "agreement" ? (
        <AdminAgreementPanel
          initialAcceptances={initialAgreementAcceptances}
          registeredAccounts={initialCommunication.metrics.registered_accounts}
        />
      ) : null}

      {panel === "logs" ? <AdminErrorLogsPanel initialLogs={initialErrorLogs} initialLoadedAt={initialErrorLogsAt} /> : null}

      {panel === "settings" ? (
        <section className="admin-panel">
          <div className="admin-panel-heading">
            <div><small>CONFIG.SYS</small><h2>НАСТРОЙКИ</h2></div>
          </div>
          <article className={`maintenance-setting opening-setting ${settings.openingAt ? "enabled" : ""}`}>
            <div>
              <span className="application-status">
                {settings.openingAt ? "ОТСЧЁТ ИДЁТ" : "ОТСЧЁТ НЕ ЗАПУЩЕН"}
              </span>
              <h3>ОТКРЫТИЕ ПЛАТФОРМЫ</h3>
              <p>
                Показывает всем посетителям торжественное окно с обратным отсчётом: сайт закрыт,
                пока не наступит время открытия. В этот момент ленточка разрезается, небо взрывается
                салютом, и все попадают на сайт. Администраторы видят сайт как обычно, войти можно
                по ссылке popperscraft.org/admin. Чтобы увидеть окно глазами посетителя, откройте
                сайт в приватной вкладке или нажмите «Предпросмотр».
              </p>
              {settings.openingAt ? (
                <small>
                  ОТКРЫТИЕ: {new Intl.DateTimeFormat("ru-RU", { dateStyle: "long", timeStyle: "medium" }).format(new Date(settings.openingAt))}
                </small>
              ) : null}
            </div>
            <div className="maintenance-controls">
              {currentAdmin.role === "owner" ? (
                settings.openingAt ? (
                  <button type="button" className="danger-button" disabled={busyKey === "opening"} onClick={stopOpening}>
                    {busyKey === "opening" ? "СОХРАНЯЕМ…" : "ОСТАНОВИТЬ И ОТКРЫТЬ САЙТ"}
                  </button>
                ) : (
                  <>
                    <label>
                      ДАТА И ВРЕМЯ ОТКРЫТИЯ
                      <input
                        type="datetime-local"
                        step={1}
                        value={openingInput}
                        onChange={(event) => setOpeningInput(event.target.value)}
                      />
                    </label>
                    <div className="opening-quick" aria-label="Быстрый запуск для проверки">
                      <button type="button" disabled={busyKey === "opening"} onClick={() => startOpeningIn(30)}>ЧЕРЕЗ 30 СЕК</button>
                      <button type="button" disabled={busyKey === "opening"} onClick={() => startOpeningIn(60)}>ЧЕРЕЗ 1 МИН</button>
                      <button type="button" disabled={busyKey === "opening"} onClick={() => startOpeningIn(300)}>ЧЕРЕЗ 5 МИН</button>
                    </div>
                    <button type="button" disabled={busyKey === "opening" || !openingInput} onClick={() => startOpening(new Date(openingInput).getTime())}>
                      {busyKey === "opening" ? "ЗАПУСКАЕМ…" : "ЗАПУСТИТЬ ОТСЧЁТ"}
                    </button>
                  </>
                )
              ) : (
                <small>Запустить отсчёт может только владелец.</small>
              )}
              {openingPreviewTime ? (
                <a className="opening-preview-link" href={`/?opening-preview=${encodeURIComponent(openingPreviewTime)}`} target="_blank" rel="noreferrer">
                  ПРЕДПРОСМОТР ↗
                </a>
              ) : null}
            </div>
          </article>
          <article className={`maintenance-setting ${settings.maintenanceMode ? "enabled" : ""}`}>
            <div>
              <span className="application-status">
                {settings.maintenanceMode ? "САЙТ ЗАКРЫТ" : "САЙТ ОТКРЫТ"}
              </span>
              <h3>ТЕХНИЧЕСКИЕ РАБОТЫ</h3>
              <p>
                Закрывает главную страницу для всех посетителей. Владелец продолжает
                видеть сайт после входа, а ссылка для администраторов остаётся внизу справа.
              </p>
            </div>
            {currentAdmin.role === "owner" ? (
              <div className="maintenance-controls">
                {!settings.maintenanceMode ? (
                  <label>
                    АВТООТКЛЮЧЕНИЕ
                    <select
                      value={maintenanceMinutes}
                      onChange={(event) => setMaintenanceMinutes(event.target.value)}
                    >
                      <option value="none">БЕЗ ТАЙМЕРА</option>
                      <option value="30">ЧЕРЕЗ 30 МИНУТ</option>
                      <option value="60">ЧЕРЕЗ 1 ЧАС</option>
                      <option value="120">ЧЕРЕЗ 2 ЧАСА</option>
                      <option value="360">ЧЕРЕЗ 6 ЧАСОВ</option>
                      <option value="720">ЧЕРЕЗ 12 ЧАСОВ</option>
                      <option value="1440">ЧЕРЕЗ 24 ЧАСА</option>
                    </select>
                  </label>
                ) : settings.endsAt ? (
                  <small>ОТКРОЕТСЯ: {new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short" }).format(new Date(settings.endsAt))}</small>
                ) : null}
                <button
                  type="button"
                  className={settings.maintenanceMode ? "danger-button" : ""}
                  disabled={busyKey === "maintenance"}
                  onClick={toggleMaintenance}
                >
                  {busyKey === "maintenance"
                    ? "СОХРАНЯЕМ…"
                    : settings.maintenanceMode
                      ? "ВЫКЛЮЧИТЬ РЕЖИМ"
                      : "ВКЛЮЧИТЬ РЕЖИМ"}
                </button>
              </div>
            ) : (
              <small>Изменить режим может только владелец.</small>
            )}
          </article>
          {currentAdmin.role === "owner" ? (
            <article className={`maintenance-setting crash-setting ${settings.crashMode ? "enabled" : ""}`}>
              <div>
                <span className="application-status">
                  {settings.crashMode ? "САЙТ СЛОМАН ДЛЯ ВСЕХ" : "КРАШ-РЕЖИМ ВЫКЛЮЧЕН"}
                </span>
                <h3>КРАШНУТЬ САЙТ</h3>
                <p>
                  Для всех, кроме владельца, интерфейс станет кривым и полностью
                  неактивным. У тебя всё продолжит работать как обычно. Повторное
                  нажатие вернёт нормальный сайт.
                </p>
              </div>
              <div className="maintenance-controls">
                <button
                  type="button"
                  className="danger-button crash-mode-toggle"
                  disabled={busyKey === "crash-mode"}
                  onClick={toggleCrashMode}
                >
                  {busyKey === "crash-mode"
                    ? "ЛОМАЕМ…"
                    : settings.crashMode
                      ? "ВОССТАНОВИТЬ САЙТ"
                      : "КРАШНУТЬ САЙТ"}
                </button>
              </div>
            </article>
          ) : null}
          <AdminCachePanel />
        </section>
      ) : null}
    </main>
  );
}
