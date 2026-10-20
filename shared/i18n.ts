export type Locale = "en" | "ru" | "uk";

export interface Strings {
  sidebarTitle: string;
  accounts: string;
  screenSubtitle: string;
  notLoggedIn: string;
  logIn: string;
  noWorkspace: string;
  loginFailed: string;
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
  /** `{var}` is replaced with the variable's name. */
  apiKeyOverride: string;
  pillNoAccount: string;
  currentAccount: string;
  switchTo: string;
  switchPaseoMissing: string;
  switchMissingDirectory: string;
  switchUnsupportedProvider: string;
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
  /** The login new chats open on, set by "Move all chats here". */
  defaultAccount: string;
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
  /** Settings → the account new chats open on. */
  defaultSetting: string;
  defaultSettingNone: string;
  defaultSettingHint: string;
  defaultSettingEmpty: string;
  defaultSettingFailed: string;
  /** Why a new chat was not started; also the settings banner for a broken default. */
  refuseDefaultGone: string;
  refuseDefaultMissingDir: string;
  refuseNotSet: string;
  refuseNoAccounts: string;
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
  /** Moves every chat in every workspace onto one account. Every state is the button's own
   *  label, so keep them short. */
  moveAllChats: string;
  /** The armed button: a second press moves. */
  moveAllConfirm: string;
  moveAllRunning: string;
  /** The outcome, joined with " · ": `{moved}`, `{skipped}` (busy chats left alone) and
   *  `{failed}` are replaced with counts. */
  moveAllDone: string;
  moveAllBusy: string;
  moveAllFailed: string;
  moveAllError: string;
  /** The default that picks by allowance as each chat opens. */
  defaultSettingAuto: string;
  /** Above a chat on a nearly full account. `{window}` is `fiveHourUsage` or `sevenDayUsage`,
   *  `{pct}` the share used. */
  pillNearlyFull: string;
  /** The workspace header button and its popover. */
  workspaceTitle: string;
  workspaceHint: string;
  /** The row that gives the choice back to the default. `{label}` is what it picks now. */
  workspaceAuto: string;
  workspaceAutoNone: string;
  /** The pill's popover: whose account this chat runs on, and what a press does. */
  pillTitle: string;
  pillHint: string;
  /** Settings. */
  autoPolicyLabel: string;
  autoPolicyHint: string;
  autoPolicyBurn: string;
  autoPolicyRoom: string;
  perWorkspaceLabel: string;
  perWorkspaceHint: string;
  /** The Accounts screen's badge, under Auto, on the account Auto would pick now. */
  autoNowBadge: string;
  /** `{label}` is the id `PASEO_CLAUDE_ACCOUNT` names, or the account's label. */
  refuseAskedUnknown: string;
  refuseAskedMissingDir: string;
  refuseAutoNone: string;
  /** The composer's "+" menu entry and its picker. */
  attachTitle: string;
  attachPickerTitle: string;
  attachSearch: string;
  attachAutoTitle: string;
  /** What the chat's agent reads; `{label}` is the login. */
  attachAccountText: string;
  attachAutoText: string;
}

const en: Strings = {
  sidebarTitle: "Accounts",
  accounts: "Accounts",
  screenSubtitle: "Your logins. Pick one from the pill above any chat to switch that chat onto it.",
  notLoggedIn: "Not logged in",
  logIn: "Log in",
  noWorkspace: "Open a workspace first: a terminal needs one to live in",
  loginFailed: "Could not start the login.",
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
  usageExpired: "The session token in this directory has expired and could not be refreshed. Log in again if this does not clear.",
  noUsageAllowance: "This plan has no usage limit to show.",
  usageUnsupported: "allowance not readable for this provider",
  usageUnknownAccount: "This account no longer exists.",
  usageReadFailed: "Could not read usage.",
  claudeNotFound: "The claude command could not be found, so no account could be checked. Install Claude Code, or start Paseo from a terminal.",
  apiKeyOverride: "{var} is set in Paseo's environment, so Claude Code uses it instead of the account picked here. Remove it for switching to take effect.",
  pillNoAccount: "No account",
  currentAccount: "This chat runs on",
  switchTo: "Switch to",
  switchPaseoMissing: "Could not find the paseo command to restart the session",
  switchMissingDirectory: "That account's directory is gone",
  switchUnsupportedProvider: "That account is for a provider this plugin does not run yet",
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
  defaultAccount: "Default",
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
  defaultSetting: "Default account for new chats",
  defaultSettingNone: "Not set: a chat uses its folder's login",
  defaultSettingHint: "A new chat opens on this account. Auto picks, as each chat opens, the account whose week resets soonest while it has room. Existing chats keep theirs; to move them, use \"Move all chats here\" on the Accounts screen.",
  defaultSettingEmpty: "No accounts yet. Log in to one on the Accounts screen to choose it here.",
  defaultSettingFailed: "Could not save the default account.",
  refuseDefaultGone: "The default account for new chats is no longer in the list. Choose another in Settings → Plugins → Claude Accounts.",
  refuseDefaultMissingDir: "The folder of the default account \"{label}\" is gone. Choose another default in Settings → Plugins → Claude Accounts.",
  refuseNotSet: "This chat has no Claude account: nobody is logged in to {dir} and no default account is set. Choose one in Settings → Plugins → Claude Accounts, or log in on the Accounts screen.",
  refuseNoAccounts: "This chat has no Claude account: nobody is logged in to {dir} and no account has been added. Log in to one on the Accounts screen, then choose it in Settings → Plugins → Claude Accounts.",
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
  moveAllChats: "Move all chats here",
  moveAllConfirm: "Press again to move",
  moveAllRunning: "Moving…",
  moveAllDone: "Moved {moved}",
  moveAllBusy: "{skipped} busy",
  moveAllFailed: "{failed} failed",
  moveAllError: "Could not move",
  defaultSettingAuto: "Auto",
  pillNearlyFull: "{window}: {pct}% used. If this chat needs more room, switch it to another account below.",
  workspaceTitle: "Account for new chats",
  workspaceHint: "Every new chat opens on this. Open chats keep theirs; the pill above a chat switches that chat.",
  workspaceAuto: "Auto (now {label})",
  workspaceAutoNone: "Auto",
  refuseAskedUnknown: "This chat was started with PASEO_CLAUDE_ACCOUNT={label}, and there is no such Claude account. Use the account's id (its folder name: work for ~/.claude-work), or @auto.",
  refuseAskedMissingDir: "This chat was started with PASEO_CLAUDE_ACCOUNT={label}, but that account's folder is gone. Log in to it again on the Accounts screen, or start the chat without it.",
  refuseAutoNone: "This chat has no Claude account: Auto found no logged-in account to pick, and nobody is logged in to {dir}. Log in on the Accounts screen.",
  attachTitle: "Claude account",
  attachPickerTitle: "Start this chat on",
  attachSearch: "Search accounts",
  attachAutoTitle: "Pick by allowance",
  attachAccountText: "This chat was started on the Claude account {label}.",
  attachAutoText: "This chat was started on the Claude account with the most suitable allowance.",
  pillTitle: "This chat's account",
  pillHint: "Picking another restarts this chat on it; the conversation carries on.",
  autoPolicyLabel: "How Auto picks",
  autoPolicyHint: "Among accounts with room. Accounts nearly out of their 5 hours, or full, come last.",
  autoPolicyBurn: "Week that resets soonest first",
  autoPolicyRoom: "Most room left first",
  perWorkspaceLabel: "One account per task",
  perWorkspaceHint: "Auto's first pick in a workspace holds for all its new chats, until the default changes. Off: each new chat is picked on its own.",
  autoNowBadge: "Auto · now",
};

const ru: Strings = {
  sidebarTitle: "Аккаунты",
  accounts: "Аккаунты",
  screenSubtitle: "Твои логины. В пилюле над любым чатом выбираешь один — и чат идёт на нём.",
  notLoggedIn: "Не выполнен вход",
  logIn: "Войти",
  noWorkspace: "Сначала открой воркспейс: терминалу нужно в чём-то жить",
  loginFailed: "Не удалось запустить вход.",
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
  usageExpired: "Токен сессии в этой директории истёк, и обновить его не вышло. Если это не пройдёт само, залогинься заново.",
  noUsageAllowance: "Для этого плана лимит не отображается.",
  usageUnsupported: "остаток по этому провайдеру не читается",
  usageUnknownAccount: "Этого аккаунта больше нет.",
  usageReadFailed: "Не удалось прочитать лимиты.",
  claudeNotFound: "Не нашёл команду claude, поэтому ни один аккаунт не проверен. Установи Claude Code или запусти Paseo из терминала.",
  apiKeyOverride: "В окружении Paseo задан {var}, поэтому Claude Code использует его, а не выбранный здесь аккаунт. Убери его, чтобы переключение работало.",
  pillNoAccount: "Без аккаунта",
  currentAccount: "Этот чат идёт на",
  switchTo: "Переключиться на",
  switchPaseoMissing: "Не нашёл команду paseo, чтобы перезапустить сессию",
  switchMissingDirectory: "Директории этого аккаунта больше нет",
  switchUnsupportedProvider: "Этот аккаунт для провайдера, который плагин пока не ведёт",
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
  defaultAccount: "По умолчанию",
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
  defaultSetting: "Аккаунт по умолчанию для новых чатов",
  defaultSettingNone: "Не задан: чат берёт вход своей папки",
  defaultSettingHint: "Новый чат открывается на этом аккаунте. Авто при открытии каждого чата берёт аккаунт, у которого неделя сбросится раньше всех, пока есть запас. Существующие чаты остаются на своих; перенести их можно кнопкой «Перевести все чаты сюда» на экране аккаунтов.",
  defaultSettingEmpty: "Аккаунтов пока нет. Войди в один на экране аккаунтов, чтобы выбрать его здесь.",
  defaultSettingFailed: "Не удалось сохранить аккаунт по умолчанию.",
  refuseDefaultGone: "Аккаунта по умолчанию для новых чатов больше нет в списке. Выбери другой в разделе Настройки → Плагины → Claude Accounts.",
  refuseDefaultMissingDir: "Папки аккаунта по умолчанию «{label}» больше нет. Выбери другой в разделе Настройки → Плагины → Claude Accounts.",
  refuseNotSet: "У этого чата нет аккаунта Claude: в {dir} никто не вошёл, а аккаунт по умолчанию не задан. Выбери его в разделе Настройки → Плагины → Claude Accounts или войди на экране аккаунтов.",
  refuseNoAccounts: "У этого чата нет аккаунта Claude: в {dir} никто не вошёл, и ни одного аккаунта не добавлено. Войди в один на экране аккаунтов и выбери его в разделе Настройки → Плагины → Claude Accounts.",
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
  moveAllChats: "Перевести все чаты сюда",
  moveAllConfirm: "Нажми ещё раз",
  moveAllRunning: "Перевожу…",
  moveAllDone: "Переведено: {moved}",
  moveAllBusy: "занято: {skipped}",
  moveAllFailed: "ошибок: {failed}",
  moveAllError: "Не вышло",
  defaultSettingAuto: "Авто",
  pillNearlyFull: "{window}: использовано {pct}%. Если этому чату нужно больше, переключи его на другой аккаунт ниже.",
  workspaceTitle: "Аккаунт для новых чатов",
  workspaceHint: "Каждый новый чат открывается на нём. Открытые чаты остаются на своих; пилка над чатом переключает этот чат.",
  workspaceAuto: "Авто (сейчас {label})",
  workspaceAutoNone: "Авто",
  refuseAskedUnknown: "Этот чат запущен с PASEO_CLAUDE_ACCOUNT={label}, а такого аккаунта Claude нет. Укажи id аккаунта (имя его папки: work для ~/.claude-work) или @auto.",
  refuseAskedMissingDir: "Этот чат запущен с PASEO_CLAUDE_ACCOUNT={label}, но папки этого аккаунта больше нет. Войди в него снова на экране аккаунтов или запусти чат без этой переменной.",
  refuseAutoNone: "У этого чата нет аккаунта Claude: Авто не нашёл ни одного аккаунта со входом, и в {dir} тоже никто не вошёл. Войди на экране аккаунтов.",
  attachTitle: "Аккаунт Claude",
  attachPickerTitle: "Начать этот чат на",
  attachSearch: "Поиск аккаунтов",
  attachAutoTitle: "Выбрать по лимитам",
  attachAccountText: "Этот чат запущен на аккаунте Claude {label}.",
  attachAutoText: "Этот чат запущен на аккаунте Claude с самым подходящим лимитом.",
  pillTitle: "Аккаунт этого чата",
  pillHint: "Выбор другого перезапустит этот чат на нём; разговор продолжится.",
  autoPolicyLabel: "Как выбирает Авто",
  autoPolicyHint: "Среди аккаунтов с запасом. Почти исчерпавшие 5 часов и полные идут последними.",
  autoPolicyBurn: "Сначала тот, у кого неделя сбросится раньше",
  autoPolicyRoom: "Сначала тот, у кого больше запаса",
  perWorkspaceLabel: "Один аккаунт на задачу",
  perWorkspaceHint: "Первый выбор Авто в воркспейсе действует на все его новые чаты, пока не сменится аккаунт по умолчанию. Выключено: каждый новый чат выбирается отдельно.",
  autoNowBadge: "Авто · сейчас",
};

const uk: Strings = {
  sidebarTitle: "Акаунти",
  accounts: "Акаунти",
  screenSubtitle: "Твої логіни. У пілюлі над будь-яким чатом обираєш один — і чат іде на ньому.",
  notLoggedIn: "Вхід не виконано",
  logIn: "Увійти",
  noWorkspace: "Спочатку відкрий воркспейс: терміналу потрібно десь жити",
  loginFailed: "Не вдалося запустити вхід.",
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
  usageExpired: "Токен сесії в цій директорії минув, і оновити його не вдалося. Якщо це не мине саме, залогінься знову.",
  noUsageAllowance: "Для цього плану ліміт не відображається.",
  usageUnsupported: "залишок для цього провайдера не читається",
  usageUnknownAccount: "Цього акаунта більше немає.",
  usageReadFailed: "Не вдалося прочитати ліміти.",
  claudeNotFound: "Не знайшов команду claude, тому жоден акаунт не перевірено. Встанови Claude Code або запусти Paseo з термінала.",
  apiKeyOverride: "В оточенні Paseo задано {var}, тому Claude Code використовує його, а не обраний тут акаунт. Прибери його, щоб перемикання працювало.",
  pillNoAccount: "Без акаунта",
  currentAccount: "Цей чат іде на",
  switchTo: "Перемкнутися на",
  switchPaseoMissing: "Не знайшов команду paseo, щоб перезапустити сесію",
  switchMissingDirectory: "Директорії цього акаунта більше немає",
  switchUnsupportedProvider: "Цей акаунт для провайдера, якого плагін поки не веде",
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
  defaultAccount: "За замовчуванням",
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
  defaultSetting: "Акаунт за замовчуванням для нових чатів",
  defaultSettingNone: "Не задано: чат бере вхід своєї теки",
  defaultSettingHint: "Новий чат відкривається на цьому акаунті. Авто під час відкриття кожного чату бере акаунт, у якого тиждень відкотиться найраніше, поки є запас. Наявні чати лишаються на своїх; перенести їх можна кнопкою «Перевести всі чати сюди» на екрані акаунтів.",
  defaultSettingEmpty: "Акаунтів поки немає. Увійди в один на екрані акаунтів, щоб обрати його тут.",
  defaultSettingFailed: "Не вдалося зберегти акаунт за замовчуванням.",
  refuseDefaultGone: "Акаунта за замовчуванням для нових чатів більше немає у списку. Обери інший у розділі Налаштування → Плагіни → Claude Accounts.",
  refuseDefaultMissingDir: "Теки акаунта за замовчуванням «{label}» більше немає. Обери інший у розділі Налаштування → Плагіни → Claude Accounts.",
  refuseNotSet: "Цей чат не має акаунта Claude: у {dir} ніхто не увійшов, а акаунт за замовчуванням не задано. Обери його в розділі Налаштування → Плагіни → Claude Accounts або увійди на екрані акаунтів.",
  refuseNoAccounts: "Цей чат не має акаунта Claude: у {dir} ніхто не увійшов, і жодного акаунта не додано. Увійди в один на екрані акаунтів і обери його в розділі Налаштування → Плагіни → Claude Accounts.",
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
  moveAllChats: "Перевести всі чати сюди",
  moveAllConfirm: "Натисни ще раз",
  moveAllRunning: "Переводжу…",
  moveAllDone: "Переведено: {moved}",
  moveAllBusy: "зайнято: {skipped}",
  moveAllFailed: "помилок: {failed}",
  moveAllError: "Не вдалося",
  defaultSettingAuto: "Авто",
  pillNearlyFull: "{window}: використано {pct}%. Якщо цьому чату треба більше, перемкни його на інший акаунт нижче.",
  workspaceTitle: "Акаунт для нових чатів",
  workspaceHint: "Кожен новий чат відкривається на ньому. Відкриті чати лишаються на своїх; пілка над чатом перемикає цей чат.",
  workspaceAuto: "Авто (зараз {label})",
  workspaceAutoNone: "Авто",
  refuseAskedUnknown: "Цей чат запущено з PASEO_CLAUDE_ACCOUNT={label}, а такого акаунта Claude немає. Вкажи id акаунта (назву його теки: work для ~/.claude-work) або @auto.",
  refuseAskedMissingDir: "Цей чат запущено з PASEO_CLAUDE_ACCOUNT={label}, але теки цього акаунта більше немає. Увійди в нього знову на екрані акаунтів або запусти чат без цієї змінної.",
  refuseAutoNone: "Цей чат не має акаунта Claude: Авто не знайшов жодного акаунта зі входом, і в {dir} теж ніхто не увійшов. Увійди на екрані акаунтів.",
  attachTitle: "Акаунт Claude",
  attachPickerTitle: "Почати цей чат на",
  attachSearch: "Пошук акаунтів",
  attachAutoTitle: "Обрати за лімітами",
  attachAccountText: "Цей чат запущено на акаунті Claude {label}.",
  attachAutoText: "Цей чат запущено на акаунті Claude з найпридатнішим лімітом.",
  pillTitle: "Акаунт цього чату",
  pillHint: "Вибір іншого перезапустить цей чат на ньому; розмова продовжиться.",
  autoPolicyLabel: "Як обирає Авто",
  autoPolicyHint: "Серед акаунтів із запасом. Майже вичерпані за 5 годин і повні йдуть останніми.",
  autoPolicyBurn: "Спершу той, у кого тиждень скинеться раніше",
  autoPolicyRoom: "Спершу той, у кого більше запасу",
  perWorkspaceLabel: "Один акаунт на задачу",
  perWorkspaceHint: "Перший вибір Авто у воркспейсі діє на всі його нові чати, доки не зміниться акаунт за замовчуванням. Вимкнено: кожен новий чат обирається окремо.",
  autoNowBadge: "Авто · зараз",
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
