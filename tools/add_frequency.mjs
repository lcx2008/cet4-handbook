/**
 * 把三套词库按「高频优先」重排（一次性数据脚本）。
 *
 * 词频：wordfreq（多语料合成，en_zipf.tsv，值越大越常见，0 = 语料里没有）
 * 顺序：高频核心词（最常用的一批除外）→ 生僻词 → 专有名词 → 基础词 → 虚词/功能词
 *
 * 为什么把 the / a / of / know 这类词放最后：
 *   它们虽然是全语料最高频，但对备考背单词没有价值；真正的学习价值在 4.0~4.6 这一段。
 *   基础词放在最后，想快速过一遍的人可以当复习。
 *
 * 每个词保留原 id，所以已有学习进度（按 id 存）不受影响。
 *
 * 用法：node tools/add_frequency.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const DATA = path.join(ROOT, 'public', 'data');
const PER_DAY = 150;
const PAGE_SIZE = 10;
/** zipf ≥ 4.6 视为「基础词」，排到最后 */
const BASIC_ZIPF = 4.6;

/** 语法功能词：对背单词没有学习价值 */
const STOPWORDS = new Set(
  `a an the and or but if then than that this these those of to in on at by for from with about into over after before under between during without within
   i you he she it we they me him her us them my your his its our their mine yours whose which who whom what when where why how
   is am are was were be been being do does did done have has has had having will would shall should can could may might must
   not no yes so as such very too also just only even still yet again ever never always often sometimes usually
   there here up down out off above below near far more most less least many much some any all both each every few little
   one two three four five six seven eight nine ten first second third next last other another same own
   please thanks thank hello hi hey ok okay well now thus hence however therefore because although though while whereas
   mr mrs ms dr etc eg ie vs per via`
    .split(/\s+/)
    .filter(Boolean),
);

function loadZipf() {
  const file = path.join(ROOT, 'tools', 'freq', 'en_zipf.tsv');
  const map = new Map();
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const [w, z] = line.split('\t');
    if (w) map.set(w, Number(z) || 0);
  }
  return map;
}

function keyOf(word) {
  return word
    .toLowerCase()
    .replace(/[^a-z'-]/g, '')
    .replace(/^[-']+|[-']+$/g, '');
}

const zipfMap = loadZipf();
console.log('词频表词条：', zipfMap.size);

for (const level of ['cet3', 'cet4', 'cet6']) {
  const file = path.join(DATA, `${level}_words.json`);
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const words = raw.words;

  for (const w of words) {
    const key = keyOf(w.word);
    const zipf = zipfMap.get(key) ?? 0;
    w.zipf = zipf;
    const proper = /^[A-Z]/.test(w.word) && w.word !== 'I';
    if (STOPWORDS.has(key)) w._tier = 5;
    else if (proper) w._tier = 3;
    else if (zipf <= 0) w._tier = 2;
    else if (zipf >= BASIC_ZIPF) w._tier = 4;
    else w._tier = 1;
  }

  words.sort((a, b) => {
    if (a._tier !== b._tier) return a._tier - b._tier;
    if (a._tier === 1 || a._tier === 4) {
      if (b.zipf !== a.zipf) return b.zipf - a.zipf;
    }
    return a.word.localeCompare(b.word, 'en');
  });

  // 重新编号：保持每 Day 150 词、每页 10 词的结构
  const total = words.length;
  const dayCount = Math.ceil(total / PER_DAY);
  let page = 0;
  for (let day = 1; day <= dayCount; day++) {
    const start = (day - 1) * PER_DAY;
    const end = Math.min(total, day * PER_DAY);
    for (let j = 0; j < end - start; j++) {
      const idx = start + j;
      const w = words[idx];
      const pageInDay = Math.floor(j / PAGE_SIZE) + 1;
      w.sourceOrder = idx + 1;
      w.freqRank = idx + 1;
      w.day = day;
      w.dayLabel = `Day ${String(day).padStart(2, '0')}`;
      w.pageInDay = pageInDay;
      w.globalPage = page + pageInDay;
      delete w._tier;
    }
    page += Math.ceil((end - start) / PAGE_SIZE);
  }

  raw.order = 'frequency';
  raw.orderVersion = 2;
  raw.freqSource = 'wordfreq 多语料词频（zipf）';
  raw.pageCount = page;
  raw.dayCount = dayCount;
  raw.coreWords = words.filter((w) => w.freqRank > 0 && w.zipf > 0 && w.zipf < BASIC_ZIPF).length;
  raw.basicWords = words.filter((w) => w.zipf >= BASIC_ZIPF).length;

  fs.writeFileSync(file, JSON.stringify(raw), 'utf8');
  console.log(
    `${level}: ${total} 词 / ${page} 页 / 核心 ${raw.coreWords} / 基础 ${raw.basicWords}`,
  );
  console.log(`   开头：${words.slice(0, 14).map((w) => w.word).join(' ')}`);
  console.log(`   结尾：${words.slice(-8).map((w) => w.word).join(' ')}`);
}
