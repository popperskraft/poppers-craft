"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { SkinUploadField } from "@/app/SkinUploadField";

export function SkinForm({ currentSkinUrl, unlimited = false, editorHref = "/models?editor=human", onSaved }: {
  currentSkinUrl: string | null; canUpload?: boolean; unlimited?: boolean; editorHref?: string;
  /* Студия редактирования перезапрашивает скин в живой карточке. */
  onSaved?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const router = useRouter();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    setError(false);
    const response = await fetch("/api/profile/skin", {
      method: "POST",
      body: new FormData(event.currentTarget),
    });
    const result = await response.json();
    setBusy(false);
    setError(!response.ok);
    setMessage(response.ok ? "Скин добавлен в аккаунт." : result.error ?? "Не удалось обновить скин.");
    if (response.ok) { router.refresh(); onSaved?.(); }
  }

  return (
    <form className="profile-password-form skin-profile-form" onSubmit={submit}>
      <SkinUploadField currentSkinUrl={currentSkinUrl} required />
      {/* Загружать готовый скин можно сколько угодно раз; гардероб лаунчера без HYPE — один скин (2026-10-04). */}
      <p className="skin-upload-note">{unlimited ? "Загружайте сколько угодно раз. В гардеробе лаунчера — до пяти скинов человека и пяти скинов пони." : "Загружайте сколько угодно раз — новый скин заменит прежний: в гардеробе лаунчера хранится один. С HYPE — пять скинов человека и пять пони."} <Link href={editorHref}>Открыть карусель скинов</Link></p>
      <button disabled={busy}>{busy ? "ЗАГРУЖАЮ..." : "ДОБАВИТЬ СКИН"}</button>
      {message ? <p className={`form-message ${error ? "error-message" : "success-message"}`}>{message}</p> : null}
    </form>
  );
}
