export type Locale = "en" | "ru" | "uk";

export interface Strings {
  sidebarTitle: string;
  accounts: string;
  screenSubtitle: string;
  notLoggedIn: string;
  logIn: string;
  noWorkspace: string;
  showUsage: string;
  fiveHourUsage: string;
  sevenDayUsage: string;
  resetIn: string;
  unitMin: string;
  unitHour: string;
  unitDay: string;
  limitExhausted: string;
  limitNearly: string;
  spareAvailable: string;
  usageExpired: string;
  noUsageAllowance: string;
  usageUnsupported: string;
  usageUnknownAccount: string;
  usageReadFailed: string;
  claudeNotFound: string;
  pillNoAccount: string;
  currentAccount: string;
  switchTo: string;
  pillNotLoggedIn: string;
  switching: string;
  switchPaseoMissing: string;
  switchMissingDirectory: string;
  switchUnsupportedProvider: string;
  switchNoToken: string;
  switchNotLoggedIn: string;
  switchUnknownAccount: string;
  switchBusy: string;
  pillAgentUnknown: string;
  pillLoadFailed: string;
  retry: string;
  reload: string;
  reloading: string;
  reloadFailed: string;
  pillEmptyTitle: string;
  pillEmptyDetail: string;
  noTokenYet: string;
  noTokenTap: string;
  tokenReady: string;
  mintToken: string;
  mintOpened: string;
  mintFailed: string;
  addAccount: string;
  add: string;
  chooseProvider: string;
  providerNotSupported: string;
  loginHint: string;
  loginOpened: string;
  cancel: string;
  suggestions: string;
  noAccountsTitle: string;
  noAccountsDetail: string;
  settingsTitle: string;
  languageLabel: string;
  languageAuto: string;
  showPill: string;
  showPillHint: string;
  settingsHint: string;
  pillUnread: string;
  /** Delete only forgets: every confirm says the folder and login stay. */
  deleteAccount: string;
  deleteConfirm: string;
  deleteSuggestionConfirm: string;
  deleteYes: string;
  deleteFailed: string;
  deleteRegistryUnreadable: string;
  /** A collapsible list of hidden folders, each with a Restore button. */
  showHidden: string;
  collapseHidden: string;
  hiddenHint: string;
  hiddenNoLogin: string;
  restore: string;
  restoreFailed: string;
}

const en: Strings = {
  sidebarTitle: "Accounts",
  accounts: "Accounts",
  screenSubtitle: "Your logins. Pick one from the pill above any chat to switch that chat onto it.",
  notLoggedIn: "Not logged in",
  logIn: "Log in",
  noWorkspace: "Open a workspace first: a terminal needs one to live in",
  showUsage: "Show usage",
  fiveHourUsage: "5 hours",
  sevenDayUsage: "Week",
  resetIn: "resets in",
  unitMin: "min",
  unitHour: "h",
  unitDay: "d",
  limitExhausted: "limit reached",
  limitNearly: "almost out",
  spareAvailable: "Another account has allowance left",
  usageExpired: "The session token in this directory has expired; it refreshes the next time Claude runs there.",
  noUsageAllowance: "This plan has no usage limit to show.",
  usageUnsupported: "allowance not readable for this provider",
  usageUnknownAccount: "This account no longer exists.",
  usageReadFailed: "Could not read usage.",
  claudeNotFound: "The claude command could not be found, so no account could be checked. Install Claude Code, or start Paseo from a terminal.",
  pillNoAccount: "No account",
  currentAccount: "This chat runs on",
  switchTo: "Switch to",
  pillNotLoggedIn: "Not logged in",
  switching: "Switching…",
  switchPaseoMissing: "Could not find the paseo command to restart the session",
  switchMissingDirectory: "That account's directory is gone",
  switchUnsupportedProvider: "That account is for a provider this plugin does not run yet",
  switchNoToken: "Switching is not enabled for that account yet",
  switchNotLoggedIn: "Nobody is logged in to that account's directory yet",
  switchUnknownAccount: "That account is not in the list any more",
  switchBusy: "This will interrupt the current turn. Press again to switch anyway.",
  pillAgentUnknown: "Can't see this chat yet.",
  pillLoadFailed: "Could not load accounts.",
  retry: "Retry",
  reload: "Reload",
  reloading: "Reloading…",
  reloadFailed: "Could not reload.",
  pillEmptyTitle: "No accounts yet",
  pillEmptyDetail: "Add one in Accounts first.",
  noTokenYet: "Switching not enabled yet",
  noTokenTap: "tap to enable switching",
  tokenReady: "Switchable",
  mintToken: "Enable switching",
  mintOpened: "A terminal opened. Approve in the browser and come back; this list updates by itself. If the terminal asks for a code, paste the one the browser shows.",
  mintFailed: "Could not start enabling switching.",
  addAccount: "Add account",
  add: "Add",
  chooseProvider: "Provider",
  providerNotSupported: "Not supported yet",
  loginHint: "A terminal and a browser will open on the daemon machine. Log in to the account you want to add.",
  loginOpened: "The login terminal is open. Approve in the browser and come back; the account appears here by itself.",
  cancel: "Cancel",
  suggestions: "Found on this machine",
  noAccountsTitle: "No accounts yet",
  noAccountsDetail: "Log in to the first one; chats can then switch between subscriptions.",
  settingsTitle: "Accounts",
  languageLabel: "Language",
  languageAuto: "Same as the system",
  showPill: "Pill above chats",
  showPillHint: "The account ring and figure in the composer of every Claude chat. Switching happens there.",
  settingsHint: "Changes apply immediately.",
  pillUnread: "…",
  deleteAccount: "Delete",
  deleteConfirm: "Remove this account from the list? Its folder and login stay where they are.",
  deleteSuggestionConfirm: "Hide this from the list? Its folder and login stay where they are.",
  deleteYes: "Yes",
  deleteFailed: "Could not delete.",
  deleteRegistryUnreadable: "The accounts file could not be read, so nothing was deleted.",
  showHidden: "Show hidden",
  collapseHidden: "Hide the list",
  hiddenHint: "A restored folder comes back under “Found on this machine”, where it can be added again.",
  hiddenNoLogin: "not found or not logged in",
  restore: "Restore",
  restoreFailed: "Could not restore.",
};

const ru: Strings = {
  sidebarTitle: "Аккаунты",
  accounts: "Аккаунты",
  screenSubtitle: "Твои логины. В пилюле над любым чатом выбираешь один — и чат идёт на нём.",
  notLoggedIn: "Не выполнен вход",
  logIn: "Войти",
  noWorkspace: "Сначала открой воркспейс: терминалу нужно в чём-то жить",
  showUsage: "Показать лимиты",
  fiveHourUsage: "5 часов",
  sevenDayUsage: "Неделя",
  resetIn: "сброс через",
  unitMin: "мин",
  unitHour: "ч",
  unitDay: "д",
  limitExhausted: "лимит выбран",
  limitNearly: "почти выбран",
  spareAvailable: "Есть аккаунт с запасом",
  usageExpired: "Токен сессии в этой директории истёк; обновится, когда Claude там снова поработает.",
  noUsageAllowance: "Для этого плана лимит не отображается.",
  usageUnsupported: "остаток по этому провайдеру не читается",
  usageUnknownAccount: "Этого аккаунта больше нет.",
  usageReadFailed: "Не удалось прочитать лимиты.",
  claudeNotFound: "Не нашёл команду claude, поэтому ни один аккаунт не проверен. Установи Claude Code или запусти Paseo из терминала.",
  pillNoAccount: "Без аккаунта",
  currentAccount: "Этот чат идёт на",
  switchTo: "Переключиться на",
  pillNotLoggedIn: "Не залогинен",
  switching: "Переключаю…",
  switchPaseoMissing: "Не нашёл команду paseo, чтобы перезапустить сессию",
  switchMissingDirectory: "Директории этого аккаунта больше нет",
  switchUnsupportedProvider: "Этот аккаунт для провайдера, который плагин пока не ведёт",
  switchNoToken: "Для этого аккаунта переключение ещё не разрешено",
  switchNotLoggedIn: "В директорию этого аккаунта ещё никто не вошёл",
  switchUnknownAccount: "Этого аккаунта больше нет в списке",
  switchBusy: "Это прервёт текущий ход. Нажми ещё раз, чтобы всё равно переключиться.",
  pillAgentUnknown: "Пока не вижу этот чат.",
  pillLoadFailed: "Не удалось загрузить аккаунты.",
  retry: "Повторить",
  reload: "Обновить",
  reloading: "Обновляю…",
  reloadFailed: "Не удалось обновить.",
  pillEmptyTitle: "Аккаунтов пока нет",
  pillEmptyDetail: "Сначала добавь в разделе «Аккаунты».",
  noTokenYet: "Переключение ещё не разрешено",
  noTokenTap: "нажми, чтобы разрешить переключение",
  tokenReady: "Переключаемый",
  mintToken: "Разрешить переключение",
  mintOpened: "Открыл терминал. Подтверди в браузере и возвращайся: список обновится сам. Если терминал попросит код, вставь тот, что покажет браузер.",
  mintFailed: "Не удалось запустить разрешение переключения.",
  addAccount: "Добавить аккаунт",
  add: "Добавить",
  chooseProvider: "Провайдер",
  providerNotSupported: "Пока не поддерживается",
  loginHint: "Откроется терминал и браузер на машине демона. Войди в аккаунт, который хочешь добавить.",
  loginOpened: "Терминал входа открыт. Подтверди в браузере и возвращайся: аккаунт появится здесь сам.",
  cancel: "Отмена",
  suggestions: "Найдено на этой машине",
  noAccountsTitle: "Аккаунтов пока нет",
  noAccountsDetail: "Войди в первый — и чаты смогут переключаться между подписками.",
  settingsTitle: "Аккаунты",
  languageLabel: "Язык",
  languageAuto: "Как в системе",
  showPill: "Пилюля над чатами",
  showPillHint: "Кольцо и цифра аккаунта в композере каждого чата Claude. Переключение делается там.",
  settingsHint: "Изменения применяются сразу.",
  pillUnread: "…",
  deleteAccount: "Удалить",
  deleteConfirm: "Убрать аккаунт из списка? Папка и вход останутся.",
  deleteSuggestionConfirm: "Скрыть из списка? Папка и вход останутся.",
  deleteYes: "Да",
  deleteFailed: "Не удалось удалить.",
  deleteRegistryUnreadable: "Не удалось прочитать файл аккаунтов, поэтому ничего не удалено.",
  showHidden: "Показать скрытые",
  collapseHidden: "Свернуть список",
  hiddenHint: "Возвращённая папка появится в разделе «Найдено на этой машине», оттуда её можно снова добавить.",
  hiddenNoLogin: "не найдена или без входа",
  restore: "Вернуть",
  restoreFailed: "Не удалось вернуть.",
};

const uk: Strings = {
  sidebarTitle: "Акаунти",
  accounts: "Акаунти",
  screenSubtitle: "Твої логіни. У пілюлі над будь-яким чатом обираєш один — і чат іде на ньому.",
  notLoggedIn: "Вхід не виконано",
  logIn: "Увійти",
  noWorkspace: "Спочатку відкрий воркспейс: терміналу потрібно десь жити",
  showUsage: "Показати ліміти",
  fiveHourUsage: "5 годин",
  sevenDayUsage: "Тиждень",
  resetIn: "скидання через",
  unitMin: "хв",
  unitHour: "год",
  unitDay: "д",
  limitExhausted: "ліміт вичерпано",
  limitNearly: "майже вичерпано",
  spareAvailable: "Є акаунт із запасом",
  usageExpired: "Токен сесії в цій директорії минув; оновиться, коли Claude там знову попрацює.",
  noUsageAllowance: "Для цього плану ліміт не відображається.",
  usageUnsupported: "залишок для цього провайдера не читається",
  usageUnknownAccount: "Цього акаунта більше немає.",
  usageReadFailed: "Не вдалося прочитати ліміти.",
  claudeNotFound: "Не знайшов команду claude, тому жоден акаунт не перевірено. Встанови Claude Code або запусти Paseo з термінала.",
  pillNoAccount: "Без акаунта",
  currentAccount: "Цей чат іде на",
  switchTo: "Перемкнутися на",
  pillNotLoggedIn: "Не залогінений",
  switching: "Перемикаю…",
  switchPaseoMissing: "Не знайшов команду paseo, щоб перезапустити сесію",
  switchMissingDirectory: "Директорії цього акаунта більше немає",
  switchUnsupportedProvider: "Цей акаунт для провайдера, якого плагін поки не веде",
  switchNoToken: "Для цього акаунта перемикання ще не дозволено",
  switchNotLoggedIn: "До директорії цього акаунта ще ніхто не увійшов",
  switchUnknownAccount: "Цього акаунта більше немає у списку",
  switchBusy: "Це перерве поточний хід. Натисни ще раз, щоб усе одно перемкнути.",
  pillAgentUnknown: "Поки не бачу цей чат.",
  pillLoadFailed: "Не вдалося завантажити акаунти.",
  retry: "Повторити",
  reload: "Оновити",
  reloading: "Оновлюю…",
  reloadFailed: "Не вдалося оновити.",
  pillEmptyTitle: "Акаунтів поки немає",
  pillEmptyDetail: "Спочатку додай у розділі «Акаунти».",
  noTokenYet: "Перемикання ще не дозволено",
  noTokenTap: "натисни, щоб дозволити перемикання",
  tokenReady: "Перемикається",
  mintToken: "Дозволити перемикання",
  mintOpened: "Відкрив термінал. Підтверди в браузері й повертайся: список оновиться сам. Якщо термінал попросить код, встав той, що покаже браузер.",
  mintFailed: "Не вдалося запустити дозвіл перемикання.",
  addAccount: "Додати акаунт",
  add: "Додати",
  chooseProvider: "Провайдер",
  providerNotSupported: "Поки не підтримується",
  loginHint: "Відкриється термінал і браузер на машині демона. Увійди в акаунт, який хочеш додати.",
  loginOpened: "Термінал входу відкрито. Підтверди в браузері й повертайся: акаунт з'явиться тут сам.",
  cancel: "Скасувати",
  suggestions: "Знайдено на цій машині",
  noAccountsTitle: "Акаунтів поки немає",
  noAccountsDetail: "Увійди в перший — і чати зможуть перемикатися між підписками.",
  settingsTitle: "Акаунти",
  languageLabel: "Мова",
  languageAuto: "Як у системі",
  showPill: "Пілюля над чатами",
  showPillHint: "Кільце й цифра акаунта в композері кожного чату Claude. Перемикання робиться там.",
  settingsHint: "Зміни застосовуються одразу.",
  pillUnread: "…",
  deleteAccount: "Видалити",
  deleteConfirm: "Прибрати акаунт зі списку? Тека й вхід залишаться.",
  deleteSuggestionConfirm: "Сховати зі списку? Тека й вхід залишаться.",
  deleteYes: "Так",
  deleteFailed: "Не вдалося видалити.",
  deleteRegistryUnreadable: "Не вдалося прочитати файл акаунтів, тому нічого не видалено.",
  showHidden: "Показати приховані",
  collapseHidden: "Згорнути список",
  hiddenHint: "Повернена тека з’явиться в розділі «Знайдено на цій машині», звідти її можна знову додати.",
  hiddenNoLogin: "не знайдена або без входу",
  restore: "Повернути",
  restoreFailed: "Не вдалося повернути.",
};

/** Maps a locale tag to a catalogue entry: `ru-RU`, `ru` and `ru_RU.UTF-8` all give `ru`. */
export function resolveLocale(tag: string): Locale {
  const lower = tag.toLowerCase();
  if (lower.startsWith("ru")) return "ru";
  if (lower.startsWith("uk")) return "uk";
  return "en";
}

/** `process.env.LANG`, or "en" where there is no `process` (read via `globalThis` because
 *  `shared/` is bundled into the client too). */
function envLocale(): string {
  const host = globalThis as { process?: { env?: Record<string, string | undefined> } };
  return host.process?.env?.LANG ?? "en";
}

/** The reader's language: the daemon's for registrations, the client's for surfaces. Uses
 *  `Intl`, which works on every runtime a plugin reaches (Hermes, browsers, Node), with
 *  `LANG` as the fallback for a runtime without Intl data. */
export function detectLocale(candidate?: string): Locale {
  if (candidate !== undefined) return resolveLocale(candidate);
  try {
    const tag = new Intl.DateTimeFormat().resolvedOptions().locale;
    if (tag !== "") return resolveLocale(tag);
  } catch {
    // No Intl data; fall through to the environment.
  }
  return resolveLocale(envLocale());
}

export function t(locale: Locale): Strings {
  return locale === "ru" ? ru : locale === "uk" ? uk : en;
}
