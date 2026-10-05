"use client";
import { useEffect, useState } from 'react';
import { PALETTE_KEY, readPalette, recentColors, rememberColor } from '@/lib/skin-palette';

const COLORS = ['#ffffff','#c6c6c6','#838383','#343434','#000000','#ff4ead','#8c5ada','#33cddb','#d7ff24','#a45e39','#ef754c','#75b667'];
const CHANGE = 'popperscraft:skin-colors';
let memory: string[] = [];

export function useSkinPalette() {
  const [recent, setRecent] = useState<string[]>([]);
  useEffect(() => {
    try { memory = recentColors([...readPalette(localStorage), ...memory]); } catch { /* Storage may be disabled. */ }
    setRecent(memory);
    const update = () => setRecent(memory);
    const storage = (event: StorageEvent) => {
      if (event.key !== PALETTE_KEY && event.key !== null) return;
      try { memory = readPalette(localStorage); } catch { return; }
      update();
    };
    window.addEventListener(CHANGE, update);
    window.addEventListener('storage', storage);
    return () => { window.removeEventListener(CHANGE, update); window.removeEventListener('storage', storage); };
  }, []);
  function remember(color: string) {
    if (memory[0] === color.toLowerCase()) return;
    memory = rememberColor(memory, color);
    try { localStorage.setItem(PALETTE_KEY, JSON.stringify(memory)); } catch { /* Keep the session palette. */ }
    window.dispatchEvent(new Event(CHANGE));
  }
  return { recent, remember };
}

export function SkinPalette({color,recent,onSelect}:{color:string;recent:string[];onSelect:(color:string)=>void}) {
  const swatches = (colors:string[]) => colors.map(value => <button key={value} type="button"
    style={{background:value}} aria-label={'Цвет '+value} title={value.toUpperCase()}
    aria-pressed={color.toLowerCase()===value} onClick={()=>onSelect(value)}/>);
  return <div className="skin-palette">
    <div className="models-palette" role="group" aria-label="Основные цвета">{swatches(COLORS)}</div>
    <span className="palette-label">Недавние цвета</span>
    {recent.length ? <div className="models-palette" role="group" aria-label="Недавние цвета">{swatches(recent)}</div>
      : <p className="palette-empty">Появятся, когда начнёте рисовать.</p>}
  </div>;
}
