import type { Metadata } from "next";
import Link from "next/link";
import { BackButton } from "@/app/BackButton";
import { MinecraftIcon, type MinecraftIconName } from "@/app/MinecraftIcon";
import "./metro.css";

export const metadata: Metadata = {
  title: "PoppersMetro — подробный гайд | Wiki PoppersCraft",
  description: "Подробный гайд для пассажиров и владельцев станций: поездки, строительство, рельсы и управление метро PoppersCraft.",
};

const navigation = [
  ["passenger", "01 / ПОЕЗДКА"],
  ["station", "02 / СВОЯ СТАНЦИЯ"],
  ["rails", "03 / РЕЛЬСЫ"],
  ["manage", "04 / УПРАВЛЕНИЕ"],
  ["fare", "05 / ОПЛАТА"],
  ["commands", "06 / КОМАНДЫ"],
] as const;

function Step({ number, title, children }: { number: string; title: string; children: React.ReactNode }) {
  return (
    <article className="metro-wiki-step">
      <span>{number}</span>
      <h3>{title}</h3>
      <p>{children}</p>
    </article>
  );
}

function SectionHeader({ number, title, icon }: { number: string; title: string; icon: MinecraftIconName }) {
  return (
    <header className="metro-wiki-section-heading">
      <MinecraftIcon name={icon} size="md" />
      <div><span>{number}</span><h2>{title}</h2></div>
    </header>
  );
}

export default function MetroWikiPage() {
  return (
    <main className="wiki-page metro-wiki-page" id="top">
      <article className="paint-window wiki-window metro-wiki-window">
        <div className="window-bar">
          <span className="window-title-with-icon"><MinecraftIcon name="rail" size="sm" /> poppersmetro.wiki</span>
          <BackButton fallback="/wiki" />
          <Link href="/wiki" aria-label="Закрыть гайд и вернуться в Wiki">×</Link>
        </div>

        <header className="metro-wiki-hero">
          <div className="metro-wiki-hero-copy">
            <div className="metro-wiki-badge">POPPERSMETRO</div>
            <h1>МЕТРО<br /><em>БЕЗ ЛИШНИХ КОМАНД</em></h1>
            <p>Подробный гайд для пассажиров и владельцев станций</p>
            <div className="metro-wiki-hero-actions">
              <a href="#passenger">НАЧАТЬ С ПОЕЗДКИ ↓</a>
              <Link href="/wiki">ВСЯ WIKI</Link>
            </div>
          </div>
          <div className="metro-wiki-sign" aria-label="Знак станции метро">
            <span className="metro-wiki-sign-m">M</span>
            <b>СТАНЦИЯ</b>
            <i />
            <small>POPPERSCRAFT</small>
          </div>
        </header>

        <nav className="metro-wiki-index" aria-label="Разделы гайда">
          {navigation.map(([id, label]) => <a key={id} href={`#${id}`}>{label}</a>)}
        </nav>

        <section className="metro-wiki-flow" aria-labelledby="metro-flow-title">
          <div className="metro-wiki-kicker" id="metro-flow-title">САМЫЙ КОРОТКИЙ МАРШРУТ</div>
          <div className="metro-wiki-step-grid">
            <Step number="01" title="Найди кнопку">У станции нажми кнопку рядом с алмазным ядром. Она вызовет служебную вагонетку.</Step>
            <Step number="02" title="Сядь в вагонетку">Зайди в вагонетку и не выходи из неё, пока выбираешь маршрут.</Step>
            <Step number="03" title="Открой «М»">Нажми M → «Поехать», выбери станцию, проверь цену на экране и подтверди поездку. Стандартный тариф — 10 попперсов.</Step>
          </div>
        </section>

        <section className="metro-wiki-section" id="passenger">
          <SectionHeader number="01 / ПОЕЗДКА" title="Как доехать до станции" icon="compass" />
          <div className="metro-wiki-columns">
            <div>
              <p className="metro-wiki-lead">Пассажиру не нужно знать команды. Нужны только станционная кнопка, вагонетка и клавиша <kbd>M</kbd>.</p>
              <ol className="metro-wiki-steps-list">
                <li><b>Вызови вагонетку.</b> Нажми кнопку у алмазного блока станции. Если вагонетка уже занята или станция повреждена, игра покажет причину в чате.</li>
                <li><b>Сядь.</b> Открой меню клавишей <kbd>M</kbd>. В разделе «Поехать» будет список станций и подсказка, откуда начинается маршрут.</li>
                <li><b>Выбери пункт назначения.</b> Недоступные станции отмечаются отдельно; выбрать саму станцию отправления нельзя.</li>
                <li><b>Подтверди.</b> Перед запуском появятся расстояние, примерное время и итоговая цена. Подтверждение действует 30 секунд.</li>
              </ol>
            </div>
            <aside className="metro-wiki-card metro-wiki-card-dark">
              <span>МЕНЮ «М»</span>
              <h3>Что где находится</h3>
              <ul>
                <li><b>Поехать</b> — выбрать направление.</li>
                <li><b>Станции</b> — адреса, владельцы и описания.</li>
                <li><b>Моя станция</b> — управление своим ядром.</li>
                <li><b>Создать станцию</b> — пошаговый мастер.</li>
                <li><b>Мини-гайд</b> — короткая памятка внутри игры.</li>
                <li><b>Линии метро</b> — названия и цвета веток.</li>
              </ul>
            </aside>
          </div>
        </section>

        <section className="metro-wiki-section metro-wiki-section-sand" id="station">
          <SectionHeader number="02 / СВОЯ СТАНЦИЯ" title="Создание через мастер" icon="diamond" />
          <p className="metro-wiki-lead">Станция принадлежит игроку и защищается вместе с его приватом PoppersClaims. Команды для обычного создания не нужны.</p>
          <div className="metro-wiki-builder-grid">
            <ol className="metro-wiki-steps-list metro-wiki-steps-list-numbered">
              <li><b>Подготовь место.</b> Создай собственный приват PoppersClaims в основном мире. Обычный игрок может зарегистрировать станцию только внутри своего региона.</li>
              <li><b>Положи рельсы.</b> Сделай две параллельные колеи встречных направлений. Для простой схемы оставь между ними один пустой блок.</li>
              <li><b>Поставь ядро.</b> Размести <strong className="metro-wiki-diamond">алмазный блок</strong> не дальше 3 блоков от рельсов. Кнопка должна быть не дальше 2 блоков от ядра.</li>
              <li><b>Ударь пустой рукой.</b> Удар по <strong className="metro-wiki-diamond">алмазному блоку</strong> откроет вопрос «Хотите создать здесь станцию метро?» Нажми «Да».</li>
              <li><b>Заполни два поля.</b> Введи название (до 48 символов) и, если хочешь, описание для пассажиров (до 120 символов). Нажми «Создать станцию».</li>
            </ol>
            <aside className="metro-wiki-checklist">
              <h3>Проверка перед созданием</h3>
              <p><span>✓</span> основной мир (Overworld)</p>
              <p><span>✓</span> собственный приват</p>
              <p><span>✓</span> две параллельные колеи</p>
              <p><span>✓</span> <strong className="metro-wiki-diamond">алмазный блок</strong> рядом</p>
              <p><span>✓</span> кнопка рядом с ядром</p>
              <p><span>✓</span> пустая рука</p>
            </aside>
          </div>
          <div className="metro-wiki-callout"><b>Станция создалась, но показывает предупреждение?</b> Это нормально: мастер может сохранить станцию до достройки рельсов или кнопки. В меню «Моя станция» будут подсказки о том, что нужно исправить.</div>
        </section>

        <section className="metro-wiki-section" id="rails">
          <SectionHeader number="03 / РЕЛЬСЫ" title="Как строится маршрут" icon="rail" />
          <div className="metro-wiki-columns">
            <div>
              <p className="metro-wiki-lead">Плагин сам проверяет непрерывную сеть от одной пары рельсов до другой и выбирает правую колею по направлению движения.</p>
              <ul className="metro-wiki-bullet-list">
                <li>Разрешены прямые участки, повороты, подъёмы и спуски.</li>
                <li>Две колеи у станции нужны для двух встречных направлений.</li>
                <li>На сложном пересечении стрелка использует золотой блок под центральной рельсой.</li>
                <li>Нажатие кнопки у ядра вызывает вагонетку; пассажир не должен вручную ставить её.</li>
              </ul>
            </div>
            <div className="metro-wiki-rail-map" aria-label="Схема линии метро">
              <div className="metro-wiki-rail-map-label">ЛИНИЯ A / ПРАВАЯ КОЛЕЯ</div>
              <div className="metro-wiki-rail-track"><i /><i /><i /><i /><i /></div>
              <div className="metro-wiki-rail-stations"><b>Ядро</b><b>Поворот</b><b>Развилка</b><b>Станция</b></div>
              <small>Непрерывный путь проверяется перед оплатой.</small>
            </div>
          </div>
          <div className="metro-wiki-trouble">
            <h3>Если путь не найден</h3>
            <p>Осмотри разрыв между координатами из сообщения: обычно проблема в пропущенной рельсе, неправильном направлении поворота, пересечении на другой высоте или второй колее у станции. После ремонта вызови новую вагонетку и повтори выбор.</p>
          </div>
        </section>

        <section className="metro-wiki-section metro-wiki-section-sand" id="manage">
          <SectionHeader number="04 / УПРАВЛЕНИЕ" title="Название, описание и права" icon="chest" />
          <div className="metro-wiki-management-grid">
            <article><span>ВЛАДЕЛЕЦ</span><h3>Полный доступ</h3><p>Может изменить название и описание, назначить управляющего, убрать управляющего или удалить станцию после подтверждения.</p></article>
            <article><span>УПРАВЛЯЮЩИЙ</span><h3>Ежедневные правки</h3><p>Может менять название и описание станции, но не может удалить её или менять список управляющих.</p></article>
            <article><span>ПАССАЖИР</span><h3>Только просмотр</h3><p>В разделе «Станции» видит название, координаты ядра, владельца, описание и доступность маршрута.</p></article>
          </div>
          <p className="metro-wiki-management-tip"><b>Как открыть управление:</b> подойди к алмазному ядру своей станции и открой «М» → «Моя станция». После ошибки сохранения введённые поля остаются на месте — исправь их и нажми кнопку ещё раз.</p>
        </section>

        <section className="metro-wiki-section metro-wiki-fare-section" id="fare">
          <SectionHeader number="05 / ОПЛАТА" title="Стандартный билет — 10 попперсов" icon="diamond" />
          <div className="metro-wiki-fare-hero"><strong>10</strong><span>ПОППЕРСОВ<br />ЗА ПОЕЗДКУ</span></div>
          <div className="metro-wiki-fare-columns">
            <div><p className="metro-wiki-lead">Цена показывается в меню перед подтверждением и списывается только после повторной проверки маршрута. Если баланс меньше стоимости, поездка не начнётся.</p><ul className="metro-wiki-bullet-list"><li>Если рельса повреждена до старта, деньги не списываются.</li><li>Если во время поездки обнаружен разрыв рельсов, исчезла вагонетка или сервер штатно останавливается, предусмотрен автоматический возврат.</li><li>При самостоятельном выходе из вагонетки или отключении от сервера оплата не возвращается.</li></ul></div>
          </div>
        </section>

        <section className="metro-wiki-section" id="commands">
          <SectionHeader number="06 / КОМАНДЫ" title="Когда команды всё-таки нужны" icon="book" />
          <p className="metro-wiki-lead">Для пассажиров и обычного создания станции команды не нужны. Они остаются дополнительным способом управления и инструментом для сложной ручной настройки.</p>
          <div className="metro-wiki-command-grid">
            <div><code>/metro help</code><p>Показать краткую помощь и ссылки-кнопки.</p></div>
            <div><code>/metro ui</code><p>Открыть меню метро из чата.</p></div>
            <div><code>/metro list</code><p>Получить список станций в запасном чат-режиме.</p></div>
            <div><code>/metro go &lt;станция&gt;</code><p>Выбрать направление без меню; подтверждение всё равно появится кнопкой.</p></div>
            <div><code>/metro platform list</code><p>Посмотреть платформы выбранной станции при ручной настройке.</p></div>
            <div><code>/metro route list</code><p>Посмотреть сохранённые маршруты выбранной станции.</p></div>
          </div>
          <div className="metro-wiki-callout metro-wiki-callout-blue"><b>Ручная настройка платформы:</b> она нужна только для нестандартной схемы. Выбери рельсу через Shift+ПКМ пустой рукой, затем используй подсказку плагина для следующего шага.</div>
          <details className="metro-wiki-trouble">
            <summary>Расширенная настройка веток и платформ</summary>
            <p>Это дополнительный режим для строителей. Для обычной автоматической станции он не обязателен. Названия ниже — примеры: подставь свои.</p>
            <ol className="metro-wiki-steps-list">
              <li>Создай ветку: <code>/metro line create green Зелёная</code>. Цвет можно задать словом или как <code>#RRGGBB</code>. Список веток: <code>/metro line list</code>.</li>
              <li>Если станция принадлежит другому игроку, владелец ветки сначала выдаёт приглашение: <code>/metro line invite Зелёная Центральная</code>. Название ветки с пробелами заключай в двойные кавычки.</li>
              <li>Управляющий станцией выбирает рельсу через Shift+ПКМ пустой рукой и выполняет <code>/metro platform add Зелёная</code>. Рельса должна находиться в том же привате, что и станция.</li>
              <li>Затем выбери кнопку через Shift+ПКМ и введи <code>/metro platform button</code> — она привяжется к выбранной платформе.</li>
              <li>Подготовь платформу той же ветки на станции назначения. Выбери исходную платформу и выполни <code>/metro route create Центральная</code>. Команда проверит рельсы и сохранит направленный маршрут; обратное направление настраивается отдельно.</li>
            </ol>
          </details>
        </section>

        <section className="metro-wiki-section metro-wiki-section-faq" id="faq">
          <SectionHeader number="FAQ" title="Частые вопросы" icon="knowledge_book" />
          <div className="metro-wiki-faq-grid">
            <details open><summary>Почему кнопка «Поехать» неактивна?</summary><p>Игрок не сидит в служебной вагонетке, станция отправления не определена, выбранная станция недоступна или это та же станция.</p></details>
            <details><summary>Что делать, если моя станция не в списке?</summary><p>Проверь, что сервер сохранил создание, ядро осталось на месте и твой клиент подключён к тому же серверу. Нажми M ещё раз для обновления данных.</p></details>
            <details><summary>Что увидят пассажиры?</summary><p>Название, описание, координаты ядра, владельца и статус доступности. Описание можно изменить в «Моя станция».</p></details>
          </div>
        </section>

        <div className="metro-wiki-support">
          <a href="https://t.me/PoppersCraftAuthBot" target="_blank" rel="noreferrer">
            <span>Остались вопросы? <strong>Пиши в телеграм!</strong></span>
            <span aria-hidden="true">↗</span>
          </a>
        </div>
        <footer className="wiki-footer"><Link href="/wiki">← НАЗАД В WIKI</Link><a href="#top">НАВЕРХ ↑</a></footer>
      </article>
    </main>
  );
}
