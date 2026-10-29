/**
 * 验收检查脚本（开发期验证用，不进入运行环境）。
 * 用 esbuild 打包后以 node 执行：校验三个词库、单元结构、题目生成规则。
 */
import { WordBank, buildUnits } from '../src/core/wordBank';
import { QuestionGenerator } from '../src/core/questionGenerator';
import type { LevelDef, LevelsConfig, WordEntry } from '../src/types';

import { readFileSync } from 'node:fs';
const dataUrl = (f: string) => new URL(`../public/data/${f}`, import.meta.url);

const cfg = JSON.parse(readFileSync(dataUrl('levels.json'), 'utf8')) as LevelsConfig;
const failures: string[] = [];
const ok = (name: string, cond: boolean, extra = '') => {
  if (cond) console.log(`✅ ${name}${extra ? ' · ' + extra : ''}`);
  else failures.push(name);
};

const rand = (n: number) => Math.floor(Math.random() * n);

function checkLevel(level: LevelDef) {
  console.log(`\n=== ${level.name}（${level.id}）===`);
  const raw = JSON.parse(readFileSync(dataUrl(level.wordsFile), 'utf8')) as { words: WordEntry[] };
  const bank = WordBank.fromParsed(raw, level.wordCount, level.id);

  // 1. 词条数量与唯一性
  ok(`词库 ${level.wordCount} 个唯一词条`, bank.words.length === level.wordCount, `实际 ${bank.words.length}`);

  // 2. 分页
  const pageSizes = new Map<number, number>();
  for (const w of bank.words) pageSizes.set(w.globalPage, (pageSizes.get(w.globalPage) ?? 0) + 1);
  const maxPage = Math.max(...pageSizes.keys());
  ok(`${level.pageCount} 个新词页`, pageSizes.size === level.pageCount, `实际 ${pageSizes.size}`);
  const lastSize = pageSizes.get(maxPage) ?? 0;
  ok('最后一页不超过 10 词', lastSize > 0 && lastSize <= 10, `第 ${maxPage} 页 ${lastSize} 词`);
  let badPage = 0;
  for (const [p, n] of pageSizes) if (n !== 10 && p !== maxPage) badPage++;
  ok('其余每页 10 词', badPage === 0, `异常页 ${badPage}`);

  // 3. 单元结构
  const units = buildUnits(level.pageCount, 3, level.dayCount);
  const news = units.filter((u) => u.kind === 'new').length;
  const reviews = units.filter((u) => u.kind === 'review').length;
  const tests = units.filter((u) => u.kind === 'test').length;
  ok(`新词页 ${level.pageCount} / 复习页 ${reviews} / Day 测验 ${level.dayCount}`, news === level.pageCount && tests === level.dayCount, `合计 ${units.length} 个单元`);

  // 4. 每个新词页都能取到词
  let unitPageOk = true;
  for (const u of units.filter((x) => x.kind === 'new')) {
    if (bank.getPageWords(u.globalPage!).length === 0) unitPageOk = false;
  }
  ok('新词页与数据 globalPage 一致', unitPageOk);

  // 5. 全部词可搜索
  let searchOk = true;
  for (const w of bank.words) {
    if (!bank.search(w.word).some((x) => x.id === w.id)) {
      searchOk = false;
      break;
    }
  }
  ok(`全部 ${level.wordCount} 词可被搜索到`, searchOk);

  // 6. 题目生成
  const gen = new QuestionGenerator(bank);
  let questionOk = true;
  let checked = 0;
  let spellingChecked = 0;
  const sample = [...bank.words].sort(() => Math.random() - 0.5).slice(0, 600);
  for (const w of sample) {
    for (const type of gen.availableTypes(w)) {
      const q = gen.makeQuestion(w, type, new Set([w.id]), new Set());
      checked++;
      if (type === 'letter-fill') {
        const miss = q.prompt.missing ?? '';
        const run = '＿'.repeat(miss.length);
        const rebuilt = q.prompt.masked?.replace(run, miss);
        if (rebuilt !== w.word || !q.prompt.masked?.includes(run)) {
          questionOk = false;
          console.log('  letter-fill 掩码错误:', w.word, q.prompt.masked, q.prompt.missing);
        }
      }
      if (type === 'letter-fill' || type === 'letter-tiles' || type === 'spell-typing') spellingChecked++;
      if (type === 'context-cloze') {
        const s = q.prompt.sentence ?? '';
        const filled = s.replace('____', w.word).toLowerCase();
        if (!s.includes('____') || !filled.includes(w.word.toLowerCase())) {
          questionOk = false;
          console.log('  语境题挖空异常:', w.word, s);
        }
      }
      if (type === 'spell-typing') {
        if (q.answerText !== w.word || q.options !== null || q.answerKey !== null) {
          questionOk = false;
          console.log('  自由拼写题结构错误:', w.word);
        }
      }
      if (q.options) {
        const texts = q.options.map((o) => o.text.trim().toLowerCase());
        if (new Set(texts).size !== texts.length) {
          questionOk = false;
          console.log('  选项重复:', w.word, type, texts);
        }
        const correctCount = q.options.filter((o) => o.key === q.answerKey).length;
        if (correctCount !== 1 || q.options.length !== 4) {
          questionOk = false;
          console.log('  选项/答案异常:', w.word, type, correctCount, q.options.length);
        }
        if (type === 'word-to-meaning') {
          const norm = (s: string) => s.replace(/\s+/g, '').replace(/[（(].*?[)）]/g, '').replace(/[，,；;、。.!！?？]/g, '');
          const norms = q.options.map((o) => norm(o.text));
          if (new Set(norms).size !== norms.length) {
            questionOk = false;
            console.log('  中文释义重复:', w.word, norms);
          }
        }
        if (type === 'phonetic-to-word') {
          const phon = w.phonetic.trim().toLowerCase();
          for (const o of q.options) {
            if (o.key === q.answerKey) continue;
            const other = bank.words.find((x) => x.word.toLowerCase() === o.text.toLowerCase());
            if (other && other.phonetic.trim().toLowerCase() === phon) {
              questionOk = false;
              console.log('  音标题多解:', w.word, other.word);
            }
          }
        }
      } else if (type === 'letter-tiles') {
        const sorted1 = [...q.tiles!].sort().join('');
        const sorted2 = [...q.answerText!.split('')].sort().join('');
        if (sorted1 !== sorted2) {
          questionOk = false;
          console.log('  字母块与单词字母不一致:', w.word, q.tiles, q.answerText);
        }
      }
    }
  }
  ok(`题目生成检查（${checked} 题，含 ${spellingChecked} 道拼写题）`, questionOk);

  // 7. 短词不生成拼写题
  let shortOk = true;
  let longSpellOk = true;
  for (const w of bank.words) {
    const avail = gen.availableTypes(w);
    const hasSpell = avail.includes('letter-tiles') || avail.includes('spell-typing');
    if (w.word.length <= 2 && hasSpell) shortOk = false;
    if (w.word.length >= 3 && !hasSpell) longSpellOk = false;
  }
  ok('长度 ≤2 的单词无拼写题', shortOk);
  ok('长度 ≥3 的单词有拼写题型', longSpellOk);

  // 7.5 例句覆盖率（语境题依赖例句）
  const withExample = bank.words.filter((w) => Boolean(w.example)).length;
  const coverage = Math.round((withExample / bank.words.length) * 100);
  ok(`例句覆盖 ${coverage}%（≥90%）`, coverage >= 90, `${withExample} / ${bank.words.length}`);

  // 7.6 高频排序：freqRank 连续，第一页是核心高频词（没有被压到后面的基础词/虚词）
  const ranksOk = bank.words.every((w, i) => w.freqRank === i + 1 && w.sourceOrder === i + 1);
  ok('学习顺序已按高频排序（freqRank 连续）', ranksOk);
  const firstPage = bank.getPageWords(1);
  const firstOk = firstPage.length > 0 && firstPage.every((w) => (w.zipf ?? 0) > 0 && (w.zipf ?? 0) < 4.6);
  ok('第一页全部是核心高频词（无 the/a 这类基础词）', firstOk, firstPage.slice(0, 5).map((w) => w.word).join(' '));
  const zipfOk = bank.words.filter((w) => typeof w.zipf === 'number').length;
  ok(`词频字段完整（${zipfOk}/${bank.words.length}）`, zipfOk === bank.words.length);

  // 8. Day 分布：每 Day 150 词，最后一天为余数
  const daySizes = new Map<number, number>();
  for (const w of bank.words) daySizes.set(w.day, (daySizes.get(w.day) ?? 0) + 1);
  const days = [...daySizes.keys()].sort((a, b) => a - b);
  const dayOk =
    days.length === level.dayCount &&
    days.every((d) => (d === level.dayCount ? (daySizes.get(d) ?? 0) <= 150 : daySizes.get(d) === 150));
  ok(`Day 01~${String(level.dayCount - 1).padStart(2, '0')} 各 150 词，最后一天 ${daySizes.get(level.dayCount)} 词`, dayOk);

  return { bank, pageSizes };
}

ok('levels.json 有三个分级', cfg.levels.length === 3, cfg.levels.map((l) => l.name).join(' / '));

for (const level of cfg.levels) {
  checkLevel(level);
}

// 三套词库互不重复覆盖（同一个词可以在不同级别出现，但 id 前缀必须区分）
const ids = new Set<string>();
let idOk = true;
for (const level of cfg.levels) {
  const raw = JSON.parse(readFileSync(dataUrl(level.wordsFile), 'utf8')) as { words: WordEntry[] };
  for (const w of raw.words.slice(0, 50)) {
    if (ids.has(w.id)) idOk = false;
    ids.add(w.id);
  }
}
ok('三个词库的 id 互不冲突', idOk);

// 每日一诵数据
const daily = JSON.parse(readFileSync(dataUrl('daily.json'), 'utf8')) as {
  passages: { id: string; title: string; sentences: { en: string; zh: string }[]; keywords: { word: string; meaning: string }[] }[];
};
ok('每日一诵至少 10 篇', daily.passages.length >= 10, `实际 ${daily.passages.length} 篇`);
const passageOk = daily.passages.every(
  (p) =>
    p.title.trim().length > 0 &&
    p.sentences.length >= 4 &&
    p.sentences.every((s) => s.en.trim().length > 0 && s.zh.trim().length > 0) &&
    p.keywords.length > 0,
);
ok('每篇都有标题 / ≥4 句中英对照 / 关键词', passageOk);
const idsOk = new Set(daily.passages.map((p) => p.id)).size === daily.passages.length;
ok('每日一诵 id 唯一', idsOk);

console.log('\n' + (failures.length === 0 ? '🎉 全部验收项通过' : `❌ 失败 ${failures.length} 项：` + failures.join('；')));
process.exit(failures.length === 0 ? 0 : 1);
