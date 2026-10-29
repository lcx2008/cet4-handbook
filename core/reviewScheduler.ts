import type { WordEntry, WordProgress } from '../types';
import { ProgressStore } from './progressStore';
import { WordBank } from './wordBank';

/** 未学习词条的只读占位（避免遍历全库时创建进度记录） */
const EMPTY_PROGRESS: WordProgress = {
  id: '',
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

/**
 * 复习调度器：按艾宾浩斯遗忘曲线给出到期词，并负责复习页 / Day 测验 / 错词复习的选题优先级。
 */
export class ReviewScheduler {
  private bank: WordBank;
  private store: ProgressStore;

  /** 只读读取进度（不存在视为未学习） */
  private wp(id: string): WordProgress {
    return this.store.peekWordProgress(id) ?? EMPTY_PROGRESS;
  }

  constructor(bank: WordBank, store: ProgressStore) {
    this.bank = bank;
    this.store = store;
  }

  /** 到期该复习的词（按到期时间从早到晚） */
  dueWords(limit: number, excludeIds: Set<string> = new Set(), now = Date.now()): WordEntry[] {
    const out: WordEntry[] = [];
    for (const w of this.bank.words) {
      if (excludeIds.has(w.id)) continue;
      const wp = this.wp(w.id);
      if (wp.status === 'unlearned') continue;
      if (wp.nextReviewAt !== null && wp.nextReviewAt <= now) out.push(w);
    }
    out.sort((a, b) => {
      const pa = this.wp(a.id);
      const pb = this.wp(b.id);
      const na = pa.nextReviewAt ?? 0;
      const nb = pb.nextReviewAt ?? 0;
      if (na !== nb) return na - nb; // 早到期的先复习
      if (pa.lapses !== pb.lapses) return pb.lapses - pa.lapses;
      return a.sourceOrder - b.sourceOrder;
    });
    return out.slice(0, limit);
  }

  /** 到期词数量 */
  dueCount(now = Date.now()): number {
    let n = 0;
    for (const w of this.bank.words) {
      const wp = this.wp(w.id);
      if (wp.status === 'unlearned') continue;
      if (wp.nextReviewAt !== null && wp.nextReviewAt <= now) n++;
    }
    return n;
  }

  /** 今天学过的词（用于拼写题的选题池） */
  learnedTodayWords(limit: number, excludeIds: Set<string> = new Set(), now = Date.now()): WordEntry[] {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const out: WordEntry[] = [];
    for (const w of this.bank.words) {
      if (excludeIds.has(w.id)) continue;
      const wp = this.wp(w.id);
      if (wp.firstLearnedAt !== null && wp.firstLearnedAt >= start.getTime()) out.push(w);
    }
    return out.slice(0, limit);
  }

  /** 复习优先级排序（从高到低） */
  rankCandidates(candidates: WordEntry[], now = Date.now()): WordEntry[] {
    return [...candidates].sort((a, b) => {
      const pa = this.wp(a.id);
      const pb = this.wp(b.id);
      // 1. 最近答错的在前
      const aWrong = pa.lastWrongAt ?? 0;
      const bWrong = pb.lastWrongAt ?? 0;
      if (aWrong !== bWrong) return bWrong - aWrong;
      // 2. 从未掌握且出错次数最多
      const aNeverMastered = pa.status !== 'mastered';
      const bNeverMastered = pb.status !== 'mastered';
      if (aNeverMastered !== bNeverMastered) return aNeverMastered ? -1 : 1;
      if (aNeverMastered && pa.wrongCount !== pb.wrongCount) return pb.wrongCount - pa.wrongCount;
      // 3. 长时间未复习的复习中词
      if (pa.status === 'reviewing' && pb.status === 'reviewing') {
        const aLast = pa.lastAnsweredAt ?? 0;
        const bLast = pb.lastAnsweredAt ?? 0;
        if (aLast !== bLast) return aLast - bLast;
      }
      // 4. 已掌握但超过 7 天未复习
      const aStale = pa.status === 'mastered' && now - (pa.lastAnsweredAt ?? 0) > 7 * 24 * 3600 * 1000;
      const bStale = pb.status === 'mastered' && now - (pb.lastAnsweredAt ?? 0) > 7 * 24 * 3600 * 1000;
      if (aStale !== bStale) return aStale ? -1 : 1;
      return a.sourceOrder - b.sourceOrder;
    });
  }

  /** 错词池中的词（按优先级） */
  wrongPoolWords(): WordEntry[] {
    const pool = this.bank.words.filter((w) => this.wp(w.id).inWrongPool);
    return this.rankCandidates(pool);
  }

  /** 历史错词（有错误记录的词） */
  historicalWrongWords(): WordEntry[] {
    const pool = this.bank.words.filter((w) => {
      const wp = this.wp(w.id);
      return wp.wrongCount > 0 || wp.inWrongPool;
    });
    return this.rankCandidates(pool);
  }

  /** 掌握度最低的词（学习过但未掌握，按答错数降序 + 答对数升序） */
  lowestMastery(limit: number, excludeIds: Set<string>): WordEntry[] {
    const pool = this.bank.words.filter((w) => {
      if (excludeIds.has(w.id)) return false;
      const wp = this.wp(w.id);
      return wp.status !== 'mastered' && wp.firstLearnedAt !== null;
    });
    return this.rankCandidates(pool).slice(0, limit);
  }

  /** 长时间未复习的“复习中”词 */
  staleReviewing(limit: number, excludeIds: Set<string>, now = Date.now()): WordEntry[] {
    const cutoff = now - 3 * 24 * 3600 * 1000;
    const pool = this.bank.words.filter((w) => {
      if (excludeIds.has(w.id)) return false;
      const wp = this.wp(w.id);
      return wp.status === 'reviewing' && (wp.lastAnsweredAt ?? 0) < cutoff;
    });
    return this.rankCandidates(pool).slice(0, limit);
  }

  /** 最近三个新词页的词 */
  recentPageWords(pages: [number, number], excludeIds: Set<string>): WordEntry[] {
    const seen = new Set<string>();
    const out: WordEntry[] = [];
    for (let p = pages[0]; p <= pages[1]; p++) {
      for (const w of this.bank.getPageWords(p)) {
        if (!excludeIds.has(w.id) && !seen.has(w.id)) {
          seen.add(w.id);
          out.push(w);
        }
      }
    }
    return out;
  }

  /** 错词不足时用掌握度最低的词补足（错词优先） */
  fillWrongOrWeak(count: number, excludeIds: Set<string>): WordEntry[] {
    const chosen: WordEntry[] = [];
    const used = new Set<string>(excludeIds);
    for (const w of this.historicalWrongWords()) {
      if (chosen.length >= count) break;
      if (used.has(w.id)) continue;
      used.add(w.id);
      chosen.push(w);
    }
    if (chosen.length < count) {
      for (const w of this.lowestMastery(count - chosen.length, used)) {
        if (chosen.length >= count) break;
        used.add(w.id);
        chosen.push(w);
      }
    }
    return chosen;
  }
}
