import {
  sendMessage,
  answerCallback,
  editMessageText,
  deleteMessage,
  isGroupAdmin,
  telegramRequest,
  setMyCommands,
} from "./telegram";
import {
  mainMenuKeyboard,
  postMeowKeyboard,
  groupSettingsKeyboard,
  treasuryKeyboard,
  lotteryKeyboard,
  duelKeyboard,
  eventInlineKeyboard,
  boosterKeyboard,
} from "./keyboards";
import {
  ensureUser,
  ensureGroup,
  deactivateGroup,
  getGroupSettings,
  getGroupLotteryConfig,
  getUserStats,
  getGroupMemberBalance,
  getGroupRank,
  getGroupDailyLeaderboard,
  findUserByUsername,
  distributeGroupTax,

  setGroupLotteryTicketPrice,
  setGroupLotteryPot,
  purchaseLotteryTickets,
  drawLotteryRound,
  allocatePendingLotteryTickets,
  getLotteryParticipants,
  getRecentGroupTreasuryTransactions,
  getBotSetting,
  applyPayTransfer,
  getDuelRating,
  getDuelLeaderboard,
  getActiveTitle,
  getBoosterStatus,
  buyBooster,
  getActiveBoosterMultiplier,
  getNotificationsEnabled,
  setNotificationsEnabled,
  getLotteryWins,
  getGroupStats,
} from "./database";
import {
  createDuel,
  getDuel,
  deleteDuel,
  findOpenDuelAgainst,
  computeElo,
} from "./duel";
import {
  escapeHtml,
  formatDuration,
  safeParseAmount,
  normalizeUsername,
  isMeow,
  generateDuelId,
  isValidDuelId,
  parseEventCommand,
  toEnglishNumbers,
} from "./utils";
import { handleAdmin, handleOwnerPanelAction } from "./owner";
import { handlePokerCallback, handlePokerCommand } from "./pokerHandlers";
import { handleBlackjackCallback, handleBlackjackCommand } from "./blackjackHandlers";
import { handleTitleCallback, titleBadge } from "./titleAuction";
import { findBoosterTier, BOOSTER_COOLDOWN_SEC } from "./constants";
import {
  Bindings,
  DuelState,
  RequestContext,
  TelegramCallbackQuery,
  TelegramMessage,
  TelegramChat,
  TelegramChatMemberUpdated,
  TelegramUser,
} from "./types";
import {
  DUEL_TIMEOUT_SEC,
  DICE_COOLDOWN_SEC,
} from "./constants";

const MEOW_TIERS = [
  {
    id: 1,
    key: "street",
    label: "گربه‌ی خیابونی",
    emoji: "🐈",
    defaultMinPoints: 1,
    defaultMaxPoints: 200,
    defaultChance: 0.33,
    variants: [
      `🐈 یه گربه‌ی ژولیده از پشت بوم پرید روی شونه‌ت و تو گوشت گفت: «میو!»\n+{points} امتیاز`,
      `🐈 گربه‌ی خیابونی کفشت رو بو کرد، یه اخمی کرد و بعد با تأیید سر تکون داد. تأیید شد!\n+{points} امتیاز`,
      `🐈 یه گربه‌ی خیس از بارون اومد چسبید به پات. بعدش یه جیبِ پر از شانس برات جا گذاشت!\n+{points} امتیاز`,
      `🐈 گربه‌ی خیابونی یه تیکه ماهی از یه جایی آورد و جلوت گذاشت. پاداش شجاعت توئه!\n+{points} امتیاز`,
      `🐈 گربه‌ی خیابونی نگات کرد، چرخید و دمش رو بلند کرد. توی زبان گربه‌ها یعنی: «تو اوکی هستی!»\n+{points} امتیاز`,
      `🐈 از پشت یه ماشین، یه جفت چشم گربه‌ای بهت چشمک زد. یه چشمک = یه عالمه شانس!\n+{points} امتیاز`,
      `🐈 گربه‌ی خیابونی نیمه‌شب‌ها از اینجا رد می‌شه. میگن هر کی بهش میو بگه، شانسی ازش رد می‌شه!\n+{points} امتیاز`,
      `🐈 گربه‌ی خیابونی یه موشِ گنده رو نشون داد و گفت: «ببین چی گرفتم! تو هم بگیر!»\n+{points} امتیاز`,
      `🐈 گربه‌ی خیابونی روی جعبه‌های خالی نشسته بود و با یه نگاه فیلسوفانه گفت: «میو یعنی زندگی.»\n+{points} امتیاز`,
      `🐈 یه گربه‌ی کثیف ولی بانمک اومد و مالید به پات. هرکی گربه بهش بماله، پولش زیاد می‌شه! باور کن!\n+{points} امتیاز`,
      `🐈 گربه‌ی خیابونی امروز صبح توی حیاطت چرت می‌زد. چرت گربه‌ای = انرژی مثبت برای کل روز!\n+{points} امتیاز`,
    ],
    nightVariants: [
      `🌙 گربه‌ی شبگرد از روی دیوار رد شد و تاریکی رو با چشم‌هاش روشن کرد. بهت شانس شب داد!\n+{points} امتیاز`,
      `🌙 نیمه‌شبه. یه گربه از توی سایه اومد بیرون، یه چیزی زیر گوشت گفت و دوباره رفت. خوب بود!\n+{points} امتیاز`,
      `🌙 گربه‌ی خیابونی زیر نور ماه نشسته بود و برای ستاره‌ها میو می‌گفت. یکی از اون میوها مال تو بود!\n+{points} امتیاز`,
      `🌙 تو تاریکی فقط چشم‌های یه گربه دیده می‌شد. بهت خیره شد… و بعدش یه عالمه شانس ریخت تو جیبت!\n+{points} امتیاز`,
    ],
  },
  {
    id: 2,
    key: "lucky",
    label: "گربه‌ی لوسی",
    emoji: "😼",
    defaultMinPoints: 201,
    defaultMaxPoints: 500,
    defaultChance: 0.55,
    variants: [
      `😼 گربه‌ی لوسی با یه چشم بسته و یه چشم باز نگات کرد. اون موقعه که می‌فهمی شانس توی گوشه‌ست!\n+{points} امتیاز`,
      `😼 گربه‌ی لوسی همیشه روی چهار تا پاش فرود میاد. امروز هم روی حساب بانکیت فرود اومد!\n+{points} امتیاز`,
      `😼 گربه‌ی لوسی یه سکه‌ی بخت‌آور از پشت گوشش درآورد و انداخت توی جیبت. مال خودت!\n+{points} امتیاز`,
      `😼 گربه‌ی لوسی هفت بار دورت چرخید و بعد آروم شد. عدد شانس تو همینه!\n+{points} امتیاز`,
      `😼 گربه‌ی لوسی خرخرش رو راه انداخت. صدای خرخر گربه = بهترین ریمیکس دنیا + شانس!\n+{points} امتیاز`,
      `😼 گربه‌ی لوسی یه پلک زد و یه‌و یه تیکه از شانسش ریخت بیرون. تو بودی که گرفتیش!\n+{points} امتیاز`,
      `😼 گربه‌ی لوسی همیشه یه قدم جلوتر از بدشانسیه. امروز تو رو هم با خودش برد!\n+{points} امتیاز`,
      `😼 گربه‌ی لوسی کفش راستت رو لیس زد. طبق افسانه‌ی گربه‌ها، یعنی روزت مثبته!\n+{points} امتیاز`,
      `😼 گربه‌ی لوسی توی آینه به خودش نگاه کرد و گفت: «کی از من خوش‌شانس‌تره؟» جواب دادیم: تو!\n+{points} امتیاز`,
      `😼 گربه‌ی لوسی یه موشِ خوش‌شانس هم داره. ولی امروز شانس رو به تو داد!\n+{points} امتیاز`,
      `😼 گربه‌ی لوسی سه بار چرخید و بعد روی یه پا نشست. اون لحظه یعنی یه خبر خوب در راهه!\n+{points} امتیاز`,
    ],
  },
  {
    id: 3,
    key: "rainbow",
    label: "گربه‌ی رنگین‌کمانی",
    emoji: "🌈",
    defaultMinPoints: 501,
    defaultMaxPoints: 900,
    defaultChance: 0.085,
    variants: [
      `🌈 یه گربه‌ی رنگین‌کمانی از توی بارون پرید بیرون و یه کم از رنگ‌هاش رو روی تو پاشید!\n+{points} امتیاز`,
      `🌈 گربه‌ی رنگین‌کمانی از اون سر رنگین‌کمون اومد. میگن آخرش یه گلدون شانس منتظره!\n+{points} امتیاز`,
      `🌈 یه گربه‌ی راه‌راه رنگی دورت چرخید و با دمش یه رنگین‌کمون کوچیک کشید!\n+{points} امتیاز`,
      `🌈 گربه‌ی رنگین‌کمانی یه جعبه‌ی رنگ همیشه با خودش داره. امروز یه عالمه رنگ داد به روزت!\n+{points} امتیاز`,
      `🌈 گربه‌ی رنگین‌کمانی از توی یه ابر رنگی اومد پایین و یه پاکت شانس بهت داد!\n+{points} امتیاز`,
      `🌈 گربه‌ی رنگین‌کمانی گفت: «خاکستری برای گربه‌های معمولیه. تو رنگی شدی!»\n+{points} امتیاز`,
      `🌈 یه بارون اومد و گربه‌ی رنگین‌کمانی از توش بیرون پرید. هر کی پیداش کنه، روزش رنگ می‌گیره!\n+{points} امتیاز`,
      `🌈 گربه‌ی رنگین‌کمانی هفت تا رنگ رو هفت بار دورت چرخوند. همهشون گفتن: خوش‌شانسی!\n+{points} امتیاز`,
      `🌈 یه رد پای رنگارنگ از جلوت رد شد و یه‌و محو شد. ردپای گربه‌ی رنگین‌کمانی!\n+{points} امتیاز`,
    ],
  },
  {
    id: 4,
    key: "legend",
    label: "گربه‌ی افسانه‌ای",
    emoji: "✨",
    defaultMinPoints: 901,
    defaultMaxPoints: 1300,
    defaultChance: 0.025,
    variants: [
      `✨ گربه‌ی افسانه‌ای از دل یه قصه‌ی قدیمی اومد بیرون و گفت: «امروز تو شخصیت اصلی شدی.»\n+{points} امتیاز`,
      `✨ گربه‌ی افسانه‌ای یه معما ازت پرسید و قبل از جواب دادنت خندید: «آفرین! درست گفتی!»\n+{points} امتیاز`,
      `✨ گربه‌ی افسانه‌ای هزار ساله و هنوز جوونه. میگه رازش میو کردنه. حالا مال توئه!\n+{points} امتیاز`,
      `✨ گربه‌ی افسانه‌ای با پنجه‌ش یه دایره‌ی جادویی دورت کشید. هیچ بدشانسی حق ورود نداره!\n+{points} امتیاز`,
      `✨ گربه‌ی افسانه‌ای از توی یه کتاب قدیمی اومد بیرون. میگن هرکی باهاش میو بگه، توی قصه‌ها می‌مونه!\n+{points} امتیاز`,
      `✨ گربه‌ی افسانه‌ای نگات کرد و گفت: «من هزار تا راز می‌دونم. یکی رو امروز به تو میگم.»\n+{points} امتیاز`,
      `✨ یه نور سبز شد و گربه‌ی افسانه‌ای جلوت ظاهر شد. این گربه فقط برای آدم‌های خاص میاد!\n+{points} امتیاز`,
      `✨ گربه‌ی افسانه‌ای یه پنجه‌ش رو بالا آورد و یه ستاره‌ی کوچیک ازش افتاد تو دستت!\n+{points} امتیاز`,
      `✨ گربه‌ی افسانه‌ای با یه پلک زدن از یه قصه اومد توی قصه‌ی تو. حالا هر دو تون توی یه صفحه‌اید!\n+{points} امتیاز`,
    ],
  },
  {
    id: 5,
    key: "king",
    label: "گربه‌ی پادشاه",
    emoji: "👑",
    defaultMinPoints: 1301,
    defaultMaxPoints: 1700,
    defaultChance: 0.007,
    variants: [
      `👑 گربه‌ی پادشاه تاجش رو کج کرد و گفت: «امروز تو رو انتخاب کردم، بنده‌ی من.»\n+{points} امتیاز`,
      `👑 گربه‌ی پادشاه با یه خرخرِ سلطنتی اعلام کرد: «از این به بعد، تو جزو درباریان منی!»\n+{points} امتیاز`,
      `👑 گربه‌ی پادشاه عصاش رو نشون داد و یه برکت سلطنتی بهت داد. تعظیم کن!\n+{points} امتیاز`,
      `👑 گربه‌ی پادشاه شنید امروز میو گفتی و گفت: «بسیار خب، جایزه‌ی وفاداری!»\n+{points} امتیاز`,
      `👑 گربه‌ی پادشاه فقط یک بار در روز ظاهر می‌شه. و اون یک بار، الان بود!\n+{points} امتیاز`,
      `👑 گربه‌ی پادشاه خزید روی تختش (یه مبل کهنه) و گفت: «این برکت رو از دست نده!»\n+{points} امتیاز`,
      `👑 گربه‌ی پادشاه نگات کرد و سبیل‌هاش رو صاف کرد: «من تو رو می‌پسندم.»\n+{points} امتیاز`,
      `👑 گربه‌ی پادشاه به درباریانش اشاره کرد که یه صندوق پر از شانس بیارن. صندوق رو گذاشتن جلوی تو!\n+{points} امتیاز`,
    ],
  },
  {
    id: 6,
    key: "diamond",
    label: "گربه‌ی الماسی",
    emoji: "💎",
    defaultMinPoints: 1701,
    defaultMaxPoints: 2200,
    defaultChance: 0.0025,
    variants: [
      `💎 گربه‌ی الماسی از توی نور خورشید اومد بیرون و یه الماس واقعی از دمش افتاد!\n+{points} امتیاز`,
      `💎 گربه‌ی الماسی اگه بخنده، اشکش الماس می‌شه. امروز جلوی تو خندید!\n+{points} امتیاز`,
      `💎 گربه‌ی الماسی دورت چرخید و هرجا رد شد، زمین برق زد. آخرش یه تیکه‌ش رو به تو داد!\n+{points} امتیاز`,
      `💎 گربه‌ی الماسی توی تاریکی می‌درخشه. امشب کنار تو درخشید!\n+{points} امتیاز`,
      `💎 گربه‌ی الماسی گفت: «الماس‌ها از فشار درست می‌شن. تو هم مثل الماس شدی!»\n+{points} امتیاز`,
      `💎 گربه‌ی الماسی یه پنجه‌ش رو دراز کرد و یه جواهر کوچیک گذاشت توی دستت!\n+{points} امتیاز`,
      `💎 یه برق الماسی توی هوا چرخید و یه گربه‌ی درخشان جلوت ایستاد. الماس‌ها تعظیم کردن!\n+{points} امتیاز`,
    ],
  },
  {
    id: 7,
    key: "galaxy",
    label: "گربه‌ی کهکشانی",
    emoji: "🌌",
    defaultMinPoints: 2201,
    defaultMaxPoints: 3000,
    defaultChance: 0.0005,
    variants: [
      `🌌 یه فلاش نور! گربه‌ی کهکشانی از دل ستاره‌ها اومد و یه ستاره از پنجه‌ش افتاد!\n+{points} امتیاز`,
      `🌌 گربه‌ی کهکشانی با کهکشون تماس گرفت و گفت: «مقررات اجازه می‌ده یک بار بهت جایزه بدم.»\n+{points} امتیاز`,
      `🌌 گربه‌ی کهکشانی از یه سیاره‌ی دیگه اومده تا میو بگه. این اولین میوی فضایی توی گروهته!\n+{points} امتیاز`,
      `🌌 گربه‌ی کهکشانی وقتی میو می‌کنه، ستاره‌ها چشمک می‌زنن. الان داشتن چشمک می‌زدن!\n+{points} امتیاز`,
      `🌌 گربه‌ی کهکشانی یه تیکه از دنباله‌دارش رو بهت داد و گفت: «یه آرزو کن.»\n+{points} امتیاز`,
      `🌌 گربه‌ی کهکشانی توی جیبش یه سیاره‌ی کوچیک داره. امروز اون سیاره رو به اسم تو کرد!\n+{points} امتیاز`,
      `🌌 گربه‌ی کهکشانی از توی یه سیاه‌چاله اومد بیرون و گفت: «اون طرف همه‌شون میو می‌گن.»\n+{points} امتیاز`,
      `🌌 گربه‌ی کهکشانی نگاهت کرد، ستاره‌ها توی چشماش چرخیدن و گفت: «تو خاصی.»\n+{points} امتیاز`,
    ],
  },
  {
    id: 8,
    key: "supernova",
    label: "گربه‌ی ابرنواختری",
    emoji: "💥",
    defaultMinPoints: 3001,
    defaultMaxPoints: 4000,
    defaultChance: 0.0003,
    variants: [
      `💥 انفجار! یه ابرنواختر منفجر شد و از دلش یه گربه‌ی درخشان بیرون اومد که داشت میو می‌گفت!\n+{points} امتیاز`,
      `💥 گربه‌ی ابرنواختری از توی یه ستاره‌ی در حال انفجار بیرون پرید و گفت: «من از آتیش اومدم، بیا شانست رو بگیر!»\n+{points} امتیاز`,
      `💥 آسمون یه‌و روشن شد! یه ابرنواختر داشت می‌درخشید و وسطش یه گربه بود که با دمش شکل قلب می‌کشید!\n+{points} امتیاز`,
      `💥 گربه‌ی ابرنواختری یه تیکه از انرژی هسته‌ایش رو بهت داد و گفت: «این بیشتر از اون چیزیه که فکر می‌کنی!»\n+{points} امتیاز`,
      `💥 یه نور خیره‌کنننده! وقتی چشماتو باز کردی، یه گربهی ابرنواختری جلوت بود و می‌گفت: «من آخرین نوری‌ام که می‌بینی!»\n+{points} امتیاز`,
      `💥 گربه‌ی ابرنواختری از توی یه کلونی ستاره‌ای اومد و با یه پنجه‌ش یه سحابی کوچیک بهت هدیه داد!\n+{points} امتیاز`,
      `💥 یه انفجار کیهانی رخ داد و از دلش یه گربه بیرون اومد که داشت روی ابرهای گازی راه می‌رفت. بهت اشاره کرد: «بیا بالا!»\n+{points} امتیاز`,
      `💥 گربه‌ی ابرنواختری گفت: «من از بقیه‌ی گربه‌ها قوی‌ترم. چون از دل یه ستاره‌ی منفجر شده اومدم!»\n+{points} امتیاز`,
    ],
    nightVariants: [
      `🌙💥 نیمه‌شب آسمون یه‌و سفید شد! یه ابرنواختر داشت منفجر می‌شد و وسطش یه گربه بود که داشت میو می‌گفت.\n+{points} امتیاز`,
      `🌙💥 توی تاریکی شب، ناگهان یه نور خیره‌کننده اومد و یه گربه‌ی ابرنواختری جلوت ظاهر شد. گفت: «من نور تاریکی‌ام!»\n+{points} امتیاز`,
    ],
  },
  {
    id: 9,
    key: "phoenix",
    label: "گربه‌ی ققنوسی",
    emoji: "🔥",
    defaultMinPoints: 4001,
    defaultMaxPoints: 5500,
    defaultChance: 0.0002,
    variants: [
      `🔥 آتیش! یه ققنوس از توی شعله‌ها بیرون اومد و روی شونه‌ت نشست. گفت: «از خاکستر، شانس تو متولد شد!»\n+{points} امتیاز`,
      `🔥 گربه‌ی ققنوسی از توی یه آتیش بزرگ بیرون پرید و دمش مثل یه مشعل می‌سوخت. گفت: «من نمی‌سوزم، تو هم نمی‌سوزی!»\n+{points} امتیاز`,
      `🔥 یه شعله‌ی طلایی از آسمون اومد پایین و وسطش یه ققنوس گربه‌ای بود که داشت می‌خوند: «از خاکستر برمی‌خیزم!»\n+{points} امتیاز`,
      `🔥 گربه‌ی ققنوسی یه پر از دمش کند و انداخت جلوت. پر شروع به سوختن کرد ولی گرماش فقط بهت انرژی داد!\n+{points} امتیاز`,
      `🔥 ققنوس گربه‌ای دورت چرخید و هرجا رد شد، آتیشش به گل تبدیل شد. آخرش یه دسته گل آتیشی بهت داد!\n+{points} امتیاز`,
      `🔥 گربه‌ی ققنوسی گفت: «من هزار بار مردم و هزار بار زنده شدم. تو هم هر روز یه بار زنده می‌شی — با میو!»\n+{points} امتیاز`,
      `🔥 یه بال ققنوس از آسمون افتاد جلوت و شروع به سوختن کرد. وقتی خاموش شد، یه تیکه شانس وسطش بود!\n+{points} امتیاز`,
      `🔥 گربه‌ی ققنوسی توی آتیش راه می‌رفت و هر قدمش یه ستاره روشن می‌کرد. یکی از اون ستاره‌ها مال تو بود!\n+{points} امتیاز`,
    ],
    nightVariants: [
      `🌙🔥 توی تاریکی شب، یه نور آتیشی اومد و یه ققنوس گربه‌ای از شعله‌ها بیرون اومد. گفت: «من نور شبم!»\n+{points} امتیاز`,
      `🌙🔥 نیمه‌شب آسمون سرخ شد و یه ققنوس گربه‌ای از دل آتیش بیرون اومد. گفت: «بیدار شو، شانت اومده!»\n+{points} امتیاز`,
    ],
  },
  {
    id: 10,
    key: "dragon",
    label: "گربه‌ی اژدهایی",
    emoji: "🐉",
    defaultMinPoints: 5501,
    defaultMaxPoints: 7500,
    defaultChance: 0.00015,
    variants: [
      `🐉 زمین لرزید! یه اژدها-گربه از توی کوه آتشفشانی بیرون اومد و با یه فوت آتیش، یه صندوقچه‌ی پر از شانس جلوت گذاشت!\n+{points} امتیاز`,
      `🐉 گربه‌ی اژدهایی دمش مثل یه اژدها بود و چشماش می‌درخشید. گفت: «من گربه‌ام ولی رگ اژدها دارم! شانت رو بگیر!»\n+{points} امتیاز`,
      `🐉 یه غرش بلند اومد و یه گربه‌ی اژدهایی با بال‌های بزرگ از توی ابرها بیرون اومد. روی سرت نشست و یه هدیه گذاشت!\n+{points} امتیاز`,
      `🐉 گربه‌ی اژدهایی یه تیکه از فلس‌های طلاییش رو بهت داد و گفت: «این فلس‌ها از طلای خالصه. مال تو!»\n+{points} امتیاز`,
      `🐉 اژدها-گربه دورت چرخید و دمش مثل یه شلاق آتیشی بود. هرجا رد شد، زمین سبز شد!\n+{points} امتیاز`,
      `🐉 گربه‌ی اژدهایی گفت: «من از قله‌ی کوه آمدم تا بهت بگم: تو قوی‌ترینی!»\n+{points} امتیاز`,
      `🐉 یه اژدها-گربه با یه فوت آتیشی، یه قلعه‌ی یخی رو ذوب کرد و وسطش یه گنج پنهان بود — مال تو!\n+{points} امتیاز`,
      `🐉 گربه‌ی اژدهایی بال‌هاش رو باز کرد و آسمون رو پر از فلس‌های درخشان کرد. یکی از اون فلس‌ها روی دستت افتاد!\n+{points} امتیاز`,
    ],
    nightVariants: [
      `🌙🐉 توی تاریکی شب، یه نور سبز اومد و یه اژدها-گربه با چشمای درخشان جلوت ظاهر شد. گفت: «من محافظ شبم!»\n+{points} امتیاز`,
      `🌙🐉 نیمه‌شب آتشفشان فوران کرد و از دلش یه گربه‌ی اژدهایی بیرون اومد که داشت میو می‌گفت!\n+{points} امتیاز`,
    ],
  },
  {
    id: 11,
    key: "shadow",
    label: "گربه‌ی سایه",
    emoji: "🌑",
    defaultMinPoints: 7501,
    defaultMaxPoints: 10000,
    defaultChance: 0.0001,
    variants: [
      `🌑 سایه‌ت یه‌و حرکت کرد! وقتی برگشتی، یه گربه‌ی سایه از توی سایه‌ت بیرون اومد و یه چیزی زیر گوشت گفت…\n+{points} امتیاز`,
      `🌑 گربه‌ی سایه مثل دود محو شد و بعد از پشتت ظاهر شد. یه دستمال پر از شانس توی جیبت گذاشت و دوباره محو شد!\n+{points} امتیاز`,
      `🌑 توی یه لحظه تاریکی، یه گربه‌ی سایه از توی هیچی ظاهر شد. چشماش فقط دوتا نور قرمز بود. یه چیزی بهت داد و گفت: «هیشکی نباید بدونه.»\n+{points} امتیاز`,
      `🌑 گربه‌ی سایه از توی آینه بیرون اومد و گفت: «من برعکس توام. من شب رو روشن می‌کنم!»\n+{points} امتیاز`,
      `🌑 سایه‌ی دیوارت یه‌و شکل گربه گرفت و بعد واقعاً یه گربه شد! یه چیزی انداخت جلوت و دوباره سایه شد.\n+{points} امتیاز`,
      `🌑 گربه‌ی سایه گفت: «من همیشه اینجام. حتی وقتی نمی‌بینیم. امروز می‌خوام خودمو نشون بدم.»\n+{points} امتیاز`,
      `🌑 یه باد سرد اومد و وسطش یه گربه‌ی سایه بود که داشت روی آسمون راه می‌رفت. بهت اشاره کرد: «بیا بالا!»\n+{points} امتیاز`,
      `🌑 گربه‌ی سایه از توی تاریکی اومد و یه چشمک زد. یه‌و همه‌چیز روشن شد و یه صندوقچه‌ی طلایی جلوت بود!\n+{points} امتیاز`,
    ],
    nightVariants: [
      `🌙🌑 توی تاریکی محض، یه گربه‌ی سایه از توی سایه‌ت بیرون اومد و گفت: «ما همیشه باهاتیم.»\n+{points} امتیاز`,
      `🌙🌑 نیمه‌شب به آسمون نگاه کردی و دیدی یه گربه‌ی سایه داره روی ماه راه می‌ره. یه چیزی از ماه انداخت پایین — مال تو!\n+{points} امتیاز`,
    ],
  },
  {
    id: 12,
    key: "cosmic_god",
    label: "خدای کیهانی",
    emoji: "⚡",
    defaultMinPoints: 10001,
    defaultMaxPoints: 15000,
    defaultChance: 0.00005,
    variants: [
      `⚡ آسمون شکافت! یه خدای گربه‌ای از پشت آسمون بیرون اومد و با یه حرکت دست، کل کیهان رو بهت هدیه داد!\n+{points} امتیاز`,
      `⚡ یه صدای عظیم اومد: «میو!» — خدای گربه‌ها از توی ابرها بیرون اومد و یه تاج ستاره‌ای روی سرت گذاشت!\n+{points} امتیاز`,
      `⚡ خدای کیهانی گربه با یه پنجه‌ش زمین رو لمس کرد و هرجا رد شد، گل و گیاه رویید. یه دسته گل ستاره‌ای بهت داد!\n+{points} امتیاز`,
      `⚡ خدای گربه‌ها گفت: «من خالق تمام گربه‌هام. و تو رو هم خالق شانس کردم!»\n+{points} امتیاز`,
      `⚡ یه نور طلایی از آسمون اومد و خدای گربه‌ای از توی نور بیرون اومد. یه حلقه‌ی ستاره‌ای دورت کشید و گفت: «تو مقدسی!»\n+{points} امتیاز`,
      `⚡ خدای کیهانی یه پنجه‌ش رو بالا آورد و تمام ستاره‌ها شروع به رقصیدن کردن. یکی از اون ستاره‌ها رو برداشت و گذاشت توی دستت!\n+{points} امتیاز`,
      `⚡ زمین لرزید، آسمون سرخ شد و خدای گربه‌ها از توی هیچی ظاهر شد. گفت: «امروز تو خوش‌شانس‌ترینی!»\n+{points} امتیاز`,
      `⚡ خدای کیهانی با یه نگاه، تمام ابرها رو کنار زد و یه تونل طلایی به سمت آسمون باز کرد. گفت: «بیا بالا، شانت اینجاست!»\n+{points} امتیاز`,
    ],
    nightVariants: [
      `🌙⚡ نیمه‌شب آسمون شکافت و خدای گربه‌ها از پشت ماه بیرون اومد. گفت: «من ماه رو هم برای تو روشن کردم!»\n+{points} امتیاز`,
      `🌙⚡ توی تاریکی شب، یه نور طلایی از آسمون اومد و خدای گربه‌ها جلوت ظاهر شد. یه ستاره از تاجش برداشت و گذاشت توی دستت!\n+{points} امتیاز`,
    ],
  },
];

const MEOW_COOLDOWN_LINES = [
  `😴 گربه بعد از اون همه خرخره چرت می‌زنه. {duration} دیگه بیدار می‌شه!`,
  `🐱 گربه یه چُرت کوتاه گرفته. {duration} دیگه برمی‌گرده با یه میوی تازه!`,
  `😾 گربه گفت: «بسه دیگه!» و رفت روی پشتبوم چرت بزنه. {duration} دیگه بیا!`,
  `🐈 گربه داره روی پنجه‌هاش حساب می‌کنه کی دوباره بیاد. جواب: {duration} دیگه!`,
  `😸 گربه خرخرش رو تنظیم کرد و خوابید. {duration} دیگه بیدارش کن!`,
  `😿 گربه از اون همه میو صدام درومده… {duration} دیگه برمی‌گرده!`,
];

const MEOW_MILESTONE_LINES = [
  `🎂 دهمین میوی تو! گربه‌ها دارن باور نمی‌کنن!`,
  `🎉 میو شماره‌ی ۱۰! گربه‌ی خیابونی یه رقص کوچیک کرد!`,
  `🏆 ده میو پشت سر هم! گربه‌ی پادشاه سرش رو تکون داد: «تحسین‌برانگیزه!»`,
  `🎊 دهمین میو! یه گربه از پشتبوم با یه بادکنک اومد پایین جشن بگیره!`,
  `🎈 ده میو کامل! گربه‌ی لوسی یه سکه‌ی خوش‌شانسی بهت هدیه داد!`,
];

const FIRST_MEOW_LINES = [
  `🎉 اولین میوی زندگیته! گربه‌ها یه جشن کوچیک گرفتن!`,
  `🐱 اولین میو! از امروز تو جزو خانواده‌ی گربه‌ها شدی!`,
  `🎈 اولین میو! یه گربه با یه کادو اومد. کادو = شانس!`,
];

const CAT_FACTS = [
  `🐱 واقعیت: گربه‌ها می‌تونن ۶ برابر اندازه‌شون بپرن!`,
  `🐱 واقعیت: گربه‌ها روزی حدود ۱۶ ساعت می‌خوابن. شاید به همین دلیل اینقدر خوشحالن!`,
  `🐱 واقعیت: صدای خرخر گربه می‌تونه استرس رو کم کنه. علمی ثابت شده!`,
  `🐱 واقعیت: گربه‌ها با دمشون حرف می‌زنن. دم بالا = خوشحال!`,
  `🐱 واقعیت: گربه‌ها ۳۲ عضله توی هر گوش دارن!`,
  `🐱 واقعیت: میو فقط برای انسان‌هاست؛ گربه‌ها با همدیگه میو نمی‌گن!`,
  `🐱 واقعیت: قلب گربه دو برابر سریع‌تر از قلب تو می‌زنه!`,
  `🐱 واقعیت: گربه‌ها می‌تونن تشخیص بدن حالت چهره‌ی تو چیه!`,
  `🐱 واقعیت: اولین گربه‌ی فضایی — «فلیکت» — با موفقیت از فضا برگشت!`,
  `🐱 واقعیت: گربه‌ها عاشق جعبه‌های خالین. جعبه = امنیت!`,
  `🐱 واقعیت: سبیل گربه به اندازه‌ی عرض بدنشه. با اون راهش رو پیدا می‌کنه!`,
  `🐱 واقعیت: گربه‌ها توی خوابم رؤیا می‌بینن. بعضی‌هاشون حرف هم می‌زنن!`,
];

export function tierMessage(tier: MeowTierConfig, points: number, hour?: number): string {
  let pool = tier.variants;
  if (tier.nightVariants?.length && hour != null && (hour >= 22 || hour < 6)) {
    pool = tier.nightVariants;
  }
  const tpl = pool[Math.floor(Math.random() * pool.length)];
  if (!tpl) return `🐱 میو!\n+${points} امتیاز`;
  return tpl.replace("{points}", String(points));
}

export function randomCooldownLine(): string {
  return MEOW_COOLDOWN_LINES[Math.floor(Math.random() * MEOW_COOLDOWN_LINES.length)];
}

export function meowMilestoneLine(firstMeow: boolean, everyTenth: boolean): string | null {
  if (firstMeow) return FIRST_MEOW_LINES[Math.floor(Math.random() * FIRST_MEOW_LINES.length)];
  if (everyTenth) return MEOW_MILESTONE_LINES[Math.floor(Math.random() * MEOW_MILESTONE_LINES.length)];
  return null;
}

export function randomCatFact(): string {
  return CAT_FACTS[Math.floor(Math.random() * CAT_FACTS.length)];
}

const BADGES = [
  { min: 800, title: "گربه‌ی پادشاه" },
  { min: 400, title: "گربه‌ی افسانه‌ای" },
  { min: 150, title: "گربه‌ی قهرمان" },
  { min: 50, title: "گربه‌ی کنجکاو" },
  { min: 0, title: "گربه‌ی تازه‌کار" },
];

function getBadgeTitle(totalMeows: number) {
  return BADGES.find((badge) => totalMeows >= badge.min)?.title ?? "گربه‌ی تازه‌کار";
}

function getMeowTaxRateByRank(rank: number): number {
  if (rank === 1) return 0.25;
  if (rank === 2) return 0.15;
  if (rank === 3) return 0.05;
  return 0;
}

type AwardMeowResult =
  | { points: number; basePoints: number; eventBonus: number; tier: MeowTierConfig; taxAmount: number; taxRate: number; lotteryTicketEarned: boolean; milestone: boolean; firstMeow: boolean; cooldown: false; boosterMult: number }
  | { cooldown: number };

export type MeowTierConfig = {
  id: number;
  key: string;
  label: string;
  emoji?: string;
  variants: string[];
  nightVariants?: string[];
  minPoints: number;
  maxPoints: number;
  chance: number;
};

type ActiveEvent = {
  title: string;
  description: string;
  start_at: number;
  end_at: number;
  bonus_multiplier: number;
} | null;

async function getMeowTierSettings(db: D1Database) {
  const tiers = [] as MeowTierConfig[];

  for (const tier of MEOW_TIERS) {
    const minSetting = await getBotSetting(db, `meow_${tier.key}_min`);
    const maxSetting = await getBotSetting(db, `meow_${tier.key}_max`);
    const chanceSetting = await getBotSetting(db, `meow_${tier.key}_chance`);
    const minPoints = minSetting !== null && minSetting !== "" && Number.isFinite(Number(minSetting)) ? Number(minSetting) : tier.defaultMinPoints;
    const maxPoints = maxSetting !== null && maxSetting !== "" && Number.isFinite(Number(maxSetting)) ? Number(maxSetting) : tier.defaultMaxPoints;
    const chance = chanceSetting !== null && chanceSetting !== "" && Number.isFinite(Number(chanceSetting)) ? Number(chanceSetting) : tier.defaultChance;
    const boundedMin = Math.max(0, Math.min(minPoints, maxPoints));
    const boundedMax = Math.max(boundedMin, maxPoints);
    tiers.push({
      ...tier,
      minPoints: boundedMin,
      maxPoints: boundedMax,
      chance: Math.max(0, Math.min(1, chance)),
    });
  }

  return tiers;
}

const ACTIVE_EVENT_CACHE_KEY = "active_event";

async function getActiveEvent(db: D1Database, env: Bindings): Promise<ActiveEvent> {
  const now = Math.floor(Date.now() / 1000);
  if (env.CACHE) {
    const cached = await env.CACHE.get(ACTIVE_EVENT_CACHE_KEY);
    if (cached) {
      try {
        return JSON.parse(cached) as ActiveEvent;
      } catch {
        // ignore invalid cache payload
      }
    }
  }

  const row = await db
    .prepare(`SELECT title, description, start_at, end_at, bonus_multiplier FROM events WHERE is_active = 1 AND start_at <= ? AND end_at >= ? ORDER BY created_at DESC LIMIT 1`)
    .bind(now, now)
    .first<{ title: string; description: string; start_at: number; end_at: number; bonus_multiplier: number }>();

  const activeEvent = row ? row : null;
  if (env.CACHE) {
    await env.CACHE.put(ACTIVE_EVENT_CACHE_KEY, JSON.stringify(activeEvent), { expirationTtl: 30 });
  }
  return activeEvent;
}

export async function invalidateActiveEventCache(env: Bindings) {
  if (!env.CACHE) return;
  await env.CACHE.delete(ACTIVE_EVENT_CACHE_KEY);
}

// VIP tier odds: the bottom tier is nearly eliminated, every tier above it gets
// a multiplier that increases with tier rarity, then the chances are renormalized
// to sum to 1. Higher tiers get progressively bigger boosts so the VIP user has
// meaningful chances at the ultra-rare tiers.
const VIP_TIER_WEIGHTS = [
  0.15,  // tier 0 (street) — nearly eliminated
  0.735, // tier 1 (lucky) — ~34.8%
  3.68,  // tier 2 (rainbow) — ~44.7%
  1.5,   // tier 3 (legend)
  1.8,   // tier 4 (king)
  2.0,   // tier 5 (diamond)
  2.5,   // tier 6 (galaxy)
  3.0,   // tier 7 (supernova)
  4.0,   // tier 8 (phoenix)
  5.0,   // tier 9 (dragon)
  6.0,   // tier 10 (shadow)
  7.0,   // tier 11 (cosmic god)
];

export function adjustMeowTierChancesForSpecialUser(
  tiers: MeowTierConfig[],
  userId: number,
  specialUserId?: string | null
): MeowTierConfig[] {
  if (!specialUserId || String(userId) !== String(specialUserId)) return tiers;

  const adjusted = tiers.map((tier) => ({ ...tier }));
  const weighted = adjusted.map((tier, i) => {
    const weight = i < VIP_TIER_WEIGHTS.length ? VIP_TIER_WEIGHTS[i] : 3.5;
    return tier.chance * weight;
  });
  const sum = weighted.reduce((a, b) => a + b, 0);
  if (sum <= 0) return adjusted;
  adjusted.forEach((tier, i) => {
    tier.chance = weighted[i] / sum;
  });
  return adjusted;
}

function pickMeowTier(tiers: MeowTierConfig[]) {
  const total = tiers.reduce((sum, tier) => sum + tier.chance, 0);
  if (total <= 0) return tiers[0];

  const roll = Math.random() * total;
  let cumulative = 0;

  for (const tier of tiers) {
    cumulative += tier.chance;
    if (roll < cumulative) return tier;
  }

  return tiers[tiers.length - 1];
}

function formatLotteryStatusText(settings: {
  lotteryEnabled: boolean;
  lotteryTicketPrice: number;
  lotteryPot: number;
  lotteryTicketSales: number;
  meowTaxPool: number;
  duelTaxPool: number;
}) {
  return (
    `🎟️ <b>لاتاری گروه</b>

` +
    `🟢 وضعیت: <b>${settings.lotteryEnabled ? "فعّال" : "غیرفعال"}</b>
` +
    `💵 قیمت هر بلیت: <b>${settings.lotteryTicketPrice} MP</b>
` +
    `💰 پات فعلی: <b>${settings.lotteryPot} MP</b>
` +
    `🎫 فروش بلیت: <b>${settings.lotteryTicketSales} MP</b>
` +
    `📊 مالیات میو: <b>${settings.meowTaxPool} MP</b>
` +
    `📊 مالیات دعوا: <b>${settings.duelTaxPool} MP</b>

` +
    `🔢 هر بلیت شامل 6 عدد یکتا از 1 تا 49 است.
` +
    `🎁 ساختار جوایز:
` +
    `• 3 عدد درست: <b>20%</b> از پات
` +
    `• 4 عدد درست: <b>35%</b> از پات
` +
    `• 5 عدد درست: <b>50%</b> از پات
` +
    `• 6 عدد درست: <b>100%</b> از پات
` +
    `• اگر چند نفر در یک سطح برنده شوند، جایزه بینشان به‌صورت مساوی تقسیم می‌شود.

` +
    `📈 شانس تقریبی:
` +
    `• 3 عدد: ~5%
` +
    `• 4 عدد: ~3%
` +
    `• 5 عدد: ~1%
` +
    `• 6 عدد: ~0.01%

` +
    `✨ برای خرید سریع: <b>/lottery buy 1</b> یا <b>/lottery buy 3</b>
` +
    `✨ همین کار را با <b>/gamble</b> یا <b>قمار</b> هم می‌توانی انجام دهی.
` +
    `🧾 بعد از خرید، شماره بلیت‌های شما نمایش داده می‌شود و در زمان قرعه‌کشی برندگان مشخص می‌شوند.`
  );
}

export async function getLotteryStatusText(db: D1Database, groupId: number, userId: number) {
  const settings = await getGroupLotteryConfig(db, groupId);

  // Capture pending free tickets BEFORE allocation (allocation zeroes the counter).
  const pendingBefore = await db
    .prepare(`SELECT lottery_bonus_tickets FROM group_members WHERE telegram_group_id = ? AND telegram_user_id = ?`)
    .bind(groupId, userId)
    .first<{ lottery_bonus_tickets: number }>();
  const pendingBeforeCount = pendingBefore?.lottery_bonus_tickets ?? 0;

  await allocatePendingLotteryTickets(db, groupId);

  const round = await db
    .prepare(`SELECT id, round_number, ticket_price FROM lottery_rounds WHERE telegram_group_id = ? AND status = 'open' ORDER BY created_at DESC LIMIT 1`)
    .bind(groupId)
    .first<{ id: number; round_number: number; ticket_price: number }>();

  if (!round) {
    const waitingText = pendingBeforeCount > 0
      ? `\n\n🎁 بلیت‌های رایگان در انتظار شما: <b>${pendingBeforeCount}</b> — به محض شروع دور جدید، خودکار ثبت می‌شوند.`
      : "";
    return `🎫 <b>هیچ دور بازی فعالی وجود ندارد.</b>\n\nوقتی دور جدید شروع شود، می‌توانی بلیت بخری و شماره‌های خود را ببینی.${waitingText}`;
  }

  const participants = await getLotteryParticipants(db, groupId);
  const totalTickets = participants.reduce((sum, participant) => sum + participant.ticket_count, 0);

  const participantLines = participants.slice(0, 8).map((participant) => {
    const displayName = escapeHtml(participant.username || participant.first_name || `کاربر ${participant.telegram_user_id}`);
    return `• ${displayName}: <b>${participant.ticket_count}</b> بلیت`;
  });

  const registeredText = pendingBeforeCount > 0
    ? `\n🎁 <b>${pendingBeforeCount}</b> بلیت رایگان شما در این دور ثبت شد.`
    : "";

  return (
    `🎟️ <b>وضعیت لاتاری</b>\n\n` +
    `🔢 دور فعال: <b>${round.round_number}</b>\n` +
    `💵 قیمت هر بلیت: <b>${round.ticket_price} MP</b>\n` +
    `💰 پات جاری: <b>${settings.lotteryPot} MP</b>\n` +
    `🎫 تعداد بلیت‌های این دور: <b>${totalTickets}</b>\n` +
    `👥 شرکت‌کنندگان: <b>${participants.length}</b>${registeredText}\n\n` +
    (participantLines.length > 0
      ? `📌 <b>برترین شرکت‌کنندگان</b>:\n${participantLines.join("\n")}${participants.length > 8 ? `\n… و ${participants.length - 8} شرکت‌کننده دیگر` : ""}`
      : `📌 هنوز هیچ بلیتی خریداری نشده است.\n`) +
    `\n🎯 برای دیدن بلیت‌های خود، از دکمه 'بلیت‌های من' استفاده کن.`
  );
}

export async function awardMeow(
  db: D1Database,
  user: TelegramUser,
  chat: TelegramChat,
  vipUserId?: string | null
): Promise<AwardMeowResult> {
  const now = Math.floor(Date.now() / 1000);
  const isGroup = chat.type === "group" || chat.type === "supergroup";

  await ensureUser(db, user);

  let tiers = await getMeowTierSettings(db);
  tiers = adjustMeowTierChancesForSpecialUser(tiers, user.id, vipUserId);
  const tier = pickMeowTier(tiers);

  const activeEvent = await db
    .prepare(`SELECT bonus_multiplier FROM events WHERE is_active = 1 AND start_at <= ? AND end_at >= ? ORDER BY created_at DESC LIMIT 1`)
    .bind(now, now)
    .first<{ bonus_multiplier: number }>();
  const eventBonus = activeEvent?.bonus_multiplier && activeEvent.bonus_multiplier > 1 ? activeEvent.bonus_multiplier : 1;
  const rawPoints = tier.minPoints === tier.maxPoints
    ? tier.minPoints
    : Math.floor(Math.random() * (tier.maxPoints - tier.minPoints + 1)) + tier.minPoints;
  const basePoints = rawPoints;
  const effectivePoints = Math.max(0, Math.round(basePoints * eventBonus));

  if (isGroup) {
    const settings = await getGroupSettings(db, chat.id);
    if (!settings.enabled) return { cooldown: 0 };
    await ensureGroup(db, chat);

    const groupRank = await getGroupRank(db, chat.id, user.id);
    const taxRate = getMeowTaxRateByRank(groupRank);
    const taxAmount = Math.floor(effectivePoints * taxRate);
    const netPoints = Math.max(0, effectivePoints - taxAmount);

    // Apply active booster multiplier (silent, per-group)
    const boosterMult = await getActiveBoosterMultiplier(db, chat.id, user.id);
    const boostedNetPoints = Math.round(netPoints * boosterMult);

    // Read the current meow-credit so we can tell whether this meow completes a
    // batch of 3 and earns a free lottery ticket. Safe under the group cooldown
    // (a user can only earn one meow per cooldown window).
    const creditRow = await db
      .prepare(`SELECT lottery_meow_credit, total_meows FROM group_members WHERE telegram_group_id = ? AND telegram_user_id = ?`)
      .bind(chat.id, user.id)
      .first<{ lottery_meow_credit: number | null; total_meows: number | null }>();
    const lotteryTicketEarned = creditRow?.lottery_meow_credit === 2;
    const prevTotalMeows = creditRow?.total_meows ?? 0;
    const newTotalMeows = prevTotalMeows + 1;
    const milestone = newTotalMeows % 10 === 0;
    const firstMeow = prevTotalMeows === 0;

    const result = await db.prepare(`
      INSERT INTO group_members (
        telegram_group_id, telegram_user_id, username, first_name, meow_points, total_meows, last_meow_at, lottery_bonus_tickets, lottery_meow_credit
      ) VALUES (?, ?, ?, ?, ?, 1, ?, 0, 1)
      ON CONFLICT(telegram_group_id, telegram_user_id) DO UPDATE SET
        username = excluded.username,
        first_name = excluded.first_name,
        meow_points = group_members.meow_points + excluded.meow_points,
        total_meows = group_members.total_meows + 1,
        last_meow_at = excluded.last_meow_at,
        lottery_bonus_tickets = group_members.lottery_bonus_tickets + CAST((group_members.lottery_meow_credit + 1) / 3 AS INTEGER),
        lottery_meow_credit = (group_members.lottery_meow_credit + 1) % 3
      WHERE group_members.last_meow_at IS NULL OR group_members.last_meow_at < ?
    `).bind(chat.id, user.id, user.username ?? null, user.first_name, boostedNetPoints, now, now - settings.cooldown).run();

    if (result.meta.changes === 0) {
      const row = await db.prepare(`SELECT last_meow_at FROM group_members WHERE telegram_group_id = ? AND telegram_user_id = ?`)
        .bind(chat.id, user.id).first<{ last_meow_at: number }>();
      const remaining = row ? Math.max(0, settings.cooldown - (now - row.last_meow_at)) : settings.cooldown;
      return { cooldown: remaining };
    }

    const operations = [
      db.prepare(`UPDATE users SET meow_points = meow_points + ?, total_meows = total_meows + 1 WHERE telegram_id = ?`).bind(boostedNetPoints, user.id),
      db.prepare(`INSERT INTO transactions (telegram_user_id, group_id, amount, reason, created_at) VALUES (?, ?, ?, ?, ?)`)
        .bind(user.id, chat.id, boostedNetPoints, "MEOW", now),
    ];

    if (taxAmount > 0) {
      operations.push(
        db.prepare(`INSERT INTO transactions (telegram_user_id, group_id, amount, reason, created_at) VALUES (?, ?, ?, ?, ?)`)
          .bind(user.id, chat.id, -taxAmount, "MEOW_TAX", now)
      );
      await distributeGroupTax(db, chat.id, "meow", taxAmount);
    }

    await db.batch(operations);

    return { points: boostedNetPoints, basePoints, eventBonus, tier, taxAmount, taxRate, lotteryTicketEarned, milestone, firstMeow, cooldown: false, boosterMult };
  }

  await db.batch([
    db.prepare(`UPDATE users SET meow_points = meow_points + ?, total_meows = total_meows + 1 WHERE telegram_id = ?`).bind(effectivePoints, user.id),
    db.prepare(`INSERT INTO transactions (telegram_user_id, group_id, amount, reason, created_at) VALUES (?, ?, ?, ?, ?)`)
      .bind(user.id, null, effectivePoints, "MEOW", now),
  ]);

  return { points: effectivePoints, basePoints, eventBonus, tier, taxAmount: 0, taxRate: 0, lotteryTicketEarned: false, milestone: false, firstMeow: false, cooldown: false, boosterMult: 1 };
}

export async function handleStart(token: string, db: D1Database, env: Bindings, message: TelegramMessage) {
  if (!message.from) return;
  await ensureUser(db, message.from);

  const activeEvent = await getActiveEvent(db, env);

  // Register the bot menu once per deployment instead of on every /start
  // (an extra Telegram API call per user for zero benefit).
  const registered = await db.prepare(`SELECT value FROM bot_settings WHERE key = 'commands_registered'`).first<{ value: string }>();
  if (registered?.value !== "1") {
    await setMyCommands(token, [
      { command: "start", description: "شروع کار با ربات" },
      { command: "me", description: "پروفایل من" },
      { command: "top", description: "رتبه‌بندی گروه" },
      { command: "history", description: "تاریخچه تراکنش‌ها" },
      { command: "pay", description: "انتقال امتیاز" },
      { command: "lottery", description: "لاتاری / قمار گروه" },
      { command: "gamble", description: "قمار در گروه" },
      { command: "dice", description: "تاس انداختن" },
      { command: "poker", description: "پوکر تگزاس گروه" },
      { command: "blackjack", description: "بلک‌جک گروه" },
      { command: "events", description: "رویدادهای فعال" },
      { command: "booster", description: "فروشگاه بوستر" },
      { command: "groupstats", description: "آمار گروه" },
      { command: "duelrank", description: "رتبه‌بندی دعوا" },
      { command: "notifications", description: "مدیریت اعلان‌ها" },
      { command: "treasury", description: "خزانه گروه" },
      { command: "settings", description: "تنظیمات گروه" },
    ]);
    await db.prepare(`INSERT INTO bot_settings (key, value) VALUES ('commands_registered', '1') ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run();
  }

  const isPm = message.chat.type === "private";
  let text = isPm
    ? `🐱 سلام <b>${escapeHtml(message.from.first_name)}</b>!\n\nبه دنیای Meow Points خوش اومدی! 🎉\n\nهر وقت توی گروه بنویسی <b>میو</b> یا <b>meow</b>، می‌تونی امتیاز جمع کنی و با بقیه رقابت کنی. ✨\n\n⚡ سریع‌ترین راه‌ها:\n• در گروه <b>میو</b> بگو\n• از دکمه‌های تعاملی استفاده کن\n• با /pay یا /gamble امتیازها رو بین دوستان منتقل کن\n\nبرای قمار، از <b>/lottery</b> یا <b>قمار</b> استفاده کن.\nبرای شروع، یکی از دکمه‌ها رو انتخاب کن:`
    : `🐱 سلام گروه!\n\nمنوهای من با دکمه‌های شیشه‌ای کار می‌کنن و هر لحظه بهت کمک می‌کنن امتیازها رو مدیریت کنی. برای قمار یا لاتاری، از دکمه <b>🎰 لاتاری / قمار</b> استفاده کن.\nبرای دیدن امکانات بیشتر، روی یکی از دکمه‌های زیر کلیک کن.`;

  if (activeEvent) {
    const remainingTime = activeEvent.end_at > Math.floor(Date.now() / 1000) ? formatDuration(activeEvent.end_at - Math.floor(Date.now() / 1000)) : "لحظاتی";
    text += `\n\n🎯 رویداد فعال: <b>${escapeHtml(activeEvent.title)}</b>\n` +
      `${escapeHtml(activeEvent.description)}\n` +
      `💥 ضریب: x${activeEvent.bonus_multiplier}\n` +
      `⏳ تا پایان: <b>${remainingTime}</b>`;
  }

  await sendMessage(token, message.chat.id, text, { reply_markup: mainMenuKeyboard(message.from?.id) });
}

export async function handleMe(token: string, db: D1Database, env: Bindings, message: TelegramMessage) {
  if (!message.from) return;
  await ensureUser(db, message.from);

  const stats = await getUserStats(db, message.from.id);
  const activeEvent = await getActiveEvent(db, env);
  const duelRating = message.chat.type !== "private"
    ? await getDuelRating(db, message.from.id, message.chat.id)
    : await getDuelRating(db, message.from.id);

  let text =
    `🐱 پروفایل <b>${escapeHtml(message.from.first_name)}</b>\n\n` +
    `💰 امتیاز فعلی: <b>${stats?.meow_points ?? 0} MP</b>\n` +
    `🐾 کل میوها: <b>${stats?.total_meows ?? 0}</b>\n` +
    `⚔️ ریتینگ دعوا: <b>${duelRating}</b>\n`;

  // Duel W/L (global)
  const duelStats = await db
    .prepare(`
      SELECT
        SUM(CASE WHEN reason LIKE 'DUEL_WIN%' THEN 1 ELSE 0 END) as wins,
        SUM(CASE WHEN reason LIKE 'DUEL_LOSS%' THEN 1 ELSE 0 END) as losses
      FROM transactions WHERE telegram_user_id = ?
    `)
    .bind(message.from.id)
    .first<{ wins: number | null; losses: number | null }>();
  const duelWins = duelStats?.wins ?? 0;
  const duelLosses = duelStats?.losses ?? 0;
  if (duelWins + duelLosses > 0) {
    text += `⚔️ دعوا: <b>${duelWins}</b> برد / <b>${duelLosses}</b> باخت\n`;
  }

  // Lottery wins (global)
  const lotteryWinCount = await getLotteryWins(db, message.from.id);
  if (lotteryWinCount > 0) {
    text += `🎰 برد لاتاری: <b>${lotteryWinCount}</b> بار\n`;
  }

  if (message.chat.type === "group" || message.chat.type === "supergroup") {
    const groupBalance = await getGroupMemberBalance(db, message.chat.id, message.from.id);
    const groupRank = await getGroupRank(db, message.chat.id, message.from.id);
    const badgeTitle = getBadgeTitle(stats?.total_meows ?? 0);
    const meTitle = await getActiveTitle(db, message.chat.id, message.from.id);
    const booster = await getBoosterStatus(db, message.chat.id, message.from.id);
    text += `\n💳 موجودی این گروه: <b>${groupBalance} MP</b>\n`;
    text += `🏅 رتبه گروه: <b>#${groupRank}</b>\n`;
    text += `🎖️ نشان: <b>${badgeTitle}</b>\n`;
    if (meTitle) {
      text += `🏅 عنوان: ${titleBadge(meTitle.name, meTitle.last_price, meTitle.emoji)}\n`;
    }
    if (booster) {
      const mins = Math.ceil((booster.until - Math.floor(Date.now() / 1000)) / 60);
      text += `🚀 بوستر: <b>${booster.multiplier}×</b> (${mins} دقیقه باقی‌مانده)\n`;
    }
  }

  text += `\n✨ برای رشد بیشتر، توی گروه‌ها میو بگو و با دوستانت دعوا کن.`;

  await sendMessage(token, message.chat.id, text, { reply_markup: mainMenuKeyboard(message.from?.id) });
}

export async function handleHistory(token: string, db: D1Database, message: TelegramMessage) {
  if (!message.from) return;

  const rows = await db
    .prepare(`
      SELECT amount, reason, group_id, created_at
      FROM transactions
      WHERE telegram_user_id = ?
      ORDER BY created_at DESC
      LIMIT 8
    `)
    .bind(message.from.id)
    .all<{ amount: number; reason: string; group_id: number | null; created_at: number }>();

  if (!rows.results.length) {
    await sendMessage(token, message.chat.id, "📜 هنوز فعالیتی ثبت نشده.");
    return;
  }

  const lines = rows.results.map((row) => {
    const label = row.reason === "MEOW" ? "میو" : row.reason === "DAILY_REWARD" ? "جایزه روزانه" : row.reason;
    const scope = row.group_id ? ` | گروه ${row.group_id}` : " | جهانی";
    return `• ${label}: ${row.amount > 0 ? `+${row.amount}` : row.amount} MP${scope}`;
  });

  await sendMessage(token, message.chat.id, `📜 <b>تاریخچه اخیر</b>\n\n${lines.join("\n")}\n\n✨ برای دیدن خلاصه‌ی سریع‌تر، از منوی اصلی هم استفاده کن.`);
}

export async function handleAddEvent(token: string, db: D1Database, env: Bindings, message: TelegramMessage) {
  if (!message.from) return;

  if (env.BOT_OWNER_ID !== String(message.from.id)) {
    await sendMessage(token, message.chat.id, "🚫 فقط صاحب ربات می‌تواند رویداد اضافه کند.");
    return;
  }

  const parsed = parseEventCommand(message.text || "");
  if (!parsed) {
    await sendMessage(
      token,
      message.chat.id,
      `📝 <b>Usage:</b> \n<code>/add event {name} {multiplier} {minutes}</code>\n\nExample:\n<code>/add event FlashSale 2 60</code>`
    );
    return;
  }

  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(`
      INSERT INTO events (title, description, start_at, end_at, is_active, bonus_multiplier, created_at)
      VALUES (?, ?, ?, ?, 1, ?, ?)
    `)
    .bind(parsed.title, parsed.description, parsed.startAt, parsed.endAt, parsed.bonusMultiplier, now)
    .run();

  await sendMessage(token, message.chat.id, `✅ رویداد جدید ذخیره شد.\n\n🎯 ${escapeHtml(parsed.title)}\n${escapeHtml(parsed.description)}\n💥 ضریب: x${parsed.bonusMultiplier}`);
  await invalidateActiveEventCache(env);
}

export async function handleEditEvent(token: string, db: D1Database, env: Bindings, message: TelegramMessage) {
  if (!message.from) return;

  if (env.BOT_OWNER_ID !== String(message.from.id)) {
    await sendMessage(token, message.chat.id, "🚫 فقط صاحب ربات می‌تواند رویداد را ویرایش کند.");
    return;
  }

  const parsed = parseEventCommand(message.text || "");
  if (!parsed) {
    await sendMessage(
      token,
      message.chat.id,
      `📝 <b>استفاده:</b> \n<code>/editevent {name} {multiplier} {minutes}</code>\n\nمثال:\n<code>/editevent FlashSale 2 60</code>`
    );
    return;
  }

  const now = Math.floor(Date.now() / 1000);
  const existing = await db.prepare(`SELECT id FROM events WHERE is_active = 1 ORDER BY created_at DESC LIMIT 1`).first<{ id: number }>();
  if (!existing) {
    await sendMessage(token, message.chat.id, "❌ رویداد فعالی برای ویرایش وجود ندارد.");
    return;
  }

  await db
    .prepare(`UPDATE events SET title = ?, description = ?, start_at = ?, end_at = ?, bonus_multiplier = ?, created_at = ? WHERE id = ?`)
    .bind(parsed.title, parsed.description, parsed.startAt, parsed.endAt, parsed.bonusMultiplier, now, existing.id)
    .run();

  await sendMessage(token, message.chat.id, `✅ رویداد فعلی به‌روزرسانی شد.\n\n🎯 ${escapeHtml(parsed.title)}\n${escapeHtml(parsed.description)}\n💥 ضریب: x${parsed.bonusMultiplier}`);
  await invalidateActiveEventCache(env);
}

export async function handleDeleteEvent(token: string, db: D1Database, env: Bindings, message: TelegramMessage) {
  if (!message.from) return;

  if (env.BOT_OWNER_ID !== String(message.from.id)) {
    await sendMessage(token, message.chat.id, "🚫 فقط صاحب ربات می‌تواند رویداد را حذف کند.");
    return;
  }

  await db.prepare(`UPDATE events SET is_active = 0 WHERE is_active = 1`).run();
  await invalidateActiveEventCache(env);
  await sendMessage(token, message.chat.id, "✅ رویداد فعلی غیرفعال شد.");
}

export async function handleEvents(token: string, db: D1Database, env: Bindings, message: TelegramMessage) {
  const now = Math.floor(Date.now() / 1000);
  const dayStart = now - 86400;
  const isGroup = message.chat.type === "group" || message.chat.type === "supergroup";
  const groupId = isGroup ? message.chat.id : null;
  const isOwner = message.from?.id !== undefined && env.BOT_OWNER_ID === String(message.from.id);

  const rows = await db
    .prepare(`
      SELECT SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) as total_meows, SUM(CASE WHEN created_at >= ? THEN amount ELSE 0 END) as today_points
      FROM transactions
      WHERE reason = 'MEOW' AND (${groupId === null ? "group_id IS NULL" : "group_id = ?"})
    `)
    .bind(dayStart, dayStart, ...(groupId === null ? [] : [groupId]))
    .first<{ total_meows: number; today_points: number }>();

  const activeEvent = await getActiveEvent(db, env);

  const scopeLabel = isGroup ? "این گروه" : "سراسر ربات";
  const eventText =
    `🎉 <b>رویدادهای ${scopeLabel}</b>\n\n` +
    `⚡ امتیازهای امروز: <b>${rows?.today_points ?? 0} MP</b>\n` +
    `🐾 میوهای امروز: <b>${rows?.total_meows ?? 0}</b>\n`;

  const keyboard = eventInlineKeyboard(isOwner, !!activeEvent, message.from?.id);
  if (activeEvent) {
    const remainingTime = activeEvent.end_at > now ? formatDuration(activeEvent.end_at - now) : "لحظاتی";
    const eventLine =
      `🎯 رویداد فعلی: <b>${escapeHtml(activeEvent.title)}</b>\n` +
      `${escapeHtml(activeEvent.description)}\n` +
      `💥 ضریب: x${activeEvent.bonus_multiplier}\n` +
      `⏳ تا پایان: <b>${remainingTime}</b>`;
    await sendMessage(token, message.chat.id, `${eventText}${eventLine}`, { reply_markup: keyboard });
    return;
  }

  await sendMessage(token, message.chat.id, `${eventText}✨ فعلاً رویداد فعالی وجود ندارد.`, { reply_markup: keyboard });
}

function formatLeaderboard(rows: { first_name: string; username: string | null; meow_points: number; title_name?: string | null; title_price?: number | null; title_emoji?: string | null }[]) {
  const medals = ["🥇", "🥈", "🥉"];
  return rows
    .map((u, i) => {
      const medal = medals[i] || `${i + 1}.`;
      const name = escapeHtml(u.first_name || u.username || "Unknown Cat");
      const display = u.title_name ? titleBadge(u.title_name, u.title_price, u.title_emoji) : name;
      return `${medal} ${display} — ${u.meow_points} MP`;
    })
    .join("\n");
}

export async function handleTop(token: string, db: D1Database, message: TelegramMessage) {
  if (message.chat.type === "private") {
    await sendMessage(token, message.chat.id, "🐱 دستور /top فقط داخل گروه کار می‌کنه!");
    return;
  }

  const results = await db
    .prepare(`
      SELECT gm.first_name, gm.username, gm.meow_points, t.name AS title_name, t.last_price AS title_price, t.emoji AS title_emoji
      FROM group_members gm
      LEFT JOIN titles t ON t.id = gm.active_title_id AND t.telegram_group_id = gm.telegram_group_id
      WHERE gm.telegram_group_id = ?
      ORDER BY gm.meow_points DESC
      LIMIT 10
    `)
    .bind(message.chat.id)
    .all<{ first_name: string; username: string | null; meow_points: number; title_name: string | null; title_price: number | null; title_emoji: string | null }>();

  if (!results.results.length) {
    await sendMessage(token, message.chat.id, "🐱 هنوز کسی Meow نکرده!");
    return;
  }

  const ownRank = await getGroupRank(db, message.chat.id, message.from?.id ?? 0);
  const ownLine = message.from ? `\n\n🏅 رتبه شما در گروه: <b>#${ownRank}</b>` : "";

  let text = `🏆 <b>Meow Leaderboard</b>\n\n${formatLeaderboard(results.results)}${ownLine}`;

  const daily = await getGroupDailyLeaderboard(db, message.chat.id, 5);
  if (daily.results.length) {
    text += `\n\n📅 <b>Daily Group Leaderboard</b>\n` + daily.results.map((row, index) => `• ${index + 1}. ${escapeHtml(row.first_name)} — ${row.today_points} MP`).join("\n");
  }

  await sendMessage(token, message.chat.id, text);
}

export async function handleDuelRank(token: string, db: D1Database, message: TelegramMessage) {
  if (!message.from) return;
  await ensureUser(db, message.from);

  if (message.chat.type === "private") {
    await sendMessage(token, message.chat.id, "🐱 /duelrank فقط داخل گروه کار می‌کنه!");
    return;
  }
  const leaderboard = await getDuelLeaderboard(db, message.chat.id, 10);
  const medals = ["🥇", "🥈", "🥉"];

  let text = `⚔️ <b>رتبه‌بندی دعوا</b>\n\n`;
  if (leaderboard.results.length) {
    text += leaderboard.results
      .map((u, i) => {
        const medal = medals[i] || `${i + 1}.`;
        const name = escapeHtml(u.first_name || u.username || "Unknown Cat");
        return `${medal} ${name} — <b>${u.duel_rating}</b>`;
      })
      .join("\n");
  } else {
    text += "🐱 هنوز کسی دعوا نکرده!";
  }

  const myRating = await getDuelRating(db, message.from.id, message.chat.id);
  text += `\n\n⚔️ ریتینگ شما: <b>${myRating}</b>\n\n✨ برای افزایش ریتینگ، توی گروه ریپلای کن و بنویس:\n<code>دعوا 500</code>`;

  await sendMessage(token, message.chat.id, text);
}

export async function handleBooster(token: string, db: D1Database, message: TelegramMessage) {
  if (!message.from) return;
  if (message.chat.type !== "group" && message.chat.type !== "supergroup") {
    await sendMessage(token, message.chat.id, "🚀 بوستر فقط داخل گروه کار می‌کند!");
    return;
  }

  await ensureGroup(db, message.chat);
  await ensureUser(db, message.from);

  const groupId = message.chat.id;
  const userId = message.from.id;
  const status = await getBoosterStatus(db, groupId, userId);

  let text = `🚀 <b>فروشگاه بوستر</b>\n\n`;
  text += `بوستر ضریب دریافت میو را در این گروه افزایش می‌دهد.\n`;
  text += `فقط روی میوهای این گروه تأثیر دارد.\n\n`;

  if (status) {
    const remaining = status.until - Math.floor(Date.now() / 1000);
    const mins = Math.ceil(remaining / 60);
    text += `🟢 <b>بوستر فعال:</b> ${status.multiplier}× (باقی‌مانده: ${mins} دقیقه)\n\n`;
  }

  text += `💰 موجودی گروه شما: <b>${await getGroupMemberBalance(db, groupId, userId)} MP</b>\n\n`;
  text += `💡 هر بوستر ۱ ساعت اعتبار دارد، جایگزین بوستر قبلی می‌شود و بین دو خرید باید ${Math.round(BOOSTER_COOLDOWN_SEC / 3600)} ساعت فاصله باشد.`;

  await sendMessage(token, message.chat.id, text, { reply_markup: boosterKeyboard(message.from.id) });
}

/** Buy a booster tier from the 🚀 بوستر store (booster:buy:<tierId> callback). */
export async function handleBoosterBuy(token: string, db: D1Database, callback: TelegramCallbackQuery, tierId: string) {
  if (!callback.message || !callback.from) return;
  if (callback.message.chat.type !== "group" && callback.message.chat.type !== "supergroup") {
    await answerCallback(token, callback.id, "🚀 بوستر فقط داخل گروه کار می‌کند!", true);
    return;
  }
  const tier = findBoosterTier(tierId);
  if (!tier) {
    await answerCallback(token, callback.id, "🚀 این بوستر وجود ندارد.", true);
    return;
  }

  const result = await buyBooster(db, callback.message.chat.id, callback.from.id, tier.multiplier, tier.durationSec, tier.cost);
  if (!result.success) {
    if (result.reason === "cooldown") {
      await answerCallback(token, callback.id, `⏳ بوستر اخیراً خریده‌ای. هر ${Math.round(BOOSTER_COOLDOWN_SEC / 3600)} ساعت یک‌بار می‌توانی بوستر بخری.`, true);
      return;
    }
    await answerCallback(token, callback.id, `🐱 موجودی کافی نیست (نیاز: ${tier.cost.toLocaleString("en-US")} MP).`, true);
    return;
  }

  await answerCallback(token, callback.id, `✅ بوستر <b>${tier.label}</b> فعال شد (${tier.multiplier}× برای ${tier.durationSec / 60} دقیقه).`);
}

export async function handleGroupStats(token: string, db: D1Database, message: TelegramMessage) {
  if (!message.from) return;
  if (message.chat.type !== "group" && message.chat.type !== "supergroup") {
    await sendMessage(token, message.chat.id, "📊 آمار گروه فقط داخل گروه کار می‌کند!");
    return;
  }

  await ensureGroup(db, message.chat);
  const stats = await getGroupStats(db, message.chat.id);

  const topName = stats.topMeower
    ? escapeHtml(stats.topMeower.username ? `@${stats.topMeower.username}` : stats.topMeower.first_name ?? ".Unknown")
    : "—";
  const topPoints = stats.topMeower?.meow_points ?? 0;

  const text =
    `📊 <b>آمار گروه ${escapeHtml(message.chat.title ?? "")}</b>\n\n` +
    `🐱 کل میوها: <b>${stats.totalMeows.toLocaleString("en-US")}</b>\n` +
    `👥 اعضا: <b>${stats.memberCount}</b>\n` +
    `💰 خزانه گروه: <b>${stats.treasuryBalance.toLocaleString("en-US")} MP</b>\n` +
    `🎰 پات لاتاری: <b>${stats.lotteryPot.toLocaleString("en-US")} MP</b>\n\n` +
    `🏆 <b>پادشاه میو:</b> ${topName} — ${topPoints.toLocaleString("en-US")} MP`;

  await sendMessage(token, message.chat.id, text);
}

export async function handleNotifications(token: string, db: D1Database, message: TelegramMessage) {
  if (!message.from) return;
  const text = (message.text || "").trim().toLowerCase();
  const parts = text.split(/\s+/);
  const sub = parts[1];

  if (sub === "off") {
    await setNotificationsEnabled(db, message.from.id, false);
    await sendMessage(token, message.chat.id, "🔕 اعلان‌ها غیرفعال شدند. برای فعال کردن مجدد: /notifications on");
  } else if (sub === "on") {
    await setNotificationsEnabled(db, message.from.id, true);
    await sendMessage(token, message.chat.id, "🔔 اعلان‌ها فعال شدند. برای غیرفعال کردن: /notifications off");
  } else {
    const enabled = await getNotificationsEnabled(db, message.from.id);
    const status = enabled ? "✅ فعال" : "❌ غیرفعال";
    await sendMessage(token, message.chat.id, `🔔 <b>وضعیت اعلان‌ها:</b> ${status}\n\n برای تغییر:\n• /notifications on — فعال\n• /notifications off — غیرفعال`);
  }
}

export async function handleTreasury(token: string, db: D1Database, message: TelegramMessage) {
  if (!message.from) return;
  if (message.chat.type === "private") {
    await sendMessage(token, message.chat.id, "🐱 خزانه گروه فقط داخل گروه قابل دسترس است!");
    return;
  }

  await ensureGroup(db, message.chat);
  const settings = await getGroupSettings(db, message.chat.id);
  const txns = await getRecentGroupTreasuryTransactions(db, message.chat.id, 5);

  let text = `🏦 <b>خزانه گروه</b>\n\n`;
  text += `💰 موجودی خزانه: <b>${settings.treasuryBalance} MP</b>\n\n`;
  if (txns.results.length) {
    text += `📝 آخرین تراکنش‌ها:\n` + txns.results.map((txn) => {
      const sign = txn.amount >= 0 ? "+" : "";
      const userLabel = txn.telegram_user_id ? ` user ${txn.telegram_user_id}` : "";
      return `• ${sign}${txn.amount} MP — ${escapeHtml(txn.reason)}${userLabel}`;
    }).join("\n");
  } else {
    text += `✨ هنوز تراکنشی برای خزانه ثبت نشده.`;
  }

  await sendMessage(token, message.chat.id, text, { reply_markup: treasuryKeyboard(settings.treasuryBalance, message.from?.id) });
}

/**
 * `خزانه` — show the group treasury.
 * `خزانه {amount}` — set the group treasury to the exact amount (owner only).
 */
export async function handleTreasuryCommand(
  token: string,
  db: D1Database,
  env: Bindings,
  message: TelegramMessage
) {
  if (!message.from) return;
  if (message.chat.type === "private") {
    await sendMessage(token, message.chat.id, "🐱 خزانه گروه فقط داخل گروه قابل دسترس است!");
    return;
  }

  await ensureGroup(db, message.chat);
  const parts = (message.text || "").split(" ").filter(Boolean);
  if (parts.length >= 2) {
    if (env.BOT_OWNER_ID !== String(message.from.id)) {
      await sendMessage(token, message.chat.id, "🚫 فقط صاحب ربات می‌تواند خزانه را تنظیم کند.");
      return;
    }
    const amount = safeParseAmount(parts[1]);
    if (amount === null || amount < 0) {
      await sendMessage(token, message.chat.id, "🐱 مقدار نامعتبر است.\n<code>خزانه 50000</code>");
      return;
    }
    const before = await db
      .prepare(`SELECT treasury_balance FROM telegram_groups WHERE telegram_group_id = ?`)
      .bind(message.chat.id)
      .first<{ treasury_balance: number }>();
    const balanceBefore = before?.treasury_balance ?? 0;
    const now = Math.floor(Date.now() / 1000);
    await db.batch([
      db.prepare(`UPDATE telegram_groups SET treasury_balance = ? WHERE telegram_group_id = ?`).bind(amount, message.chat.id),
      db.prepare(
        `INSERT INTO group_treasury_transactions (telegram_group_id, telegram_user_id, amount, balance_before, balance_after, reason, reference_type, reference_id, created_at) VALUES (?, NULL, ?, ?, ?, 'owner:set', 'owner', NULL, ?)`
      ).bind(message.chat.id, amount - balanceBefore, balanceBefore, amount, now),
    ]);
    await sendMessage(token, message.chat.id, `✅ خزانه گروه به <b>${amount} MP</b> تنظیم شد.`);
    return;
  }

  await handleTreasury(token, db, message);
}

/**
 * `پات` — show the group lottery pot.
 * `پات {amount}` — set the pot to the exact amount (owner only).
 */
export async function handlePotCommand(
  token: string,
  db: D1Database,
  env: Bindings,
  message: TelegramMessage
) {
  if (!message.from) return;
  if (message.chat.type === "private") {
    await sendMessage(token, message.chat.id, "🐱 پات فقط داخل گروه قابل دسترس است!");
    return;
  }

  await ensureGroup(db, message.chat);
  const parts = (message.text || "").split(" ").filter(Boolean);
  if (parts.length >= 2) {
    if (env.BOT_OWNER_ID !== String(message.from.id)) {
      await sendMessage(token, message.chat.id, "🚫 فقط صاحب ربات می‌تواند پات را تنظیم کند.");
      return;
    }
    const amount = safeParseAmount(parts[1]);
    if (amount === null || amount < 0) {
      await sendMessage(token, message.chat.id, "🐱 مقدار نامعتبر است.\n<code>پات 50000</code>");
      return;
    }
    await setGroupLotteryPot(db, message.chat.id, amount);
    await sendMessage(token, message.chat.id, `✅ پات گروه به <b>${amount} MP</b> تنظیم شد.`);
    return;
  }

  const settings = await getGroupLotteryConfig(db, message.chat.id);
  await sendMessage(token, message.chat.id, `💰 <b>پات گروه</b>: <b>${settings.lotteryPot} MP</b>\n\n🎟️ این پات برای لاتاری گروه استفاده می‌شود.`);
}

export async function handleLottery(token: string, db: D1Database, env: Bindings, message: TelegramMessage) {
  if (message.chat.type === "private") {
    await sendMessage(token, message.chat.id, "🐱 لاتاری فقط داخل گروه کار می‌کند. لطفاً ربات را به گروه اضافه کن و از /lottery یا /gamble استفاده کن.");
    return;
  }

  await ensureGroup(db, message.chat);
  // Register any pending free tickets (earned by meowing) into the open round.
  await allocatePendingLotteryTickets(db, message.chat.id);
  const settings = await getGroupLotteryConfig(db, message.chat.id);
  const isOwner = message.from?.id !== undefined && env.BOT_OWNER_ID === String(message.from.id);
  // The 🎯 draw button also shows for group admins (server-side check in the
  // lottery:draw callback branch); the /lottery command is group-only.
  const canDraw = isOwner || (message.from ? await isGroupAdmin(token, message.chat.id, message.from.id) : false);

  const parts = (message.text || "").split(" ").filter(Boolean);
  if (parts.length >= 2) {
    const sub = parts[1].toLowerCase();
    if (sub === "buy") {
      if (!message.from) return;
      if (!settings.lotteryEnabled) {
        await sendMessage(token, message.chat.id, "🎟️ لاتاری فعلا غیرفعال است.");
        return;
      }
      const count = Math.min(10, Math.max(1, Number.parseInt(toEnglishNumbers(parts[2] || "1"), 10) || 1));
      const res = await purchaseLotteryTickets(db, message.chat.id, message.from.id, count);
      if (!res.success) {
        if (res.reason === "insufficient_funds") {
          await sendMessage(token, message.chat.id, "🐱 امتیاز کافی برای خرید این تعداد بلیت نداری.");
          return;
        }
        await sendMessage(token, message.chat.id, "❌ خطا در خرید بلیت لاتاری.");
        return;
      }
      const numbersText = res.numbers?.map((nums, index) => `🎫 بلیت ${index + 1}: ${nums.split(",").join(", ")}`).join("\n") ?? "-";
      const freeText = res.allocated > 0 ? `\n\n🎁 <b>${res.allocated}</b> بلیت رایگان شما هم در این دور ثبت شد.` : "";
      await sendMessage(token, message.chat.id,
        `🎫 <b>خرید بلیت موفق</b>

تعداد بلیت: <b>${count}</b>
شماره دور: <b>${res.roundId}</b>

${numbersText}${freeText}

📈 شانس تقریبی: 3 عدد ~5%، 4 عدد ~3%، 5 عدد ~1%، 6 عدد ~0.01%\n` +
        `💡 برای خرید سریع‌تر: /lottery buy 3 یا /gamble buy 3`
        , { parse_mode: "HTML" }
      );
      return;
    }

    if (sub === "status") {
      await sendMessage(token, message.chat.id, formatLotteryStatusText(settings), {
        reply_markup: lotteryKeyboard(isOwner, message.from?.id, canDraw),
        parse_mode: "HTML",
      });
      return;
    }

      if (sub === "tickets" || sub === "mytickets" || sub === "my_tickets") {
        const text = await getLotteryTicketSummary(db, message.chat.id, message.from?.id ?? 0);
        await sendMessage(token, message.chat.id, text, {
          reply_markup: lotteryKeyboard(isOwner, message.from?.id, canDraw),
          parse_mode: "HTML",
        });
        return;
      }

    if (sub === "settings") {
      if (!message.from) return;
      const isAdmin = message.from && await isGroupAdmin(token, message.chat.id, message.from.id);
      if (!isOwner && !isAdmin) {
        await sendMessage(token, message.chat.id, '❌ فقط مالک یا ادمین می‌تواند تنظیمات لاتاری را تغییر دهد.');
        return;
      }
      const arg = parts[2]?.toLowerCase();
      if (arg === 'price' && parts[3]) {
        const newPrice = parseInt(toEnglishNumbers(parts[3]), 10);
        if (!Number.isFinite(newPrice) || newPrice <= 0) {
          await sendMessage(token, message.chat.id, '❌ قیمت صحیح نیست.');
          return;
        }
        await setGroupLotteryTicketPrice(db, message.chat.id, newPrice);
        await sendMessage(token, message.chat.id, `✅ قیمت بلیت لاتاری به ${newPrice} MP تنظیم شد.`);
        return;
      }
      if (arg === 'enable') {
        await db.prepare(`UPDATE telegram_groups SET lottery_enabled = 1 WHERE telegram_group_id = ?`).bind(message.chat.id).run();
        await sendMessage(token, message.chat.id, '✅ لاتاری فعال شد.');
        return;
      }
      if (arg === 'disable') {
        await db.prepare(`UPDATE telegram_groups SET lottery_enabled = 0 WHERE telegram_group_id = ?`).bind(message.chat.id).run();
        await sendMessage(token, message.chat.id, '✅ لاتاری غیرفعال شد.');
        return;
      }
    }
  }

  await sendMessage(token, message.chat.id, formatLotteryStatusText(settings), {
    reply_markup: lotteryKeyboard(isOwner, message.from?.id, canDraw),
    parse_mode: "HTML",
  });
}



export async function handleDice(token: string, db: D1Database, env: Bindings, message: TelegramMessage) {
  if (message.chat.type === "private") {
    await sendMessage(token, message.chat.id, "تاس فقط داخل گروه کار می‌کند. لطفاً ربات را به گروه اضافه کن.");
    return;
  }

  if (!message.from) return;
  await ensureGroup(db, message.chat);
  await ensureUser(db, message.from);

  const now = Math.floor(Date.now() / 1000);

  const die1 = Math.floor(Math.random() * 6) + 1;
  const die2 = Math.floor(Math.random() * 6) + 1;
  const isPair = die1 === die2;
  const isDoubleSix = isPair && die1 === 6;
  let reward = isPair ? Math.floor(Math.random() * 501) + 1500 : 0;
  if (isDoubleSix) reward *= 2;

  const diceUpsert = await db
    .prepare(`INSERT INTO group_members (
      telegram_group_id, telegram_user_id, username, first_name, meow_points, total_meows, last_meow_at, last_dice_at
    ) VALUES (?, ?, ?, ?, ?, 0, NULL, ?)
    ON CONFLICT(telegram_group_id, telegram_user_id) DO UPDATE SET
      username = excluded.username,
      first_name = excluded.first_name,
      meow_points = group_members.meow_points + excluded.meow_points,
      last_dice_at = excluded.last_dice_at
    WHERE group_members.last_dice_at IS NULL OR group_members.last_dice_at < ?`)
    .bind(message.chat.id, message.from.id, message.from.username ?? null, message.from.first_name, reward, now, now - DICE_COOLDOWN_SEC)
    .run();

  if (!diceUpsert.meta.changes) {
    const cooldownRow = await db
      .prepare(`SELECT last_dice_at FROM group_members WHERE telegram_group_id = ? AND telegram_user_id = ?`)
      .bind(message.chat.id, message.from.id)
      .first<{ last_dice_at: number | null }>();
    const remaining = cooldownRow?.last_dice_at ? DICE_COOLDOWN_SEC - (now - cooldownRow.last_dice_at) : DICE_COOLDOWN_SEC;
    await sendMessage(token, message.chat.id, `⏱️ باید ${formatDuration(Math.max(0, remaining))} صبر کنی تا دوباره تاس بندازی.`);
    return;
  }

  // Only reward after the cooldown guard confirmed the roll counts — otherwise
  // a cooldown hit would still credit the global balance.
  if (reward > 0) {
    await db.batch([
      db.prepare(`UPDATE users SET meow_points = meow_points + ? WHERE telegram_id = ?`).bind(reward, message.from.id),
      db.prepare(`INSERT INTO transactions (telegram_user_id, group_id, amount, reason, created_at) VALUES (?, ?, ?, ?, ?)`)
        .bind(message.from.id, message.chat.id, reward, 'DICE_REWARD', now),
    ]);
  }

  const diceTitle = await getActiveTitle(db, message.chat.id, message.from.id);
  const text =
    (diceTitle ? `${titleBadge(diceTitle.name, diceTitle.last_price, diceTitle.emoji)}\n` : "") +
    `تاس انداختی:\n\n` +
    `• عدد اول: <b>${die1}</b>\n` +
    `• عدد دوم: <b>${die2}</b>\n\n` +
    (reward > 0
      ? isDoubleSix
        ? `🎉🎲 <b>شش شش! جک‌پات!</b> 🎲🎉\nهر دو تاس ۶ آوردی و جایزه‌ات <b>دوبرابر</b> شد!\n💰 <b>${reward} MP</b> به حسابت اضافه شد!`
        : `🎉 معجزه‌ی تاس! دو عدد برابر آوردی و به‌صورت شانسی <b>${reward} MP</b> برنده شدی. پولت را چک کن و ببین چه معجزه‌ای از مسیرت عبور کرد!`
      : `😿 این بار دو عدد برابر نشدند. فقط وقتی هر دو تاس یک عدد بیاورند، جایزه دریافت می‌کنی. دفعه‌ی بعد بهتر می‌شه!`);

  await sendMessage(token, message.chat.id, text);
}

export async function getLotteryTicketSummary(db: D1Database, groupId: number, userId: number) {
  // Capture pending free tickets BEFORE allocation (allocation zeroes the counter).
  const pendingBefore = await db
    .prepare(`SELECT lottery_bonus_tickets FROM group_members WHERE telegram_group_id = ? AND telegram_user_id = ?`)
    .bind(groupId, userId)
    .first<{ lottery_bonus_tickets: number }>();
  const pendingBeforeCount = pendingBefore?.lottery_bonus_tickets ?? 0;

  await allocatePendingLotteryTickets(db, groupId);

  const round = await db
    .prepare(`SELECT id, round_number, ticket_price FROM lottery_rounds WHERE telegram_group_id = ? AND status = 'open' ORDER BY created_at DESC LIMIT 1`)
    .bind(groupId)
    .first<{ id: number; round_number: number; ticket_price: number }>();

  if (!round) {
    const pendingText = pendingBeforeCount > 0
      ? `\n\n🎁 بلیت رایگان در انتظار شما: <b>${pendingBeforeCount}</b> — به محض شروع دور جدید، خودکار ثبت می‌شود.`
      : "";
    return `🎫 <b>هیچ دور بازی فعالی وجود ندارد.</b>\n\nوقتی دور جدید شروع شود، می‌توانی بلیت بخری و شماره‌های خود را ببینی.${pendingText}`;
  }

  const tickets = await db
    .prepare(`SELECT numbers FROM lottery_tickets WHERE lottery_round_id = ? AND telegram_user_id = ? ORDER BY purchased_at ASC`)
    .bind(round.id, userId)
    .all<{ numbers: string }>();

  if (!tickets.results.length) {
    return `🎫 <b>بلیتی برای دور ${round.round_number} نخریده‌ای.</b>\n\nبرای خرید بلیت از /lottery buy 1 یا دکمه‌های لاتاری استفاده کن.`;
  }

  const ticketLines = tickets.results.map((ticket, index) => `• بلیت ${index + 1}: <code>${escapeHtml(ticket.numbers)}</code>`).join("\n");
  return (
    `🎫 <b>بلیت‌های شما</b>\n\n` +
    `شماره دور: <b>${round.round_number}</b>\n` +
    `قیمت هر بلیت: <b>${round.ticket_price} MP</b>\n` +
    `تعداد بلیت: <b>${tickets.results.length}</b>\n\n` +
    `${ticketLines}`
  );
}

function formatLotteryHelpText(settings: {
  lotteryEnabled: boolean;
  lotteryTicketPrice: number;
  lotteryPot: number;
  lotteryTicketSales: number;
  meowTaxPool: number;
  duelTaxPool: number;
}) {
  return (
    `🎲 <b>راهنمای لاتاری و قمار</b>\n\n` +
    `• هر بلیت شامل 6 عدد یکتا از 1 تا 49 است.\n` +
    `• قیمت هر بلیت: <b>${settings.lotteryTicketPrice} MP</b>\n` +
    `• پات جاری: <b>${settings.lotteryPot} MP</b>\n\n` +
    `🎁 هر 3 میو دریافتی در گروه، یک بلیت رایگان برای دور بعد به شما می‌دهد.\n` +
    `📈 شانس تقریبی:\n` +
    `• 3 عدد: ~5%\n` +
    `• 4 عدد: ~3%\n` +
    `• 5 عدد: ~1%\n` +
    `• 6 عدد: ~0.01%\n\n` +
    `💡 برای خرید سریع از دکمه‌ها استفاده کن یا دستورهای زیر را بفرست:\n` +
    `  /lottery buy 1\n` +
    `  /lottery buy 3\n` +
    `  /lottery buy 4\n` +
    `  /lottery buy 8\n` +
    `  /lottery buy 9\n` +
    `  /lottery buy 10\n\n` +
    `✨ همچنین می‌توانی از <b>/gamble</b> یا <b>قمار</b> استفاده کنی.\n` +
    `✨ مالک گروه یا ادمین می‌تواند با دکمه قرعه‌کشی، برنده‌ها را انتخاب کند.\n` +
    `🧾 شماره بلیت‌ها بلافاصله بعد از خرید نمایش داده می‌شوند.`
  );
}

export async function handleLotterySetPrice(token: string, db: D1Database, groupId: number, delta: number) {
  const settings = await getGroupLotteryConfig(db, groupId);
  const price = Math.max(1, settings.lotteryTicketPrice + delta);
  await setGroupLotteryTicketPrice(db, groupId, price);
  return price;
}

export async function handleLotterySetPot(token: string, db: D1Database, groupId: number, delta: number) {
  const settings = await getGroupLotteryConfig(db, groupId);
  const pot = Math.max(0, settings.lotteryPot + delta);
  await setGroupLotteryPot(db, groupId, pot);
  return pot;
}

export async function handlePay(token: string, db: D1Database, message: TelegramMessage) {
  if (!message.from) return;
  if (message.chat.type === "private") {
    await sendMessage(token, message.chat.id, "🐱 انتقال امتیاز فقط داخل گروه انجام می‌شه!", { reply_to_message_id: message.message_id });
    return;
  }

  const text = message.text || "";
  const parts = text.split(" ").filter(Boolean);

  let targetUser: { telegram_id: number; first_name: string } | null = null;
  let amount: number | null = null;

  if (message.reply_to_message?.from && parts.length === 2) {
    const replied = message.reply_to_message.from;
    if (replied.is_bot) {
      await sendMessage(token, message.chat.id, "🐱 نمی‌تونی به ربات انتقال بدی!", { reply_to_message_id: message.message_id });
      return;
    }
    if (replied.id === message.from.id) {
      await sendMessage(token, message.chat.id, "🐱 نمی‌تونی به خودت انتقال بدی!", { reply_to_message_id: message.message_id });
      return;
    }
    amount = safeParseAmount(parts[1]);
    if (amount === null) {
      await sendMessage(token, message.chat.id, "🐱 مقدار امتیاز نامعتبره!", { reply_to_message_id: message.message_id });
      return;
    }
    await ensureUser(db, replied);
    targetUser = { telegram_id: replied.id, first_name: replied.first_name };
  } else if (parts.length >= 3) {
    amount = safeParseAmount(parts[2]);
    if (amount === null) {
      await sendMessage(token, message.chat.id, "🐱 مقدار امتیاز نامعتبره!", { reply_to_message_id: message.message_id });
      return;
    }
    targetUser = await findUserByUsername(db, normalizeUsername(parts[1]));
    if (!targetUser) {
      await sendMessage(token, message.chat.id, "🐱 کاربری با این یوزرنیم پیدا نشد!", { reply_to_message_id: message.message_id });
      return;
    }
    if (targetUser.telegram_id === message.from.id) {
      await sendMessage(token, message.chat.id, "🐱 نمی‌تونی به خودت انتقال بدی!", { reply_to_message_id: message.message_id });
      return;
    }
  } else {
    await sendMessage(token, message.chat.id, "🐱 نحوه استفاده:\n/pay @username 100\nیا ریپلای کن و بنویس /pay 100", { reply_to_message_id: message.message_id });
    return;
  }

  if (!targetUser) {
    await sendMessage(token, message.chat.id, "🐱 کاربر پیدا نشد!", { reply_to_message_id: message.message_id });
    return;
  }

  const groupBalance = await getGroupMemberBalance(db, message.chat.id, message.from.id);
  if (groupBalance < amount) {
    await sendMessage(token, message.chat.id, `🐱 امتیاز کافی در این گروه نداری!\n💳 موجودی گروه: ${groupBalance} MP`, { reply_to_message_id: message.message_id });
    return;
  }

  const now = Math.floor(Date.now() / 1000);
  const success = await applyPayTransfer(db, message.from.id, targetUser.telegram_id, amount, message.chat.id, now);

  if (!success) {
    await sendMessage(token, message.chat.id, "🐱 انتقال امکان‌پذیر نیست. یا موجودی گروه کافی نیست یا دریافت‌کننده عضو گروه نیست!", { reply_to_message_id: message.message_id });
    return;
  }

  const fromTitle = await getActiveTitle(db, message.chat.id, message.from.id);
  const toTitle = await getActiveTitle(db, message.chat.id, targetUser.telegram_id);
  const fromLabel = fromTitle ? titleBadge(fromTitle.name, fromTitle.last_price, fromTitle.emoji) : `🐱 ${escapeHtml(message.from.first_name)}`;
  const toLabel = toTitle ? titleBadge(toTitle.name, toTitle.last_price, toTitle.emoji) : `🐱 ${escapeHtml(targetUser.first_name)}`;

  await sendMessage(
    token,
    message.chat.id,
    `💸 <b>انتقال موفق!</b>\n\n${fromLabel}\n➡️ ${amount} MP\n${toLabel}\n\n✨ هم‌اکنون لیدربورد گروه هم به‌روز شده.`
  );
}

export async function handleDuelRequest(
  token: string,
  db: D1Database,
  message: TelegramMessage
) {
  if (!message.from) return;
  if (message.chat.type === "private") {
    await sendMessage(token, message.chat.id, "🐱 دعوا فقط داخل گروه انجام می‌شه!");
    return;
  }

  if (!message.reply_to_message || !message.reply_to_message.from) {
    await sendMessage(
      token,
      message.chat.id,
      "🐱 برای دعوا، روی پیام حریفت ریپلای کن و بنویس:\n<code>دعوا 500</code>",
      { reply_to_message_id: message.message_id }
    );
    return;
  }

  const target = message.reply_to_message.from;
  if (target.is_bot) {
    await sendMessage(token, message.chat.id, "🐱 نمی‌تونی با ربات دعوا کنی!", { reply_to_message_id: message.message_id });
    return;
  }

  if (target.id === message.from.id) {
    await sendMessage(token, message.chat.id, "🐱 نمی‌تونی با خودت دعوا کنی!", { reply_to_message_id: message.message_id });
    return;
  }

  const text = message.text || "";
  const parts = text.split(" ").filter(Boolean);
  if (parts.length < 2) {
    await sendMessage(
      token,
      message.chat.id,
      `🐱 نحوه استفاده:\nریپلای کن و بنویس <code>دعوا 500</code>`,
      { reply_to_message_id: message.message_id }
    );
    return;
  }

  const amount = safeParseAmount(parts[1]);
  if (amount === null) {
    await sendMessage(token, message.chat.id, "🐱 مقدار امتیاز نامعتبره!", { reply_to_message_id: message.message_id });
    return;
  }

  await ensureGroup(db, message.chat);
  await ensureUser(db, message.from);
  const challenger = await db
    .prepare(`SELECT meow_points FROM users WHERE telegram_id = ?`)
    .bind(message.from.id)
    .first<{ meow_points: number }>();
  const challengerGroupBalance = await getGroupMemberBalance(db, message.chat.id, message.from.id);

  if (!challenger || challenger.meow_points < amount || challengerGroupBalance < amount) {
    await sendMessage(token, message.chat.id, `🐱 امتیاز کافی نداری!\n💳 موجودی گروه: ${challengerGroupBalance} MP`, {
      reply_to_message_id: message.message_id,
    });
    return;
  }

  await ensureUser(db, target);
  const targetGlobal = await db
    .prepare(`SELECT meow_points FROM users WHERE telegram_id = ?`)
    .bind(target.id)
    .first<{ meow_points: number }>();
  const targetGroupBalance = await getGroupMemberBalance(db, message.chat.id, target.id);

  if (!targetGlobal || targetGlobal.meow_points < amount || targetGroupBalance < amount) {
    await sendMessage(token, message.chat.id, `🐱 حریف امتیاز کافی در این گروه نداره!\n💳 موجودی گروه حریف: ${targetGroupBalance} MP`, {
      reply_to_message_id: message.message_id,
    });
    return;
  }

  const existingId = await findOpenDuelAgainst(db, message.chat.id, target.id);
  if (existingId) await deleteDuel(db, existingId);

  const duelId = generateDuelId();
  const nowSec = Math.floor(Date.now() / 1000);
  const challengerRating = await getDuelRating(db, message.from.id, message.chat.id);
  const targetRating = await getDuelRating(db, target.id, message.chat.id);
  const challengerTitle = await getActiveTitle(db, message.chat.id, message.from.id);
  const targetTitle = await getActiveTitle(db, message.chat.id, target.id);
  const challengerLabel = challengerTitle ? titleBadge(challengerTitle.name, challengerTitle.last_price, challengerTitle.emoji) : `🐱 ${escapeHtml(message.from.first_name)}`;
  const targetLabel = targetTitle ? titleBadge(targetTitle.name, targetTitle.last_price, targetTitle.emoji) : `🐱 ${escapeHtml(target.first_name)}`;

  const res = await telegramRequest(token, "sendMessage", {
    chat_id: message.chat.id,
    text:
      `⚔️ <b>دعوای Meow!</b>\n\n` +
      `${challengerLabel} <b>(${challengerRating})</b>\n` +
      `🆚\n` +
      `${targetLabel} <b>(${targetRating})</b>\n\n` +
      `💰 شرط: <b>${amount} MP</b>\n` +
      `🏆 برنده: <b>${amount * 2} MP</b>\n\n` +
      `⏱️ ${DUEL_TIMEOUT_SEC} ثانیه فرصت داری قبول کنی!`,
    parse_mode: "HTML",
    reply_markup: duelKeyboard(duelId, target.id, message.from.id),
  });

  const duel: DuelState = {
    id: duelId,
    challengerId: message.from.id,
    challengerName: message.from.first_name,
    targetId: target.id,
    targetName: target.first_name,
    amount,
    groupId: message.chat.id,
    messageId: res.result?.message_id ?? 0,
    createdAt: nowSec,
  };

  // No escrow happens at creation — both players are debited at accept time
  // (handleDuelAccept). Expired duels are simply deleted by the cron sweep
  // (src/sweep.ts); in-request setTimeout() is unreliable on Workers and not used.
  await createDuel(db, duel);
}

export async function handleDuelAccept(
  token: string,
  db: D1Database,
  callback: TelegramCallbackQuery,
  duelId: string
) {
  if (!callback.message) return;

  if (!isValidDuelId(duelId)) {
    await answerCallback(token, callback.id, "🐱 دعوای نامعتبر!", true);
    return;
  }

  const duel = await getDuel(db, duelId);
  if (!duel || duel.messageId !== callback.message.message_id) {
    await answerCallback(token, callback.id, "🐱 این دعوا منقضی شده!", true);
    return;
  }

  if (duel.targetId !== callback.from.id) {
    await answerCallback(token, callback.id, "🐱 فقط حریف می‌تونه قبول کنه!", true);
    return;
  }

  const claimed = await deleteDuel(db, duelId);
  if (!claimed) {
    await answerCallback(token, callback.id, "🐱 این دعوا قبلاً انجام شده یا منقضی شده!", true);
    return;
  }
  const now = Math.floor(Date.now() / 1000);

  // Double-check both players actually have enough points before proceeding.
  const challengerRow = await db.prepare(`SELECT meow_points FROM users WHERE telegram_id = ?`).bind(duel.challengerId).first<{ meow_points: number }>();
  const targetRow = await db.prepare(`SELECT meow_points FROM users WHERE telegram_id = ?`).bind(duel.targetId).first<{ meow_points: number }>();
  const challengerGroupRow = await db
    .prepare(`SELECT meow_points FROM group_members WHERE telegram_group_id = ? AND telegram_user_id = ?`)
    .bind(duel.groupId, duel.challengerId)
    .first<{ meow_points: number }>();
  const targetGroupRow = await db
    .prepare(`SELECT meow_points FROM group_members WHERE telegram_group_id = ? AND telegram_user_id = ?`)
    .bind(duel.groupId, duel.targetId)
    .first<{ meow_points: number }>();

  if (
    !challengerRow || !targetRow ||
    challengerRow.meow_points < duel.amount ||
    targetRow.meow_points < duel.amount ||
    !challengerGroupRow || challengerGroupRow.meow_points < duel.amount ||
    !targetGroupRow || targetGroupRow.meow_points < duel.amount
  ) {
    await editMessageText(
      token,
      duel.groupId,
      duel.messageId,
      `❌ <b>دعوا لغو شد!</b>\n\nیکی از بازیکن‌ها امتیاز کافی نداره.`
    );
    await answerCallback(token, callback.id);
    return;
  }

  const batchResults = await db.batch([
    db.prepare(`UPDATE users SET meow_points = meow_points - ? WHERE telegram_id = ? AND meow_points >= ?`)
      .bind(duel.amount, duel.challengerId, duel.amount),
    db.prepare(`UPDATE users SET meow_points = meow_points - ? WHERE telegram_id = ? AND meow_points >= ?`)
      .bind(duel.amount, duel.targetId, duel.amount),
    db.prepare(`UPDATE group_members SET meow_points = meow_points - ? WHERE telegram_group_id = ? AND telegram_user_id = ? AND meow_points >= ?`)
      .bind(duel.amount, duel.groupId, duel.challengerId, duel.amount),
    db.prepare(`UPDATE group_members SET meow_points = meow_points - ? WHERE telegram_group_id = ? AND telegram_user_id = ? AND meow_points >= ?`)
      .bind(duel.amount, duel.groupId, duel.targetId, duel.amount),
  ]);

  // defensive check in case concurrent change happened between select and update.
  // NOTE: D1 batch() only rolls back on hard errors — a statement matching zero
  // rows (meta.changes === 0) is NOT an error, so the other deductions in this
  // batch are already committed. Refund the ones that DID apply so no points
  // silently vanish, keeping the accept all-or-nothing.
  if (
    batchResults[0].meta.changes === 0 ||
    batchResults[1].meta.changes === 0 ||
    batchResults[2].meta.changes === 0 ||
    batchResults[3].meta.changes === 0
  ) {
    const refunds: Array<ReturnType<D1Database["prepare"]>> = [];
    if (batchResults[0].meta.changes > 0) {
      refunds.push(db.prepare(`UPDATE users SET meow_points = meow_points + ? WHERE telegram_id = ?`).bind(duel.amount, duel.challengerId));
    }
    if (batchResults[1].meta.changes > 0) {
      refunds.push(db.prepare(`UPDATE users SET meow_points = meow_points + ? WHERE telegram_id = ?`).bind(duel.amount, duel.targetId));
    }
    if (batchResults[2].meta.changes > 0) {
      refunds.push(
        db.prepare(`UPDATE group_members SET meow_points = meow_points + ? WHERE telegram_group_id = ? AND telegram_user_id = ?`)
          .bind(duel.amount, duel.groupId, duel.challengerId)
      );
    }
    if (batchResults[3].meta.changes > 0) {
      refunds.push(
        db.prepare(`UPDATE group_members SET meow_points = meow_points + ? WHERE telegram_group_id = ? AND telegram_user_id = ?`)
          .bind(duel.amount, duel.groupId, duel.targetId)
      );
    }
    if (refunds.length) await db.batch(refunds);

    await editMessageText(
      token,
      duel.groupId,
      duel.messageId,
      `❌ <b>دعوا لغو شد!</b>\n\nیکی از بازیکن‌ها امتیاز کافی نداره.`
    );
    await answerCallback(token, callback.id);
    return;
  }

  const challengerRoll = Math.floor(Math.random() * 49) + 1;
  const targetRoll = Math.floor(Math.random() * 49) + 1;

  if (challengerRoll === targetRoll) {
    await db.batch([
      db.prepare(`UPDATE users SET meow_points = meow_points + ? WHERE telegram_id = ?`).bind(duel.amount, duel.challengerId),
      db.prepare(`UPDATE users SET meow_points = meow_points + ? WHERE telegram_id = ?`).bind(duel.amount, duel.targetId),
      db.prepare(`UPDATE group_members SET meow_points = meow_points + ? WHERE telegram_group_id = ? AND telegram_user_id = ?`).bind(duel.amount, duel.groupId, duel.challengerId),
      db.prepare(`UPDATE group_members SET meow_points = meow_points + ? WHERE telegram_group_id = ? AND telegram_user_id = ?`).bind(duel.amount, duel.groupId, duel.targetId),
      // Compensating rows so the /repair balance check (meow_points vs SUM of
      // transactions) stays consistent — mirror the win path's DUEL_BET rows.
      db.prepare(`INSERT INTO transactions (telegram_user_id, group_id, amount, reason, created_at) VALUES (?, ?, ?, ?, ?)`)
        .bind(duel.challengerId, duel.groupId, -duel.amount, 'DUEL_BET', now),
      db.prepare(`INSERT INTO transactions (telegram_user_id, group_id, amount, reason, created_at) VALUES (?, ?, ?, ?, ?)`)
        .bind(duel.targetId, duel.groupId, -duel.amount, 'DUEL_BET', now),
      db.prepare(`INSERT INTO transactions (telegram_user_id, group_id, amount, reason, created_at) VALUES (?, ?, ?, ?, ?)`)
        .bind(duel.challengerId, duel.groupId, duel.amount, 'DUEL_TIE', now),
      db.prepare(`INSERT INTO transactions (telegram_user_id, group_id, amount, reason, created_at) VALUES (?, ?, ?, ?, ?)`)
        .bind(duel.targetId, duel.groupId, duel.amount, 'DUEL_TIE', now),
    ]);

    await editMessageText(
      token,
      duel.groupId,
      duel.messageId,
      `🎲 <b>دعوای Meow!</b>\n\n` +
      `🐱 ${escapeHtml(duel.challengerName)}: ${challengerRoll}\n` +
      `🐱 ${escapeHtml(duel.targetName)}: ${targetRoll}\n\n` +
      `🤝 <b>مساوی!</b>\nهیچ‌کس امتیازی نمی‌بره.`
    );
    await answerCallback(token, callback.id);
    return;
  }

  const winnerId = challengerRoll > targetRoll ? duel.challengerId : duel.targetId;
  const winnerName = challengerRoll > targetRoll ? duel.challengerName : duel.targetName;
  const winnerReward = duel.amount * 2;
  const winnerNetGain = duel.amount;

  const challengerRating = await getDuelRating(db, duel.challengerId, duel.groupId);
  const targetRating = await getDuelRating(db, duel.targetId, duel.groupId);
  const [newChallengerRating, newTargetRating] = computeElo(
    challengerRating,
    targetRating,
    challengerRoll > targetRoll ? 1 : 0
  );

  await db.batch([
    db.prepare(`UPDATE users SET meow_points = meow_points + ? WHERE telegram_id = ?`).bind(winnerReward, winnerId),
    db.prepare(`UPDATE group_members SET meow_points = meow_points + ? WHERE telegram_group_id = ? AND telegram_user_id = ?`).bind(winnerReward, duel.groupId, winnerId),
    db.prepare(`INSERT INTO transactions (telegram_user_id, group_id, amount, reason, created_at) VALUES (?, ?, ?, ?, ?)`)
      .bind(duel.challengerId, duel.groupId, -duel.amount, `DUEL_BET`, now),
    db.prepare(`INSERT INTO transactions (telegram_user_id, group_id, amount, reason, created_at) VALUES (?, ?, ?, ?, ?)`)
      .bind(duel.targetId, duel.groupId, -duel.amount, `DUEL_BET`, now),
    db.prepare(`INSERT INTO transactions (telegram_user_id, group_id, amount, reason, created_at) VALUES (?, ?, ?, ?, ?)`)
      .bind(winnerId, duel.groupId, winnerReward, `DUEL_WIN`, now),
    db.prepare(`INSERT INTO transactions (telegram_user_id, group_id, amount, reason, created_at) VALUES (?, ?, ?, ?, ?)`)
      .bind(winnerId === duel.challengerId ? duel.targetId : duel.challengerId, duel.groupId, 0, `DUEL_LOSS`, now),
    db.prepare(`UPDATE group_members SET duel_rating = ? WHERE telegram_group_id = ? AND telegram_user_id = ?`).bind(newChallengerRating, duel.groupId, duel.challengerId),
    db.prepare(`UPDATE group_members SET duel_rating = ? WHERE telegram_group_id = ? AND telegram_user_id = ?`).bind(newTargetRating, duel.groupId, duel.targetId),
  ]);

  await editMessageText(
    token,
    duel.groupId,
    duel.messageId,
    `🎲 <b>دعوای Meow!</b>\n\n` +
    `🐱 ${escapeHtml(duel.challengerName)}: ${challengerRoll}\n` +
    `🐱 ${escapeHtml(duel.targetName)}: ${targetRoll}\n\n` +
    `🏆 <b>${escapeHtml(winnerName)} برنده شد!</b>\n` +
    `💰 کل پاداش: ${winnerReward} MP\n` +
    `➕ افزایش خالص: +${winnerNetGain} MP\n\n` +
    `⚔️ <b>ریتینگ دعوا:</b>\n` +
    `🐱 ${escapeHtml(duel.challengerName)}: ${challengerRating} → <b>${newChallengerRating}</b>\n` +
    `🐱 ${escapeHtml(duel.targetName)}: ${targetRating} → <b>${newTargetRating}</b>`
  );

  await answerCallback(token, callback.id, "🎲 دعوا انجام شد!");
}

export async function handleDuelDecline(token: string, db: D1Database, callback: TelegramCallbackQuery, duelId: string) {
  if (!callback.message) return;

  if (!isValidDuelId(duelId)) {
    await answerCallback(token, callback.id, "🐱 دعوای نامعتبر!", true);
    return;
  }

  const duel = await getDuel(db, duelId);
  if (!duel || duel.messageId !== callback.message.message_id) {
    await answerCallback(token, callback.id, "🐱 این دعوا منقضی شده!", true);
    return;
  }

  if (duel.targetId !== callback.from.id && duel.challengerId !== callback.from.id) {
    await answerCallback(token, callback.id, "🐱 این دعوا مال تو نیست!", true);
    return;
  }

  await deleteDuel(db, duelId);

  await editMessageText(
    token,
    duel.groupId,
    duel.messageId,
    `❌ <b>دعوا لغو شد!</b>\n\n` +
    `🐱 ${escapeHtml(duel.challengerName)} 🆚 ${escapeHtml(duel.targetName)}\n` +
    `💰 ${duel.amount} MP`
  );

  await answerCallback(token, callback.id, "✅ دعوا لغو شد.");
}

export async function handleGroupSettings(token: string, db: D1Database, message: TelegramMessage) {
  if (message.chat.type === "private") {
    await sendMessage(token, message.chat.id, "🐱 این دستور فقط داخل گروه کار می‌کنه!");
    return;
  }

  if (!message.from) return;

  const isAdmin = await isGroupAdmin(token, message.chat.id, message.from.id);
  if (!isAdmin) {
    await sendMessage(token, message.chat.id, "🚫 فقط ادمین‌های گروه می‌تونن تنظیمات رو تغییر بدن!", {
      reply_to_message_id: message.message_id,
    });
    return;
  }

  await ensureGroup(db, message.chat);
  const settings = await getGroupSettings(db, message.chat.id);

  const text =
    `⚙️ <b>تنظیمات گروه</b>\n\n` +
    `🤖 وضعیت ربات: ${settings.enabled ? "✅ روشن" : "❌ خاموش"}\n` +
    `⏱️ کول‌داون: ${settings.cooldown} ثانیه`;

  await sendMessage(token, message.chat.id, text, { reply_markup: groupSettingsKeyboard(settings.enabled, settings.cooldown, message.from?.id) });
}

export async function handleCallbackQuery(
  token: string,
  db: D1Database,
  env: Bindings,
  callback: TelegramCallbackQuery
) {
  if (!callback.message || !callback.data) return;

  const chatId = callback.message.chat.id;
  const messageId = callback.message.message_id;
  const userId = callback.from.id;
  const data = callback.data;

  const segments = data.split(":");
  if (segments.length < 2) {
    await answerCallback(token, callback.id, "❌ درخواست نامعتبر", true);
    return;
  }

  const [action, ...rawParams] = segments;

  const parseUserScopedParams = (params: string[]) => {
    const userIndex = params.indexOf("user");
    if (userIndex >= 0 && userIndex + 1 < params.length) {
      const parsed = parseInt(params[userIndex + 1], 10);
      if (Number.isFinite(parsed)) {
        return {
          userId: parsed,
          params: params.slice(0, userIndex),
        };
      }
    }
    return { userId: null as number | null, params };
  };

  const { userId: scopedUserId, params } = parseUserScopedParams(rawParams);
  if (scopedUserId && scopedUserId !== userId) {
    await answerCallback(token, callback.id, "🚫 این دکمه فقط برای کسی است که پیام را باز کرده است.", true);
    return;
  }

  if (action === "admin" || action === "useract" || action === "bc" || action === "groupmgr" || action === "duelmon" || action === "audit" || action === "repair" || action === "auctionmgr" || action === "cfg") {
    await handleOwnerPanelAction(token, db, env, callback, action, params);
    return;
  }

  if (action === "group") {
    const isAdmin = await isGroupAdmin(token, chatId, userId);
    if (!isAdmin) {
      await answerCallback(token, callback.id, "🚫 فقط ادمین گروه!", true);
      return;
    }
  }

  try {
    if (action === "cmd") {
      const fakeMessage: TelegramMessage = {
        message_id: messageId,
        from: callback.from,
        chat: callback.message.chat,
        text: `/${params[0]}`,
      };

      if (params[0] === "me") await handleMe(token, db, env, fakeMessage);
      else if (params[0] === "top") await handleTop(token, db, fakeMessage);
      else if (params[0] === "history") await handleHistory(token, db, fakeMessage);
      else if (params[0] === "events") await handleEvents(token, db, env, fakeMessage);
      else if (params[0] === "pay") await handlePay(token, db, fakeMessage);
      else if (params[0] === "treasury") await handleTreasury(token, db, fakeMessage);
      else if (params[0] === "dice") await handleDice(token, db, env, fakeMessage);
      else if (params[0] === "lottery" || params[0] === "gamble") await handleLottery(token, db, env, fakeMessage);
      else if (params[0] === "duelrank") await handleDuelRank(token, db, fakeMessage);
      else if (params[0] === "poker") await handlePokerCommand(token, db, env, fakeMessage);
      else if (params[0] === "blackjack") await handleBlackjackCommand(token, db, env, fakeMessage);
      else if (params[0] === "booster") await handleBooster(token, db, fakeMessage);
      else if (params[0] === "groupstats") await handleGroupStats(token, db, fakeMessage);

      await answerCallback(token, callback.id);
      return;
    }

    if (action === "menu") {
      if (params[0] === "main") {
        await editMessageText(token, chatId, messageId, "🐱 <b>منوی اصلی</b>\n\nاز اینجا سریع به همه امکانات دسترسی داری:", mainMenuKeyboard(userId));
      } else if (params[0] === "help") {
        await editMessageText(
          token,
          chatId,
          messageId,
          `🆘 <b>راهنمای سریع</b>\n\n• برای امتیاز گرفتن، در گروه <b>میو</b> بگو\n• برای دیدن وضعیت خود، /me را بفرست\n• برای انتقال امتیاز، /pay یا انتقال @username 100\n• برای دیدن رتبه‌بندی، /top را بفرست`,
          mainMenuKeyboard(userId)
        );
      } else if (params[0] === "group_settings") {
        if (callback.message.chat.type === "private") {
          await answerCallback(token, callback.id, "این منو فقط داخل گروه کار می‌کند!", true);
          return;
        }
        const isAdmin = await isGroupAdmin(token, chatId, userId);
        if (!isAdmin) {
          await answerCallback(token, callback.id, "🚫 فقط ادمین گروه!", true);
          return;
        }
        const settings = await getGroupSettings(db, chatId);
        await editMessageText(
          token,
          chatId,
          messageId,
          `⚙️ <b>تنظیمات گروه</b>\n\n🤖 وضعیت: ${settings.enabled ? "✅ روشن" : "❌ خاموش"}\n⏱️ کول‌داون: ${settings.cooldown}s`,
          groupSettingsKeyboard(settings.enabled, settings.cooldown, userId)
        );
      } else if (params[0] === "close") {
        await deleteMessage(token, chatId, messageId);
      } else if (params[0] === "admin") {
        const fakeMessage: TelegramMessage = {
          message_id: messageId,
          from: callback.from,
          chat: callback.message.chat,
          text: "/admin",
        };
        await handleAdmin(token, db, env, fakeMessage);
      }
      await answerCallback(token, callback.id);
      return;
    }

    if (action === "group") {
      const settings = await getGroupSettings(db, chatId);

      if (params[0] === "toggle_bot") {
        const newState = settings.enabled ? 0 : 1;
        await db.prepare(`UPDATE telegram_groups SET bot_enabled = ? WHERE telegram_group_id = ?`).bind(newState, chatId).run();
        const updated = await getGroupSettings(db, chatId);
        await editMessageText(token, chatId, messageId, `⚙️ <b>تنظیمات گروه</b>\n\n🤖 وضعیت: ${updated.enabled ? "✅ روشن" : "❌ خاموش"}\n⏱️ کول‌داون: ${updated.cooldown}s`, groupSettingsKeyboard(updated.enabled, updated.cooldown, userId));
      } else if (params[0] === "set_cooldown") {
        const options = [5, 10, 30, 60, 300];
        const currentIndex = options.indexOf(settings.cooldown);
        const nextCooldown = options[(currentIndex + 1) % options.length];
        await db.prepare(`UPDATE telegram_groups SET cooldown_seconds = ? WHERE telegram_group_id = ?`).bind(nextCooldown, chatId).run();
        const updated = await getGroupSettings(db, chatId);
        await editMessageText(token, chatId, messageId, `⚙️ <b>تنظیمات گروه</b>\n\n🤖 وضعیت: ${updated.enabled ? "✅ روشن" : "❌ خاموش"}\n⏱️ کول‌داون: ${updated.cooldown}s`, groupSettingsKeyboard(updated.enabled, updated.cooldown, userId));
      } else if (params[0] === "reset_lb") {
        await db.prepare(`DELETE FROM group_members WHERE telegram_group_id = ?`).bind(chatId).run();
        await editMessageText(token, chatId, messageId, "🔄 <b>لیدربورد گروه ریست شد!</b>", groupSettingsKeyboard(settings.enabled, settings.cooldown, userId));
      }

      await answerCallback(token, callback.id, "✅ انجام شد!");
      return;
    }

    if (action === "duel") {
      if (params[0] === "accept") {
        await handleDuelAccept(token, db, callback, params[1]);
      } else if (params[0] === "decline" || params[0] === "cancel") {
        // decline is target-scoped, cancel is challenger-scoped (see
        // duelKeyboard); handleDuelDecline accepts either player.
        await handleDuelDecline(token, db, callback, params[1]);
      }
      return;
    }

    if (action === "booster") {
      if (params[0] !== "buy") {
        await answerCallback(token, callback.id, "❌ درخواست نامعتبر", true);
        return;
      }
      await handleBoosterBuy(token, db, callback, params[1] ?? "");
      return;
    }

    if (action === "poker") {
      await handlePokerCallback(token, db, env, callback);
      return;
    }

    if (action === "bj") {
      await handleBlackjackCallback(token, db, env, callback);
      return;
    }

    if (action === "title") {
      await handleTitleCallback(token, db, env, callback);
      return;
    }

    if (action === "event") {
      if (env.BOT_OWNER_ID !== String(userId)) {
        await answerCallback(token, callback.id, "🚫 فقط صاحب ربات!", true);
        return;
      }

      if (params[0] === "add") {
        await answerCallback(token, callback.id, "✅ استفاده از /add event برای افزودن رویداد", true);
        await sendMessage(token, chatId, `برای افزودن رویداد از دستور زیر استفاده کن:\n<code>/add event FlashSale 2 60</code>`);
        return;
      }

      if (params[0] === "edit") {
        await answerCallback(token, callback.id, "✅ استفاده از /editevent برای ویرایش رویداد", true);
        await sendMessage(token, chatId, `برای ویرایش رویداد فعلی از دستور زیر استفاده کن:\n<code>/editevent FlashSale 2 60</code>`);
        return;
      }

      if (params[0] === "end") {
        await db.prepare(`UPDATE events SET is_active = 0 WHERE is_active = 1`).run();
        // Flush the cached active event so meows stop applying its multiplier
        // immediately (same as handleDeleteEvent) instead of up to the TTL.
        await invalidateActiveEventCache(env);
        await editMessageText(token, chatId, messageId, "✅ رویداد فعلی پایان پیدا کرد.");
        await answerCallback(token, callback.id, "رویداد پایان یافت.", true);
        return;
      }
    }

    if (action === "lottery") {
      const { userId: scopedUserId, params: lotteryParams } = parseUserScopedParams(params);
      if (scopedUserId && scopedUserId !== userId) {
        await answerCallback(token, callback.id, "🚫 این دکمه فقط برای کسی است که پیام را باز کرده است.", true);
        return;
      }
      const canDraw = env.BOT_OWNER_ID === String(userId) || await isGroupAdmin(token, chatId, userId);

      if (lotteryParams[0] === "status") {
        const text = await getLotteryStatusText(db, chatId, userId);
        await editMessageText(token, chatId, messageId, text, lotteryKeyboard(env.BOT_OWNER_ID === String(userId), userId, canDraw));
        await answerCallback(token, callback.id);
        return;
      }

      if (lotteryParams[0] === "my_tickets") {
        const text = await getLotteryTicketSummary(db, chatId, userId);
        await editMessageText(token, chatId, messageId, text, lotteryKeyboard(env.BOT_OWNER_ID === String(userId), userId, canDraw));
        await answerCallback(token, callback.id);
        return;
      }

      if (lotteryParams[0] === "help") {
        const settings = await getGroupLotteryConfig(db, chatId);
        const isOwner = env.BOT_OWNER_ID === String(userId);
        await editMessageText(token, chatId, messageId, formatLotteryHelpText(settings), lotteryKeyboard(isOwner, userId, canDraw));
        await answerCallback(token, callback.id);
        return;
      }

      if (lotteryParams[0] === "buy") {
        if (!callback.from || !callback.message) {
          await answerCallback(token, callback.id, "❌ درخواست نامعتبر", true);
          return;
        }
        const config = await getGroupLotteryConfig(db, chatId);
        if (!config.lotteryEnabled) {
          await answerCallback(token, callback.id, "🎟️ لاتاری فعلا غیرفعال است.", true);
          return;
        }
        const count = lotteryParams.length >= 2 ? parseInt(lotteryParams[1], 10) : 1;
        if (!Number.isFinite(count) || count <= 0 || count > 10) {
          await answerCallback(token, callback.id, "🐱 تعداد بلیت نامعتبر است. حداکثر 10 بلیت مجاز است.", true);
          return;
        }
        const purchase = await purchaseLotteryTickets(db, chatId, callback.from.id, count);
        if (!purchase.success) {
          if (purchase.reason === 'insufficient_funds') {
            await answerCallback(token, callback.id, "🐱 امتیاز گروهی کافی نداری!", true);
            return;
          }
          await answerCallback(token, callback.id, "❌ خطا در خرید بلیت لاتاری.", true);
          return;
        }
        const numbersText = purchase.numbers?.map((nums, index) => `🎫 بلیت ${index + 1}: ${nums.split(',').join(', ')}`).join('\n') ?? "-";
        const freeText = purchase.allocated > 0 ? `\n\n🎁 <b>${purchase.allocated}</b> بلیت رایگان شما هم در این دور ثبت شد.` : "";
        await editMessageText(token, chatId, messageId,
          `🎫 <b>بلیت خریداری شد</b>\n\n` +
          `تعداد بلیت: <b>${count}</b>\n` +
          `شماره دور: <b>${purchase.roundId}</b>\n\n` +
          `📌 شماره‌های بلیت‌های شما:\n${numbersText}${freeText}\n\n` +
          `🎯 اگر حداقل 3 عدد با اعداد برنده یکی باشد، در این دور برنده می‌شوید.\n` +
          `💡 ساختار جوایز: 3 عدد = 20% پات، 4 عدد = 35%، 5 عدد = 50%، 6 عدد = 100%`,
          lotteryKeyboard(env.BOT_OWNER_ID === String(userId), callback.from.id, canDraw)
        );

        await answerCallback(token, callback.id);
        return;
      }

      if (lotteryParams[0] === "draw") {
        if (env.BOT_OWNER_ID !== String(userId)) {
          const isAdmin = await isGroupAdmin(token, chatId, userId);
          if (!isAdmin) {
            await answerCallback(token, callback.id, "🚫 فقط صاحب ربات یا ادمین می‌تواند لاتاری را قرعه‌کشی کند.", true);
            return;
          }
        }

        const round = await db.prepare(`SELECT id FROM lottery_rounds WHERE telegram_group_id = ? AND status = 'open' ORDER BY created_at DESC LIMIT 1`).bind(chatId).first<{ id: number }>();
        if (!round) {
          await answerCallback(token, callback.id, "🎟️ راند بازی باز وجود ندارد.", true);
          return;
        }

        // Make sure pending free tickets (earned by meowing) join this round before the draw.
        await allocatePendingLotteryTickets(db, chatId);

        const drawRes = await drawLotteryRound(db, round.id, chatId);
        if (!drawRes.success) {
          await answerCallback(token, callback.id, `❌ خطا در قرعه‌کشی: ${String(drawRes.reason)}`, true);
          return;
        }

        const winners = drawRes.winners || [];
        const winnerLines = winners.length
          ? winners.slice(0, 8).map((w) => `• <b>${escapeHtml(String(w.displayName || `کاربر ${w.userId}`))}</b> — ${w.matchCount} عدد درست — <b>${w.payout} MP</b>`)
          : [];
        const winnerSection = winners.length
          ? `\n\n🏆 <b>برندگان این دور</b>:\n${winnerLines.join("\n")}${winners.length > 8 ? `\n… و ${winners.length - 8} برنده دیگر` : ""}`
          : `\n\n🎯 هیچ بلیتی با حداقل 3 عدد درست برنده نشد. پات این دور به دور بعد منتقل می‌شود.`;

        await editMessageText(token, chatId, messageId,
          `🎉 <b>قرعه‌کشی انجام شد</b>\n\n` +
          `🔢 اعداد برنده: <b>${drawRes.winningNumbers}</b>\n` +
          `💸 مجموع پرداختی: <b>${drawRes.totalPaid} MP</b>\n` +
          `👥 تعداد برندگان: <b>${drawRes.payoutsCount}</b>\n` +
          `✨ نتایج در پیام جدید ارسال شد.`,
          lotteryKeyboard(env.BOT_OWNER_ID === String(userId), userId, canDraw)
        );

        await sendMessage(token, chatId,
          `🎉 <b>نتایج لاتاری</b>\n\n` +
          `🔢 اعداد برنده: <b>${drawRes.winningNumbers}</b>\n` +
          `💸 مجموع پرداختی: <b>${drawRes.totalPaid} MP</b>\n` +
          `👥 تعداد برندگان: <b>${drawRes.payoutsCount}</b>${winnerSection}`,
          { parse_mode: "HTML" }
        );

        // Notify each winning user privately when they have opted in. A user
        // may win with multiple tickets, so send at most one DM per draw.
        const notifiedUsers = new Set<number>();
        for (const winner of winners) {
          if (winner.payout <= 0 || notifiedUsers.has(winner.userId)) continue;
          notifiedUsers.add(winner.userId);
          if (await getNotificationsEnabled(db, winner.userId)) {
            await sendMessage(
              token,
              winner.userId,
              `🎉 <b>برد لاتاری!</b>\n\nدر گروه <b>${escapeHtml(String(chatId))}</b>، ${winner.matchCount} عدد درست داشتی و <b>${winner.payout} MP</b> بردی.`,
            );
          }
        }

        await answerCallback(token, callback.id, "✅ قرعه‌کشی انجام شد.");
        return;
      }

      if (lotteryParams[0] === "adjust_price") {
        if (env.BOT_OWNER_ID !== String(userId)) {
          await answerCallback(token, callback.id, "🚫 فقط صاحب ربات!", true);
          return;
        }

        const delta = parseInt(params[1], 10) || 0;
        const newPrice = await handleLotterySetPrice(token, db, chatId, delta);
        const settings = await getGroupLotteryConfig(db, chatId);
        await editMessageText(token, chatId, messageId, `🎟️ قیمت بلیت جدید: <b>${newPrice} MP</b>\n\n${formatLotteryStatusText(settings)}`, lotteryKeyboard(true, userId));
        await answerCallback(token, callback.id, `✅ قیمت بلیت به ${newPrice} تغییر یافت.`);
        return;
      }

      if (lotteryParams[0] === "adjust_pot") {
        if (env.BOT_OWNER_ID !== String(userId)) {
          await answerCallback(token, callback.id, "🚫 فقط صاحب ربات!", true);
          return;
        }

        const delta = parseInt(params[1], 10) || 0;
        const newPot = await handleLotterySetPot(token, db, chatId, delta);
        const settings = await getGroupLotteryConfig(db, chatId);
        await editMessageText(token, chatId, messageId, `💰 پات لاتاری جدید: <b>${newPot} MP</b>\n\n${formatLotteryStatusText(settings)}`, lotteryKeyboard(true, userId));
        await answerCallback(token, callback.id, `✅ پات لاتاری به ${newPot} تغییر یافت.`);
        return;
      }

    await answerCallback(token, callback.id, "❌ درخواست نامعتبر", true);
    return;
  }

  await answerCallback(token, callback.id);
  } catch (err) {
    console.error("Callback error:", err);
    await answerCallback(token, callback.id, "❌ خطا رخ داد!", true);
  }
}

export async function handleMyChatMember(token: string, db: D1Database, update: TelegramChatMemberUpdated) {
  const { chat, new_chat_member } = update;

  if (new_chat_member.status === "member" || new_chat_member.status === "administrator") {
    if (chat.type === "group" || chat.type === "supergroup") {
      await ensureGroup(db, chat);
      await sendMessage(
        token,
        chat.id,
        `🐱 <b>سلام گروه!</b>\n\nمن Meow Points Bot هستم! 🎉\n\n` +
          `هر وقت کسی توی این گروه بنویسه:\n` +
          `🐱 <b>meow</b>\n` +
          `🐱 <b>میو</b>\n` +
          `🐱 <b>میووو</b>\n\n` +
          `ممکنه Meow Points بگیره! ✨\n\n` +
          `📌 <b>دستورات:</b>\n` +
          `/me — پروفایل من\n` +
          `/top — رتبه‌بندی گروه\n` +
          `/pay — انتقال امتیاز\n` +
          `/settings — تنظیمات گروه (ادمین)\n\n` +
          `⏱️ کول‌داون: <b>5 دقیقه</b>\n` +
          `😸 بفرستید و امتیاز بگیرید!`
      );
    }
  }

  if (new_chat_member.status === "left" || new_chat_member.status === "kicked") {
    if (chat.type === "group" || chat.type === "supergroup") {
      await deactivateGroup(db, chat.id);
    }
  }
}
