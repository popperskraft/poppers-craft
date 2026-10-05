import { MinecraftIcon } from "./MinecraftIcon";
import type { MinecraftIconName } from "@/lib/minecraft-icons";
import "./join-process.css";

/* Как попасть на сервер — над анкетой в листе ожидания на главной.
   Шаг с оплатой входа показывается всегда (решение владельца, 2026-10-01). */
const STEPS: Array<{ title: string; text: string; icon: MinecraftIconName }> = [
  { title: "АНКЕТА", text: "Заполни анкету ниже: ник, почта, пароль и пара слов о себе.", icon: "writable_book" },
  { title: "ГОЛОСУЮТ ИГРОКИ", text: "Анкету читают игроки сервера: голосуют «за» или «против» и оставляют отзывы.", icon: "book" },
  { title: "РЕШАЕТ АДМИНИСТРАЦИЯ", text: "Администрация смотрит на голоса и принимает решение. Если анкету одобрят, придёт письмо на почту.", icon: "nether_star" },
  { title: "ОПЛАТИ ВХОД", text: "Войди под своим логином и паролем и оплати пропуск — это разовый платёж.", icon: "emerald" },
  { title: "ИГРАЙ", text: "Скачай лаунчер в разделе «Играть» и заходи на сервер.", icon: "grass" },
];

export function JoinProcess() {
  return (
    <div className="join-process">
      <h3>КАК ПОПАСТЬ НА СЕРВЕР</h3>
      <ol>
        {STEPS.map((step, index) => (
          <li key={step.title}>
            <span className="join-process-number">{String(index + 1).padStart(2, "0")}</span>
            <MinecraftIcon name={step.icon} size="md" />
            <strong>{step.title}</strong>
            <p>{step.text}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}
