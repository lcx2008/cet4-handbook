import type { Question, QuestionType, SpellingMode, UnitDef, WordEntry } from '../types';
import { ProgressStore } from './progressStore';
import { QuestionGenerator, hasUsableExample } from './questionGenerator';
import { ReviewScheduler } from './reviewScheduler';
import { WordBank } from './wordBank';

/** 每次会话的拼写题单词上限（需求：一次不超过 20 个） */
const SPELLING_CAP = 20;
/** 词意题单词上限（英译中 + 中译英各一轮） */
const MEANING_CAP = 12;
/** 每局语境填空题上限 */
const CONTEXT_CAP = 10;
const REVISIT_GAP_MIN = 2;
const REVISIT_GAP_MAX = 3;

/** 艾宾浩斯到期复习虚拟单元 */
export const DUE_REVIEW_UNIT: UnitDef = { id: 'DUE', kind: 'review', label: '艾宾浩斯复习', day: 0, seq: 0 };
/** 错词复习虚拟单元 */
export const WRONG_REVIEW_UNIT: UnitDef = { id: 'W001', kind: 'review', label: '错词复习', day: 0, seq: 0 };

export function isVirtualUnit(id: string): boolean {
  return id === DUE_REVIEW_UNIT.id || id === WRONG_REVIEW_UNIT.id;
}

export interface QuizPlan {
  unit: UnitDef;
  /** 出题计划：全部为未答题状态时的问题列表（动态插入会改变 queue） */
  queue: Question[];
  /** 已答历史 */
  answered: { question: Question; correct: boolean; chosen: string | null }[];
  correct: number;
  wrong: number;
  combo: number;
  maxCombo: number;
  wrongWordIds: Set<string>;
  /** 已用翻小抄 */
  hintUsed: boolean;
  finished: boolean;
  /** 答对词统计（用于掌握数） */
  correctWordIds: Set<string>;
  /** 本局得分 */
  score: number;
  /** 最近一题的得分（用于飘字反馈） */
  lastGain: number;
}

/**
 * 构建一个学习单元的题目计划。
 *
 * 顺序固定为：① 英译中 → ② 中译英 → ③ 拼写（字母贴纸 / 自由拼写）
 * 拼写词按「今天学的词 + 艾宾浩斯到期词」挑选，每次最多 20 个。
 */
export class QuizPlanner {
  private bank: WordBank;
  private gen: QuestionGenerator;
  private scheduler: ReviewScheduler;
  private store: ProgressStore;
  private unit: UnitDef;

  constructor(bank: WordBank, store: ProgressStore, unit: UnitDef) {
    this.bank = bank;
    this.store = store;
    this.gen = new QuestionGenerator(bank);
    this.scheduler = new ReviewScheduler(bank, store);
    this.unit = unit;
  }

  build(): QuizPlan {
    const queue =
      this.unit.id === DUE_REVIEW_UNIT.id
        ? this.buildDueReview()
        : this.unit.id === WRONG_REVIEW_UNIT.id
          ? this.buildWrongReview()
          : this.unit.kind === 'new'
            ? this.buildNewPage()
            : this.unit.kind === 'review'
              ? this.buildReviewPage()
              : this.buildDayTest();
    return {
      unit: this.unit,
      queue,
      answered: [],
      correct: 0,
      wrong: 0,
      combo: 0,
      maxCombo: 0,
      wrongWordIds: new Set(),
      hintUsed: false,
      finished: false,
      correctWordIds: new Set(),
      score: 0,
      lastGain: 0,
    };
  }

  // ---------- 统一组装：英译中 → 中译英 → 语境填空 → 拼写 ----------
  private compose(meaningWords: WordEntry[], spellingWords: WordEntry[]): Question[] {
    const qs: Question[] = [];
    const used = new Set<string>();
    const usedMeanings = new Set<string>();

    // ① 英译中
    for (const w of shuffle(meaningWords)) {
      qs.push(this.gen.makeQuestion(w, 'word-to-meaning', used, usedMeanings, 'meaning-en'));
    }
    // ② 中译英
    for (const w of shuffle(meaningWords)) {
      qs.push(this.gen.makeQuestion(w, 'meaning-to-word', used, usedMeanings, 'meaning-cn'));
    }
    // ③ 语境填空（只挑有例句、且例句里能找到这个词的）
    const contextWords = shuffle(meaningWords.filter((w) => hasUsableExample(w))).slice(0, CONTEXT_CAP);
    for (const w of contextWords) {
      qs.push(this.gen.makeQuestion(w, 'context-cloze', used, usedMeanings, 'context'));
    }
    // ④ 拼写
    const spell = this.pickSpellingWords(spellingWords);
    for (const w of spell) {
      qs.push(this.gen.makeQuestion(w, this.spellingType(w), used, usedMeanings, 'spelling'));
    }
    return qs;
  }

  /** 可拼写的词：纯字母、长度 ≥3 */
  private spellable(w: WordEntry): boolean {
    return w.word.length >= 3 && /^[A-Za-z][A-Za-z'-]*$/.test(w.word);
  }

  /** 拼写题选题：先本页/本次的词，再用到期复习词补，最多 20 个 */
  private pickSpellingWords(primary: WordEntry[]): WordEntry[] {
    const out: WordEntry[] = [];
    const seen = new Set<string>();
    const take = (w: WordEntry) => {
      if (out.length >= SPELLING_CAP) return;
      if (!this.spellable(w) || seen.has(w.id)) return;
      seen.add(w.id);
      out.push(w);
    };
    for (const w of primary) take(w);
    if (out.length < SPELLING_CAP) {
      // 今天学的词优先补，再补到期复习词
      for (const w of this.scheduler.learnedTodayWords(SPELLING_CAP, seen)) take(w);
      for (const w of this.scheduler.dueWords(SPELLING_CAP, seen)) take(w);
    }
    return out;
  }

  /** 按设置决定拼写题的呈现方式 */
  private spellingType(word: WordEntry): QuestionType {
    const mode: SpellingMode = this.store.settings.spellingMode ?? 'tiles';
    if (mode === 'typing') return 'spell-typing';
    if (mode === 'tiles') return 'letter-tiles';
    // mixed：长词更容易用键盘，短词用贴纸
    if (word.word.length >= 8) return Math.random() < 0.5 ? 'spell-typing' : 'letter-tiles';
    return Math.random() < 0.5 ? 'letter-tiles' : 'spell-typing';
  }

  // ---------- 新词页 ----------
  private buildNewPage(): Question[] {
    const page = this.unit.globalPage!;
    const pageWords = this.bank.getPageWords(page).slice(0, MEANING_CAP);
    return this.compose(pageWords, pageWords);
  }

  // ---------- 复习页（按遗忘曲线到期词优先） ----------
  private buildReviewPage(): Question[] {
    const [coverFrom, coverTo] = this.unit.coversPages ?? [1, 1];
    const due = this.scheduler.dueWords(MEANING_CAP);
    const used = new Set(due.map((w) => w.id));
    const picked: WordEntry[] = [...due];
    if (picked.length < MEANING_CAP) {
      const recent = shuffle(this.scheduler.recentPageWords([coverFrom, coverTo], used));
      for (const w of recent) {
        if (picked.length >= MEANING_CAP) break;
        if (used.has(w.id)) continue;
        used.add(w.id);
        picked.push(w);
      }
    }
    // 仍不足用最弱的词补足
    if (picked.length < 6) {
      for (const w of this.scheduler.fillWrongOrWeak(MEANING_CAP - picked.length, used)) {
        if (picked.length >= MEANING_CAP) break;
        used.add(w.id);
        picked.push(w);
      }
    }
    return this.compose(picked, picked);
  }

  // ---------- 艾宾浩斯到期复习 ----------
  private buildDueReview(): Question[] {
    const due = this.scheduler.dueWords(MEANING_CAP);
    if (due.length === 0) {
      // 没有到期词时退化为最弱的词，保证页面不空
      const fallback = this.scheduler.lowestMastery(MEANING_CAP, new Set());
      const words = fallback.length > 0 ? fallback : this.bank.getPageWords(1);
      return this.compose(words.slice(0, MEANING_CAP), words);
    }
    return this.compose(due, due);
  }

  // ---------- 错词复习组 ----------
  private buildWrongReview(): Question[] {
    const wrong = this.scheduler.fillWrongOrWeak(8, new Set());
    return this.compose(wrong, wrong);
  }

  // ---------- Day 测验 ----------
  private buildDayTest(): Question[] {
    const day = this.unit.day;
    const used = new Set<string>();
    const picked: WordEntry[] = [];
    // ≥30% 历史错词
    const wrongCount = Math.ceil(MEANING_CAP * 0.3);
    for (const w of this.scheduler.fillWrongOrWeak(wrongCount, used)) {
      used.add(w.id);
      picked.push(w);
    }
    // 其余来自本 Day
    for (const w of shuffle(this.bank.getDayWords(day))) {
      if (picked.length >= MEANING_CAP) break;
      if (used.has(w.id)) continue;
      used.add(w.id);
      picked.push(w);
    }
    return this.compose(picked, picked);
  }

  /**
   * 答完一题后更新计划。答错时在间隔 2~3 题处插入该词重考题。
   * 返回更新后的 plan（同一引用）。
   */
  static recordAnswer(
    bank: WordBank,
    store: ProgressStore,
    plan: QuizPlan,
    question: Question,
    chosen: string | null,
  ): { plan: QuizPlan; correct: boolean } {
    const word = bank.getById(question.wordId)!;
    const correct =
      question.type === 'letter-tiles' || question.type === 'spell-typing'
        ? normalizeSpelling(chosen ?? '') === normalizeSpelling(question.answerText ?? '')
        : chosen === question.answerKey;
    plan.answered.push({ question, correct, chosen });
    if (plan.queue.length > 0) plan.queue.shift();
    if (correct) {
      plan.correct++;
      plan.combo++;
      plan.maxCombo = Math.max(plan.maxCombo, plan.combo);
      plan.correctWordIds.add(word.id);
      const base = 100;
      const bonus = plan.combo >= 3 ? Math.min(plan.combo * 20, 200) : 0;
      plan.lastGain = base + bonus;
      plan.score += plan.lastGain;
    } else {
      plan.wrong++;
      plan.combo = 0;
      plan.lastGain = 0;
      plan.wrongWordIds.add(word.id);
      // 插入重考：间隔 2~3 题后，换一种题型。每词每局最多 3 次
      const appearancesInSession =
        plan.answered.filter((a) => a.question.wordId === word.id).length +
        plan.queue.filter((q) => q.wordId === word.id).length;
      if (appearancesInSession < 3) {
        const gap = REVISIT_GAP_MIN + Math.floor(Math.random() * (REVISIT_GAP_MAX - REVISIT_GAP_MIN + 1));
        const insertAt = Math.min(plan.queue.length, gap);
        const gen = new QuestionGenerator(bank);
        const available = gen.availableTypes(word).filter((t) => t !== question.type);
        const retype = available.length > 0 ? available[Math.floor(Math.random() * available.length)] : question.type;
        const usedIds = new Set(plan.queue.map((q) => q.wordId));
        const revisit = gen.makeQuestion(word, retype, usedIds, new Set(), question.stage ?? 'meaning-en');
        revisit.isRevisit = true;
        plan.queue.splice(insertAt, 0, revisit);
      }
    }
    store.recordAnswer(word.id, plan.unit.id, plan.unit.seq, word, question.type, correct);
    return { plan, correct };
  }
}

function normalizeSpelling(s: string): string {
  return s.trim().toLowerCase();
}

/**
 * 会话缓存：去设置页改完再回来，能接着上一次的进度继续，
 * 也保证「拼写方式」切换后立刻生效（不必等下一局）。
 *
 * 注意：缓存里同时存了建计划用的 bank / store 实例。切词库或重新加载后
 * 会拿到新的实例，这时必须重建，否则答题会写进已经作废的 store（记录丢失）。
 */
interface CachedPlan {
  bank: WordBank;
  store: ProgressStore;
  plan: QuizPlan;
}

const SESSION_CACHE = new Map<string, CachedPlan>();

export function getOrCreatePlan(bank: WordBank, store: ProgressStore, unit: UnitDef): QuizPlan {
  const key = `${store.levelId}:${unit.id}`;
  const hit = SESSION_CACHE.get(key);
  if (hit && hit.bank === bank && hit.store === store) return hit.plan;
  const plan = new QuizPlanner(bank, store, unit).build();
  SESSION_CACHE.set(key, { bank, store, plan });
  return plan;
}

/** 一局结束后清掉缓存，下次进去重新出题 */
export function clearPlan(levelId: string, unitId: string): void {
  SESSION_CACHE.delete(`${levelId}:${unitId}`);
}

/** 切换词库 / 重新分页时整体作废，保证不会串到别的词库 */
export function clearAllPlans(): void {
  SESSION_CACHE.clear();
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
