import { MinecraftIcon } from "../MinecraftIcon";
import { BackButton } from "@/app/BackButton";

export const metadata = {
  title: "Файлы cookie — PoppersCraft",
  description: "Какие файлы cookie использует платформа PoppersCraft и зачем они нужны.",
};

export default function CookiesPage() {
  return (
    <main className="cookies-info-page">
      <article className="paint-window cookies-info-window">
        <div className="window-bar">
          <span><MinecraftIcon name="cookie" size="sm" /> COOKIE_INFO.TXT</span>
          <BackButton />
        </div>
        <div className="cookies-info-content">
          <small>PRIVACY / TECHNICAL DATA</small>
          <h1>ФАЙЛЫ<br />COOKIE</h1>
          <p>
            Мы используем только технические cookie. Они сохраняют вход и помогают защищать аккаунт.
          </p>

          <section>
            <h2>ЧТО МЫ ХРАНИМ</h2>
            <ul>
              <li><strong>Сессия Supabase:</strong> хранит вход в аккаунт.</li>
              <li><strong>Проверка Telegram:</strong> нужна во время входа через Telegram.</li>
              <li><strong>Согласие:</strong> запоминает, что вы уже закрыли окно про cookie.</li>
            </ul>
          </section>

          <section>
            <h2>ЧЕГО СЕЙЧАС НЕТ</h2>
            <p>Рекламных cookie и Яндекс Метрики сейчас нет.</p>
          </section>

          <section>
            <h2>СРОК ХРАНЕНИЯ</h2>
            <p>
              Сессия обновляется при входе и удаляется при выходе. Проверка Telegram действует
              до пяти минут. Согласие хранится до года.
            </p>
          </section>

          <section>
            <h2>КАК УДАЛИТЬ</h2>
            <p>
              Cookie можно удалить в настройках браузера. После этого придётся войти заново,
              а окно с согласием появится ещё раз.
            </p>
          </section>

        </div>
        <div className="status-bar"><span>NECESSARY_COOKIES_ONLY</span><span>UTF-8</span></div>
      </article>
    </main>
  );
}
