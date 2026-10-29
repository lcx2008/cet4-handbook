import type { Question, QuestionStage, QuestionType, WordEntry } from '../types';
import { WordBank } from './wordBank';

/** 随机工具：上限不含 */
const rand = (n: number) => Math.floor(Math.random() * n);
const shuffle = <T,>(arr: T[]): T[] => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

/** 词性主类：用于干扰项“同词性或词性接近”
 *  注意顺序：adv./adj. 要先于 v. 判断（"adv" 里含字母 v）；prep 不能和 num 混在一起 */
function posClass(pos: string): string {
  const p = pos.toLowerCase().replace(/\./g, '');
  if (p.includes('adv') || p.includes('adj')) return 'mod';
  if (p.includes('prep')) return 'prep';
  if (p.includes('conj')) return 'conj';
  if (p.includes('art')) return 'art';
  if (p.includes('num')) return 'num';
  if (p.includes('pron') || p.startsWith('n')) return 'noun';
  if (p.includes('v')) return 'verb';
  return 'other';
}

function normalizeMeaning(s: string): string {
  return s.replace(/\s+/g, '').replace(/[（(].*?[)）]/g, '').replace(/[，,；;、。.!！?？]/g, '');
}

const LETTERS = ['A', 'B', 'C', 'D'];

/**
 * 把「正确答案 + 3 个干扰项」打乱后按 A/B/C/D 顺序重新编号。
 * 之前是先编号再打乱，界面上会出现 A、D、B、C 这种顺序，看着乱。
 */
function assembleOptions(correctText: string, distractorTexts: string[]): {
  options: { key: string; text: string }[];
  answerKey: string;
} {
  const texts = shuffle([correctText, ...distractorTexts.slice(0, 3)]);
  const options = texts.map((text, i) => ({ key: LETTERS[i] ?? String.fromCharCode(65 + i), text }));
  return { options, answerKey: options.find((o) => o.text === correctText)?.key ?? 'A' };
}

/** 把例句里的目标词挖成 ____；词不在句子里就返回 null（这种词不出语境题） */
export function maskSentence(sentence: string, word: string): string | null {
  if (!sentence) return null;
  const stem = word.replace(/[^A-Za-z]/g, '');
  if (stem.length < 3) return null;
  const re = new RegExp(`\\b${stem}[a-z]{0,4}\\b`, 'i');
  if (!re.test(sentence)) return null;
  return sentence.replace(re, '____');
}

/** 是否具备出语境题的条件 */
export function hasUsableExample(word: WordEntry): boolean {
  return Boolean(word.example) && maskSentence(word.example, word.word) !== null;
}

export class QuestionGenerator {
  private bank: WordBank;
  private qidSeq = 0;
  private wordIdSeq = 0;

  constructor(bank: WordBank) {
    this.bank = bank;
  }

  /** 某个词可用的题型 */
  availableTypes(word: WordEntry): QuestionType[] {
    const types: QuestionType[] = ['word-to-meaning', 'meaning-to-word', 'phonetic-to-word'];
    if (hasUsableExample(word)) types.push('context-cloze');
    if (word.word.length > 2) types.push('letter-fill', 'letter-tiles', 'spell-typing');
    return types;
  }

  /** 生成一个指定题型的题目 */
  makeQuestion(
    word: WordEntry,
    type: QuestionType,
    excludeWords: Set<string>,
    excludeMeanings: Set<string>,
    stage: QuestionStage = 'meaning-en',
  ): Question {
    this.qidSeq++;
    this.wordIdSeq++;
    const id = `q${this.qidSeq}_w${this.wordIdSeq}`;
    const base = { qid: id, wordId: word.id, stage };
    switch (type) {
      case 'word-to-meaning':
        return this.makeWordToMeaning(word, excludeMeanings, base);
      case 'meaning-to-word':
        return this.makeMeaningToWord(word, excludeWords, base);
      case 'phonetic-to-word':
        return this.makePhoneticToWord(word, excludeWords, base);
      case 'letter-fill':
        return this.makeLetterFill(word, base);
      case 'letter-tiles':
        return this.makeLetterTiles(word, base);
      case 'spell-typing':
        return this.makeSpellTyping(word, base);
      case 'context-cloze':
        return this.makeContextCloze(word, excludeWords, base);
    }
  }

  /** 干扰词候选：同词性类优先，再按全库补齐 */
  private distractorPool(target: WordEntry): WordEntry[] {
    const cls = posClass(target.partOfSpeech);
    const same = this.bank.words.filter(
      (w) => w.id !== target.id && posClass(w.partOfSpeech) === cls,
    );
    if (same.length >= 30) return same;
    return this.bank.words.filter((w) => w.id !== target.id);
  }

  private makeWordToMeaning(
    word: WordEntry,
    excludeMeanings: Set<string>,
    base: { qid: string; wordId: string; stage: QuestionStage },
  ): Question {
    const targetNorm = normalizeMeaning(word.meaning);
    const seen = new Set<string>([targetNorm, ...excludeMeanings]);
    const candidates = shuffle(this.distractorPool(word)).filter((w) => {
      const m = normalizeMeaning(w.meaning);
      if (!m || seen.has(m)) return false;
      seen.add(m);
      return true;
    });
    const { options, answerKey } = assembleOptions(
      word.meaning,
      candidates.slice(0, 3).map((w) => w.meaning),
    );
    return {
      ...base,
      type: 'word-to-meaning',
      prompt: {
        word: word.word,
        phonetic: word.phonetic,
        partOfSpeech: word.partOfSpeech,
        meaning: word.meaning,
        rawDefinition: word.rawDefinition,
      },
      options,
      answerKey,
    };
  }

  private makeMeaningToWord(
    word: WordEntry,
    excludeWords: Set<string>,
    base: { qid: string; wordId: string; stage: QuestionStage },
  ): Question {
    const lw = word.word.toLowerCase();
    const seen = new Set<string>([lw, ...excludeWords]);
    const candidates = shuffle(this.distractorPool(word)).filter((w) => {
      const k = w.word.toLowerCase();
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    const { options, answerKey } = assembleOptions(
      word.word,
      candidates.slice(0, 3).map((w) => w.word),
    );
    return {
      ...base,
      type: 'meaning-to-word',
      prompt: {
        word: word.word,
        phonetic: word.phonetic,
        partOfSpeech: word.partOfSpeech,
        meaning: word.meaning,
        rawDefinition: word.rawDefinition,
      },
      options,
      answerKey,
    };
  }

  private makePhoneticToWord(
    word: WordEntry,
    excludeWords: Set<string>,
    base: { qid: string; wordId: string; stage: QuestionStage },
  ): Question {
    const lw = word.word.toLowerCase();
    const phon = word.phonetic.trim().toLowerCase();
    const seen = new Set<string>([lw, ...excludeWords]);
    const candidates = shuffle(this.distractorPool(word)).filter((w) => {
      const wl = w.word.toLowerCase();
      if (!wl || seen.has(wl)) return false;
      // 音标题干扰项不能与正确词音标完全相同（否则多解）
      if (w.phonetic.trim().toLowerCase() === phon) return false;
      seen.add(wl);
      return true;
    });
    const { options, answerKey } = assembleOptions(
      word.word,
      candidates.slice(0, 3).map((w) => w.word),
    );
    return {
      ...base,
      type: 'phonetic-to-word',
      prompt: {
        word: word.word,
        phonetic: word.phonetic,
        partOfSpeech: word.partOfSpeech,
        meaning: word.meaning,
        rawDefinition: word.rawDefinition,
      },
      options,
      answerKey,
    };
  }

  /** 字母补全：隐藏 1~2 个字母（位置避开首字母，避免歧义过重），从 4 个选项中选缺失片段 */
  private makeLetterFill(word: WordEntry, base: { qid: string; wordId: string; stage: QuestionStage }): Question {
    const w = word.word;
    const len = w.length;
    const hideCount = len >= 6 ? 2 : 1;
    const maxStart = len - hideCount - 1;
    const start = 1 + rand(Math.max(1, maxStart));
    const missing = w.slice(start, start + hideCount);
    const masked = w.slice(0, start) + '＿'.repeat(hideCount) + w.slice(start + hideCount);
    const distractorFrags = new Set<string>([missing]);
    const pool = shuffle(this.bank.words.filter((x) => x.id !== word.id));
    for (const other of pool) {
      if (distractorFrags.size >= 4) break;
      const ow = other.word;
      if (ow.length < hideCount + 1) continue;
      const s = rand(ow.length - hideCount);
      const frag = ow.slice(s, s + hideCount).toLowerCase();
      const miss = missing.toLowerCase();
      if (frag !== miss) distractorFrags.add(frag);
    }
    const alphabet = 'abcdefghijklmnopqrstuvwxyz';
    while (distractorFrags.size < 4) {
      let frag = '';
      for (let i = 0; i < hideCount; i++) frag += alphabet[rand(26)];
      distractorFrags.add(frag);
    }
    const frags = shuffle([...distractorFrags]);
    const options = frags.map((f, i) => ({ key: String.fromCharCode(65 + i), text: f }));
    return {
      ...base,
      type: 'letter-fill',
      prompt: {
        word: word.word,
        phonetic: word.phonetic,
        partOfSpeech: word.partOfSpeech,
        meaning: word.meaning,
        rawDefinition: word.rawDefinition,
        masked,
        missing,
      },
      options,
      answerKey: options.find((o) => o.text === missing)?.key ?? 'A',
    };
  }

  /** 语境填空：例句挖空，从 4 个单词里选出合适的那个 */
  private makeContextCloze(
    word: WordEntry,
    excludeWords: Set<string>,
    base: { qid: string; wordId: string; stage: QuestionStage },
  ): Question {
    const masked = maskSentence(word.example, word.word) ?? word.example;
    const lw = word.word.toLowerCase();
    const seen = new Set<string>([lw, ...excludeWords]);
    const candidates = shuffle(this.distractorPool(word)).filter((w) => {
      const wl = w.word.toLowerCase();
      if (!wl || wl.length <= 1 || seen.has(wl)) return false;
      seen.add(wl);
      return true;
    });
    const { options, answerKey } = assembleOptions(
      word.word,
      candidates.slice(0, 3).map((w) => w.word),
    );
    return {
      ...base,
      type: 'context-cloze',
      prompt: {
        word: word.word,
        phonetic: word.phonetic,
        partOfSpeech: word.partOfSpeech,
        meaning: word.meaning,
        rawDefinition: word.rawDefinition,
        sentence: masked,
        sentenceTranslation: word.exampleTranslation,
      },
      options,
      answerKey,
    };
  }

  /** 字母贴纸：打乱字母块按顺序拼出单词 */
  private makeLetterTiles(word: WordEntry, base: { qid: string; wordId: string; stage: QuestionStage }): Question {
    const letters = word.word.split('');
    let tiles = shuffle(letters);
    let guard = 0;
    while (tiles.join('') === word.word && guard < 10) {
      tiles = shuffle(letters);
      guard++;
    }
    return {
      ...base,
      type: 'letter-tiles',
      prompt: {
        word: word.word,
        phonetic: word.phonetic,
        partOfSpeech: word.partOfSpeech,
        meaning: word.meaning,
        rawDefinition: word.rawDefinition,
      },
      options: null,
      answerKey: null,
      tiles,
      answerText: word.word,
    };
  }

  /** 自由拼写：看释义/音标，用键盘把单词敲出来 */
  private makeSpellTyping(word: WordEntry, base: { qid: string; wordId: string; stage: QuestionStage }): Question {
    return {
      ...base,
      type: 'spell-typing',
      prompt: {
        word: word.word,
        phonetic: word.phonetic,
        partOfSpeech: word.partOfSpeech,
        meaning: word.meaning,
        rawDefinition: word.rawDefinition,
      },
      options: null,
      answerKey: null,
      answerText: word.word,
    };
  }
}
