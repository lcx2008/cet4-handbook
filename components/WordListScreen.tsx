import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp, useStoreVersion } from '../state/AppContext';
import { useRoute } from '../router';
import { BottomNav, PosBadge, TopBar, statusLabel } from './shared';
import { buildWordCsv, downloadText } from '../core/wordExport';
import { audio } from '../core/audioFeedback';
import type { WordEntry, WordStatus } from '../types';

const ROW_HEIGHT = 48;
const OVERSCAN = 6;
const PAGE_BLOCK = 50;

type StatusFilter = 'all' | WordStatus | 'wrong';
type LetterFilter = string | 'all';

export default function WordListScreen() {
  const { store, bank, level } = useApp();
  useStoreVersion();
  const [, navigate] = useRoute();

  const [query, setQuery] = useState('');
  const [statusF, setStatusF] = useState<StatusFilter>('all');
  const [pageF, setPageF] = useState<number>(-1); // -1 = 全部
  const [letterF, setLetterF] = useState<LetterFilter>('all');
  const [scrollTop, setScrollTop] = useState(0);
  const [openWord, setOpenWord] = useState<WordEntry | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);

  const pageBlocks = useMemo(() => {
    const out: { from: number; to: number }[] = [];
    for (let p = 1; p <= bank.pageCount; p += PAGE_BLOCK) {
      out.push({ from: p, to: Math.min(bank.pageCount, p + PAGE_BLOCK - 1) });
    }
    return out;
  }, [bank.pageCount]);

  const filtered = useMemo(() => {
    let list: WordEntry[];
    if (query.trim()) {
      list = bank.search(query);
    } else {
      list = bank.words;
    }
    if (statusF !== 'all') {
      list = list.filter((w) => {
        // 只读：总表会遍历全库，不能因为看一眼就把进度记录写出来
        const wp = store.peekWordProgress(w.id);
        if (statusF === 'wrong') return Boolean(wp && (wp.wrongCount > 0 || wp.inWrongPool));
        return (wp?.status ?? 'unlearned') === statusF;
      });
    }
    if (pageF >= 0 && pageBlocks[pageF]) {
      const { from, to } = pageBlocks[pageF];
      list = list.filter((w) => w.globalPage >= from && w.globalPage <= to);
    }
    if (letterF !== 'all') list = list.filter((w) => w.word.toLowerCase().startsWith(letterF));
    return list;
  }, [bank, store, query, statusF, pageF, letterF, pageBlocks]);

  const viewportH = 480;
  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const end = Math.min(filtered.length, Math.ceil((scrollTop + viewportH) / ROW_HEIGHT) + OVERSCAN);
  const visible = filtered.slice(start, end);

  const onScroll = useCallback(() => {
    if (viewportRef.current) setScrollTop(viewportRef.current.scrollTop);
  }, []);

  // 搜索/筛选变化时回到顶部
  useEffect(() => {
    if (viewportRef.current) viewportRef.current.scrollTop = 0;
    setScrollTop(0);
  }, [query, statusF, pageF, letterF]);

  // 搜到唯一一个词时，直接弹大词卡（每个关键词只自动弹一次，关掉不会再弹）
  const autoOpenedRef = useRef('');
  useEffect(() => {
    if (!query.trim() || filtered.length !== 1) return;
    if (autoOpenedRef.current === query) return;
    autoOpenedRef.current = query;
    const t = window.setTimeout(() => setOpenWord(filtered[0]), 260);
    return () => window.clearTimeout(t);
  }, [query, filtered]);

  const letters = useMemo(() => {
    const set = new Set(bank.words.map((w) => w.word[0].toLowerCase()));
    return [...set].sort();
  }, [bank]);

  const openWordStatus = openWord ? store.peekWordProgress(openWord.id)?.status ?? 'unlearned' : 'unlearned';

  return (
    <>
      <TopBar title="📇 单词总表" backTo={{ name: 'home' }} />
      <main className="screen">
        <div className="wordlist-toolbar">
          <div className="search-box">
            <span className="search-icon" aria-hidden="true">
              🔍
            </span>
            <input
              type="search"
              placeholder="搜英文单词或中文释义…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && filtered.length > 0) {
                  e.preventDefault();
                  setOpenWord(filtered[0]);
                }
              }}
              aria-label="搜索单词或释义"
            />
          </div>
          <div className="filter-chips" role="group" aria-label="状态筛选">
            {(
              [
                ['all', '全部'],
                ['unlearned', '未学习'],
                ['learning', '学习中'],
                ['reviewing', '复习中'],
                ['mastered', '已掌握'],
                ['wrong', '错词'],
              ] as [StatusFilter, string][]
            ).map(([key, label]) => (
              <button
                key={key}
                className={`filter-chip${statusF === key ? ' selected' : ''}`}
                onClick={() => setStatusF(key)}
                aria-pressed={statusF === key}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="filter-chips" role="group" aria-label="按页筛选">
            <button
              className={`filter-chip${pageF === -1 ? ' selected' : ''}`}
              onClick={() => setPageF(-1)}
              aria-pressed={pageF === -1}
            >
              全部页
            </button>
            {pageBlocks.map((b, i) => (
              <button
                key={b.from}
                className={`filter-chip${pageF === i ? ' selected' : ''}`}
                onClick={() => setPageF(i)}
                aria-pressed={pageF === i}
              >
                第{b.from}–{b.to}页
              </button>
            ))}
          </div>
          <div className="letter-strip" role="group" aria-label="首字母筛选">
            <button
              className={`letter-chip${letterF === 'all' ? ' selected' : ''}`}
              onClick={() => setLetterF('all')}
              aria-pressed={letterF === 'all'}
            >
              全
            </button>
            {letters.map((l) => (
              <button
                key={l}
                className={`letter-chip${letterF === l ? ' selected' : ''}`}
                onClick={() => setLetterF(l)}
                aria-pressed={letterF === l}
              >
                {l.toUpperCase()}
              </button>
            ))}
          </div>
          <p className="wordlist-count">共 {filtered.length} 个词条</p>
          <button
            className="btn btn-plain wl-export"
            onClick={() => {
              const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
              downloadText(buildWordCsv(bank.words, store), `单词手账-${level.name}词表-${date}.csv`, 'text/csv;charset=utf-8');
            }}
          >
            📄 导出词表（CSV）
          </button>
        </div>

        <div
          className="wordlist-viewport"
          ref={viewportRef}
          onScroll={onScroll}
          role="list"
          aria-label="词条列表"
        >
          {filtered.length === 0 ? (
            <div className="wl-empty">没有符合条件的词条</div>
          ) : (
            <div className="wordlist-inner" style={{ height: filtered.length * ROW_HEIGHT }}>
              {visible.map((w, i) => {
                const wp = store.peekWordProgress(w.id);
                const status = wp?.status ?? 'unlearned';
                const top = (start + i) * ROW_HEIGHT;
                return (
                  <button
                    key={w.id}
                    className="wl-row"
                    style={{ top, height: ROW_HEIGHT }}
                    onClick={() => {
                      audio.click();
                      setOpenWord(w);
                    }}
                    role="listitem"
                    aria-label={`${w.word}，查看词卡`}
                  >
                    <span className="wl-word">{w.word}</span>
                    <span className="wl-meaning">{w.meaning}</span>
                    <span className="wl-status">
                      <span className={`status-dot ${status}`} aria-hidden="true" />
                      {statusLabel(status)}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </main>

      {openWord && (
        <div className="modal-mask" role="dialog" aria-modal="true" aria-labelledby="word-card-title" onClick={() => setOpenWord(null)}>
          <div className="modal-card word-modal" onClick={(e) => e.stopPropagation()}>
            <p className="word-modal-word" id="word-card-title">
              {openWord.word}
              <button
                className="q-speak-btn"
                onClick={() => audio.speak(openWord.word)}
                aria-label={`朗读 ${openWord.word}`}
              >
                🔊
              </button>
            </p>
            <p className="word-modal-phonetic">{openWord.phonetic}</p>
            <div className="word-modal-meta">
              <PosBadge pos={openWord.partOfSpeech} />
              <span className="status-pill">{statusLabel(openWordStatus)}</span>
              <span className="progress-note" style={{ marginLeft: 'auto' }}>
                第 {openWord.globalPage} 页
              </span>
            </div>
            <p className="word-modal-meaning">{openWord.meaning}</p>
            {openWord.example && (
              <div className="word-modal-example">
                <p className="recite-en">{openWord.example}</p>
                {openWord.exampleTranslation && <p className="recite-zh">{openWord.exampleTranslation}</p>}
                <button className="btn btn-plain" onClick={() => audio.speak(openWord.example)}>
                  🔊 听例句
                </button>
              </div>
            )}
            <div className="modal-actions">
              <button className="btn btn-plain" onClick={() => setOpenWord(null)}>
                关闭
              </button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  const id = openWord.id;
                  setOpenWord(null);
                  navigate({ name: 'word', wordId: id });
                }}
              >
                查看完整词条
              </button>
            </div>
          </div>
        </div>
      )}

      <BottomNav active="words" />
    </>
  );
}
