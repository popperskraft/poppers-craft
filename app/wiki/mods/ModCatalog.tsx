"use client";

import { useMemo, useState } from "react";
import type { ServerCatalogEntry } from "@/lib/server-catalog";

function searchable(value: string) {
  return value.toLocaleLowerCase("ru-RU").replaceAll("ё", "е");
}

export function ModCatalog({ entries }: { entries: ServerCatalogEntry[] }) {
  const [query, setQuery] = useState("");
  const normalizedQuery = searchable(query.trim());
  const filtered = useMemo(
    () => entries.filter((entry) => searchable(`${entry.name} ${entry.description}`).includes(normalizedQuery)),
    [entries, normalizedQuery],
  );

  return (
    <section className="mod-catalog" aria-labelledby="mod-catalog-title">
      <div className="mod-catalog-search">
        <label htmlFor="mod-search" id="mod-catalog-title">ПОИСК ПО СБОРКЕ</label>
        <div>
          <input
            id="mod-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Название или функция мода"
            autoComplete="off"
          />
          {query ? <button type="button" onClick={() => setQuery("")} aria-label="Очистить поиск">×</button> : <span aria-hidden="true">⌕</span>}
        </div>
        <p>ПОКАЗАНО: <b>{filtered.length}</b> ИЗ {entries.length}</p>
      </div>

      <ol className="mod-catalog-grid">
        {filtered.map((entry) => (
          <li key={entry.name}>
            <span>{String(entries.indexOf(entry) + 1).padStart(2, "0")}</span>
            <div>
              <h2>{entry.name}</h2>
              <p>{entry.description}</p>
              {entry.url ? <a href={entry.url} target="_blank" rel="noreferrer">СТРАНИЦА МОДА ↗</a> : null}
            </div>
          </li>
        ))}
      </ol>

      {!filtered.length ? (
        <div className="mod-catalog-empty">
          <strong>НИЧЕГО НЕ НАЙДЕНО</strong>
          <p>Попробуй другое название или опиши функцию мода.</p>
          <button type="button" onClick={() => setQuery("")}>ПОКАЗАТЬ ВЕСЬ СПИСОК</button>
        </div>
      ) : null}
    </section>
  );
}
