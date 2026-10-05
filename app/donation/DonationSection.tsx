"use client";

import Image from "next/image";
import Link from "next/link";
import { useLayoutEffect, useRef } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { MinecraftIcon } from "../MinecraftIcon";
import {
  donationTitle,
  hypeAction,
  passAction,
  plusAction,
  type StageAction,
  type ViewerAccess,
  type ViewerStage,
} from "@/lib/viewer-stage";
import "./home-donation.css";

gsap.registerPlugin(ScrollTrigger);

/* Кнопки сцен зависят от того, кто смотрит (lib/viewer-stage.ts):
   PLUS — оформить, продлить или «активен»; пропуск — оплатить или, если
   доступ уже есть, просто отметка для сравнения без покупки. */
type SceneProps = { stage: ViewerStage; access: ViewerAccess | null };

function SceneAction({ action, plus = false }: { action: StageAction; plus?: boolean }) {
  /* Розовый — фирменный цвет PLUS. */
  return <Link className={plus ? "donation-action plus" : "donation-action"} href={action.href}>{action.label}</Link>;
}

function PrefixScene({ stage, access }: SceneProps) {
  return (
    <article className="donation-scene prefix-scene" data-scene="prefix">
      <div className="profile-donation-preview">
        <div className="profile-demo-cover"><MinecraftIcon name="totem" size="lg" /><span><b>КИРПИЧ</b><small>@kirpich.exe</small></span></div>
        <div className="profile-demo-grid">
          <p><small>О СЕБЕ</small>Строю метро. Иногда теряюсь в шахте.</p>
          <p><small>МУЗЫКА</small>Lady Gaga — The Fame</p>
          <p><small>ОФОРМЛЕНИЕ</small>Цвет, значок и фон профиля</p>
        </div>
      </div>
      <div className="donation-copy">
        <span className="donation-rank">ОФОРМЛЕНИЕ ПРОФИЛЯ</span>
        <strong>ДОПОЛНИТЕЛЬНОЕ ОФОРМЛЕНИЕ</strong>
        <ul><li>Пиксельная шапка</li><li>Обводка профиля и значок</li><li>На игру это не влияет</li></ul>
        <SceneAction action={plusAction(stage, access)} plus />
      </div>
    </article>
  );
}

function SupportScene({ stage, access }: SceneProps) {
  const pass = passAction(stage, access);
  return (
    <article className="donation-scene support-scene" data-scene="support">
      <div className="pixel-server support-receipt">
        <h3>НА ЧТО ИДЁТ ПОДДЕРЖКА</h3>
        <div className="support-line"><span>ХОСТИНГ</span><b>60%</b></div>
        <div className="support-line"><span>КАРТА И БЭКАПЫ</span><b>25%</b></div>
        <div className="support-line"><span>ДОМЕН</span><b>15%</b></div>
        <div className="support-meter"><i /></div>
        <p>ЭТИ ДЕНЬГИ ИДУТ НА СЕРВЕР<br />ПРИВИЛЕГИЙ ЗА НИХ НЕТ</p>
      </div>
      <div className="donation-copy">
        <span className="donation-rank">{pass.href ? "ПРОПУСК · 499 ₽ ОДИН РАЗ" : "ПРОПУСК · ДЛЯ СРАВНЕНИЯ"}</span>
        <strong>ОПЛАТА СЕРВЕРА</strong>
        <ul><li>Вход на сервер</li><li>Хостинг, карта, бэкапы</li><li>Без игровых бонусов</li></ul>
        {pass.href
          ? <Link className="donation-action" href={pass.href}>{pass.label}</Link>
          : <span className="donation-action is-owned" role="status">{pass.label}</span>}
      </div>
    </article>
  );
}

/* Пластинки на экране — около 300px, а не 2048: раньше браузер качал
   огромные файлы и только когда до них долистали (loading="lazy"), и каждая
   догрузка пересчитывала закрепление прямо во время прокрутки (r100). */
const RECORD_SIZES = "(max-width: 767px) 45vw, 360px";

/* Пересчёт позиций ScrollTrigger — не посреди прокрутки. Если человек сразу
   после загрузки быстро листает вниз, а в этот момент догрузилась картинка
   или шрифт, refresh() на ходу снимал и заново ставил закрепление, и блок
   доната дёргался. Теперь пересчёт ждёт, пока прокрутка остановится (r100). */
function calmRefresher() {
  let frame = 0;
  let waiting = false;
  const run = () => {
    waiting = false;
    ScrollTrigger.removeEventListener("scrollEnd", run);
    window.cancelAnimationFrame(frame);
    frame = window.requestAnimationFrame(() => ScrollTrigger.refresh());
  };
  const refresh = () => {
    if (ScrollTrigger.isScrolling()) {
      if (!waiting) {
        waiting = true;
        ScrollTrigger.addEventListener("scrollEnd", run);
      }
      return;
    }
    run();
  };
  const stop = () => {
    window.cancelAnimationFrame(frame);
    ScrollTrigger.removeEventListener("scrollEnd", run);
  };
  return { refresh, stop };
}

function RecordStack() {
  return (
    <div className="record-stack" aria-label="Три кастомные пластинки PoppersCraft">
      <Image className="donation-record record-red" src="/donation/record-red.png" width={1024} height={1024} sizes={RECORD_SIZES} loading="eager" alt="Красная пиксельная пластинка" draggable={false} />
      <Image className="donation-record record-gaga" src="/donation/record-gaga.png" width={1024} height={1024} sizes={RECORD_SIZES} loading="eager" alt="Пиксельная пластинка Lady Gaga" draggable={false} />
      <Image className="donation-record record-brat" src="/donation/record-brat.png" width={1024} height={1024} sizes={RECORD_SIZES} loading="eager" alt="Зелёная пиксельная пластинка brat" draggable={false} />
      <span className="now-playing">NOW PLAYING ♪</span>
    </div>
  );
}

function RecordScene({ stage, access }: SceneProps) {
  return (
    <article className="donation-scene record-scene" data-scene="records">
      <RecordStack />
      <div className="donation-copy">
        <span className="donation-rank">ПЛАСТИНКА</span>
        <strong>СВОЙ ЗВУК</strong>
        <ul><li>Свой трек на пластинке</li><li>Одна в неделю — всем</li><li>С HYPE — одна каждый день</li></ul>
        <SceneAction action={hypeAction(stage, access)} plus />
      </div>
    </article>
  );
}

export function DonationSection({ stage, access }: { stage: ViewerStage | null; access: ViewerAccess | null }) {
  /* Пока неизвестно, кто зашёл, сцены показываются как гостю. */
  const sceneProps: SceneProps = { stage: stage ?? "guest", access };
  const owned = stage === "member";
  const sectionRef = useRef<HTMLElement>(null);
  const progressRef = useRef<HTMLSpanElement>(null);
  const hintRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const section = sectionRef.current;
    if (!section) return;
    const media = gsap.matchMedia();
    const context = gsap.context(() => {
      media.add(
        {
          desktop: "(min-width: 768px)",
          mobile: "(max-width: 767px)",
          reduce: "(prefers-reduced-motion: reduce)",
        },
        ({ conditions }) => {
          const reduce = Boolean(conditions?.reduce);
          const mobile = Boolean(conditions?.mobile);

          /* Отключённые в системе анимации важнее всего остального: там донат
             показывается простым столбиком из трёх блоков. Этот же режим
             раньше был единственным на телефоне. */
          if (reduce) {
            const staticTargets = section.querySelectorAll(
              ".donation-scene, .donation-scene *, .profile-donation-preview > *, .support-line, .support-meter i, .record-stack, .donation-record",
            );
            section.classList.add("reduced-motion");
            if (mobile) section.classList.add("donation-mobile-static");
            gsap.set(staticTargets, { clearProps: "all" });
            if (progressRef.current) progressRef.current.textContent = "03 БЛОКА";
            if (hintRef.current) hintRef.current.textContent = "";

            return () => {
              section.classList.remove("reduced-motion", "donation-mobile-static");
              gsap.set(staticTargets, { clearProps: "all" });
            };
          }

          /* Телефон: раскладка остаётся статическим столбиком, а анимация
             только добавляется поверх — каждая сцена проявляется, когда до неё
             долистали.

             Первая версия была другой: секция закреплялась и сцены сменяли
             друг друга, как на компьютере. На реальном телефоне это дало
             пустой экран — сцены остались невидимыми. Причина не так важна,
             как вывод: анимация не должна быть единственным, что делает
             контент видимым. Здесь используется fromTo с immediateRender:
             false, поэтому до срабатывания триггера сцена видима, и если
             анимация почему-то не запустится, пользователь увидит обычный
             читаемый блок, а не пустоту. */
          if (mobile) {
            const staticTargets = section.querySelectorAll(
              ".donation-scene, .donation-scene *, .profile-donation-preview > *, .support-line, .support-meter i, .record-stack, .donation-record",
            );
            section.classList.add("donation-mobile-static");
            gsap.set(staticTargets, { clearProps: "all" });
            if (progressRef.current) progressRef.current.textContent = "03 БЛОКА";
            if (hintRef.current) hintRef.current.textContent = "";

            const reveals: gsap.core.Tween[] = [];

            for (const scene of gsap.utils.toArray<HTMLElement>(".donation-scene")) {
              reveals.push(gsap.fromTo(
                scene,
                { autoAlpha: 0, y: 26 },
                {
                  autoAlpha: 1,
                  y: 0,
                  duration: 0.5,
                  ease: "power2.out",
                  immediateRender: false,
                  scrollTrigger: { trigger: scene, start: "top 85%", once: true },
                },
              ));
            }

            /* Шкала расходов заполняется, когда виден блок поддержки. */
            reveals.push(gsap.fromTo(
              ".support-meter i",
              { scaleX: 0, transformOrigin: "left center" },
              {
                scaleX: 1,
                duration: 0.7,
                ease: "power2.out",
                immediateRender: false,
                scrollTrigger: { trigger: ".support-scene", start: "top 70%", once: true },
              },
            ));

            /* Пластинки слегка разъезжаются, продолжая перекрывать друг друга. */
            reveals.push(gsap.fromTo(
              ".record-red",
              { xPercent: 0, rotation: 0 },
              {
                xPercent: -28,
                rotation: -8,
                duration: 0.7,
                ease: "back.out(1.3)",
                immediateRender: false,
                scrollTrigger: { trigger: ".record-scene", start: "top 70%", once: true },
              },
            ));
            reveals.push(gsap.fromTo(
              ".record-gaga",
              { xPercent: 0, rotation: 0 },
              {
                xPercent: 26,
                rotation: 7,
                duration: 0.7,
                ease: "back.out(1.3)",
                immediateRender: false,
                scrollTrigger: { trigger: ".record-scene", start: "top 70%", once: true },
              },
            ));

            /* Пересчёт позиций после загрузки картинок.

               Без него анимации не работают, хотя код верный: ScrollTrigger
               считает, где начинается каждая сцена, в момент создания — то
               есть до того, как загрузились изображения пластинок и иконки.
               Картинки приходят позже, страница становится длиннее, и
               сохранённые позиции устаревают. К моменту, когда пользователь
               долистывает до доната, триггеры считают, что их точка старта
               давно позади, и показывают сцены разом — блоки просто идут друг
               за другом без анимации.

               Это описано в документации ScrollTrigger как типичная ошибка;
               решение — вызвать refresh() после загрузки содержимого. */
            const { refresh, stop: stopRefresh } = calmRefresher();
            const pendingImages: HTMLImageElement[] = [];

            if (document.readyState === "complete") {
              refresh();
            } else {
              window.addEventListener("load", refresh, { once: true });
            }

            for (const image of Array.from(section.querySelectorAll("img"))) {
              if (image.complete) continue;
              pendingImages.push(image);
              image.addEventListener("load", refresh);
              /* Не загрузившаяся картинка тоже меняет высоту блока. */
              image.addEventListener("error", refresh);
            }

            return () => {
              stopRefresh();
              window.removeEventListener("load", refresh);
              for (const image of pendingImages) {
                image.removeEventListener("load", refresh);
                image.removeEventListener("error", refresh);
              }
              for (const tween of reveals) {
                tween.scrollTrigger?.kill();
                tween.kill();
              }
              section.classList.remove("donation-mobile-static");
              gsap.set(staticTargets, { clearProps: "all" });
            };
          }

          const timeline = gsap.timeline({
            defaults: { ease: "power3.inOut" },
            scrollTrigger: {
              trigger: section,
              start: "top top",
              end: "+=430%",
              pin: true,
              /* Чуть плотнее за прокруткой, а при быстром пролёте анимация
                 сразу доходит до конца, а не догоняет страницу (r100). */
              scrub: 0.6,
              fastScrollEnd: true,
              anticipatePin: 1,
              invalidateOnRefresh: true,
              onUpdate(self) {
                const stage = Math.min(3, Math.floor(self.progress * 3) + 1);
                if (progressRef.current) progressRef.current.textContent = `0${stage} / 03`;
                if (hintRef.current) hintRef.current.textContent = self.progress > 0.94 ? "ПРОДОЛЖИТЬ ↓" : "SCROLL TO INSPECT ↓";
              },
            },
          });

          gsap.set(".donation-scene", { autoAlpha: 0, scale: 0.96 });
          gsap.set(".prefix-scene", { autoAlpha: 1, scale: 1 });
          gsap.set(".profile-donation-preview > *, .prefix-scene .donation-copy > *", { autoAlpha: 1, scale: 1 });
          gsap.set(".support-scene .donation-copy > *, .support-line, .pixel-server > p", { autoAlpha: 0, y: 16 });
          gsap.set(".support-meter i", { scaleX: 0, transformOrigin: "left center" });
          gsap.set(".record-scene .donation-copy > *", { autoAlpha: 0, y: 18 });

          /* Разлёт пластинок зависит от ширины экрана: чем шире окно, тем
             дальше они расходятся. Значение остаётся ниже 100% ширины
             пластинки, поэтому соседние диски всегда частично перекрываются.
             Функция, а не число: ScrollTrigger пересчитывает её при resize. */
          const recordSpread = () =>
            gsap.utils.mapRange(768, 1920, 52, 78, gsap.utils.clamp(768, 1920, window.innerWidth));

          timeline
            .to(".prefix-scene", { autoAlpha: 1, y: 0, scale: 1, duration: 0.9, ease: "none" })
            .to(".prefix-scene", { autoAlpha: 0, y: -80, scale: 0.92, duration: 0.8 })
            .to(".support-scene", { autoAlpha: 1, scale: 1, duration: 0.7 }, "<0.15")
            .to(".support-meter i", { scaleX: 1, duration: 0.9, ease: "power2.out" })
            .to(".support-line, .pixel-server > p", { autoAlpha: 1, y: 0, stagger: 0.08, duration: 0.35 })
            .to(".support-scene .donation-copy > *", { autoAlpha: 1, y: 0, stagger: 0.1, duration: 0.35 }, "<")
            .to(".support-scene", { autoAlpha: 0, x: -180, scale: 0.82, duration: 0.85 })
            .to(".record-scene", { autoAlpha: 1, scale: 1, duration: 0.65 }, "<0.1")
            .fromTo(".record-stack", { y: 35, scale: 0.91 }, { y: -10, scale: 1.02, duration: 0.7, ease: "back.out(1.4)" })
            .to(".record-red", { xPercent: () => -recordSpread(), y: 30, rotation: -12, scale: 0.88, duration: 0.8, ease: "back.out(1.35)" })
            .to(".record-gaga", { xPercent: () => recordSpread() * 0.96, y: 22, rotation: 11, scale: 0.91, duration: 0.8, ease: "back.out(1.35)" }, "<0.15")
            .to(".record-brat", { y: -30, rotation: -3, scale: 1.05, duration: 0.65 }, "<0.15")
            .to(".record-scene .donation-copy > *", { autoAlpha: 1, y: 0, stagger: 0.09, duration: 0.4 }, "<")
            .to(".record-red", { scale: 1.05, duration: 0.35 })
            .to(".record-red", { scale: 0.9, duration: 0.25 })
            .to(".record-gaga", { scale: 1.06, duration: 0.35 })
            .to(".record-gaga", { scale: 0.94, duration: 0.25 })
            .to(".record-brat", { scale: 1.12, rotation: 2, duration: 0.4 })
            .to(".record-scene", { y: -30, scale: 0.94, duration: 0.6 });

          /* Текст сцены с пластинками стоит не по сетке, а на постоянном
             расстоянии от правого края самой правой пластинки в последнем кадре.
             Разлёт пластинок зависит от ширины окна, поэтому при сетке на одних
             экранах текст наезжал на диск. Место пересчитывается при каждом
             refresh — то есть и при изменении размера окна. */
          const RECORD_TEXT_GAP = 40;
          const FINAL_RECORD_ROTATION = 11; // градусов, как в анимации .record-gaga
          const FINAL_SCENE_SCALE = 0.94; // масштаб .record-scene в последнем кадре
          const recordCopy = section.querySelector<HTMLElement>(".record-scene .donation-copy");
          const lastRecord = section.querySelector<HTMLElement>(".record-gaga");
          const placeRecordCopy = () => {
            if (!recordCopy || !lastRecord) return;
            const saved = timeline.progress();
            gsap.set(recordCopy, { x: 0 });
            timeline.progress(1, true);
            const box = lastRecord.getBoundingClientRect();
            /* Картинка диска повёрнута: её рамка шире самого диска. */
            const turn = (FINAL_RECORD_ROTATION * Math.PI) / 180;
            const disc = box.width / (Math.cos(turn) + Math.sin(turn));
            const discRight = box.left + box.width / 2 + disc / 2;
            const copy = recordCopy.getBoundingClientRect();
            let shift = discRight + RECORD_TEXT_GAP - copy.left;
            /* Сдвигать можно и вправо, и влево, но не за край окна. */
            shift = Math.min(shift, window.innerWidth - 24 - copy.right);
            gsap.set(recordCopy, { x: shift / FINAL_SCENE_SCALE });
            timeline.progress(saved, true);
          };
          ScrollTrigger.addEventListener("refresh", placeRecordCopy);

          const { refresh, stop: stopRefresh } = calmRefresher();
          const images = Array.from(section.querySelectorAll("img"));
          images.forEach((image) => image.addEventListener("load", refresh, { once: true }));
          const sectionsBeforeDonation = Array.from(document.querySelectorAll("main > section")).filter((item) => item !== section && item.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING);
          const resizeObserver = new ResizeObserver(refresh);
          sectionsBeforeDonation.forEach((item) => resizeObserver.observe(item));
          document.fonts.ready.then(refresh).catch(() => undefined);
          refresh();
          return () => {
            stopRefresh();
            resizeObserver.disconnect();
            images.forEach((image) => image.removeEventListener("load", refresh));
            ScrollTrigger.removeEventListener("refresh", placeRecordCopy);
            if (recordCopy) gsap.set(recordCopy, { clearProps: "x" });
          };
        },
      );
    }, section);

    return () => {
      media.revert();
      context.revert();
    };
  }, []);

  return (
    <section className="donation-timeline-section" id="donate" ref={sectionRef}>
      <div className="donation-stage-shell">
        <div className="donation-heading">
          <span className="heading-number">04</span>
          <div><p className="kicker">{owned ? "КОСМЕТИКА БЕЗ ПРЕИМУЩЕСТВ" : "КУДА ИДУТ ДЕНЬГИ"}</p><h2>{donationTitle(stage)}</h2></div>
          <span className="donation-stage-number" ref={progressRef}>01 / 03</span>
        </div>
        <p className="donation-intro">
          {owned
            ? "Пропуск у тебя уже есть — он здесь для сравнения. PLUS добавляет только внешний вид: купить преимущество в игре нельзя."
            : "Донат оплачивает сервер. Купить преимущество в игре нельзя."}
        </p>
        <div className="donation-stage">
          <PrefixScene {...sceneProps} />
          <SupportScene {...sceneProps} />
          <RecordScene {...sceneProps} />
        </div>
        <span className="donation-scroll-hint" ref={hintRef}>SCROLL TO INSPECT ↓</span>
      </div>
    </section>
  );
}
