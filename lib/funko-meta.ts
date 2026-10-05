/* Фанкопопы: описание фигурок без серверного кода — его берут и карточка
   игрока в браузере (app/players/FunkoShelf.tsx), и lib/funko.ts. */

export type FunkoFigureId = "step" | "platon" | "tomac";
export const FUNKO_FIGURES: FunkoFigureId[] = ["step", "platon", "tomac"];

/* Чей скин носит фигурка: логин игрока на сервере. */
export const FUNKO_SKIN_LOGIN: Record<FunkoFigureId, string> = { step: "step", platon: "platon", tomac: "tomac" };
export const FUNKO_RARITY: Record<FunkoFigureId, string> = { step: "РЕДКАЯ", platon: "РЕДКАЯ", tomac: "САМАЯ РЕДКАЯ" };

/* Для карточки игрока: только то, что видно всем. */
export type OwnedFunko = { figure: FunkoFigureId; number: number; title: string; awardedAt: string | null };

export const isFunkoFigure = (value: unknown): value is FunkoFigureId =>
  typeof value === "string" && (FUNKO_FIGURES as string[]).includes(value);
