import { redirect } from "next/navigation";
import Link from "next/link";
import { getApprovedMember, getViewerIdentity } from "@/lib/waitlist";
import { hasServerAccess } from "@/lib/payments";
import { loginPageUrl } from "@/lib/login-return";
import { SUPPORT_BOT_URL } from "@/lib/viewer-stage";
import { MinecraftIcon } from "@/app/MinecraftIcon";
import { WindowCloseLink } from "@/app/WindowCloseLink";
import { BackButton } from "@/app/BackButton";

export const dynamic = "force-dynamic";

export default async function MembersPage() {
  const member = await getApprovedMember();
  if (!member) {
    /* Гостю — вход с возвратом сюда. Вошедшему без одобренной анкеты окно
       входа не поможет: администратора ведём в управление, остальных —
       на главную. */
    const identity = await getViewerIdentity();
    if (!identity) redirect(loginPageUrl("/members"));
    if (identity.needsMfa) redirect("/mfa?next=/members");
    redirect(identity.adminProfile ? "/admin" : "/");
  }
  const serverAccess = await hasServerAccess(member.userId);

  return (
    <main className="member-page">
      <div className="member-desktop">
        <div className="paint-window member-window">
          <div className="window-bar">
            <span className="window-title-with-icon"><MinecraftIcon name="key" size="sm" /> popperscraft_access.exe</span>
            <BackButton />
            <div className="window-actions"><i aria-hidden="true">_</i><i aria-hidden="true">□</i><WindowCloseLink /></div>
          </div>
          <div className="member-content">
            <span className="member-approved">{serverAccess ? "ДОСТУП ОДОБРЕН ✓" : "АНКЕТА ОДОБРЕНА ✓"}</span>
            {serverAccess ? null : (
              <p style={{ padding: "10px 12px", border: "3px solid #000", background: "#fff2a6" }}>
                Остался последний шаг — пропуск POPPERSCRAFT, 499 ₽ один раз. <Link href="/donation?plan=pass">Оплатить →</Link>
              </p>
            )}
            <p>Добро пожаловать,</p>
            <h1>@{member.login}</h1>
            {/* Заходят теперь через свой лаунчер: он ставит игру и подключается
                сам, поэтому адрес сервера ушёл на второй план. */}
            {serverAccess ? (
              <div className="member-launcher">
                <div>
                  <b>ЛАУНЧЕР POPPERSCRAFT</b>
                  <p>Скачайте лаунчер — он поставит игру со всем нужным и сам подключит к серверу. Вход по кнопке «Войти через сайт»: ник подставится из анкеты, пароль вводить не нужно.</p>
                </div>
                <Link className="member-launcher-button" href="/launcher">СКАЧАТЬ ЛАУНЧЕР →</Link>
                <p className="member-launcher-phone">Лаунчер ставится на компьютер — откройте сайт с компьютера, чтобы его скачать.</p>
              </div>
            ) : null}
            <div className="member-steps">
              <div><b>01</b><p>Скачайте лаунчер и установите его.</p></div>
              <div><b>02</b><p>В лаунчере нажмите «Войти через сайт».</p></div>
              {/* Правила живут на сайте, а не в Discord (приглашения туда пока нет). */}
              <div><b>03</b><p>Нажмите «Играть» — и загляните в <Link href="/rules">правила</Link>.</p></div>
            </div>
            {/* Блок «IP сервера» убран (2026-10-02): без лаунчера POPPERSCRAFT
                на сервер не зайти, адрес только сбивал с толку. */}
            <div className="member-actions">
              {/* Главная, профиль и лаунчер — в шапке и выше на странице; здесь
                  только то, чего там нет. */}
              <Link href="/rules">ПРАВИЛА →</Link>
              {/* Ведёт в бота поддержки, а не в канал (r100, просьба владельца). */}
              <a href={SUPPORT_BOT_URL} target="_blank" rel="noreferrer">TELEGRAM ↗</a>
            </div>
          </div>
          {/* Раньше здесь стоял текст «о себе» из анкеты целиком. */}
          <div className="status-bar"><span>Пользователь: @{member.login}</span><span>{serverAccess ? "ACCESS_OK" : "PASS_REQUIRED"}</span></div>
        </div>
      </div>
    </main>
  );
}
