import { redirect } from "next/navigation";
import { getApprovedMember, getViewerIdentity } from "@/lib/waitlist";
import { LauncherAuthorizeClient } from "./LauncherAuthorizeClient";
import { LauncherConfirm } from "./LauncherConfirm";
import { approveLauncher, validLauncherToken as validToken } from "@/lib/launcher-authorize";
import styles from "./authorize.module.css";

export const dynamic = "force-dynamic";

type Search = Promise<{ request?: string; code?: string }>;

export default async function LauncherAuthorizePage({ searchParams }: { searchParams: Search }) {
  const { request = "", code = "" } = await searchParams;
  const returnTo = `/launcher/authorize?${new URLSearchParams({ request, code })}`;
  if (!validToken(request) || !validToken(code)) {
    return <Result title="ССЫЛКА НЕДЕЙСТВИТЕЛЬНА" text="Вернитесь в лаунчер и нажмите «Войти через сайт» ещё раз." />;
  }

  const [viewer, member] = await Promise.all([getViewerIdentity(), getApprovedMember()]);
  if (!viewer) return <LauncherAuthorizeClient returnTo={returnTo} />;
  /* Вход без кода 2FA — сначала код, потом сюда же. */
  if (viewer.needsMfa) redirect(`/mfa?next=${encodeURIComponent(returnTo)}`);

  if (!member) {
    /* Отказ передаём сразу — он ничего не открывает. */
    await approveLauncher({ requestId: request, approvalToken: code, approved: false });
    return <Result title="ДОСТУП НЕ ВЫДАН" text="Ваша заявка ещё не одобрена администрацией PoppersCraft." />;
  }
  /* Разрешение — только по нажатию кнопки (app/api/launcher/authorize). */
  return <LauncherConfirm request={request} code={code} login={member.login} />;
}

function Result({ title, text, success = false }: { title: string; text: string; success?: boolean }) {
  return (
    <main className={styles.desktop}>
      <section className={`paint-window ${styles.window}`}>
        <div className="window-bar"><span>launcher_authorize.exe</span></div>
        <div className={styles.body}>
          <span className={styles.eyebrow}>{success ? "ACCESS_OK" : "ACCESS_ERROR"}</span>
          <h1>{title}</h1>
          <p>{text}</p>
        </div>
      </section>
    </main>
  );
}

