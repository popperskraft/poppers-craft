import type { Metadata } from "next";
import Link from "next/link";
import { BackButton } from "@/app/BackButton";
import { MinecraftIcon } from "@/app/MinecraftIcon";
import { serverCatalog } from "@/lib/server-catalog";
import { ModCatalog } from "./ModCatalog";

export const metadata: Metadata = {
  title: "Моды и плагины PoppersCraft",
  description: "Полный список модов и серверных компонентов сборки PoppersCraft с краткими описаниями.",
};

/* «82 компонента», «85 компонентов», «81 компонент». */
function componentsWord(count: number) {
  const tail = count % 100 >= 11 && count % 100 <= 14 ? 0 : count % 10;
  return tail === 1 ? "компонент" : tail >= 2 && tail <= 4 ? "компонента" : "компонентов";
}

export default function ModsPage() {
  const word = componentsWord(serverCatalog.length);
  return (
    <main className="wiki-page wiki-mods-page">
      <article className="paint-window wiki-window wiki-mods-window">
        <div className="window-bar">
          <span className="window-title-with-icon"><MinecraftIcon name="redstone" size="sm" /> server_build_catalog.exe</span>
          <BackButton fallback="/wiki" />
          <Link href="/wiki" aria-label="Закрыть список и вернуться в Wiki">×</Link>
        </div>

        <header className="wiki-mods-hero">
          <div>
            <p>POPPERSCRAFT / ТЕКУЩАЯ СБОРКА</p>
            <h1>МОДЫ<br />И ПЛАГИНЫ</h1>
            <p>Полный каталог компонентов сервера: от новых биомов и декора до интерфейса, голосового чата и оптимизации.</p>
          </div>
          <div className="wiki-mods-counter" aria-label={`${serverCatalog.length} ${word}`}>
            <strong>{serverCatalog.length}</strong>
            <span>{word.toUpperCase()}</span>
          </div>
        </header>

        <div className="wiki-mods-note">
          <MinecraftIcon name="book" size="sm" />
          <p>Поиск работает одновременно по названию и описанию. Ссылки на Modrinth добавлены только для позиций, где они были указаны в исходном списке.</p>
        </div>

        <ModCatalog entries={serverCatalog} />

        <footer className="wiki-footer"><Link href="/wiki">← НАЗАД В WIKI</Link><a href="#mod-catalog-title">К ПОИСКУ ↑</a></footer>
      </article>
    </main>
  );
}
