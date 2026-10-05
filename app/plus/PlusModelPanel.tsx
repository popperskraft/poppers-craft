"use client";

import dynamic from "next/dynamic";
import { useState } from "react";

const ModelStudio = dynamic(() => import("@/app/models/ModelStudio").then(module => module.ModelStudio), {
  loading: () => <p>Загружаем…</p>,
  ssr: false,
});

export function PlusModelPanel() {
  const [open, setOpen] = useState(false);
  const [visited, setVisited] = useState(false);
  return <section className="profile-password plus-model-panel" id="plus-models">
    <p>CHARACTER_MODELS.EXE</p><h2>МОДЕЛИ ПЕРСОНАЖЕЙ</h2>
    <p>Редактор откроется здесь. Пони доступен с HYPE; настройки и рисунок сохраняются при сворачивании.</p>
    <div className="profile-actions">
      <button type="button" aria-expanded={open} aria-controls="plus-model-editor" onClick={() => { setOpen(value => !value); setVisited(true); }}>{open ? "СВЕРНУТЬ РЕДАКТОР" : "ОТКРЫТЬ РЕДАКТОР →"}</button>
    </div>
    <div id="plus-model-editor" hidden={!open}>
      {visited ? <ModelStudio embedded active={open} /> : null}
    </div>
  </section>;
}
