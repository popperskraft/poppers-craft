"use client";

import { ChangeEvent, useEffect, useRef, useState } from "react";
import { MinecraftSkinPreview } from "@/app/MinecraftSkinPreview";

const MAX_SKIN_BYTES = 256 * 1024;

export function SkinUploadField({
  name = "skin",
  required = false,
  currentSkinUrl = null,
  confirmSelection = false,
}: {
  name?: string;
  required?: boolean;
  currentSkinUrl?: string | null;
  confirmSelection?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const objectUrlRef = useRef<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(currentSkinUrl);
  const [error, setError] = useState("");
  const [hasSelection, setHasSelection] = useState(false);
  const [selectedFileName, setSelectedFileName] = useState("");
  const [toast, setToast] = useState<"success" | "error" | null>(null);

  useEffect(() => () => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
  }, []);

  useEffect(() => {
    const input = inputRef.current;
    const form = input?.form;
    if (!form) return;
    const reset = () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
      setPreviewUrl(currentSkinUrl);
      setError("");
      setHasSelection(false);
      setSelectedFileName("");
      setToast(null);
    };
    form.addEventListener("reset", reset);
    return () => form.removeEventListener("reset", reset);
  }, [currentSkinUrl]);

  function showToast(status: "success" | "error") {
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    setToast(status);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 2800);
  }

  function validateAndPreview(input: HTMLInputElement, notify: boolean) {
    const file = input.files?.[0];
    setError("");
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = null;
    if (!file) {
      const message = "Сначала выберите PNG-файл со скином.";
      input.setCustomValidity(message);
      setError(message);
      setPreviewUrl(currentSkinUrl);
      if (notify) showToast("error");
      return;
    }
    input.setCustomValidity("Проверяем скин...");
    if (file.type !== "image/png" || file.size > MAX_SKIN_BYTES) {
      const message = "Нужен PNG-файл размером не больше 256 КБ.";
      input.setCustomValidity(message);
      setError(message);
      setPreviewUrl(currentSkinUrl);
      if (notify) showToast("error");
      return;
    }

    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const valid = image.naturalWidth === 64 && [32, 64].includes(image.naturalHeight);
      if (!valid) {
        const message = "Размер скина должен быть 64×64 или 64×32 пикселя.";
        input.setCustomValidity(message);
        setError(message);
        URL.revokeObjectURL(url);
        setPreviewUrl(currentSkinUrl);
        if (notify) showToast("error");
        return;
      }
      objectUrlRef.current = url;
      setPreviewUrl(url);
      input.setCustomValidity("");
      setError("");
      if (notify) showToast("success");
    };
    image.onerror = () => {
      const message = "Не удалось прочитать этот PNG-файл.";
      input.setCustomValidity(message);
      setError(message);
      URL.revokeObjectURL(url);
      setPreviewUrl(currentSkinUrl);
      if (notify) showToast("error");
    };
    image.src = url;
  }

  function change(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    setHasSelection(Boolean(file));
    setSelectedFileName(file?.name ?? "");
    if (confirmSelection) {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
      setPreviewUrl(currentSkinUrl);
      setError("");
      setToast(null);
      input.setCustomValidity(file ? "Нажмите кнопку «Установить скин»." : "");
      return;
    }
    validateAndPreview(input, false);
  }

  return (
    <div className="skin-upload-field">
      <div className="skin-upload-preview">
        <MinecraftSkinPreview src={previewUrl} />
        <small>ВИД СПЕРЕДИ</small>
      </div>
      <div className="skin-upload-controls">
        <span className="skin-upload-heading">СКИН MINECRAFT</span>
        <label className="skin-file-picker">
          <input ref={inputRef} name={name} type="file" accept="image/png,.png" required={required} onChange={change} />
          <strong>ЗАГРУЗИТЬ СКИН</strong>
          {selectedFileName ? <span>{selectedFileName}</span> : null}
        </label>
        <small>PNG 64×64 или 64×32 · максимум 256 КБ</small>
        {confirmSelection ? (
          <button className="skin-install-button" type="button" disabled={!hasSelection} onClick={() => inputRef.current && validateAndPreview(inputRef.current, true)}>
            УСТАНОВИТЬ СКИН
          </button>
        ) : null}
      </div>
      {error ? <p className="skin-upload-error" role="alert">{error}</p> : null}
      {toast ? (
        <div className={`skin-install-toast ${toast}`} role="status" aria-live="polite">
          {toast === "success" ? "СКИН УСПЕШНО УСТАНОВЛЕН" : "НЕ УДАЛОСЬ ЗАГРУЗИТЬ СКИН"}
        </div>
      ) : null}
    </div>
  );
}
