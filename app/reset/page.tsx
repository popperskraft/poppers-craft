import Link from "next/link";
import { loginPageUrl } from "@/lib/login-return";
import { MinecraftIcon } from "@/app/MinecraftIcon";
import { WindowCloseLink } from "@/app/WindowCloseLink";
import { ResetForm } from "./ResetForm";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Новый пароль — PoppersCraft",
  robots: { index: false, follow: false },
};

export default async function ResetPage({
  searchParams,
}: {
  searchParams: Promise<{ u?: string; t?: string }>;
}) {
  const params = await searchParams;
  const userId = String(params.u ?? "");
  const token = String(params.t ?? "");
  /* Сам токен здесь не проверяем: ответ «ссылка верна» до ввода пароля
     подсказал бы подбирающему, что он угадал. Проверка — в /api. */
  const usable = Boolean(userId && token);

  return (
    <main className="profile-page">
      <div className="paint-window profile-window mfa-window">
        <div className="window-bar">
          <span className="window-title-with-icon"><MinecraftIcon name="key" size="sm" /> new_password.exe</span>
          <div className="window-actions"><WindowCloseLink label="Закрыть окно и вернуться на главную" /></div>
        </div>
        <div className="profile-content">
          <h1>НОВЫЙ ПАРОЛЬ</h1>
          {usable ? (
            <>
              <p>Придумайте новый пароль для входа на сайт. Не короче 8 символов.</p>
              <ResetForm userId={userId} token={token} />
            </>
          ) : (
            <>
              <p>Ссылка неполная. Откройте её из письма целиком или запросите новое письмо в окне входа.</p>
              <Link className="profile-primary-action" href={loginPageUrl()}>К ВХОДУ →</Link>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
