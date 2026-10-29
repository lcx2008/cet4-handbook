import type { CheckinDay, ProgressData, SettingsData, UnitResult, WordEntry, WordProgress, WordStatus } from '../types';

/** 进度按分级隔离：cet4-handbook-progress-v2:cet4 / :cet3 / :cet6 */
export const STORAGE_PREFIX = 'cet4-handbook-progress-v2';
export const SETTINGS_KEY = 'cet4-handbook-settings-v2';
/** 1.0 版本遗留键（只有四级） */
const LEGACY_PROGRESS_KEY = 'cet4-handbook-progress-v1';
const LEGACY_SETTINGS_KEY = 'cet4-handbook-settings-v1';
const SCHEMA_VERSION = 2;

export function storageKey(levelId: string): string {
  return `${STORAGE_PREFIX}:${levelId}`;
}

/**
 * 艾宾浩斯遗忘曲线复习间隔（8 个阶段）。
 * 第一次答对 → 5 分钟后复习；之后 30 分钟 / 12 小时 / 1 天 / 2 天 / 4 天 / 7 天 / 15 天。
 */
export const REVIEW_INTERVALS = [
  5 * 60 * 1000,
  30 * 60 * 1000,
  12 * 60 * 60 * 1000,
  24 * 60 * 60 * 1000,
  2 * 24 * 60 * 60 * 1000,
  4 * 24 * 60 * 60 * 1000,
  7 * 24 * 60 * 60 * 1000,
  15 * 24 * 60 * 60 * 1000,
];

export const REVIEW_STAGE_LABELS = ['新学', '5 分钟', '30 分钟', '12 小时', '1 天', '2 天', '4 天', '7 天', '15 天'];

export function stageLabel(stage: number): string {
  return REVIEW_STAGE_LABELS[Math.min(Math.max(stage, 0), REVIEW_STAGE_LABELS.length - 1)];
}

/** 人类可读的“还有多久到期” */
export function dueLabel(nextReviewAt: number | null, now = Date.now()): string {
  if (nextReviewAt === null) return '未排期';
  const diff = nextReviewAt - now;
  if (diff <= 0) return '该复习了';
  const mins = Math.round(diff / 60000);
  if (mins < 60) return `${mins} 分钟后`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} 小时后`;
  return `${Math.round(hours / 24)} 天后`;
}

export function todayStr(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function yesterdayStr(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return todayStr(d);
}

function defaultDaily(): ProgressData['daily'] {
  return { newPages: 1, doneNewPages: 0, doneExtraReview: 0, doneDueWords: 0 };
}

export function createEmptyProgress(levelId = 'cet4'): ProgressData {
  const now = Date.now();
  return {
    schema: SCHEMA_VERSION,
    levelId,
    words: {},
    units: {},
    lastUnitId: null,
    learnedWords: 0,
    streak: 0,
    lastActiveDate: null,
    daily: defaultDaily(),
    dailyDate: todayStr(),
    totalScore: 0,
    checkins: [],
    orderVersion: 2,
    createdAt: now,
    updatedAt: now,
  };
}

export function defaultSettings(levelId = 'cet4'): SettingsData {
  return {
    soundOn: true,
    animationOn: true,
    speechOn: true,
    dailyNewPages: 1,
    levelId,
    spellingMode: 'tiles',
    wordsPerPage: 10,
    onlineAudio: true,
    forceOnlineAudio: false,
    accent: 'us',
    theme: 'paper',
  };
}

/** 只读设置（不依赖词库，启动最先用到） */
export function loadSettings(): SettingsData {
  const base = defaultSettings();
  try {
    const raw = localStorage.getItem(SETTINGS_KEY) ?? localStorage.getItem(LEGACY_SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SettingsData>;
      if (parsed && typeof parsed === 'object') return { ...base, ...parsed };
    }
  } catch {
    /* 用默认值 */
  }
  return base;
}

export class ProgressStore {
  data: ProgressData;
  settings: SettingsData;
  readonly levelId: string;
  /** 距上次落盘又答了几题（答几题存一次，防止中途退出白答） */
  private answeredSinceSave = 0;

  constructor(data: ProgressData, settings: SettingsData, levelId: string) {
    this.data = data;
    this.settings = settings;
    this.levelId = levelId;
  }

  /**
   * 跨零点保护：日期一变就把「今日计划」清零。
   * 以前只在 load 时判断，App 挂在后台过夜再答题，计数会记到昨天，
   * 重新打开就变成 0，看起来像「打卡没记录」。
   */
  ensureToday(now = Date.now()): void {
    const t = todayStr(new Date(now));
    if (this.data.dailyDate !== t) {
      this.data.daily = { ...defaultDaily(), newPages: this.settings.dailyNewPages || 1 };
      this.data.dailyDate = t;
    }
  }

  // ---------- 持久化 ----------
  save(): boolean {
    this.ensureToday();
    this.data.updatedAt = Date.now();
    try {
      localStorage.setItem(storageKey(this.levelId), JSON.stringify(this.data));
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
      this.answeredSinceSave = 0;
      return true;
    } catch {
      // localStorage 满或不可用：本次会话仍可用，但要让界面知道（否则用户以为记录丢了）
      try {
        window.dispatchEvent(new CustomEvent('dsh-storage-failed'));
      } catch {
        /* 忽略 */
      }
      return false;
    }
  }

  static load(levelId: string, settingsIn?: SettingsData): ProgressStore {
    const settings = settingsIn ? { ...settingsIn } : loadSettings();
    let data: ProgressData | null = null;
    const key = storageKey(levelId);

    // 1.0 → 2.0 迁移：旧键只有四级进度，搬到 cet4 命名空间
    if (levelId === 'cet4') {
      const old = localStorage.getItem(LEGACY_PROGRESS_KEY);
      if (old && !localStorage.getItem(key)) {
        try {
          const parsed = JSON.parse(old) as ProgressData;
          if (parsed && parsed.words) {
            data = upgrade(parsed, levelId);
            localStorage.setItem(key, JSON.stringify(data));
            localStorage.removeItem(LEGACY_PROGRESS_KEY);
          }
        } catch {
          /* 坏数据丢弃 */
        }
      }
    }

    if (!data) {
      const raw = localStorage.getItem(key);
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as ProgressData;
          if (parsed && parsed.words) {
            data = parsed.schema === SCHEMA_VERSION ? parsed : upgrade(parsed, levelId);
          } else {
            localStorage.setItem(`${key}-backup-${Date.now()}`, raw);
          }
        } catch {
          try {
            localStorage.setItem(`${key}-backup-${Date.now()}`, raw);
          } catch {
            /* 忽略 */
          }
        }
      }
    }

    if (!data) data = createEmptyProgress(levelId);
    data.levelId = levelId;
    if (typeof data.totalScore !== 'number') data.totalScore = 0;
    if (!data.daily) data.daily = defaultDaily();
    if (typeof data.daily.doneDueWords !== 'number') data.daily.doneDueWords = 0;
    if (!Array.isArray(data.checkins)) data.checkins = [];
    if (typeof data.orderVersion !== 'number') data.orderVersion = 2;
    const store = new ProgressStore(data, settings, levelId);
    store.ensureToday();
    store.backfillCheckins();
    return store;
  }

  /**
   * 老数据没有 checkins：用已有的单元记录（带 finishedAt）补出打卡历史，
   * 这样升级后首页不会出现「已打卡 1 个单元，但最近 7 天全是空的」。
   */
  private backfillCheckins(): void {
    const known = new Set(this.data.checkins.map((c) => c.date));
    const agg = new Map<string, { units: number; score: number }>();
    for (const r of Object.values(this.data.units)) {
      if (!r || typeof r.finishedAt !== 'number') continue;
      const date = todayStr(new Date(r.finishedAt));
      if (known.has(date)) continue;
      const a = agg.get(date) ?? { units: 0, score: 0 };
      a.units += 1;
      a.score += typeof r.score === 'number' ? r.score : 0;
      agg.set(date, a);
    }
    if (agg.size === 0) return;
    for (const [date, a] of agg) {
      this.data.checkins.push({ date, units: a.units, words: 0, score: a.score, at: Date.now() });
    }
    this.data.checkins.sort((a, b) => a.date.localeCompare(b.date));
    this.data.checkins = this.data.checkins.slice(-60);
  }

  // ---------- 单词进度 ----------
  getWordProgress(id: string): WordProgress {
    let wp = this.data.words[id];
    if (!wp) {
      wp = {
        id,
        appearances: 0,
        correctCount: 0,
        wrongCount: 0,
        lastAnsweredAt: null,
        lastQuestionType: null,
        spellingDone: false,
        spellingCorrectCount: 0,
        streakCorrect: 0,
        status: 'unlearned',
        firstLearnedAt: null,
        correctInUnits: [],
        inWrongPool: false,
        poolCorrectStreak: 0,
        poolLastCorrectUnit: null,
        lastWrongAt: null,
        lastCorrectAt: null,
        lastReviewUnitSeq: null,
        masteredOnce: false,
        reviewStage: 0,
        nextReviewAt: null,
        reviewCount: 0,
        lapses: 0,
        scheduledAt: null,
      };
      this.data.words[id] = wp;
    }
    // 旧数据补字段
    if (typeof wp.reviewStage !== 'number') wp.reviewStage = 0;
    if (wp.nextReviewAt === undefined) wp.nextReviewAt = null;
    if (typeof wp.reviewCount !== 'number') wp.reviewCount = 0;
    if (typeof wp.lapses !== 'number') wp.lapses = 0;
    if (wp.scheduledAt === undefined) wp.scheduledAt = null;
    return wp;
  }

  /** 只读访问：不存在时返回 null，不创建记录（避免遍历全库时把词表撑爆） */
  peekWordProgress(id: string): WordProgress | null {
    return this.data.words[id] ?? null;
  }

  /** 进入新词预览：状态变学习中，并按遗忘曲线排出第一次复习（5 分钟后） */
  markLearned(wordId: string): void {
    const wp = this.getWordProgress(wordId);
    if (wp.status === 'unlearned') {
      const now = Date.now();
      wp.status = 'learning';
      wp.firstLearnedAt = now;
      wp.reviewStage = 0;
      wp.nextReviewAt = now + REVIEW_INTERVALS[0];
      wp.scheduledAt = now;
      this.data.learnedWords++;
    }
  }

  /** 记录一次答题。unitId：所在单元；unitSeq：单元全局序号；word：词条 */
  recordAnswer(
    wordId: string,
    unitId: string,
    unitSeq: number,
    word: WordEntry,
    questionType: string,
    correct: boolean,
  ): void {
    this.ensureToday();
    const wp = this.getWordProgress(wordId);
    const now = Date.now();
    const wasDue = wp.nextReviewAt !== null && wp.nextReviewAt <= now;
    wp.appearances++;
    wp.lastAnsweredAt = now;
    wp.lastQuestionType = questionType;
    const isSpelling = questionType === 'letter-fill' || questionType === 'letter-tiles' || questionType === 'spell-typing';

    if (correct) {
      wp.correctCount++;
      wp.streakCorrect++;
      wp.lastCorrectAt = now;
      if (isSpelling) {
        wp.spellingDone = true;
        wp.spellingCorrectCount++;
      }
      // 跨单元答对记录（去重，保留插入顺序，截断到 12 个）
      if (!wp.correctInUnits.includes(unitId)) {
        wp.correctInUnits.push(unitId);
        if (wp.correctInUnits.length > 12) wp.correctInUnits.shift();
      }
      // 错词池：跨单元连续答对 2 次移出
      if (wp.inWrongPool) {
        if (wp.poolLastCorrectUnit !== null && wp.poolLastCorrectUnit !== unitId) {
          wp.poolCorrectStreak++;
        } else if (wp.poolLastCorrectUnit === null) {
          wp.poolCorrectStreak = 1;
        }
        wp.poolLastCorrectUnit = unitId;
        if (wp.poolCorrectStreak >= 2) {
          wp.inWrongPool = false;
          wp.poolCorrectStreak = 0;
          wp.poolLastCorrectUnit = null;
        }
      }
      wp.lastReviewUnitSeq = unitSeq;
      this.scheduleNext(wp, true, now);
      if (wasDue) this.data.daily.doneDueWords++;
    } else {
      wp.wrongCount++;
      wp.streakCorrect = 0;
      wp.lastWrongAt = now;
      wp.inWrongPool = true;
      wp.poolCorrectStreak = 0;
      wp.poolLastCorrectUnit = null;
      this.scheduleNext(wp, false, now);
      // 已掌握答错 → 立即回复习中；重置跨单元计数，之后“再跨单元答对 2 次”才能重新掌握
      if (wp.status === 'mastered') {
        wp.status = 'reviewing';
        wp.masteredOnce = true;
        wp.correctInUnits = [];
        return;
      }
    }
    wp.status = computeStatus(wp, word);
    if (wp.status === 'mastered') wp.masteredOnce = true;
    // 答几题落一次盘：中途退出/切后台也不至于把整页白答
    this.answeredSinceSave += 1;
    if (this.answeredSinceSave >= 5) this.save();
  }

  /** 艾宾浩斯排程：答对推进一个阶段，答错回到第一阶段 */
  private scheduleNext(wp: WordProgress, correct: boolean, now: number): void {
    wp.scheduledAt = now;
    if (correct) {
      const nextStage = Math.min(wp.reviewStage + 1, REVIEW_INTERVALS.length);
      wp.reviewStage = nextStage;
      wp.nextReviewAt = now + REVIEW_INTERVALS[nextStage - 1];
      wp.reviewCount++;
    } else {
      wp.lapses++;
      wp.reviewStage = 1;
      wp.nextReviewAt = now + REVIEW_INTERVALS[0];
    }
  }

  /** 到期待复习的词数 */
  dueCount(now = Date.now()): number {
    let n = 0;
    for (const id in this.data.words) {
      const wp = this.data.words[id];
      if (wp.nextReviewAt !== null && wp.nextReviewAt <= now && wp.status !== 'unlearned') n++;
    }
    return n;
  }

  // ---------- 单元结果 ----------
  getUnitResult(unitId: string): UnitResult | null {
    return this.data.units[unitId] ?? null;
  }

  finishUnit(
    unitId: string,
    kind: 'new' | 'review' | 'test',
    result: {
      correct: number;
      total: number;
      maxCombo: number;
      wrongWords: string[];
      masteredCount: number;
      score: number;
      /** 本单元接触的词数（按词去重），用于打卡记录 */
      wordCount?: number;
    },
  ): UnitResult {
    this.ensureToday();
    const accuracy = result.total > 0 ? result.correct / result.total : 0;
    let stars = 1;
    if (accuracy >= 0.9) stars = 3;
    else if (accuracy >= 0.7) stars = 2;
    const unitResult: UnitResult = {
      stars,
      accuracy,
      maxCombo: result.maxCombo,
      correct: result.correct,
      total: result.total,
      masteredCount: result.masteredCount,
      wrongWords: [...new Set(result.wrongWords)],
      finishedAt: Date.now(),
      score: result.score,
      goldStamp: kind === 'test' && accuracy >= 0.9,
    };
    this.data.units[unitId] = unitResult;
    this.data.totalScore += result.score;
    this.data.lastUnitId = unitId;
    // 每日任务
    if (kind === 'new') this.data.daily.doneNewPages++;
    if (kind === 'review') this.data.daily.doneExtraReview++;
    // 连续天数
    const t = todayStr();
    if (this.data.lastActiveDate === t) {
      /* 同日，不变 */
    } else if (this.data.lastActiveDate === yesterdayStr()) {
      this.data.streak++;
      this.data.lastActiveDate = t;
    } else {
      this.data.streak = 1;
      this.data.lastActiveDate = t;
    }
    // 打卡历史：首页「最近 7 天」靠它
    this.recordCheckin(1, result.wordCount ?? 0, result.score, Date.now());
    this.save();
    return unitResult;
  }

  /** 合并当天的打卡记录 */
  private recordCheckin(units: number, words: number, score: number, now: number): void {
    const date = todayStr(new Date(now));
    let day: CheckinDay | undefined = this.data.checkins.find((c) => c.date === date);
    if (!day) {
      day = { date, units: 0, words: 0, score: 0, at: now };
      this.data.checkins.push(day);
    }
    day.units += units;
    day.words += words;
    day.score += score;
    day.at = now;
    this.data.checkins = this.data.checkins.slice(-60);
  }

  /** 今天的打卡记录（没有返回 null） */
  todayCheckin(): CheckinDay | null {
    const t = todayStr();
    return this.data.checkins.find((c) => c.date === t) ?? null;
  }

  updateSettings(partial: Partial<SettingsData>): void {
    this.settings = { ...this.settings, ...partial };
    this.data.daily.newPages = this.settings.dailyNewPages;
    this.save();
  }

  resetProgress(): void {
    this.data = createEmptyProgress(this.levelId);
    this.save();
  }

  exportProgress(): string {
    return JSON.stringify(
      { levelId: this.levelId, progress: this.data, settings: { ...this.settings, levelId: this.levelId } },
      null,
      2,
    );
  }

  importProgress(json: string): boolean {
    try {
      const parsed = JSON.parse(json) as { progress?: ProgressData; settings?: SettingsData };
      if (!parsed.progress || typeof parsed.progress !== 'object' || !parsed.progress.words) return false;
      if (parsed.progress.schema !== SCHEMA_VERSION) return false;
      this.data = upgrade(parsed.progress, this.levelId);
      if (parsed.settings) this.settings = { ...defaultSettings(this.levelId), ...parsed.settings };
      this.save();
      return true;
    } catch {
      return false;
    }
  }
}

/** ============ 全量导出 / 导入（三个词库一起） ============ */

export interface ProgressBundle {
  app: string;
  schema: number;
  exportedAt: string;
  settings: SettingsData;
  levels: Record<string, ProgressData>;
}

/** 一次导出所有词库的进度（三级 + 四级 + 六级） */
export function exportAllProgress(levelIds: string[], now = new Date()): string {
  const bundle: ProgressBundle = {
    app: 'cet4-handbook',
    schema: SCHEMA_VERSION,
    exportedAt: now.toISOString(),
    settings: loadSettings(),
    levels: {},
  };
  for (const id of levelIds) {
    const raw = localStorage.getItem(storageKey(id));
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as ProgressData;
      if (parsed && parsed.words) bundle.levels[id] = parsed;
    } catch {
      /* 坏数据跳过 */
    }
  }
  return JSON.stringify(bundle, null, 2);
}

export interface ImportResult {
  ok: boolean;
  imported: string[];
  words: number;
  error?: string;
}

/**
 * 导入进度。兼容三种格式：
 *  1. 2.0 全量包 { levels: { cet3, cet4, cet6 } }
 *  2. 1.x 单级包 { progress, settings }
 *  3. 裸 ProgressData { schema, words, ... }
 */
export function importAllProgress(json: string, levelIds: string[], fallbackLevelId = 'cet4'): ImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, imported: [], words: 0, error: '不是合法的 JSON 文件' };
  }
  const obj = parsed as Record<string, unknown>;
  const imported: string[] = [];
  let words = 0;

  const put = (levelId: string, data: unknown): boolean => {
    const d = data as ProgressData;
    if (!d || typeof d !== 'object' || !d.words) return false;
    const upgraded = upgrade(d, levelId);
    localStorage.setItem(storageKey(levelId), JSON.stringify(upgraded));
    imported.push(levelId);
    words += Object.keys(upgraded.words).length;
    return true;
  };

  const levels = obj.levels as Record<string, unknown> | undefined;
  if (levels && typeof levels === 'object') {
    // 1) 全量包
    for (const id of levelIds) {
      if (levels[id]) put(id, levels[id]);
    }
  } else if (obj.progress && typeof obj.progress === 'object') {
    // 2) 单级包
    const target = (obj.settings as SettingsData | undefined)?.levelId;
    put(target && levelIds.includes(target) ? target : fallbackLevelId, obj.progress);
  } else if (obj.words && typeof obj.words === 'object') {
    // 3) 裸 ProgressData
    put(levelIds.includes(fallbackLevelId) ? fallbackLevelId : levelIds[0], obj);
  }

  if (imported.length === 0) {
    return { ok: false, imported, words, error: '文件里没有可识别的进度数据' };
  }
  const settings = obj.settings as Partial<SettingsData> | undefined;
  if (settings && typeof settings === 'object') {
    const merged = { ...loadSettings(), ...settings };
    if (!levelIds.includes(merged.levelId)) merged.levelId = imported[0];
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(merged));
  }
  return { ok: true, imported, words };
}

/** 只导出某一个词库的进度 */
export function exportLevelProgress(levelId: string, now = new Date()): string {
  const raw = localStorage.getItem(storageKey(levelId));
  let progress: ProgressData | null = null;
  if (raw) {
    try {
      progress = JSON.parse(raw) as ProgressData;
    } catch {
      progress = null;
    }
  }
  return JSON.stringify(
    {
      app: 'cet4-handbook',
      scope: 'level',
      levelId,
      exportedAt: now.toISOString(),
      settings: loadSettings(),
      progress,
    },
    null,
    2,
  );
}

/** 把文件导入到指定词库（不管文件里原本属于哪一级，都写进 targetLevel） */
export function importIntoLevel(json: string, targetLevelId: string): ImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, imported: [], words: 0, error: '不是合法的 JSON 文件' };
  }
  const obj = parsed as Record<string, unknown>;

  // 候选数据：单级包 progress / 全量包 levels[target] / 裸 ProgressData
  let data: unknown = null;
  if (obj.progress && typeof obj.progress === 'object') {
    data = obj.progress;
  } else if (obj.levels && typeof obj.levels === 'object') {
    const levels = obj.levels as Record<string, unknown>;
    data = levels[targetLevelId] ?? Object.values(levels)[0] ?? null;
  } else if (obj.words && typeof obj.words === 'object') {
    data = obj;
  }
  const d = data as ProgressData | null;
  if (!d || typeof d !== 'object' || !d.words) {
    return { ok: false, imported: [], words: 0, error: '文件里没有可识别的进度数据' };
  }
  const upgraded = upgrade(d, targetLevelId);
  localStorage.setItem(storageKey(targetLevelId), JSON.stringify(upgraded));
  return { ok: true, imported: [targetLevelId], words: Object.keys(upgraded.words).length };
}

/** 只清空某一个词库的进度 */
export function resetLevelProgress(levelId: string): void {
  localStorage.removeItem(storageKey(levelId));
}

/** 老版本数据升级（补字段，不丢进度） */
export function upgrade(data: ProgressData, levelId: string): ProgressData {
  const out: ProgressData = {
    ...createEmptyProgress(levelId),
    ...data,
    schema: SCHEMA_VERSION,
    levelId,
  };
  if (!out.daily) out.daily = defaultDaily();
  if (typeof out.daily.doneDueWords !== 'number') out.daily.doneDueWords = 0;
  if (!out.dailyDate) out.dailyDate = todayStr();
  if (typeof out.totalScore !== 'number') out.totalScore = 0;
  if (!Array.isArray(out.checkins)) out.checkins = [];
  if (typeof out.orderVersion !== 'number') out.orderVersion = 2;
  for (const id in out.words) {
    const wp = out.words[id];
    if (typeof wp.reviewStage !== 'number') wp.reviewStage = 0;
    if (wp.nextReviewAt === undefined) wp.nextReviewAt = null;
    if (typeof wp.reviewCount !== 'number') wp.reviewCount = 0;
    if (typeof wp.lapses !== 'number') wp.lapses = 0;
    if (wp.scheduledAt === undefined) wp.scheduledAt = null;
  }
  return out;
}

/** 状态计算规则（提示词第六节） */
export function computeStatus(wp: WordProgress, word: WordEntry): WordStatus {
  if (wp.status === 'unlearned' || wp.firstLearnedAt === null) {
    if (wp.appearances > 0 && wp.status === 'unlearned') return 'learning';
    return 'unlearned';
  }
  if (wp.status === 'mastered') return 'mastered';
  const correctUnits = wp.correctInUnits.length;
  const needSpelling = word.word.length > 2;
  // 曾掌握过、答错降级后：再跨单元答对 2 次即可重新掌握
  if (wp.masteredOnce) {
    if (correctUnits >= 2 && (!needSpelling || wp.spellingDone)) return 'mastered';
    return 'reviewing';
  }
  if (correctUnits >= 3) {
    // 复习中 → 已掌握：复习中后再跨单元答对 2 次（共 5 个单元），且长词需完成拼写题
    if (correctUnits >= 5 && (!needSpelling || wp.spellingDone)) return 'mastered';
    return 'reviewing';
  }
  return 'learning';
}
