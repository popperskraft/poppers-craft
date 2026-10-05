# PoppersCraft — сайт

Сайт приватного Minecraft-сервера [PoppersCraft](https://popperscraft.org): анкеты в вайтлист, профили игроков со скинами и пони, лента, Wiki, оплата пропуска и подписки, вход в лаунчер через сайт.

## Стек

- Next.js 16 (App Router), React 19, TypeScript
- Supabase: Postgres с RLS, Auth, Storage (`supabase/migrations`)
- Оплата: ЮKassa (российские карты), lava.top (зарубежные)
- Почта — Brevo, помощник Poppers — Gemini, поддержка — Telegram-бот

## Запуск

```bash
pnpm install
cp .env.example .env.local   # заполнить своими значениями
pnpm dev
```

Тесты:

```bash
node --test tests/*.test.cjs
```

Продакшен-сборка: `node node_modules/next/dist/bin/next build --webpack`.

## Лицензия

Код открыт только для просмотра — см. [LICENSE](LICENSE).

## Безопасность

Нашли уязвимость — напишите в [Telegram-бот поддержки](https://t.me/PoppersCraftAuthBot) или на popperskraft@gmail.com, не публикуя детали в issues.

> В миграциях личные почты владельцев заменены на owner@example.invalid.
