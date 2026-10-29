import { useMemo, useState } from 'react';
import { useApp, useStoreVersion } from '../state/AppContext';
import { useRoute } from '../router';
import { BottomNav, PosBadge, TopBar } from './shared';
import { audio } from '../core/audioFeedback';
import { ReviewScheduler } from '../core/reviewScheduler';

type SortKey = 'day' | 'wrongs' | 'recent';

/** 错词复习的虚拟单元 id（不在 523 个常规单元里） */
export const WRONG_UNIT_ID = 'W001';

export default function WrongWordsScreen() {
  const { store, bank } = useApp();
  useStoreVersion();
  const [, navigate] = useRoute();
  const [sort, setSort] = useState<SortKey>('recent');
  const [flipped, setFlipped] = useState<Set<string>>(new Set());

  const scheduler = useMemo(() => new ReviewScheduler(bank, store), [bank, store]);
  const wrongWords = useMemo(() => scheduler.historicalWrongWords(), [scheduler]);

  const sorted = useMemo(() => {
    const list = [...wrongWords];
    switch (sort) {
      case 'day':
        return list.sort((a, b) => a.day - b.day || a.sourceOrder - b.sourceOrder);
      case 'wrongs':
        return list.sort(
          (a, b) => store.getWordProgress(b.id).wrongCount - store.getWordProgress(a.id).wrongCount,
        );
      case 'recent':
      default:
        return list.sort(
          (a, b) =>
            (store.getWordProgress(b.id).lastWrongAt ?? 0) - (store.getWordProgress(a.id).lastWrongAt ?? 0),
        );
    }
  }, [wrongWords, sort, store]);

  const toggle = (id: string) => {
    audio.flip();
    setFlipped((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const startWrongReview = () => {
    if (wrongWords.length === 0) return;
    audio.click();
    navigate({ name: 'quiz', unitId: WRONG_UNIT_ID });
  };

  return (
    <>
      <TopBar
        title="📎 折角错词"
        backTo={{ name: 'home' }}
        right={
          wrongWords.length > 0 ? (
            <button
              className="btn btn-warm"
              style={{ minHeight: 40, padding: '6px 14px', fontSize: 14 }}
              onClick={startWrongReview}
            >
              生成一组错词复习
            </button>
          ) : undefined
        }
      />
      <main className="screen">
        <div className="card">
          <p className="progress-note">
            共 <strong>{wrongWords.length}</strong> 个错词在折角页里。跨单元连续答对 2 次后会移出。
          </p>
        </div>

        {wrongWords.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: 40 }}>
            <p style={{ fontSize: 40, margin: 0 }}>🎉</p>
            <p className="progress-note">目前没有折角错词，继续保持！</p>
          </div>
        ) : (
          <>
            <div className="sort-row" role="group" aria-label="排序方式">
              {(
                [
                  ['recent', '最近错'],
                  ['wrongs', '错得多'],
                  ['day', '按 Day'],
                ] as [SortKey, string][]
              ).map(([key, label]) => (
                <button
                  key={key}
                  className={`chip${sort === key ? ' selected' : ''}`}
                  onClick={() => setSort(key)}
                  aria-pressed={sort === key}
                >
                  {label}
                </button>
              ))}
            </div>
            {sorted.map((w) => {
              const wp = store.getWordProgress(w.id);
              const isFlipped = flipped.has(w.id);
              return (
                <button
                  key={w.id}
                  className="wrong-card dog-ear"
                  onClick={() => toggle(w.id)}
                  aria-expanded={isFlipped}
                >
                  <span className="wrong-count">错 {wp.wrongCount} 次</span>
                  <span className="wc-front">
                    <span className="wc-word">{w.word}</span>
                    <span className="wc-phonetic">{w.phonetic}</span>
                  </span>
                  <span className="wc-hint">第 {w.globalPage} 页 · 点击翻面</span>
                  {isFlipped && (
                    <span className="wc-back" style={{ display: 'block', marginTop: 10 }}>
                      <PosBadge pos={w.partOfSpeech} />
                      <span className="wc-meaning" style={{ display: 'block' }}>
                        {w.meaning}
                      </span>
                    </span>
                  )}
                </button>
              );
            })}
          </>
        )}
      </main>
      <BottomNav active="wrong" />
    </>
  );
}
