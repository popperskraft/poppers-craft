import "server-only";

import type { MailContent, MailLocale } from "@/lib/mail";

/* Тексты писем: русский и английский варианты рядом, чтобы их было видно
   целиком и не приходилось искать по словарю интерфейса. */

type LetterInput = { to: string; login: string; url: string; locale: MailLocale };

export function passwordResetLetter({ to, login, url, locale }: LetterInput): MailContent {
  if (locale === "en") {
    return {
      to,
      toName: login,
      locale,
      subject: "Password recovery — PoppersCraft",
      heading: "Password recovery",
      lines: [
        `Hi, ${login}!`,
        "Someone asked to change the password of this popperscraft.org account. If that was you, press the button below and set a new password.",
        "The link works once and stops working in an hour.",
      ],
      button: { label: "Set a new password", url },
      note: "If you did not forget your password, do nothing: it stays the same until someone opens this link.",
    };
  }
  return {
    to,
    toName: login,
    locale,
    subject: "Восстановление пароля — PoppersCraft",
    heading: "Восстановление пароля",
    lines: [
      `Привет, ${login}!`,
      "Кто-то запросил смену пароля для этого аккаунта на popperscraft.org. Если это вы — нажмите кнопку ниже и придумайте новый пароль.",
      "Ссылка сработает один раз и перестанет действовать через час.",
    ],
    button: { label: "Сменить пароль", url },
    note: "Если пароль вы не забывали, делать ничего не нужно: пока по ссылке никто не перешёл, пароль остаётся прежним.",
  };
}

export function emailChangeLetter({ to, login, url, locale }: LetterInput): MailContent {
  if (locale === "en") {
    return {
      to,
      toName: login,
      locale,
      subject: "Confirm your new email — PoppersCraft",
      heading: "Confirm your email",
      lines: [
        `Hi, ${login}!`,
        "This address was set as the new email of a popperscraft.org account. Until you confirm it, the account keeps the old address.",
        "The link works for 24 hours.",
      ],
      button: { label: "Confirm email", url },
      note: "If you did not change anything, just delete this letter.",
    };
  }
  return {
    to,
    toName: login,
    locale,
    subject: "Подтвердите новую почту — PoppersCraft",
    heading: "Подтверждение почты",
    lines: [
      `Привет, ${login}!`,
      "Этот адрес указали как новую почту аккаунта на popperscraft.org. Пока адрес не подтверждён, у аккаунта остаётся прежняя почта.",
      "Ссылка действует сутки.",
    ],
    button: { label: "Подтвердить почту", url },
    note: "Если вы ничего не меняли — просто удалите письмо.",
  };
}

export function emailVerifyLetter({ to, login, url, locale }: LetterInput): MailContent {
  if (locale === "en") {
    return {
      to,
      toName: login,
      locale,
      subject: "Confirm your email — PoppersCraft",
      heading: "Confirm your email",
      lines: [
        `Hi, ${login}!`,
        "Your application on popperscraft.org is on its way to the administrators.",
        "Confirm your email so that you can recover the account if you ever forget the password.",
        "The link works for 24 hours.",
      ],
      button: { label: "Confirm email", url },
    };
  }
  return {
    to,
    toName: login,
    locale,
    subject: "Подтвердите почту — PoppersCraft",
    heading: "Подтвердите почту",
    lines: [
      `Привет, ${login}!`,
      "Ваша анкета на popperscraft.org отправлена администраторам.",
      "Подтвердите почту — тогда доступ к аккаунту можно будет вернуть, если вы забудете пароль.",
      "Ссылка действует сутки.",
    ],
    button: { label: "Подтвердить почту", url },
  };
}

/* Сброс 2FA, когда к приложению-аутентификатору нет доступа. Письмо уходит
   только на почту аккаунта и только после верного пароля: одного пароля
   для снятия защиты мало. */
export function mfaResetLetter({ to, login, url, locale }: LetterInput): MailContent {
  if (locale === "en") {
    return {
      to,
      toName: login,
      locale,
      subject: "Turn off two-factor sign-in — PoppersCraft",
      heading: "Turn off 2FA",
      lines: [
        `Hi, ${login}!`,
        "Someone entered the correct password of this popperscraft.org account and asked to turn off two-factor sign-in because the code is not available.",
        "If that was you, press the button. All authenticators will be removed, and you can set up a new one in the profile.",
        "The link works once and stops working in an hour.",
      ],
      button: { label: "Turn off 2FA", url },
      note: "If it was not you, do not press anything and change your password: someone knows it.",
    };
  }
  return {
    to,
    toName: login,
    locale,
    subject: "Отключение двухфакторного входа — PoppersCraft",
    heading: "Отключение 2FA",
    lines: [
      `Привет, ${login}!`,
      "Кто-то ввёл верный пароль от этого аккаунта на popperscraft.org и попросил отключить двухфакторный вход, потому что нет доступа к коду.",
      "Если это вы — нажмите кнопку. Все аутентификаторы будут удалены, новый можно подключить в профиле.",
      "Ссылка сработает один раз и перестанет действовать через час.",
    ],
    button: { label: "Отключить 2FA", url },
    note: "Если это были не вы — ничего не нажимайте и смените пароль: его кто-то знает.",
  };
}

/* Код подтверждения удаления аккаунта (Профиль → Настройки → Аккаунт и почта). */
export function accountDeletionCodeLetter({ to, login, code, locale }: { to: string; login: string; code: string; locale: MailLocale }): MailContent {
  if (locale === "en") {
    return {
      to,
      toName: login,
      locale,
      subject: `Code to delete your account: ${code} — PoppersCraft`,
      heading: "Delete account",
      lines: [
        `Hi, ${login}!`,
        "Someone signed in to this popperscraft.org account and asked to delete it.",
        `Confirmation code: ${code}`,
        "Enter it on the site to delete the account. The code works for 15 minutes. Deleting cannot be undone: the profile, posts, comments, skin and looks are erased.",
      ],
      note: "If it was not you, do not enter the code and change your password: someone has access to your account.",
    };
  }
  return {
    to,
    toName: login,
    locale,
    subject: `Код удаления аккаунта: ${code} — PoppersCraft`,
    heading: "Удаление аккаунта",
    lines: [
      `Привет, ${login}!`,
      "Кто-то вошёл в этот аккаунт popperscraft.org и попросил его удалить.",
      `Код подтверждения: ${code}`,
      "Введите его на сайте, чтобы удалить аккаунт. Код действует 15 минут. Удаление нельзя отменить: профиль, посты, комментарии, скин и образы стираются.",
    ],
    note: "Если это были не вы — не вводите код и смените пароль: у кого-то есть доступ к вашему аккаунту.",
  };
}

