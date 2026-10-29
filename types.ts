/** 词条数据结构 —— 与 {level}_words.json 字段一一对应，原文不修改 */
export interface WordEntry {
  id: string;
  sourceOrder: number;
  day: number;
  dayLabel: string;
  globalPage: number;
  pageInDay: number;
  word: string;
  phonetic: string;
  partOfSpeech: string;
  meaning: string;
  rawDefinition: string;
  example: string;
  exampleTranslation: string;
  notes: string;
  /** 学习顺序（1 = 最该先学的高频词） */
  freqRank?: number;
  /** wordfreq 词频值（0~8，越大越常见；0 表示语料未收录） */
  zipf?: number;
}

/** 一个分级（三级 / 四级 / 六级）的元信息，来自 public/data/levels.json */
export interface LevelDef {
  id: string;
  name: string;
  fullName: string;
  badge: string;
  wordCount: number;
  dayCount: number;
  pageCount: number;
  wordsFile: string;
  note: string;
}

export interface LevelsConfig {
  schemaVersion: string;
  default: string;
  levels: LevelDef[];
}

export type WordStatus = 'unlearned' | 'learning' | 'reviewing' | 'mastered';

/** 每个单词的学习状态 */
export interface WordProgress {
  id: string;
  /** 出现过次数（任何单元中被出题的次数） */
  appearances: number;
  /** 答对次数 */
  correctCount: number;
  /** 答错次数 */
  wrongCount: number;
  /** 最近一次答题时间戳 */
  lastAnsweredAt: number | null;
  /** 最近一次题型 */
  lastQuestionType: string | null;
  /** 是否完成过拼写题（答对即可视为完成练习） */
  spellingDone: boolean;
  /** 拼写题答对次数 */
  spellingCorrectCount: number;
  /** 连续正确次数 */
  streakCorrect: number;
  /** 当前状态 */
  status: WordStatus;
  /** 首次进入预览（变学习中）的时间戳 */
  firstLearnedAt: number | null;
  /** 在不同学习单元中答对的最小单元集合（按单元 id 去重，最多记 12 个） */
  correctInUnits: string[];
  /** 错词池标记 */
  inWrongPool: boolean;
  /** 错词池中跨单元连续答对次数 */
  poolCorrectStreak: number;
  /** 最近一次答对所在单元（用于池内跨单元判断） */
  poolLastCorrectUnit: string | null;
  /** 最近一次答错时间 */
  lastWrongAt: number | null;
  /** 最近一次答对时间 */
  lastCorrectAt: number | null;
  /** 已掌握后最近一次复习所在的单元序号（用于“超 7 个单元未复习”） */
  lastReviewUnitSeq: number | null;
  /** 是否曾达到过已掌握（用于答错降级后“再跨单元答对 2 次”重新掌握） */
  masteredOnce: boolean;

  // ---------- 艾宾浩斯遗忘曲线排程 ----------
  /** 当前记忆阶段 0~8（0 = 还没排期，1 = 5 分钟后……） */
  reviewStage: number;
  /** 下次复习时间戳（毫秒）；null = 未排期 */
  nextReviewAt: number | null;
  /** 按曲线完成的复习次数 */
  reviewCount: number;
  /** 遗忘次数（排期后被答错，阶段归零） */
  lapses: number;
  /** 最近一次复习排期时间 */
  scheduledAt: number | null;
}

export type QuestionType =
  | 'word-to-meaning'
  | 'meaning-to-word'
  | 'phonetic-to-word'
  | 'letter-fill'
  | 'letter-tiles'
  | 'spell-typing'
  | 'context-cloze';

/** 题目所属阶段：先英译中 → 再中译英 → 语境填空 → 最后拼写 */
export type QuestionStage = 'meaning-en' | 'meaning-cn' | 'context' | 'spelling';

export interface Question {
  /** 会话内唯一 id */
  qid: string;
  type: QuestionType;
  stage: QuestionStage;
  wordId: string;
  /** 题干展示 */
  prompt: {
    word: string;
    phonetic: string;
    partOfSpeech: string;
    meaning: string;
    rawDefinition: string;
    /** 字母补全题的残缺展示，如 "bea_tiful" */
    masked?: string;
    /** 字母补全题缺失片段 */
    missing?: string;
    /** 语境填空题：挖空后的句子 */
    sentence?: string;
    /** 语境填空题：句子中文翻译 */
    sentenceTranslation?: string;
  };
  /** 选项（拼写题为 null） */
  options: { key: string; text: string }[] | null;
  /** 正确选项 key（拼写题为 null，正确拼写在 answerText） */
  answerKey: string | null;
  /** 字母贴纸题：打乱的字母块 */
  tiles?: string[];
  /** 拼写题：正确拼写 */
  answerText?: string;
  /** 该题是不是错词重考（间隔插入） */
  isRevisit?: boolean;
}

export type UnitKind = 'new' | 'review' | 'test';

export interface UnitDef {
  id: string;
  kind: UnitKind;
  /** 展示编号，如 Day 01 · 第 3 页 */
  label: string;
  day: number;
  seq: number;
  /** 新词页关联的 globalPage */
  globalPage?: number;
  /** 复习页覆盖的新词页区间 [from, to] */
  coversPages?: [number, number];
}

export interface UnitResult {
  stars: number;
  accuracy: number;
  maxCombo: number;
  correct: number;
  total: number;
  masteredCount: number;
  wrongWords: string[];
  finishedAt: number;
  /** 本局得分（含连击加成） */
  score: number;
  /** Day 测验 ≥90% 的金色印章 */
  goldStamp: boolean;
}

export interface DailyPlan {
  /** 计划新词页数 1~2 */
  newPages: number;
  /** 今日已完成新词页 */
  doneNewPages: number;
  /** 今日已追加复习页 */
  doneExtraReview: number;
  /** 今日已完成的到期复习词数 */
  doneDueWords: number;
}

/** 一天的学习打卡记录（首页「最近 7 天」用） */
export interface CheckinDay {
  /** YYYY-MM-DD（本地时区） */
  date: string;
  /** 当天完成的单元数 */
  units: number;
  /** 当天接触过的词数（各单元去重后的题量） */
  words: number;
  /** 当天拿到的分数 */
  score: number;
  /** 最近一次打卡时间戳 */
  at: number;
}

/** 主题色 */
export type ThemeId = 'paper' | 'mint' | 'rose' | 'night' | 'sky' | 'latte' | 'forest';

export interface ProgressData {
  schema: number;
  /** 这份进度属于哪个分级 */
  levelId: string;
  words: Record<string, WordProgress>;
  units: Record<string, UnitResult>;
  /** 最近完成的单元 id */
  lastUnitId: string | null;
  /** 累计学习词数（进入过预览的词） */
  learnedWords: number;
  /** 连续学习天数 */
  streak: number;
  /** 最近活跃日期（YYYY-MM-DD 本地） */
  lastActiveDate: string | null;
  /** 今日计划 */
  daily: DailyPlan;
  /** 计划日期 */
  dailyDate: string;
  /** 累计总得分（游戏进度） */
  totalScore: number;
  /** 最近 60 天打卡记录 */
  checkins: CheckinDay[];
  /** 词库排序版本（2 = 高频优先） */
  orderVersion?: number;
  createdAt: number;
  updatedAt: number;
}

/** 拼写题的呈现方式 */
export type SpellingMode = 'tiles' | 'typing' | 'mixed';

export interface SettingsData {
  soundOn: boolean;
  animationOn: boolean;
  speechOn: boolean;
  dailyNewPages: number;
  /** 当前分级 id */
  levelId: string;
  /** 拼写题方式：字母贴纸 / 键盘拼写 / 混合 */
  spellingMode: SpellingMode;
  /** 每个新词页包含的单词数（6 / 10 / 15 / 20），改后会重新划分词页 */
  wordsPerPage: number;
  /** 设备没有英文语音包时，允许联网取在线发音 */
  onlineAudio: boolean;
  /** 系统语音读不出声时，强制只用在线发音 */
  forceOnlineAudio?: boolean;
  /** 发音口音：美音 / 英音 */
  accent?: 'us' | 'uk';
  /** 主题色 */
  theme: ThemeId;
}
