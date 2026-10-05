import Link from "next/link";
import { MinecraftIcon } from "@/app/MinecraftIcon";
import { WindowCloseLink } from "@/app/WindowCloseLink";
import { ConfirmButton } from "./ConfirmButton";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Подтверждение почты — PoppersCraft",
  robots: { index: false, follow: false },
};

export default async function MailConfirmPage({
  searchParams,
}: {
  searchParams: Promise<{ k?: string; u?: string; t?: string }>;
}) {
  const params = await searchParams;
  const kind = params.k === "change" ? "change" : params.k === "mfa" ? "mfa" : "verify";
  const userId = String(params.u ?? "");
  const token = String(params.t ?? "");
  const usable = Boolean(userId && token);

  return (
    <main className="profile-page">
      <div className="paint-window profile-window mfa-window">
        <div className="window-bar">
          <span className="window-title-with-icon"><MinecraftIcon name="writable_book" size="sm" /> email_confirm.exe</span>
          <div className="window-actions"><WindowCloseLink label="Закрыть окно и вернуться на главную" /></div>
        </div>
        <div className="profile-content">
          <h1>{kind === "mfa" ? "ОТКЛЮЧЕНИЕ 2FA" : "ПОДТВЕРЖДЕНИЕ ПОЧТЫ"}</h1>
          {usable ? (
            <>
              <p>
                {kind === "change"
                  ? "Нажмите кнопку, чтобы этот адрес стал почтой аккаунта."
                  : kind === "mfa"
                    ? "Нажмите кнопку, чтобы отключить двухфакторный вход. Если вы не просили об этом — закройте страницу и смените пароль."
                    : "Нажмите кнопку, чтобы подтвердить, что этот ящик ваш."}
              </p>
              <ConfirmButton kind={kind} userId={userId} token={token} />
            </>
          ) : (
            <>
              <p>Ссылка неполная. Откройте её из письма целиком или запросите новое письмо в «Профиль → Настройки → Аккаунт и почта».</p>
              <Link className="profile-primary-action" href="/profile?tab=settings&section=account">В НАСТРОЙКИ →</Link>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
