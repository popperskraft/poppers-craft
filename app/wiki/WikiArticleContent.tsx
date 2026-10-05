/* eslint-disable @next/next/no-img-element */
import type { CSSProperties } from "react";
import type { WikiArticleBlock } from "@/lib/wiki-content";

function blockStyle(block: WikiArticleBlock): CSSProperties {
  return { color: block.color };
}

function blockClass(block: WikiArticleBlock) {
  return `wiki-article-block wiki-article-block-${block.type} wiki-font-${block.font}`;
}

export function WikiArticleContent({ blocks, emptyText = "В статье пока нет содержимого." }: { blocks: WikiArticleBlock[]; emptyText?: string }) {
  if (!blocks.length) return <p className="wiki-article-empty">{emptyText}</p>;
  return (
    <div className="wiki-article-content">
      {blocks.map((block) => {
        const common = { className: blockClass(block), style: blockStyle(block) };
        if (block.type === "heading") {
          return block.level === 3
            ? <h3 key={block.id} id={`section-${block.id}`} translate="no" {...common}>{block.text || "Заголовок"}</h3>
            : <h2 key={block.id} id={`section-${block.id}`} translate="no" {...common}>{block.text || "Заголовок"}</h2>;
        }
        if (block.type === "paragraph") return <p key={block.id} translate="no" {...common}>{block.text}</p>;
        if (block.type === "quote") return <blockquote key={block.id} translate="no" {...common}>{block.text}</blockquote>;
        if (block.type === "notice") return <aside key={block.id} {...common}><strong>ВАЖНО</strong><span translate="no">{block.text}</span></aside>;
        if (block.type === "code") return <pre key={block.id} translate="no" {...common}><code>{block.text}</code></pre>;
        if (block.type === "divider") return <hr key={block.id} {...common} />;
        if (block.type === "list") {
          const items = block.text.split("\n").map((item) => item.trim().replace(/^[-*•]\s*/, "")).filter(Boolean);
          const List = block.listStyle === "number" ? "ol" : "ul";
          return <List key={block.id} translate="no" {...common}>{items.map((item, index) => <li key={`${block.id}-${index}`}>{item}</li>)}</List>;
        }
        return (
          <figure key={block.id} {...common}>
            {block.imageUrl
              ? <img src={block.imageUrl} alt={block.alt || block.caption || "Скриншот из статьи"} />
              : <div className="wiki-image-placeholder">СКРИНШОТ НЕ ЗАГРУЖЕН</div>}
            {block.caption ? <figcaption translate="no">{block.caption}</figcaption> : null}
          </figure>
        );
      })}
    </div>
  );
}
