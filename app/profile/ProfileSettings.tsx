"use client";

import { type ReactNode, useState } from "react";

/* Разделы вкладки «Настройки» в окне профиля (app/profile/page.tsx): слева
   список, справа выбранный раздел. Раздел без содержимого не показывается
   (например, «Нейросети» — только у владельца). */
export type SettingsPanel = { id: string; label: string; content: ReactNode };

export function ProfileSettings({ sections, initialSection }: { sections: SettingsPanel[]; initialSection?: string | null }) {
  const visible = sections.filter((section) => section.content !== undefined && section.content !== null);
  const [active, setActive] = useState(visible.some((section) => section.id === initialSection) ? String(initialSection) : visible[0]?.id ?? "");
  return <div className="profile-settings-layout">
    <nav className="profile-settings-nav" aria-label="Разделы настроек">
      {visible.map(section => <button key={section.id} type="button" aria-pressed={active === section.id} aria-controls={`settings-${section.id}`} onClick={() => setActive(section.id)}><span>{section.label}</span><span aria-hidden="true">→</span></button>)}
      <p>Изменения сохраняются кнопкой в соответствующем разделе.</p>
    </nav>
    <div className="profile-settings-panels">
      {visible.map(section => <div id={`settings-${section.id}`} key={section.id} hidden={active !== section.id}>{section.content}</div>)}
    </div>
  </div>;
}
