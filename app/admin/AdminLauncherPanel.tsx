"use client";

import { FormEvent, useMemo, useState } from "react";
import type { LauncherRelease } from "@/lib/launcher-releases";
import { launcherReleaseLabel, launcherUploadTargets, linuxInstallerFor, type LauncherUploadTarget } from "@/lib/launcher-installers";

function formatBytes(value: number) {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)} ГБ`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)} МБ`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)} КБ`;
  return `${value} Б`;
}

function readUploadResponse(xhr: XMLHttpRequest) {
  try {
    return JSON.parse(xhr.responseText) as { release?: LauncherRelease; error?: string };
  } catch {
    return { error: "Сервер вернул некорректный ответ." };
  }
}

export function AdminLauncherPanel({ initialReleases }: { initialReleases: LauncherRelease[] }) {
  const [releases, setReleases] = useState(initialReleases);
  const [target, setTarget] = useState<LauncherUploadTarget>("macos");
  const selected = launcherUploadTargets[target];
  const [busy, setBusy] = useState("");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmArchiveId, setConfirmArchiveId] = useState<string | null>(null);

  const counts = useMemo(() => {
    return releases.reduce<Record<LauncherUploadTarget, number>>(
      (result, release) => {
        const key = linuxInstallerFor(release) ?? release.platform;
        if (!release.archived && key in result) result[key as LauncherUploadTarget] += 1;
        return result;
      },
      { macos: 0, windows: 0, deb: 0, appimage: 0 },
    );
  }, [releases]);

  const submitRelease = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const file = formData.get("file");
    if (!(file instanceof File) || !file.size) {
      setError("Выберите файл лаунчера.");
      return;
    }

    const version = String(formData.get("version") ?? "").trim();
    const notes = String(formData.get("notes") ?? "").trim();
    const query = new URLSearchParams({ platform: selected.platform, installer: selected.installer, version, notes, filename: file.name });
    setBusy("upload");
    setProgress(0);
    setError("");
    setNotice("");

    try {
      const release = await new Promise<LauncherRelease>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", `/api/admin/launcher-releases?${query.toString()}`);
        xhr.setRequestHeader("Content-Type", "application/octet-stream");
        xhr.upload.addEventListener("progress", (uploadEvent) => {
          if (uploadEvent.lengthComputable) {
            setProgress(Math.round((uploadEvent.loaded / uploadEvent.total) * 100));
          }
        });
        xhr.addEventListener("load", () => {
          const result = readUploadResponse(xhr);
          if (xhr.status >= 200 && xhr.status < 300 && result.release) resolve(result.release);
          else reject(new Error(result.error ?? "Не удалось загрузить файл."));
        });
        xhr.addEventListener("error", () => reject(new Error("Соединение прервалось во время загрузки.")));
        xhr.send(file);
      });
      setReleases((current) => [release, ...current]);
      form.reset();
      setProgress(100);
      setNotice(`Версия ${release.version} для ${launcherReleaseLabel(release)} опубликована.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось загрузить файл.");
    } finally {
      setBusy("");
    }
  };

  const setArchived = async (release: LauncherRelease, archived: boolean) => {
    setBusy(release.id);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin/launcher-releases", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: release.id, action: archived ? "archive" : "restore" }),
      });
      const result = await response.json() as { release?: LauncherRelease; error?: string };
      if (!response.ok || !result.release) throw new Error(result.error ?? "Не удалось изменить версию.");
      setReleases((current) => current.map((item) => item.id === release.id ? result.release as LauncherRelease : item));
      setConfirmArchiveId(null);
      setNotice(
        archived
          ? `Версия ${release.version} скрыта от пользователей. Файл сохранён и доступен для восстановления.`
          : `Версия ${release.version} снова доступна для скачивания.`,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось изменить версию.");
    } finally {
      setBusy("");
    }
  };

  return (
    <section className="admin-panel launcher-admin-panel">
      <div className="admin-panel-heading">
        <div><small>LAUNCHER_VAULT.EXE</small><h2>ЛАУНЧЕРЫ</h2></div>
        <span>{releases.filter((release) => !release.archived).length} ДОСТУПНО</span>
      </div>

      <div className="launcher-admin-summary" aria-label="Опубликованные версии">
        {(Object.keys(launcherUploadTargets) as LauncherUploadTarget[]).map((value) => (
          <span key={value}><b>{launcherUploadTargets[value].name}</b>{counts[value]} вер.</span>
        ))}
      </div>

      <form className="admin-editor launcher-upload-form" onSubmit={submitRelease}>
        <div className="window-bar">ДОБАВИТЬ ВЕРСИЮ — UPLOAD.EXE</div>
        <div className="admin-editor-grid launcher-upload-grid">
          <label>
            СИСТЕМА И ФОРМАТ
            <select name="target" value={target} disabled={busy === "upload"} onChange={(event) => setTarget(event.target.value as LauncherUploadTarget)}>
              <option value="macos">macOS</option>
              <option value="windows">Windows</option>
              <option value="deb">Linux · DEB — Ubuntu / Debian / Mint</option>
              <option value="appimage">Linux · AppImage — переносимый</option>
            </select>
          </label>
          <label>
            ВЕРСИЯ
            <input name="version" maxLength={40} placeholder="например: 1.4.0" required />
          </label>
        </div>
        {selected.platform === "linux" ? <p className="launcher-upload-hint">DEB и AppImage публикуются отдельно. Загрузка одного формата не заменяет другой. Загружайте сборки для 64-битных Intel / AMD (x86_64).</p> : null}
        <label>
          {`ФАЙЛ ДЛЯ ${selected.name.toUpperCase()}`}
          <input key={target} name="file" type="file" accept={selected.accept} disabled={busy === "upload"} required />
          <small>{`До 1,5 ГБ · ${selected.accept.replaceAll(",", ", ")}`}</small>
        </label>
        <label>
          ЧТО ИЗМЕНИЛОСЬ
          <textarea name="notes" maxLength={500} placeholder="Необязательно: коротко опишите изменения этой версии." />
        </label>
        {busy === "upload" ? (
          <div className="launcher-upload-progress" aria-live="polite">
            <span style={{ width: `${Math.max(2, progress)}%` }} />
            <b>{progress < 100 ? `ЗАГРУЗКА ${progress}%` : "СОХРАНЯЕМ ВЕРСИЮ…"}</b>
          </div>
        ) : null}
        <button type="submit" disabled={busy === "upload"}>+ ЗАГРУЗИТЬ И ОПУБЛИКОВАТЬ</button>
      </form>

      {error ? <p className="form-message error-message">{error}</p> : null}
      {notice ? <p className="form-message success-message">{notice}</p> : null}

      <div className="launcher-release-list">
        {releases.length ? releases.map((release) => (
          <article className={release.archived ? "archived" : ""} key={release.id}>
            <div className="launcher-release-platform">{launcherReleaseLabel(release)}</div>
            <div className="launcher-release-copy">
              <div>
                <h3>ВЕРСИЯ {release.version}</h3>
                <span className={release.archived ? "release-status archived" : "release-status active"}>
                  {release.archived ? "СКРЫТА" : "ДОСТУПНА"}
                </span>
              </div>
              <p>{release.notes || "Описание изменений не добавлено."}</p>
              <small>{release.originalName} · {formatBytes(release.size)}</small>
              <small>{new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" }).format(new Date(release.createdAt))} · {release.createdBy}</small>
              <code title={release.sha256}>SHA-256: {release.sha256}</code>
            </div>
            <div className="launcher-release-actions">
              {!release.archived ? (
                <a href={`/api/launcher/releases/${release.id}/download`}>СКАЧАТЬ ↗</a>
              ) : null}
              {release.archived ? (
                <button type="button" disabled={busy === release.id} onClick={() => void setArchived(release, false)}>
                  {busy === release.id ? "ВОССТАНАВЛИВАЕМ…" : "ВОССТАНОВИТЬ"}
                </button>
              ) : (
                <button
                  type="button"
                  className={confirmArchiveId === release.id ? "confirm-delete" : ""}
                  disabled={busy === release.id}
                  onClick={() => {
                    if (confirmArchiveId === release.id) void setArchived(release, true);
                    else setConfirmArchiveId(release.id);
                  }}
                >
                  {busy === release.id
                    ? "СКРЫВАЕМ…"
                    : confirmArchiveId === release.id
                      ? "ТОЧНО СКРЫТЬ?"
                      : "УДАЛИТЬ ИЗ СКАЧИВАНИЙ"}
                </button>
              )}
            </div>
          </article>
        )) : (
          <div className="empty-applications">Загруженных версий пока нет.</div>
        )}
      </div>
    </section>
  );
}
