"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import type { HumanModel } from "@/lib/human-skin";
import type { ProfilePony } from "@/lib/profile-pony";

const Skin3D = dynamic(() => import("./Skin3D").then(module => module.Skin3D), { ssr: false, loading: () => <p role="status">ЗАГРУЖАЕМ 3D…</p> });

export function ProfileSkinViewer({ src, model = "classic", pony = null }: { src: string | null; model?: HumanModel; pony?: ProfilePony | null }) {
  const [view, setView] = useState<"human" | "pony">(!src && pony ? "pony" : "human");
  const selectedPony = view === "pony" ? pony : null;
  return <div className="profile-skin-viewer">
    <div className="skin-view-stage">
      {src || selectedPony ? <Skin3D key={selectedPony ? "pony" : "human"} src={src} model={model} pony={selectedPony} /> : <p>Игрок ещё не добавил обычный скин.</p>}
    </div>
    {pony ? <div className="skin-view-switch" role="group" aria-label="Просмотр 3D-модели">
      <button type="button" aria-label="Человек" title="Человек" aria-pressed={view === "human"} onClick={() => setView("human")}>
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" shapeRendering="crispEdges"><path fill="currentColor" d="M9 2h6v6H9zM5 9h14v8h-3v-5h-1v10h-3v-6h-1v6H8V12H7v5H4V9z" /></svg>
      </button>
      <button type="button" aria-label="Пони" title="Пони" aria-pressed={view === "pony"} onClick={() => setView("pony")}>
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" shapeRendering="crispEdges"><path fill="currentColor" fillRule="evenodd" d="M15 2h3v3h3v3h2v5h-6v3h-1v6h-3v-6H8v6H5V12H3v5H1V9h4V8h9V5h1zM7 10v4h8v-3h6V9h-2V7h-3v3z" /></svg>
      </button>
    </div> : null}
  </div>;
}
