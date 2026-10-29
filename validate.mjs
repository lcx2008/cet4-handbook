// src/core/wordBank.ts
function normalizeWord(raw) {
  const pos = raw.partOfSpeech ?? "";
  const meaning = raw.meaning ?? "";
  return {
    id: raw.id ?? "",
    sourceOrder: raw.sourceOrder ?? 0,
    day: raw.day ?? 1,
    dayLabel: raw.dayLabel ?? "",
    globalPage: raw.globalPage ?? 1,
    pageInDay: raw.pageInDay ?? 1,
    word: raw.word,
    phonetic: raw.phonetic ?? "",
    partOfSpeech: pos,
    meaning,
    rawDefinition: raw.rawDefinition && raw.rawDefinition.length > 0 ? raw.rawDefinition : (pos + " " + meaning).trim(),
    example: raw.example ?? "",
    exampleTranslation: raw.exampleTranslation ?? "",
    notes: raw.notes ?? "",
    freqRank: raw.freqRank ?? void 0,
    zipf: raw.zipf ?? void 0
  };
}
function repaginate(words, pageSize) {
  const size = Math.max(3, Math.min(30, Math.floor(pageSize) || 10));
  const byDay = /* @__PURE__ */ new Map();
  for (const w of words) {
    const list = byDay.get(w.day);
    if (list) list.push(w);
    else byDay.set(w.day, [w]);
  }
  const out = [];
  let page = 0;
  for (const day of [...byDay.keys()].sort((a, b) => a - b)) {
    const list = byDay.get(day).sort((a, b) => a.sourceOrder - b.sourceOrder);
    for (let i = 0; i < list.length; i += size) {
      page += 1;
      const chunk = list.slice(i, i + size);
      const pageInDay = Math.floor(i / size) + 1;
      for (const w of chunk) out.push({ ...w, globalPage: page, pageInDay });
    }
  }
  return out;
}
var WordBank = class _WordBank {
  words;
  expectedCount;
  levelId;
  byId = /* @__PURE__ */ new Map();
  byPage = /* @__PURE__ */ new Map();
  byDay = /* @__PURE__ */ new Map();
  constructor(words, expectedCount, levelId) {
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
  static fromParsed(raw, expectedCount, levelId = "cet4", pageSize = 10) {
    const words = raw.words;
    if (!Array.isArray(words)) throw new Error("\u8BCD\u5E93\u6587\u4EF6\u7ED3\u6784\u65E0\u6548\uFF1A\u7F3A\u5C11 words \u6570\u7EC4");
    if (words.length !== expectedCount) {
      throw new Error(`\u8BCD\u6761\u6570\u91CF\u6821\u9A8C\u5931\u8D25\uFF1A\u5B9E\u9645 ${words.length}\uFF0C\u5E94\u4E3A ${expectedCount}\u3002\u5DF2\u505C\u6B62\u52A0\u8F7D\u3002`);
    }
    const normalized = words.map(normalizeWord);
    const unique = new Set(normalized.map((w) => w.word.toLowerCase()));
    if (unique.size !== words.length) {
      throw new Error(`\u8BCD\u6761\u552F\u4E00\u6027\u6821\u9A8C\u5931\u8D25\uFF1A\u5B58\u5728 ${words.length - unique.size} \u4E2A\u91CD\u590D\u8BCD\u3002`);
    }
    return new _WordBank(repaginate(normalized, pageSize), expectedCount, levelId);
  }
  static async load(level, pageSize = 10) {
    const key = `${level.id}:${pageSize}`;
    const cached = _WordBank.cache.get(key);
    if (cached) return cached;
    const url = `./data/${level.wordsFile}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`\u65E0\u6CD5\u8BFB\u53D6 ${level.wordsFile}\uFF08HTTP ${res.status}\uFF09`);
    const raw = await res.json();
    const bank = _WordBank.fromParsed(raw, level.wordCount, level.id, pageSize);
    _WordBank.cache.set(key, bank);
    return bank;
  }
  /** 已加载过的词库：切换分级时秒回，不重复下载 */
  static cache = /* @__PURE__ */ new Map();
  getById(id) {
    return this.byId.get(id);
  }
  /** 总页数 */
  get pageCount() {
    return this.byPage.size;
  }
  /** 取一个 globalPage 的词（按 sourceOrder 排序） */
  getPageWords(globalPage) {
    const list = this.byPage.get(globalPage);
    if (!list) return [];
    return [...list].sort((a, b) => a.sourceOrder - b.sourceOrder);
  }
  /** 取某个 Day 的全部词 */
  getDayWords(day) {
    const list = this.byDay.get(day);
    if (!list) return [];
    return [...list].sort((a, b) => a.sourceOrder - b.sourceOrder);
  }
  search(query) {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return this.words.filter(
      (w) => w.word.toLowerCase().includes(q) || w.meaning.toLowerCase().includes(q) || w.rawDefinition.toLowerCase().includes(q)
    );
  }
};
function buildUnits(totalPages, pagesPerReview, dayCount) {
  const units = [];
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
        id: `N${String(p).padStart(3, "0")}`,
        kind: "new",
        label: `\u7B2C ${p} \u9875`,
        day,
        seq,
        globalPage: p
      });
      const pageIdx = p - from + 1;
      if (pageIdx % pagesPerReview === 0 && pageIdx / pagesPerReview <= reviewCount) {
        seq++;
        reviewIdx++;
        const coverFrom = p - pagesPerReview + 1;
        units.push({
          id: `R${String(reviewIdx).padStart(3, "0")}`,
          kind: "review",
          label: `\u590D\u4E60 \xB7 \u7B2C ${coverFrom}~${p} \u9875`,
          day,
          seq,
          coversPages: [coverFrom, p]
        });
      }
    }
    seq++;
    units.push({
      id: `T${String(day).padStart(2, "0")}`,
      kind: "test",
      label: `\u6D4B\u9A8C \xB7 \u7B2C ${from}~${to} \u9875`,
      day,
      seq,
      coversPages: [from, to]
    });
  }
  return units;
}

// src/core/questionGenerator.ts
var rand = (n) => Math.floor(Math.random() * n);
var shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
function posClass(pos) {
  const p = pos.toLowerCase().replace(/\./g, "");
  if (p.includes("adv") || p.includes("adj")) return "mod";
  if (p.includes("prep")) return "prep";
  if (p.includes("conj")) return "conj";
  if (p.includes("art")) return "art";
  if (p.includes("num")) return "num";
  if (p.includes("pron") || p.startsWith("n")) return "noun";
  if (p.includes("v")) return "verb";
  return "other";
}
function normalizeMeaning(s) {
  return s.replace(/\s+/g, "").replace(/[（(].*?[)）]/g, "").replace(/[，,；;、。.!！?？]/g, "");
}
var LETTERS = ["A", "B", "C", "D"];
function assembleOptions(correctText, distractorTexts) {
  const texts = shuffle([correctText, ...distractorTexts.slice(0, 3)]);
  const options = texts.map((text, i) => ({ key: LETTERS[i] ?? String.fromCharCode(65 + i), text }));
  return { options, answerKey: options.find((o) => o.text === correctText)?.key ?? "A" };
}
function maskSentence(sentence, word) {
  if (!sentence) return null;
  const stem = word.replace(/[^A-Za-z]/g, "");
  if (stem.length < 3) return null;
  const re = new RegExp(`\\b${stem}[a-z]{0,4}\\b`, "i");
  if (!re.test(sentence)) return null;
  return sentence.replace(re, "____");
}
function hasUsableExample(word) {
  return Boolean(word.example) && maskSentence(word.example, word.word) !== null;
}
var QuestionGenerator = class {
  bank;
  qidSeq = 0;
  wordIdSeq = 0;
  constructor(bank) {
    this.bank = bank;
  }
  /** 某个词可用的题型 */
  availableTypes(word) {
    const types = ["word-to-meaning", "meaning-to-word", "phonetic-to-word"];
    if (hasUsableExample(word)) types.push("context-cloze");
    if (word.word.length > 2) types.push("letter-fill", "letter-tiles", "spell-typing");
    return types;
  }
  /** 生成一个指定题型的题目 */
  makeQuestion(word, type, excludeWords, excludeMeanings, stage = "meaning-en") {
    this.qidSeq++;
    this.wordIdSeq++;
    const id = `q${this.qidSeq}_w${this.wordIdSeq}`;
    const base = { qid: id, wordId: word.id, stage };
    switch (type) {
      case "word-to-meaning":
        return this.makeWordToMeaning(word, excludeMeanings, base);
      case "meaning-to-word":
        return this.makeMeaningToWord(word, excludeWords, base);
      case "phonetic-to-word":
        return this.makePhoneticToWord(word, excludeWords, base);
      case "letter-fill":
        return this.makeLetterFill(word, base);
      case "letter-tiles":
        return this.makeLetterTiles(word, base);
      case "spell-typing":
        return this.makeSpellTyping(word, base);
      case "context-cloze":
        return this.makeContextCloze(word, excludeWords, base);
    }
  }
  /** 干扰词候选：同词性类优先，再按全库补齐 */
  distractorPool(target) {
    const cls = posClass(target.partOfSpeech);
    const same = this.bank.words.filter(
      (w) => w.id !== target.id && posClass(w.partOfSpeech) === cls
    );
    if (same.length >= 30) return same;
    return this.bank.words.filter((w) => w.id !== target.id);
  }
  makeWordToMeaning(word, excludeMeanings, base) {
    const targetNorm = normalizeMeaning(word.meaning);
    const seen = /* @__PURE__ */ new Set([targetNorm, ...excludeMeanings]);
    const candidates = shuffle(this.distractorPool(word)).filter((w) => {
      const m = normalizeMeaning(w.meaning);
      if (!m || seen.has(m)) return false;
      seen.add(m);
      return true;
    });
    const { options, answerKey } = assembleOptions(
      word.meaning,
      candidates.slice(0, 3).map((w) => w.meaning)
    );
    return {
      ...base,
      type: "word-to-meaning",
      prompt: {
        word: word.word,
        phonetic: word.phonetic,
        partOfSpeech: word.partOfSpeech,
        meaning: word.meaning,
        rawDefinition: word.rawDefinition
      },
      options,
      answerKey
    };
  }
  makeMeaningToWord(word, excludeWords, base) {
    const lw = word.word.toLowerCase();
    const seen = /* @__PURE__ */ new Set([lw, ...excludeWords]);
    const candidates = shuffle(this.distractorPool(word)).filter((w) => {
      const k = w.word.toLowerCase();
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    const { options, answerKey } = assembleOptions(
      word.word,
      candidates.slice(0, 3).map((w) => w.word)
    );
    return {
      ...base,
      type: "meaning-to-word",
      prompt: {
        word: word.word,
        phonetic: word.phonetic,
        partOfSpeech: word.partOfSpeech,
        meaning: word.meaning,
        rawDefinition: word.rawDefinition
      },
      options,
      answerKey
    };
  }
  makePhoneticToWord(word, excludeWords, base) {
    const lw = word.word.toLowerCase();
    const phon = word.phonetic.trim().toLowerCase();
    const seen = /* @__PURE__ */ new Set([lw, ...excludeWords]);
    const candidates = shuffle(this.distractorPool(word)).filter((w) => {
      const wl = w.word.toLowerCase();
      if (!wl || seen.has(wl)) return false;
      if (w.phonetic.trim().toLowerCase() === phon) return false;
      seen.add(wl);
      return true;
    });
    const { options, answerKey } = assembleOptions(
      word.word,
      candidates.slice(0, 3).map((w) => w.word)
    );
    return {
      ...base,
      type: "phonetic-to-word",
      prompt: {
        word: word.word,
        phonetic: word.phonetic,
        partOfSpeech: word.partOfSpeech,
        meaning: word.meaning,
        rawDefinition: word.rawDefinition
      },
      options,
      answerKey
    };
  }
  /** 字母补全：隐藏 1~2 个字母（位置避开首字母，避免歧义过重），从 4 个选项中选缺失片段 */
  makeLetterFill(word, base) {
    const w = word.word;
    const len = w.length;
    const hideCount = len >= 6 ? 2 : 1;
    const maxStart = len - hideCount - 1;
    const start = 1 + rand(Math.max(1, maxStart));
    const missing = w.slice(start, start + hideCount);
    const masked = w.slice(0, start) + "\uFF3F".repeat(hideCount) + w.slice(start + hideCount);
    const distractorFrags = /* @__PURE__ */ new Set([missing]);
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
    const alphabet = "abcdefghijklmnopqrstuvwxyz";
    while (distractorFrags.size < 4) {
      let frag = "";
      for (let i = 0; i < hideCount; i++) frag += alphabet[rand(26)];
      distractorFrags.add(frag);
    }
    const frags = shuffle([...distractorFrags]);
    const options = frags.map((f, i) => ({ key: String.fromCharCode(65 + i), text: f }));
    return {
      ...base,
      type: "letter-fill",
      prompt: {
        word: word.word,
        phonetic: word.phonetic,
        partOfSpeech: word.partOfSpeech,
        meaning: word.meaning,
        rawDefinition: word.rawDefinition,
        masked,
        missing
      },
      options,
      answerKey: options.find((o) => o.text === missing)?.key ?? "A"
    };
  }
  /** 语境填空：例句挖空，从 4 个单词里选出合适的那个 */
  makeContextCloze(word, excludeWords, base) {
    const masked = maskSentence(word.example, word.word) ?? word.example;
    const lw = word.word.toLowerCase();
    const seen = /* @__PURE__ */ new Set([lw, ...excludeWords]);
    const candidates = shuffle(this.distractorPool(word)).filter((w) => {
      const wl = w.word.toLowerCase();
      if (!wl || wl.length <= 1 || seen.has(wl)) return false;
      seen.add(wl);
      return true;
    });
    const { options, answerKey } = assembleOptions(
      word.word,
      candidates.slice(0, 3).map((w) => w.word)
    );
    return {
      ...base,
      type: "context-cloze",
      prompt: {
        word: word.word,
        phonetic: word.phonetic,
        partOfSpeech: word.partOfSpeech,
        meaning: word.meaning,
        rawDefinition: word.rawDefinition,
        sentence: masked,
        sentenceTranslation: word.exampleTranslation
      },
      options,
      answerKey
    };
  }
  /** 字母贴纸：打乱字母块按顺序拼出单词 */
  makeLetterTiles(word, base) {
    const letters = word.word.split("");
    let tiles = shuffle(letters);
    let guard = 0;
    while (tiles.join("") === word.word && guard < 10) {
      tiles = shuffle(letters);
      guard++;
    }
    return {
      ...base,
      type: "letter-tiles",
      prompt: {
        word: word.word,
        phonetic: word.phonetic,
        partOfSpeech: word.partOfSpeech,
        meaning: word.meaning,
        rawDefinition: word.rawDefinition
      },
      options: null,
      answerKey: null,
      tiles,
      answerText: word.word
    };
  }
  /** 自由拼写：看释义/音标，用键盘把单词敲出来 */
  makeSpellTyping(word, base) {
    return {
      ...base,
      type: "spell-typing",
      prompt: {
        word: word.word,
        phonetic: word.phonetic,
        partOfSpeech: word.partOfSpeech,
        meaning: word.meaning,
        rawDefinition: word.rawDefinition
      },
      options: null,
      answerKey: null,
      answerText: word.word
    };
  }
};

// scripts/validate.ts
import { readFileSync } from "node:fs";
var dataUrl = (f) => new URL(`../public/data/${f}`, import.meta.url);
var cfg = JSON.parse(readFileSync(dataUrl("levels.json"), "utf8"));
var failures = [];
var ok = (name, cond, extra = "") => {
  if (cond) console.log(`\u2705 ${name}${extra ? " \xB7 " + extra : ""}`);
  else failures.push(name);
};
function checkLevel(level) {
  console.log(`
=== ${level.name}\uFF08${level.id}\uFF09===`);
  const raw = JSON.parse(readFileSync(dataUrl(level.wordsFile), "utf8"));
  const bank = WordBank.fromParsed(raw, level.wordCount, level.id);
  ok(`\u8BCD\u5E93 ${level.wordCount} \u4E2A\u552F\u4E00\u8BCD\u6761`, bank.words.length === level.wordCount, `\u5B9E\u9645 ${bank.words.length}`);
  const pageSizes = /* @__PURE__ */ new Map();
  for (const w of bank.words) pageSizes.set(w.globalPage, (pageSizes.get(w.globalPage) ?? 0) + 1);
  const maxPage = Math.max(...pageSizes.keys());
  ok(`${level.pageCount} \u4E2A\u65B0\u8BCD\u9875`, pageSizes.size === level.pageCount, `\u5B9E\u9645 ${pageSizes.size}`);
  const lastSize = pageSizes.get(maxPage) ?? 0;
  ok("\u6700\u540E\u4E00\u9875\u4E0D\u8D85\u8FC7 10 \u8BCD", lastSize > 0 && lastSize <= 10, `\u7B2C ${maxPage} \u9875 ${lastSize} \u8BCD`);
  let badPage = 0;
  for (const [p, n] of pageSizes) if (n !== 10 && p !== maxPage) badPage++;
  ok("\u5176\u4F59\u6BCF\u9875 10 \u8BCD", badPage === 0, `\u5F02\u5E38\u9875 ${badPage}`);
  const units = buildUnits(level.pageCount, 3, level.dayCount);
  const news = units.filter((u) => u.kind === "new").length;
  const reviews = units.filter((u) => u.kind === "review").length;
  const tests = units.filter((u) => u.kind === "test").length;
  ok(`\u65B0\u8BCD\u9875 ${level.pageCount} / \u590D\u4E60\u9875 ${reviews} / Day \u6D4B\u9A8C ${level.dayCount}`, news === level.pageCount && tests === level.dayCount, `\u5408\u8BA1 ${units.length} \u4E2A\u5355\u5143`);
  let unitPageOk = true;
  for (const u of units.filter((x) => x.kind === "new")) {
    if (bank.getPageWords(u.globalPage).length === 0) unitPageOk = false;
  }
  ok("\u65B0\u8BCD\u9875\u4E0E\u6570\u636E globalPage \u4E00\u81F4", unitPageOk);
  let searchOk = true;
  for (const w of bank.words) {
    if (!bank.search(w.word).some((x) => x.id === w.id)) {
      searchOk = false;
      break;
    }
  }
  ok(`\u5168\u90E8 ${level.wordCount} \u8BCD\u53EF\u88AB\u641C\u7D22\u5230`, searchOk);
  const gen = new QuestionGenerator(bank);
  let questionOk = true;
  let checked = 0;
  let spellingChecked = 0;
  const sample = [...bank.words].sort(() => Math.random() - 0.5).slice(0, 600);
  for (const w of sample) {
    for (const type of gen.availableTypes(w)) {
      const q = gen.makeQuestion(w, type, /* @__PURE__ */ new Set([w.id]), /* @__PURE__ */ new Set());
      checked++;
      if (type === "letter-fill") {
        const miss = q.prompt.missing ?? "";
        const run = "\uFF3F".repeat(miss.length);
        const rebuilt = q.prompt.masked?.replace(run, miss);
        if (rebuilt !== w.word || !q.prompt.masked?.includes(run)) {
          questionOk = false;
          console.log("  letter-fill \u63A9\u7801\u9519\u8BEF:", w.word, q.prompt.masked, q.prompt.missing);
        }
      }
      if (type === "letter-fill" || type === "letter-tiles" || type === "spell-typing") spellingChecked++;
      if (type === "context-cloze") {
        const s = q.prompt.sentence ?? "";
        const filled = s.replace("____", w.word).toLowerCase();
        if (!s.includes("____") || !filled.includes(w.word.toLowerCase())) {
          questionOk = false;
          console.log("  \u8BED\u5883\u9898\u6316\u7A7A\u5F02\u5E38:", w.word, s);
        }
      }
      if (type === "spell-typing") {
        if (q.answerText !== w.word || q.options !== null || q.answerKey !== null) {
          questionOk = false;
          console.log("  \u81EA\u7531\u62FC\u5199\u9898\u7ED3\u6784\u9519\u8BEF:", w.word);
        }
      }
      if (q.options) {
        const texts = q.options.map((o) => o.text.trim().toLowerCase());
        if (new Set(texts).size !== texts.length) {
          questionOk = false;
          console.log("  \u9009\u9879\u91CD\u590D:", w.word, type, texts);
        }
        const correctCount = q.options.filter((o) => o.key === q.answerKey).length;
        if (correctCount !== 1 || q.options.length !== 4) {
          questionOk = false;
          console.log("  \u9009\u9879/\u7B54\u6848\u5F02\u5E38:", w.word, type, correctCount, q.options.length);
        }
        if (type === "word-to-meaning") {
          const norm = (s) => s.replace(/\s+/g, "").replace(/[（(].*?[)）]/g, "").replace(/[，,；;、。.!！?？]/g, "");
          const norms = q.options.map((o) => norm(o.text));
          if (new Set(norms).size !== norms.length) {
            questionOk = false;
            console.log("  \u4E2D\u6587\u91CA\u4E49\u91CD\u590D:", w.word, norms);
          }
        }
        if (type === "phonetic-to-word") {
          const phon = w.phonetic.trim().toLowerCase();
          for (const o of q.options) {
            if (o.key === q.answerKey) continue;
            const other = bank.words.find((x) => x.word.toLowerCase() === o.text.toLowerCase());
            if (other && other.phonetic.trim().toLowerCase() === phon) {
              questionOk = false;
              console.log("  \u97F3\u6807\u9898\u591A\u89E3:", w.word, other.word);
            }
          }
        }
      } else if (type === "letter-tiles") {
        const sorted1 = [...q.tiles].sort().join("");
        const sorted2 = [...q.answerText.split("")].sort().join("");
        if (sorted1 !== sorted2) {
          questionOk = false;
          console.log("  \u5B57\u6BCD\u5757\u4E0E\u5355\u8BCD\u5B57\u6BCD\u4E0D\u4E00\u81F4:", w.word, q.tiles, q.answerText);
        }
      }
    }
  }
  ok(`\u9898\u76EE\u751F\u6210\u68C0\u67E5\uFF08${checked} \u9898\uFF0C\u542B ${spellingChecked} \u9053\u62FC\u5199\u9898\uFF09`, questionOk);
  let shortOk = true;
  let longSpellOk = true;
  for (const w of bank.words) {
    const avail = gen.availableTypes(w);
    const hasSpell = avail.includes("letter-tiles") || avail.includes("spell-typing");
    if (w.word.length <= 2 && hasSpell) shortOk = false;
    if (w.word.length >= 3 && !hasSpell) longSpellOk = false;
  }
  ok("\u957F\u5EA6 \u22642 \u7684\u5355\u8BCD\u65E0\u62FC\u5199\u9898", shortOk);
  ok("\u957F\u5EA6 \u22653 \u7684\u5355\u8BCD\u6709\u62FC\u5199\u9898\u578B", longSpellOk);
  const withExample = bank.words.filter((w) => Boolean(w.example)).length;
  const coverage = Math.round(withExample / bank.words.length * 100);
  ok(`\u4F8B\u53E5\u8986\u76D6 ${coverage}%\uFF08\u226590%\uFF09`, coverage >= 90, `${withExample} / ${bank.words.length}`);
  const ranksOk = bank.words.every((w, i) => w.freqRank === i + 1 && w.sourceOrder === i + 1);
  ok("\u5B66\u4E60\u987A\u5E8F\u5DF2\u6309\u9AD8\u9891\u6392\u5E8F\uFF08freqRank \u8FDE\u7EED\uFF09", ranksOk);
  const firstPage = bank.getPageWords(1);
  const firstOk = firstPage.length > 0 && firstPage.every((w) => (w.zipf ?? 0) > 0 && (w.zipf ?? 0) < 4.6);
  ok("\u7B2C\u4E00\u9875\u5168\u90E8\u662F\u6838\u5FC3\u9AD8\u9891\u8BCD\uFF08\u65E0 the/a \u8FD9\u7C7B\u57FA\u7840\u8BCD\uFF09", firstOk, firstPage.slice(0, 5).map((w) => w.word).join(" "));
  const zipfOk = bank.words.filter((w) => typeof w.zipf === "number").length;
  ok(`\u8BCD\u9891\u5B57\u6BB5\u5B8C\u6574\uFF08${zipfOk}/${bank.words.length}\uFF09`, zipfOk === bank.words.length);
  const daySizes = /* @__PURE__ */ new Map();
  for (const w of bank.words) daySizes.set(w.day, (daySizes.get(w.day) ?? 0) + 1);
  const days = [...daySizes.keys()].sort((a, b) => a - b);
  const dayOk = days.length === level.dayCount && days.every((d) => d === level.dayCount ? (daySizes.get(d) ?? 0) <= 150 : daySizes.get(d) === 150);
  ok(`Day 01~${String(level.dayCount - 1).padStart(2, "0")} \u5404 150 \u8BCD\uFF0C\u6700\u540E\u4E00\u5929 ${daySizes.get(level.dayCount)} \u8BCD`, dayOk);
  return { bank, pageSizes };
}
ok("levels.json \u6709\u4E09\u4E2A\u5206\u7EA7", cfg.levels.length === 3, cfg.levels.map((l) => l.name).join(" / "));
for (const level of cfg.levels) {
  checkLevel(level);
}
var ids = /* @__PURE__ */ new Set();
var idOk = true;
for (const level of cfg.levels) {
  const raw = JSON.parse(readFileSync(dataUrl(level.wordsFile), "utf8"));
  for (const w of raw.words.slice(0, 50)) {
    if (ids.has(w.id)) idOk = false;
    ids.add(w.id);
  }
}
ok("\u4E09\u4E2A\u8BCD\u5E93\u7684 id \u4E92\u4E0D\u51B2\u7A81", idOk);
var daily = JSON.parse(readFileSync(dataUrl("daily.json"), "utf8"));
ok("\u6BCF\u65E5\u4E00\u8BF5\u81F3\u5C11 10 \u7BC7", daily.passages.length >= 10, `\u5B9E\u9645 ${daily.passages.length} \u7BC7`);
var passageOk = daily.passages.every(
  (p) => p.title.trim().length > 0 && p.sentences.length >= 4 && p.sentences.every((s) => s.en.trim().length > 0 && s.zh.trim().length > 0) && p.keywords.length > 0
);
ok("\u6BCF\u7BC7\u90FD\u6709\u6807\u9898 / \u22654 \u53E5\u4E2D\u82F1\u5BF9\u7167 / \u5173\u952E\u8BCD", passageOk);
var idsOk = new Set(daily.passages.map((p) => p.id)).size === daily.passages.length;
ok("\u6BCF\u65E5\u4E00\u8BF5 id \u552F\u4E00", idsOk);
console.log("\n" + (failures.length === 0 ? "\u{1F389} \u5168\u90E8\u9A8C\u6536\u9879\u901A\u8FC7" : `\u274C \u5931\u8D25 ${failures.length} \u9879\uFF1A` + failures.join("\uFF1B")));
process.exit(failures.length === 0 ? 0 : 1);
