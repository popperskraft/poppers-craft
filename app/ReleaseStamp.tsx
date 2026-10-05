/* Отметка версии сайта в подвале, справа от подписи авторства.

   В обычном состоянии видно только слово «Version». Полное имя релиза
   раскрывается при наведении мыши и при фокусе с клавиатуры. Фокус нужен
   ещё и для телефонов, где наведения нет и подсказка открывается касанием.

   Значение приходит из переменной окружения NEXT_PUBLIC_RELEASE_ID, которую
   задаёт скрипт запуска на сервере. Строка совпадает с именем каталога релиза
   в /home/stepan/popperscraft/runtimes, поэтому по странице всегда видно,
   какая именно сборка сейчас обслуживает сайт.

   Формат каталога: ГГГГММДД-ЧЧММСС-rНОМЕР-описание */

export function ReleaseStamp() {
  const releaseId = process.env.NEXT_PUBLIC_RELEASE_ID?.trim();

  if (!releaseId) {
    return null;
  }

  const numberMatch = releaseId.match(/-r(\d+)(?:-|$)/i);
  const releaseNumber = numberMatch ? numberMatch[1] : null;

  return (
    <span className="release-stamp">
      <button className="release-stamp-trigger" type="button" aria-describedby="release-stamp-value">
        Version
      </button>
      <span className="release-stamp-value" id="release-stamp-value" role="tooltip">
        {releaseNumber ? <b>РЕЛИЗ {releaseNumber}</b> : null}
        <span>{releaseId}</span>
      </span>
    </span>
  );
}
