import { randomBytes, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { CAPTCHA_COOKIE, signCaptcha } from "@/lib/captcha";
import { resolveMinecraftIcon } from "@/lib/minecraft-icons";
import type { MinecraftIconName } from "@/app/MinecraftIcon";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const blocks: Array<{ id: string; label: string; icon: MinecraftIconName }> = [
  { id: "diamond", label: "алмаз", icon: "diamond" },
  { id: "crafting_table", label: "верстак", icon: "crafting_table" },
  { id: "chest", label: "сундук", icon: "chest" },
  { id: "redstone", label: "редстоун", icon: "redstone" },
  { id: "record", label: "пластинку", icon: "record" },
  { id: "totem", label: "тотем", icon: "totem" },
  { id: "apple", label: "яблоко", icon: "apple" },
  { id: "cake", label: "торт", icon: "cake" },
  { id: "clock", label: "часы", icon: "clock" },
  { id: "compass", label: "компас", icon: "compass" },
  { id: "furnace", label: "печку", icon: "furnace" },
  { id: "bone", label: "кость", icon: "bone" },
];

/* Лаунчер (0.2.16 и старше) рисует картинку сам по названию предмета и знает
   только эти шесть. API лаунчера спрашивает капчу с общим ключом
   X-PoppersCraft-Browser-Key — ему отвечаем с названиями, иначе вход в
   лаунчере по логину и паролю падает. Браузеру названия не отдаём. */
const launcherBlocks: Array<{ id: string; label: string; icon: MinecraftIconName }> = [
  { id: "diamond", label: "алмаз", icon: "diamond" },
  { id: "grass", label: "блок травы", icon: "grass" },
  { id: "chest", label: "сундук", icon: "chest" },
  { id: "redstone", label: "редстоун", icon: "redstone" },
  { id: "record", label: "пластинку", icon: "record" },
  { id: "totem", label: "тотем", icon: "totem" },
];

function fromLauncherApi(request: Request) {
  const expected = Buffer.from(process.env.POPPERSCRAFT_BROWSER_SECRET ?? "");
  const supplied = Buffer.from(request.headers.get("x-popperscraft-browser-key") ?? "");
  return expected.length >= 32 && supplied.length === expected.length && timingSafeEqual(expected, supplied);
}

/* Ответ не выдаёт, что нарисовано: ни названия предмета, ни имени файла.
   Картинка приходит по адресу /api/auth/captcha/image?o=<id варианта>, а
   расшифровать этот идентификатор можно только по куке. */
export async function GET(request: Request) {
  const forLauncher = fromLauncherApi(request);
  const shuffled = [...(forLauncher ? launcherBlocks : blocks)].sort(() => Math.random() - 0.5).slice(0, 4);
  const target = shuffled[Math.floor(Math.random() * shuffled.length)];
  const options = shuffled.map((block, index) => ({
    id: randomBytes(18).toString("base64url"),
    label: `вариант ${index + 1}`,
    icon: block.icon,
    blockId: block.id,
  }));
  const expectedAnswer = options.find((option) => option.blockId === target.id)?.id ?? "";
  const icons = Object.fromEntries(
    options.map((option) => [option.id, resolveMinecraftIcon(option.icon)]),
  );
  const response = NextResponse.json({
    prompt: `Нажми на ${target.label}`,
    options: options.map((option) =>
      forLauncher ? { id: option.id, label: option.label, icon: option.icon } : { id: option.id, label: option.label },
    ),
  });
  response.cookies.set(CAPTCHA_COOKIE, signCaptcha(expectedAnswer, icons), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 300,
    path: "/",
  });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
