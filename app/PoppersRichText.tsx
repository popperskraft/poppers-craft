import { Fragment, type ReactNode } from "react";
import { parseInline, parsePoppersText, type InlineNode } from "@/lib/poppers-format";

/* Ответ Попперса с оформлением: заголовки, жирный текст, списки и ссылки
   вместо звёздочек и решёток (lib/poppers-format.ts). Внутри пузыря чата нет
   <p> и <b> — у них свои стили подписи и рамки (globals.css). */
function inline(nodes: InlineNode[]): ReactNode {
  return nodes.map((node, index) => {
    if (node.type === "text") return <Fragment key={index}>{node.text}</Fragment>;
    if (node.type === "code") return <code key={index}>{node.text}</code>;
    if (node.type === "strong") return <strong key={index}>{inline(node.children)}</strong>;
    if (node.type === "em") return <em key={index}>{inline(node.children)}</em>;
    const external = !node.href.startsWith("/");
    return (
      <a key={index} href={node.href} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
        {inline(node.children)}
      </a>
    );
  });
}

export function PoppersRichText({ text }: { text: string }) {
  return (
    <div className="poppers-rich">
      {parsePoppersText(text).map((block, index) => {
        if (block.type === "heading") return <strong className="poppers-md-h" key={index}>{inline(parseInline(block.text))}</strong>;
        if (block.type === "paragraph") return <div className="poppers-md-p" key={index}>{inline(parseInline(block.text))}</div>;
        const items = block.items.map((item, itemIndex) => (
          <li key={itemIndex} value={block.ordered && item.number !== null ? item.number : undefined}>{inline(parseInline(item.text))}</li>
        ));
        return block.ordered ? <ol key={index}>{items}</ol> : <ul key={index}>{items}</ul>;
      })}
    </div>
  );
}
