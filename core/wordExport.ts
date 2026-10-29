import type { WordEntry, WordStatus } from '../types';
import type { ProgressStore } from './progressStore';

const STATUS_TEXT: Record<WordStatus, string> = {
  unlearned: '未学习',
  learning: '学习中',
  reviewing: '复习中',
  mastered: '已掌握',
};

function csvCell(value: string | number | null | undefined): string {
  const s = String(value ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * 把当前词库导出成 CSV（带 BOM，Excel / WPS 直接打开不乱码）。
 * 只导词表本身，不含学习进度；进度用「导出进度」。
 */
export function buildWordCsv(words: WordEntry[], store?: ProgressStore): string {
  const head = ['单词', '音标', '词性', '释义', '例句', '例句翻译', 'Day', '词页', '学习顺序', '常用度', '状态'];
  const rows = words.map((w) => {
    const status = store ? STATUS_TEXT[store.peekWordProgress(w.id)?.status ?? 'unlearned'] : '';
    return [w.word, w.phonetic, w.partOfSpeech, w.meaning, w.example, w.exampleTranslation, w.day, w.globalPage, w.freqRank ?? '', w.zipf ?? '', status]
      .map(csvCell)
      .join(',');
  });
  return `\uFEFF${head.join(',')}\n${rows.join('\n')}`;
}

export function downloadText(text: string, filename: string, mime = 'text/plain;charset=utf-8'): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
