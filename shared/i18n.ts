export type Locale = "en" | "ru" | "uk";

export interface Strings {
  sidebarTitle: string;
  accounts: string;
  screenSubtitle: string;
  notLoggedIn: string;
  /** Whose an account is when it is the person's own rather than a company seat. */
  personalAccount: string;
  logIn: string;
  noWorkspace: string;
  loginFailed: string;
  showUsage: string;
  fiveHourUsage: string;
  sevenDayUsage: string;
  resetIn: string;
  /** The units also stand on the pill, right after the number ("3д 62%"). Short: the pill sits
   *  above the composer on a phone too. */
  unitMin: string;
  unitHour: string;
  unitDay: string;
  /** Under a minute, in "refreshed 20 s ago". */
  unitSec: string;
  limitExhausted: string;
  limitNearly: string;
  spareAvailable: string;
  usageExpired: string;
  noUsageAllowance: string;
  usageUnsupported: string;
  usageUnknownAccount: string;
  usageReadFailed: string;
  usageRateLimited: string;
  usageTimedOut: string;
  usageNetworkFailed: string;
  usageNoToken: string;
  usageBadKeychain: string;
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
  switchFirstTurn: string;
  switchUnknownAccount: string;
  switchUnknownChat: string;
  switchArchived: string;
  switchProviderMismatch: string;
  switchNotApplied: string;
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
  /** On an account's card: new chats open on this account from now on. */
  newChatsHere: string;
  /** The armed button: a second press moves. */
  moveAllConfirm: string;
  moveAllRunning: string;
  /** The outcome, joined with " · ": `{moved}`, `{skipped}` (chats left alone: busy, or whose first turn is not saved) and
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
  /** Settings: how often a reading is taken again. */
  refreshIntervalLabel: string;
  refreshIntervalHint: string;
  /** The pill popover's round refresh buttons, one per account and one above the list. */
  refreshAccount: string;
  refreshAllAccounts: string;
  /** In the corner of a row in the popover: when it was last measured. `{ago}`: how long since. */
  updatedAgo: string;
  rowPaused: string;
  updatedJustNow: string;
  /** `{wait}`: how long the usage service asked to wait. */
  refreshHeld: string;
  /** Under the Accounts header while the saved overview is shown; `{time}` is when it was saved. */
  savedDataNote: string;
  /** The same while the refresh has failed. */
  savedDataFailed: string;
  /** The forecast card on the Accounts screen. */
  forecastMore: string;
  forecastLess: string;
  forecastHeroSpeedLead: string;
  forecastHeroSpeedNext: string;
  forecastHeroSpeedNote: string;
  forecastHeroLost: string;
  forecastHeroReset: string;
  forecastHeroBoost: string;
  forecastHeroSlowLead: string;
  forecastHeroCut: string;
  forecastHeroTarget: string;
  forecastHeroIdle: string;
  forecastHeroSlowNote: string;
  forecastHeroOpenDetails: string;
  forecastTitle: string;
  forecastHint: string;
  forecastNothingTicked: string;
  forecastNoReadings: string;
  forecastLoadFailed: string;
  forecastReserveNow: string;
  forecastUsableNow: string;
  forecastPace: string;
  forecastPaceValue: string;
  forecastAccuracy: string;
  forecastLevelHigh: string;
  forecastLevelMedium: string;
  forecastLevelLow: string;
  forecastLevelNone: string;
  forecastBand: string;
  forecastBasisBacktest: string;
  forecastBasisRule: string;
  forecastHistory: string;
  forecastHistoryRange: string;
  forecastHistoryNone: string;
  forecastHistoryUnderHour: string;
  forecastReadoutNow: string;
  forecastReadoutAt: string;
  forecastLegendReserve: string;
  forecastLegendBand: string;
  forecastLegendUsable: string;
  forecastLegendIdle: string;
  forecastLegendReset: string;
  forecastSlowTitle: string;
  forecastSlowLater: string;
  forecastSpeedTitle: string;
  forecastSpeedLimited: string;
  forecastIdleNowTitle: string;
  forecastIdleNowBody: string;
  forecastOnTrackTitle: string;
  forecastOnTrackBody: string;
  forecastTooLittle: string;
  forecastIdleHeading: string;
  forecastNoIdle: string;
  forecastIdleSpell: string;
  forecastIdleWeekly: string;
  forecastIdleShort: string;
  forecastWeekReset: string;
  forecastWeekIdle: string;
  forecastFiveReset: string;
  forecastFiveIdle: string;
  forecastNoFive: string;
  forecastLeftAtReset: string;
  forecastEmptyAt: string;
  forecastSpendable: string;
  forecastSpendableShort: string;
  forecastBasisLine: string;
  forecastSourceHistory: string;
  forecastSourceBlend: string;
  forecastSourceAverage: string;
  forecastSourceNone: string;
  forecastCostMeasured: string;
  forecastCostAssumed: string;
  forecastCapacitySame: string;
  forecastCapacityPlan: string;
  forecastCapacityManual: string;
  forecastCapacityHeading: string;
  forecastCapacityHint: string;
  forecastCapacityShow: string;
  forecastCapacityHide: string;
  forecastCapacityAuto: string;
  forecastOutLine: string;
  forecastOutNoMeter: string;
  forecastOutNoReading: string;
  forecastOutNoWeek: string;
  forecastOutNoReset: string;
  forecastOutNoCapacity: string;
  forecastAssumptionsHeading: string;
  forecastAssumePercentOnly: string;
  forecastAssumeSteadyPace: string;
  forecastAssumeEarliestFirst: string;
  forecastAssumeSpendCeiling: string;
  forecastAssumeWindowRestarts: string;
  forecastAssumeModelLimits: string;
  forecastAssumeSamePlan: string;
  forecastAssumePlanMultiple: string;
  forecastAssumeManual: string;
  forecastAssumeWindowCost: string;
  forecastAssumeThinHistory: string;
  forecastAssumeNoHistory: string;
  forecastAssumeOldReadings: string;
}

const en: Strings = {
  sidebarTitle: "Accounts",
  accounts: "Accounts",
  screenSubtitle: "Your accounts and their limits. A chat's account is changed in the pill above it.",
  notLoggedIn: "Not logged in",
  personalAccount: "Personal",
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
  usageRateLimited: "The usage service is limiting requests; it will be asked again after the wait.",
  usageTimedOut: "The reading did not finish in time.",
  usageNetworkFailed: "No connection to the usage service",
  usageNoToken: "This folder has no Claude login.",
  usageBadKeychain: "The login stored for this folder cannot be read.",
  claudeNotFound: "The claude command could not be found, so no account could be checked. Install Claude Code, or start Paseo from a terminal.",
  apiKeyOverride: "{var} is set in Paseo's environment, so Claude Code uses it instead of the account picked here. Remove it for switching to take effect.",
  pillNoAccount: "No account",
  currentAccount: "This chat runs on",
  switchTo: "Switch to",
  switchPaseoMissing: "Could not find the paseo command to restart the session",
  switchMissingDirectory: "That account's directory is gone",
  switchUnsupportedProvider: "This plugin cannot move a chat of that provider to another account",
  switchNotLoggedIn: "Nobody is logged in to that account's directory yet",
  switchFirstTurn: "This chat's first turn is not saved yet, and restarting it now would lose the conversation. Wait for the first reply, then switch.",
  switchUnknownAccount: "That account is not in the list any more",
  switchUnknownChat: "Paseo has no chat with this id",
  switchArchived: "This chat is archived, and restarting it would bring it back from the archive",
  switchProviderMismatch: "That account belongs to another provider than this chat",
  switchNotApplied: "The chat restarted but did not take that account, so its previous one is kept",
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
  languageAuto: "Same as Paseo",
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
  newChatsHere: "New chats here",
  moveAllConfirm: "Press again to move",
  moveAllRunning: "Moving…",
  moveAllDone: "Moved {moved}",
  moveAllBusy: "left alone: {skipped}",
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
  unitSec: "s",
  refreshIntervalLabel: "Auto-refresh",
  refreshIntervalHint: "How often accounts are measured again while Paseo is open. Very short intervals risk the usage service's rate limit.",
  refreshAccount: "Refresh this account",
  refreshAllAccounts: "Refresh all accounts",
  updatedAgo: "{ago} ago",
  rowPaused: "paused {wait}",
  updatedJustNow: "just now",
  refreshHeld: "The usage service asked to wait {wait}",
  savedDataNote: "Saved data from {time} · updating…",
  savedDataFailed: "Saved data from {time}",
  forecastMore: "Details: chart, accounts, assumptions",
  forecastLess: "Hide details",
  forecastHeroSpeedLead: "{account}: use it first",
  forecastHeroSpeedNext: "Now {now}, then {next}",
  forecastHeroSpeedNote: "From {from}, {extra} of {account}'s week can still be spent by then.",
  forecastHeroLost: "lost",
  forecastHeroReset: "reset",
  forecastHeroBoost: "pace",
  forecastHeroSlowLead: "Runs out {from}, idle until {to}",
  forecastHeroCut: "pace",
  forecastHeroTarget: "hold",
  forecastHeroIdle: "idle",
  forecastHeroSlowNote: "From now until {until}.",
  forecastHeroOpenDetails: "Nothing can be counted yet: open the details.",
  forecastTitle: "Reserve forecast",
  forecastHint: "Ticked accounts combined, as a share of their combined weekly capacity. The provider reports percentages only, so nothing here is in tokens.",
  forecastNothingTicked: "Tick an account to see its forecast.",
  forecastNoReadings: "Nothing to forecast yet: none of the ticked accounts has a reading.",
  forecastLoadFailed: "Could not load the forecast.",
  forecastReserveNow: "Reserve now",
  forecastUsableNow: "Usable right now",
  forecastPace: "Recent pace",
  forecastPaceValue: "{pace}% / h",
  forecastAccuracy: "Accuracy: {level}",
  forecastLevelHigh: "high",
  forecastLevelMedium: "medium",
  forecastLevelLow: "low",
  forecastLevelNone: "not enough data",
  forecastBand: "±{pct}% {basis}",
  forecastBasisBacktest: "(how far past days' pace missed the next day)",
  forecastBasisRule: "(a rule of thumb from how much history there is)",
  forecastHistory: "history {hours}",
  forecastHistoryRange: "history {from} to {to}",
  forecastHistoryNone: "no history yet",
  forecastHistoryUnderHour: "under an hour",
  forecastReadoutNow: "Now: reserve {reserve}, usable {usable}",
  forecastReadoutAt: "{at}: reserve {reserve} ({low}–{high}), usable {usable}",
  forecastLegendReserve: "Forecast reserve",
  forecastLegendBand: "Range at a faster and a slower pace",
  forecastLegendUsable: "Usable at that moment, given the 5-hour windows",
  forecastLegendIdle: "Idle: no ticked account has room",
  forecastLegendReset: "Weekly reset",
  forecastSlowTitle: "Slow down",
  forecastSlowLater: "Put it off until {at} and it takes a cut of {cut}.",
  forecastSpeedTitle: "You can speed up",
  forecastSpeedLimited: "The 5-hour windows limit this; the rest is lost however hard it is used.",
  forecastIdleNowTitle: "No room right now",
  forecastIdleNowBody: "No ticked account can take work until {until}.",
  forecastOnTrackTitle: "On track",
  forecastOnTrackBody: "At this pace no idle time is forecast and nothing worth using is lost at a reset.",
  forecastTooLittle: "Too little to go on for a pace yet. The chart shows the reserve as it stands.",
  forecastIdleHeading: "Expected idle",
  forecastNoIdle: "None expected.",
  forecastIdleSpell: "{from} – {to} ({length}, {cause})",
  forecastIdleWeekly: "weeks spent",
  forecastIdleShort: "5-hour windows spent",
  forecastWeekReset: "Week resets {at}",
  forecastWeekIdle: "Week not started",
  forecastFiveReset: "5 hours reset {at}",
  forecastFiveIdle: "5 hours not started",
  forecastNoFive: "no 5-hour window",
  forecastLeftAtReset: "Forecast left at the reset: {pct} of its week",
  forecastEmptyAt: "Its week runs out {at}, before the reset",
  forecastSpendable: "Can still be spent by the reset: {pct} of its week",
  forecastSpendableShort: "Can still be spent by the reset: only {pct} of its week, the 5-hour windows limit it",
  forecastBasisLine: "Pace {pace}% of its week / h ({source})",
  forecastSourceHistory: "last 24 h",
  forecastSourceBlend: "recent readings and the week's average",
  forecastSourceAverage: "average since the week began",
  forecastSourceNone: "no basis yet",
  forecastCostMeasured: "a 5-hour window costs {pct} of the week, measured",
  forecastCostAssumed: "a 5-hour window costs about {pct} of the week, assumed",
  forecastCapacitySame: "same plan as the others",
  forecastCapacityPlan: "capacity ×{n} from its plan",
  forecastCapacityManual: "capacity ×{n} set by hand",
  forecastCapacityHeading: "Capacity",
  forecastCapacityHint: "How big each account's limits are, in multiples of a Pro plan. Auto takes it from the plan where the plan says.",
  forecastCapacityShow: "Set capacities",
  forecastCapacityHide: "Hide capacities",
  forecastCapacityAuto: "Auto",
  forecastOutLine: "{account} is left out: {reason}",
  forecastOutNoMeter: "the provider has no usage meter",
  forecastOutNoReading: "its usage could not be read",
  forecastOutNoWeek: "it reports no weekly window",
  forecastOutNoReset: "the provider gave no reset time for its week",
  forecastOutNoCapacity: "the size of its plan is unknown; set its capacity above",
  forecastAssumptionsHeading: "What this rests on",
  forecastAssumePercentOnly: "The provider reports percentages and reset times only, so nothing here is in tokens.",
  forecastAssumeSteadyPace: "The recent pace is taken to carry on unchanged.",
  forecastAssumeEarliestFirst: "Work is taken to go to the account whose week resets soonest.",
  forecastAssumeSpendCeiling: "What can still be spent is limited by the windows alone, not by how fast you work.",
  forecastAssumeWindowRestarts: "After a reset, a new 5-hour window is taken to start with the next request.",
  forecastAssumeModelLimits: "Separate weekly limits per model (such as Opus) are not counted and can run out sooner.",
  forecastAssumeSamePlan: "The accounts are on one plan, so they are taken to have equal capacity.",
  forecastAssumePlanMultiple: "Capacity comes from each plan's multiple of Pro. Those multiples are published for the 5-hour window only, so weekly capacity may differ.",
  forecastAssumeManual: "Capacities set by hand are used as given.",
  forecastAssumeWindowCost: "What a 5-hour window costs of the week is not measured yet on some accounts; an assumed figure of at most 15% of the week is used.",
  forecastAssumeThinHistory: "Less than a day of readings on some accounts: their pace blends the recent readings with the week's average.",
  forecastAssumeNoHistory: "No readings to speak of on some accounts: their pace is the average since their week began.",
  forecastAssumeOldReadings: "Some readings are more than two hours old.",
};

const ru: Strings = {
  sidebarTitle: "Аккаунты",
  accounts: "Аккаунты",
  screenSubtitle: "Твои аккаунты и их лимиты. Аккаунт чата меняется в пилюле над ним.",
  notLoggedIn: "Не выполнен вход",
  personalAccount: "Личный",
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
  usageRateLimited: "Сервис лимитов ограничил запросы, повторю после паузы.",
  usageTimedOut: "Замер не успел завершиться.",
  usageNetworkFailed: "Нет связи с сервисом лимитов",
  usageNoToken: "В этой папке нет входа в Claude.",
  usageBadKeychain: "Сохранённый вход этой папки не читается.",
  claudeNotFound: "Не нашёл команду claude, поэтому ни один аккаунт не проверен. Установи Claude Code или запусти Paseo из терминала.",
  apiKeyOverride: "В окружении Paseo задан {var}, поэтому Claude Code использует его, а не выбранный здесь аккаунт. Убери его, чтобы переключение работало.",
  pillNoAccount: "Без аккаунта",
  currentAccount: "Этот чат идёт на",
  switchTo: "Переключиться на",
  switchPaseoMissing: "Не нашёл команду paseo, чтобы перезапустить сессию",
  switchMissingDirectory: "Директории этого аккаунта больше нет",
  switchUnsupportedProvider: "Этот плагин не умеет переносить чат этого провайдера на другой аккаунт",
  switchNotLoggedIn: "В директорию этого аккаунта ещё никто не вошёл",
  switchFirstTurn: "Первый ход этого чата ещё не сохранён, и перезапуск сейчас потеряет разговор. Дождись первого ответа, потом переключай.",
  switchUnknownAccount: "Этого аккаунта больше нет в списке",
  switchUnknownChat: "У Paseo нет чата с таким id",
  switchArchived: "Этот чат в архиве, и перезапуск вернул бы его из архива",
  switchProviderMismatch: "Этот аккаунт другого провайдера, чем чат",
  switchNotApplied: "Чат перезапустился, но не взял этот аккаунт, поэтому остаётся прежний",
  switchBusy: "Это прервёт текущий ход. Нажми ещё раз, чтобы всё равно переключиться.",
  pillAgentUnknown: "Пока не вижу этот чат.",
  pillLoadFailed: "Не удалось загрузить аккаунты.",
  retry: "Повторить",
  reload: "Обновить",
  reloading: "Обновляю…",
  reloadFailed: "Не удалось обновить.",
  pillEmptyTitle: "Аккаунтов пока нет",
  pillEmptyDetail: "Сначала добавь в разделе «Аккаунты».",
  defaultAccount: "Дефолт",
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
  languageAuto: "Как в Paseo",
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
  newChatsHere: "Новые чаты сюда",
  moveAllConfirm: "Нажми ещё раз",
  moveAllRunning: "Перевожу…",
  moveAllDone: "Переведено: {moved}",
  moveAllBusy: "оставлено как есть: {skipped}",
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
  unitSec: "с",
  refreshIntervalLabel: "Автообновление",
  refreshIntervalHint: "Как часто аккаунты измеряются заново, пока открыт Paseo. На совсем коротком интервале можно упереться в ограничение запросов сервиса лимитов.",
  refreshAccount: "Обновить этот аккаунт",
  refreshAllAccounts: "Обновить все аккаунты",
  updatedAgo: "{ago} назад",
  rowPaused: "пауза {wait}",
  updatedJustNow: "только что",
  refreshHeld: "Сервис лимитов попросил подождать {wait}",
  savedDataNote: "Сохранённые данные от {time} · обновляю…",
  savedDataFailed: "Сохранённые данные от {time}",
  forecastMore: "Подробнее: график, аккаунты, допущения",
  forecastLess: "Свернуть",
  forecastHeroSpeedLead: "{account}: используй его первым",
  forecastHeroSpeedNext: "Сейчас {now}, потом {next}",
  forecastHeroSpeedNote: "С {from} можно успеть потратить ещё {extra} недели {account}.",
  forecastHeroLost: "сгорит",
  forecastHeroReset: "сброс",
  forecastHeroBoost: "к темпу",
  forecastHeroSlowLead: "Кончится {from}, простой до {to}",
  forecastHeroCut: "темпа",
  forecastHeroTarget: "держать",
  forecastHeroIdle: "простой",
  forecastHeroSlowNote: "Отсюда и до {until}.",
  forecastHeroOpenDetails: "Пока нечего считать: открой подробности.",
  forecastTitle: "Прогноз запаса",
  forecastHint: "Отмеченные аккаунты вместе, в долях их общей недельной ёмкости. Провайдер отдаёт только проценты, поэтому токенов здесь нет.",
  forecastNothingTicked: "Отметь аккаунт, чтобы увидеть прогноз.",
  forecastNoReadings: "Пока не из чего считать: ни по одному отмеченному аккаунту нет замера.",
  forecastLoadFailed: "Не удалось загрузить прогноз.",
  forecastReserveNow: "Запас сейчас",
  forecastUsableNow: "Можно потратить сразу",
  forecastPace: "Недавний темп",
  forecastPaceValue: "{pace}% / ч",
  forecastAccuracy: "Точность: {level}",
  forecastLevelHigh: "высокая",
  forecastLevelMedium: "средняя",
  forecastLevelLow: "низкая",
  forecastLevelNone: "данных мало",
  forecastBand: "±{pct}% {basis}",
  forecastBasisBacktest: "(насколько темп прошлых дней расходился со следующими)",
  forecastBasisRule: "(грубое правило по длине истории)",
  forecastHistory: "история {hours}",
  forecastHistoryRange: "история от {from} до {to}",
  forecastHistoryNone: "истории пока нет",
  forecastHistoryUnderHour: "меньше часа",
  forecastReadoutNow: "Сейчас: запас {reserve}, можно потратить {usable}",
  forecastReadoutAt: "{at}: запас {reserve} ({low}–{high}), можно потратить {usable}",
  forecastLegendReserve: "Прогноз запаса",
  forecastLegendBand: "Разброс при быстром и медленном темпе",
  forecastLegendUsable: "Можно потратить в этот момент с учётом 5-часовых окон",
  forecastLegendIdle: "Простой: ни у одного отмеченного аккаунта нет места",
  forecastLegendReset: "Недельный сброс",
  forecastSlowTitle: "Притормози",
  forecastSlowLater: "Если отложить до {at}, сбавлять придётся на {cut}.",
  forecastSpeedTitle: "Можно прибавить",
  forecastSpeedLimited: "Упирается в 5-часовые окна: остальное сгорит, как ни старайся.",
  forecastIdleNowTitle: "Сейчас места нет",
  forecastIdleNowBody: "Ни один отмеченный аккаунт не примет работу до {until}.",
  forecastOnTrackTitle: "Идёшь ровно",
  forecastOnTrackBody: "В таком темпе простоя не ожидается, и на сбросах ничего заметного не сгорит.",
  forecastTooLittle: "Пока не из чего вывести темп. График показывает запас как он есть.",
  forecastIdleHeading: "Ожидаемый простой",
  forecastNoIdle: "Не ожидается.",
  forecastIdleSpell: "{from} – {to} ({length}, {cause})",
  forecastIdleWeekly: "недели выбраны",
  forecastIdleShort: "5-часовые окна выбраны",
  forecastWeekReset: "Сброс недели {at}",
  forecastWeekIdle: "Неделя не началась",
  forecastFiveReset: "сброс 5 часов {at}",
  forecastFiveIdle: "5 часов не начаты",
  forecastNoFive: "без 5-часового окна",
  forecastLeftAtReset: "Прогноз остатка к сбросу: {pct} его недели",
  forecastEmptyAt: "Его неделя кончится {at}, раньше сброса",
  forecastSpendable: "До сброса реально потратить: {pct} его недели",
  forecastSpendableShort: "До сброса реально потратить только {pct} его недели: упирается в 5-часовые окна",
  forecastBasisLine: "Темп {pace}% его недели / ч ({source})",
  forecastSourceHistory: "за последние 24 ч",
  forecastSourceBlend: "свежие замеры и среднее за неделю",
  forecastSourceAverage: "среднее с начала недели",
  forecastSourceNone: "пока не из чего считать",
  forecastCostMeasured: "5-часовое окно стоит {pct} недели, измерено",
  forecastCostAssumed: "5-часовое окно стоит примерно {pct} недели, допущение",
  forecastCapacitySame: "тот же тариф, что у остальных",
  forecastCapacityPlan: "ёмкость ×{n} по тарифу",
  forecastCapacityManual: "ёмкость ×{n} задана вручную",
  forecastCapacityHeading: "Ёмкость",
  forecastCapacityHint: "Насколько велики лимиты аккаунта, в кратных тарифу Pro. Авто берёт это из тарифа, если тариф об этом говорит.",
  forecastCapacityShow: "Задать ёмкости",
  forecastCapacityHide: "Скрыть ёмкости",
  forecastCapacityAuto: "Авто",
  forecastOutLine: "{account} не учтён: {reason}",
  forecastOutNoMeter: "у провайдера нет счётчика",
  forecastOutNoReading: "не удалось прочитать лимиты",
  forecastOutNoWeek: "нет недельного окна",
  forecastOutNoReset: "провайдер не дал время сброса недели",
  forecastOutNoCapacity: "размер тарифа неизвестен: задай ёмкость выше",
  forecastAssumptionsHeading: "На чём это держится",
  forecastAssumePercentOnly: "Провайдер отдаёт только проценты и время сброса, поэтому токенов здесь нет.",
  forecastAssumeSteadyPace: "Считается, что недавний темп сохранится.",
  forecastAssumeEarliestFirst: "Считается, что работа идёт на аккаунт, у которого неделя сбросится раньше всех.",
  forecastAssumeSpendCeiling: "«Реально потратить» ограничено только окнами, а не тем, как быстро ты работаешь.",
  forecastAssumeWindowRestarts: "После сброса новое 5-часовое окно считается начатым со следующего запроса.",
  forecastAssumeModelLimits: "Отдельные недельные лимиты моделей (например, Opus) не учитываются и могут кончиться раньше.",
  forecastAssumeSamePlan: "Аккаунты на одном тарифе, поэтому ёмкость считается равной.",
  forecastAssumePlanMultiple: "Ёмкость взята из множителя тарифа к Pro. Эти множители опубликованы только для 5-часового окна, недельная ёмкость может отличаться.",
  forecastAssumeManual: "Заданные вручную ёмкости берутся как есть.",
  forecastAssumeWindowCost: "Сколько недели стоит 5-часовое окно, у некоторых аккаунтов ещё не измерено: взято допущение, не больше 15% недели.",
  forecastAssumeThinHistory: "У некоторых аккаунтов замеров меньше чем за сутки: их темп смешан со средним за неделю.",
  forecastAssumeNoHistory: "У некоторых аккаунтов замеров почти нет: их темп взят как среднее с начала недели.",
  forecastAssumeOldReadings: "Часть замеров старше двух часов.",
};

const uk: Strings = {
  sidebarTitle: "Акаунти",
  accounts: "Акаунти",
  screenSubtitle: "Твої акаунти та їхні ліміти. Акаунт чату змінюється в пілюлі над ним.",
  notLoggedIn: "Вхід не виконано",
  personalAccount: "Особистий",
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
  usageRateLimited: "Сервіс лімітів обмежив запити, повторю після паузи.",
  usageTimedOut: "Замір не встиг завершитися.",
  usageNetworkFailed: "Немає зв’язку із сервісом лімітів",
  usageNoToken: "У цій теці немає входу в Claude.",
  usageBadKeychain: "Збережений вхід цієї теки не читається.",
  claudeNotFound: "Не знайшов команду claude, тому жоден акаунт не перевірено. Встанови Claude Code або запусти Paseo з термінала.",
  apiKeyOverride: "В оточенні Paseo задано {var}, тому Claude Code використовує його, а не обраний тут акаунт. Прибери його, щоб перемикання працювало.",
  pillNoAccount: "Без акаунта",
  currentAccount: "Цей чат іде на",
  switchTo: "Перемкнутися на",
  switchPaseoMissing: "Не знайшов команду paseo, щоб перезапустити сесію",
  switchMissingDirectory: "Директорії цього акаунта більше немає",
  switchUnsupportedProvider: "Цей плагін не вміє переносити чат цього провайдера на інший акаунт",
  switchNotLoggedIn: "До директорії цього акаунта ще ніхто не увійшов",
  switchFirstTurn: "Перший хід цього чату ще не збережено, і перезапуск зараз втратить розмову. Дочекайся першої відповіді, потім перемикай.",
  switchUnknownAccount: "Цього акаунта більше немає у списку",
  switchUnknownChat: "У Paseo немає чату з таким id",
  switchArchived: "Цей чат в архіві, і перезапуск повернув би його з архіву",
  switchProviderMismatch: "Цей акаунт іншого провайдера, ніж чат",
  switchNotApplied: "Чат перезапустився, але не взяв цей акаунт, тому лишається попередній",
  switchBusy: "Це перерве поточний хід. Натисни ще раз, щоб усе одно перемкнути.",
  pillAgentUnknown: "Поки не бачу цей чат.",
  pillLoadFailed: "Не вдалося завантажити акаунти.",
  retry: "Повторити",
  reload: "Оновити",
  reloading: "Оновлюю…",
  reloadFailed: "Не вдалося оновити.",
  pillEmptyTitle: "Акаунтів поки немає",
  pillEmptyDetail: "Спочатку додай у розділі «Акаунти».",
  defaultAccount: "Дефолт",
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
  languageAuto: "Як у Paseo",
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
  newChatsHere: "Нові чати сюди",
  moveAllConfirm: "Натисни ще раз",
  moveAllRunning: "Переводжу…",
  moveAllDone: "Переведено: {moved}",
  moveAllBusy: "залишено як є: {skipped}",
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
  unitSec: "с",
  refreshIntervalLabel: "Автооновлення",
  refreshIntervalHint: "Як часто акаунти вимірюються заново, поки відкрито Paseo. На зовсім короткому інтервалі можна впертися в обмеження запитів сервісу лімітів.",
  refreshAccount: "Оновити цей акаунт",
  refreshAllAccounts: "Оновити всі акаунти",
  updatedAgo: "{ago} тому",
  rowPaused: "пауза {wait}",
  updatedJustNow: "щойно",
  refreshHeld: "Сервіс лімітів попросив зачекати {wait}",
  savedDataNote: "Збережені дані від {time} · оновлюю…",
  savedDataFailed: "Збережені дані від {time}",
  forecastMore: "Детальніше: графік, акаунти, припущення",
  forecastLess: "Згорнути",
  forecastHeroSpeedLead: "{account}: використай його першим",
  forecastHeroSpeedNext: "Зараз {now}, потім {next}",
  forecastHeroSpeedNote: "З {from} можна встигнути витратити ще {extra} тижня {account}.",
  forecastHeroLost: "згорить",
  forecastHeroReset: "скидання",
  forecastHeroBoost: "до темпу",
  forecastHeroSlowLead: "Скінчиться {from}, простій до {to}",
  forecastHeroCut: "темпу",
  forecastHeroTarget: "тримати",
  forecastHeroIdle: "простій",
  forecastHeroSlowNote: "Звідси й до {until}.",
  forecastHeroOpenDetails: "Поки нічого рахувати: відкрий деталі.",
  forecastTitle: "Прогноз запасу",
  forecastHint: "Позначені акаунти разом, у частках їхньої спільної тижневої ємності. Провайдер віддає лише відсотки, тому токенів тут немає.",
  forecastNothingTicked: "Познач акаунт, щоб побачити прогноз.",
  forecastNoReadings: "Поки немає з чого рахувати: жоден позначений акаунт не має заміру.",
  forecastLoadFailed: "Не вдалося завантажити прогноз.",
  forecastReserveNow: "Запас зараз",
  forecastUsableNow: "Можна витратити одразу",
  forecastPace: "Нещодавній темп",
  forecastPaceValue: "{pace}% / год",
  forecastAccuracy: "Точність: {level}",
  forecastLevelHigh: "висока",
  forecastLevelMedium: "середня",
  forecastLevelLow: "низька",
  forecastLevelNone: "даних замало",
  forecastBand: "±{pct}% {basis}",
  forecastBasisBacktest: "(наскільки темп минулих днів розходився з наступними)",
  forecastBasisRule: "(грубе правило за довжиною історії)",
  forecastHistory: "історія {hours}",
  forecastHistoryRange: "історія від {from} до {to}",
  forecastHistoryNone: "історії поки немає",
  forecastHistoryUnderHour: "менше години",
  forecastReadoutNow: "Зараз: запас {reserve}, можна витратити {usable}",
  forecastReadoutAt: "{at}: запас {reserve} ({low}–{high}), можна витратити {usable}",
  forecastLegendReserve: "Прогноз запасу",
  forecastLegendBand: "Розкид за швидшого й повільнішого темпу",
  forecastLegendUsable: "Можна витратити цієї миті з огляду на 5-годинні вікна",
  forecastLegendIdle: "Простій: жоден позначений акаунт не має місця",
  forecastLegendReset: "Тижневе скидання",
  forecastSlowTitle: "Пригальмуй",
  forecastSlowLater: "Якщо відкласти до {at}, знижувати доведеться на {cut}.",
  forecastSpeedTitle: "Можна додати",
  forecastSpeedLimited: "Упирається в 5-годинні вікна: решта згорить, хоч як старайся.",
  forecastIdleNowTitle: "Зараз місця немає",
  forecastIdleNowBody: "Жоден позначений акаунт не прийме роботу до {until}.",
  forecastOnTrackTitle: "Йдеш рівно",
  forecastOnTrackBody: "У такому темпі простою не очікується, і на скиданнях нічого помітного не згорить.",
  forecastTooLittle: "Поки немає з чого вивести темп. Графік показує запас як він є.",
  forecastIdleHeading: "Очікуваний простій",
  forecastNoIdle: "Не очікується.",
  forecastIdleSpell: "{from} – {to} ({length}, {cause})",
  forecastIdleWeekly: "тижні вичерпано",
  forecastIdleShort: "5-годинні вікна вичерпано",
  forecastWeekReset: "Скидання тижня {at}",
  forecastWeekIdle: "Тиждень не почався",
  forecastFiveReset: "скидання 5 годин {at}",
  forecastFiveIdle: "5 годин не почато",
  forecastNoFive: "без 5-годинного вікна",
  forecastLeftAtReset: "Прогноз залишку до скидання: {pct} його тижня",
  forecastEmptyAt: "Його тиждень скінчиться {at}, раніше за скидання",
  forecastSpendable: "До скидання реально витратити: {pct} його тижня",
  forecastSpendableShort: "До скидання реально витратити лише {pct} його тижня: упирається в 5-годинні вікна",
  forecastBasisLine: "Темп {pace}% його тижня / год ({source})",
  forecastSourceHistory: "за останні 24 год",
  forecastSourceBlend: "свіжі заміри й середнє за тиждень",
  forecastSourceAverage: "середнє з початку тижня",
  forecastSourceNone: "поки немає з чого рахувати",
  forecastCostMeasured: "5-годинне вікно коштує {pct} тижня, виміряно",
  forecastCostAssumed: "5-годинне вікно коштує приблизно {pct} тижня, припущення",
  forecastCapacitySame: "той самий тариф, що в інших",
  forecastCapacityPlan: "ємність ×{n} за тарифом",
  forecastCapacityManual: "ємність ×{n} задано вручну",
  forecastCapacityHeading: "Ємність",
  forecastCapacityHint: "Наскільки великі ліміти акаунта, у кратних тарифу Pro. Авто бере це з тарифу, якщо тариф про це каже.",
  forecastCapacityShow: "Задати ємності",
  forecastCapacityHide: "Сховати ємності",
  forecastCapacityAuto: "Авто",
  forecastOutLine: "{account} не враховано: {reason}",
  forecastOutNoMeter: "провайдер не має лічильника",
  forecastOutNoReading: "не вдалося прочитати ліміти",
  forecastOutNoWeek: "немає тижневого вікна",
  forecastOutNoReset: "провайдер не дав час скидання тижня",
  forecastOutNoCapacity: "розмір тарифу невідомий: задай ємність вище",
  forecastAssumptionsHeading: "На чому це тримається",
  forecastAssumePercentOnly: "Провайдер віддає лише відсотки й час скидання, тому токенів тут немає.",
  forecastAssumeSteadyPace: "Вважається, що нещодавній темп збережеться.",
  forecastAssumeEarliestFirst: "Вважається, що робота йде на акаунт, у якого тиждень скинеться найраніше.",
  forecastAssumeSpendCeiling: "«Реально витратити» обмежено лише вікнами, а не тим, як швидко ти працюєш.",
  forecastAssumeWindowRestarts: "Після скидання нове 5-годинне вікно вважається розпочатим із наступного запиту.",
  forecastAssumeModelLimits: "Окремі тижневі ліміти моделей (наприклад, Opus) не враховуються і можуть скінчитися раніше.",
  forecastAssumeSamePlan: "Акаунти на одному тарифі, тому ємність вважається рівною.",
  forecastAssumePlanMultiple: "Ємність узято з множника тарифу до Pro. Ці множники опубліковано лише для 5-годинного вікна, тижнева ємність може відрізнятися.",
  forecastAssumeManual: "Задані вручну ємності беруться як є.",
  forecastAssumeWindowCost: "Скільки тижня коштує 5-годинне вікно, у деяких акаунтів ще не виміряно: узято припущення, не більше 15% тижня.",
  forecastAssumeThinHistory: "У деяких акаунтів замірів менш ніж за добу: їхній темп змішано із середнім за тиждень.",
  forecastAssumeNoHistory: "У деяких акаунтів замірів майже немає: їхній темп узято як середнє з початку тижня.",
  forecastAssumeOldReadings: "Частина замірів старша за дві години.",
};

/** Failures the daemon reports in English, since it does not know who is reading. */
export const USAGE_RATE_LIMITED = "rate limited by the usage endpoint";
export const USAGE_NOT_IN_TIME = "the reading did not finish in time";
export const USAGE_NO_TOKEN = "this config directory has no claude.ai token";
export const USAGE_BAD_KEYCHAIN = "the Keychain item for this config directory is not JSON";

/** A failure from the daemon in the reader's language, where it is one of ours or the network's. */
export function usageErrorText(raw: string, strings: Strings): string {
  if (raw === USAGE_RATE_LIMITED) return strings.usageRateLimited;
  if (raw === USAGE_NOT_IN_TIME) return strings.usageTimedOut;
  if (raw === USAGE_NO_TOKEN) return strings.usageNoToken;
  if (raw === USAGE_BAD_KEYCHAIN) return strings.usageBadKeychain;
  const network = /^fetch failed(?: \((.+)\))?$/.exec(raw);
  if (network === null) return raw;
  return network[1] === undefined ? strings.usageNetworkFailed : `${strings.usageNetworkFailed} (${network[1]})`;
}

/**
 * The language for "same as Paseo". `host` is what Paseo says it runs in (0.15 and newer, null
 * before), `setting` its saved language where that can be read, null for "system" or unknown.
 * A language this catalogue lacks reads English. Paseo has no Ukrainian: on a Ukrainian device
 * left on "system" it falls back to English, and the plugin, which has Ukrainian, need not.
 */
export function pickLocale(host: string | null, setting: string | null, device: Locale): Locale {
  if (host === null) return setting === null ? device : resolveLocale(setting);
  const locale = resolveLocale(host);
  return locale === "en" && setting === null && device === "uk" ? "uk" : locale;
}

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
