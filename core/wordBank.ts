import type { LevelDef, UnitDef, WordEntry } from '../types';

/** 词库为压缩体积省略了空字段与 rawDefinition，这里补齐（原文不修改，只是拼回展示串） */
function normalizeWord(raw: Partial<WordEntry> & { word: string }): WordEntry {
  const pos = raw.partOfSpeech ?? '';
  const meaning = raw.meaning ?? '';
  return {
    id: raw.id ?? '',
    sourceOrder: raw.sourceOrder ?? 0,
    day: raw.day ?? 1,
    dayLabel: raw.dayLabel ?? '',
    globalPage: raw.globalPage ?? 1,
    pageInDay: raw.pageInDay ?? 1,
    word: raw.word,
    phonetic: raw.phonetic ?? '',
    partOfSpeech: pos,
    meaning,
    rawDefinition: raw.rawDefinition && raw.rawDefinition.length > 0 ? raw.rawDefinition : (pos + ' ' + meaning).trim(),
    example: raw.example ?? '',
    exampleTranslation: raw.exampleTranslation ?? '',
    notes: raw.notes ?? '',
    freqRank: raw.freqRank ?? undefined,
    zipf: raw.zipf ?? undefined,
  };
}

/**
 * 按用户设定的「每页词数」重新划分词页（不改动 Day 归属，只在每个 Day 内部切页）。
 * 数据里预置的 globalPage 是按每页 10 词算的，用户可以改成 6/10/15/20。
 */
function repaginate(words: WordEntry[], pageSize: number): WordEntry[] {
  const size = Math.max(3, Math.min(30, Math.floor(pageSize) || 10));
  const byDay = new Map<number, WordEntry[]>();
  for (const w of words) {
    const list = byDay.get(w.day);
    if (list) list.push(w);
    else byDay.set(w.day, [w]);
  }
  const out: WordEntry[] = [];
  let page = 0;
  for (const day of [...byDay.keys()].sort((a, b) => a - b)) {
    const list = byDay.get(day)!.sort((a, b) => a.sourceOrder - b.sourceOrder);
    for (let i = 0; i < list.length; i += size) {
      page += 1;
      const chunk = list.slice(i, i + size);
      const pageInDay = Math.floor(i / size) + 1;
      for (const w of chunk) out.push({ ...w, globalPage: page, pageInDay });
    }
  }
  return out;
}

/**
 * 词库加载与索引。
 * 唯一内容来源是 public/data/{level}_words.json，运行时校验数量，防止静默损坏。
 */
export class WordBank {
  readonly words: WordEntry[];
  readonly expectedCount: number;
  readonly levelId: string;
  private byId = new Map<string, WordEntry>();
  private byPage = new Map<number, WordEntry[]>();
  private byDay = new Map<number, WordEntry[]>();

  private constructor(words: WordEntry[], expectedCount: number, levelId: string) {
    this.words = words;
    this.expectedCount = expectedCount;
    this.levelId = levelId;
    for (const w of words) {
      this.byId.set(w.id, w);
      const page = this.byPage.get(w.globalPage) ?? [];
      page.push(w);
      this.byPage.set(w.globalPage, page);
      const day = this.byDay.get(w.day) ?? [];
      day.push(w);
      this.byDay.set(w.day, day);
    }
  }

  /** 从已解析的数据构建（供验证脚本/测试复用校验逻辑） */
  static fromParsed(raw: { words?: WordEntry[] }, expectedCount: number, levelId = 'cet4', pageSize = 10): WordBank {
    const words = raw.words;
    if (!Array.isArray(words)) throw new Error('词库文件结构无效：缺少 words 数组');
    if (words.length !== expectedCount) {
      throw new Error(`词条数量校验失败：实际 ${words.length}，应为 ${expectedCount}。已停止加载。`);
    }
    const normalized = words.map(normalizeWord) as WordEntry[];
    const unique = new Set(normalized.map((w) => w.word.toLowerCase()));
    if (unique.size !== words.length) {
      throw new Error(`词条唯一性校验失败：存在 ${words.length - unique.size} 个重复词。`);
    }
    return new WordBank(repaginate(normalized, pageSize), expectedCount, levelId);
  }

  static async load(level: LevelDef, pageSize = 10): Promise<WordBank> {
    const key = `${level.id}:${pageSize}`;
    const cached = WordBank.cache.get(key);
    if (cached) return cached;
    const url = `./data/${level.wordsFile}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`无法读取 ${level.wordsFile}（HTTP ${res.status}）`);
    const raw = (await res.json()) as { words?: WordEntry[] };
    const bank = WordBank.fromParsed(raw, level.wordCount, level.id, pageSize);
    WordBank.cache.set(key, bank);
    return bank;
  }

  /** 已加载过的词库：切换分级时秒回，不重复下载 */
  private static cache = new Map<string, WordBank>();

  getById(id: string): WordEntry | undefined {
    return this.byId.get(id);
  }

  /** 总页数 */
  get pageCount(): number {
    return this.byPage.size;
  }

  /** 取一个 globalPage 的词（按 sourceOrder 排序） */
  getPageWords(globalPage: number): WordEntry[] {
    const list = this.byPage.get(globalPage);
    if (!list) return [];
    return [...list].sort((a, b) => a.sourceOrder - b.sourceOrder);
  }

  /** 取某个 Day 的全部词 */
  getDayWords(day: number): WordEntry[] {
    const list = this.byDay.get(day);
    if (!list) return [];
    return [...list].sort((a, b) => a.sourceOrder - b.sourceOrder);
  }

  search(query: string): WordEntry[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return this.words.filter(
      (w) => w.word.toLowerCase().includes(q) || w.meaning.toLowerCase().includes(q) || w.rawDefinition.toLowerCase().includes(q),
    );
  }
}

/** 按词库规模计算新词页 + 复习页 + 阶段测验。
 * 学习顺序交织：每 3 个新词页后插入 1 个复习页，每个阶段末尾是测验。
 * 界面上一律用「页」说话，不出现天数。 */
export function buildUnits(totalPages: number, pagesPerReview: number, dayCount: number): UnitDef[] {
  const units: UnitDef[] = [];
  const pagesPerDay = Math.max(1, Math.ceil(totalPages / dayCount));
  let seq = 0;
  let reviewIdx = 0;
  for (let day = 1; day <= dayCount; day++) {
    const from = (day - 1) * pagesPerDay + 1;
    const to = day === dayCount ? totalPages : Math.min(day * pagesPerDay, totalPages);
    if (from > to) continue;
    const pagesInDay = to - from + 1;
    const reviewCount = Math.floor(pagesInDay / pagesPerReview);
    for (let p = from; p <= to; p++) {
      seq++;
      units.push({
        id: `N${String(p).padStart(3, '0')}`,
        kind: 'new',
        label: `第 ${p} 页`,
        day,
        seq,
        globalPage: p,
      });
      // 每满 3 个新词页（不含末尾凑不满的部分），紧跟着插一个复习页
      const pageIdx = p - from + 1;
      if (pageIdx % pagesPerReview === 0 && pageIdx / pagesPerReview <= reviewCount) {
        seq++;
        reviewIdx++;
        const coverFrom = p - pagesPerReview + 1;
        units.push({
          id: `R${String(reviewIdx).padStart(3, '0')}`,
          kind: 'review',
          label: `复习 · 第 ${coverFrom}~${p} 页`,
          day,
          seq,
          coversPages: [coverFrom, p],
        });
      }
    }
    // 阶段测验
    seq++;
    units.push({
      id: `T${String(day).padStart(2, '0')}`,
      kind: 'test',
      label: `测验 · 第 ${from}~${to} 页`,
      day,
      seq,
      coversPages: [from, to],
    });
  }
  return units;
}
