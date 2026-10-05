"use client";

import { useEffect, useRef } from "react";

export function ProfileName({ name }: { name: string }) {
  const host = useRef<HTMLHeadingElement>(null), text = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const heading = host.current!, label = text.current!;
    let active = true;
    const fit = () => {
      if (!active || !heading.clientWidth) return;
      label.style.fontSize = "86px";
      /* Ширины заголовка и надписи — в одних единицах (offsetWidth, как
         clientWidth): getBoundingClientRect учитывает zoom окна профиля (r098),
         и имя вылезало бы за край. */
      label.style.fontSize = `${Math.max(16, Math.min(86, 86 * (heading.clientWidth - 2) / Math.max(1, label.offsetWidth)))}px`;
    };
    const observer = new ResizeObserver(fit); observer.observe(heading);
    void document.fonts.ready.then(fit); fit();
    return () => { active = false; observer.disconnect(); };
  }, [name]);
  return <h1 ref={host} className="player-name-fit" title={name} translate="no"><span ref={text}>{name}</span></h1>;
}
