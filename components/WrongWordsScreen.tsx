import { useMemo, useState } from 'react';
import { bumpStoreVersion, useApp, useStoreVersion } from '../state/AppContext';
import { useRoute } from '../router';
import { BottomNav, PosBadge, TopBar } from './shared';
import { audio } from '../core/audioFeedback';
import { ReviewScheduler } from '../core/reviewScheduler';

type SortKey = 'day' | 'wrongs' | 'recent';
type Mode = 'wrong' | 'starred';

/** 错词复习的虚拟单元 id（不在 523 个常规单元里） */
export const WRONG_UNIT_ID = 'W001';

export default function WrongWordsScreen() {
  const { store, bank } = useApp();
  // store 是可变对象，同一个实例里改字段不会换引用；把版本号带进 useMemo 依赖，
  // 否则取消收藏后列表和角标都不刷新（2.8.0 修）
  const ver = useStoreVersion();
  const [, navigate] = useRoute();
  const [mode, setMode] = useState<Mode>('wrong');
  const [sort, setSort] = useState<SortKey>('recent');
  const [flipped, setFlipped] = useState<Set<string>>(new Set());

  const scheduler = useMemo(() => new ReviewScheduler(bank, store), [bank, store]);
  const wrongWords = useMemo(() => scheduler.historicalWrongWords(), [scheduler]);

  /** 收藏的词：手动标的，跟错词是两个池子 */
  const starredWords = useMemo(() => {
    const ids = store.starredIds();
    return ids
      .map((id) => ({ id, word: bank.getById(id), at: store.peekWordProgress(id)?.starredAt ?? 0 }))
      .filter((x) => x.word)
      .sort((a, b) => b.at - a.at);
  }, [bank, store, ver]);

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
  }, [wrongWords, sort, store, ver]);

  const toggle = (id: string) => {
    audio.flip();
    setFlipped((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleStar = (id: string) => {
    audio.click();
    store.toggleStar(id);
    bumpStoreVersion();
  };

  const startWrongReview = () => {
    if (wrongWords.length === 0) return;
    audio.click();
    navigate({ name: 'quiz', unitId: WRONG_UNIT_ID });
  };

  const isStarred = mode === 'starred';

  return (
    <>
      <TopBar
        title="📎 折角错词"
        backTo={{ name: 'home' }}
        right={
          !isStarred && wrongWords.length > 0 ? (
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
        <div className="sort-row" role="tablist" aria-label="错词与收藏">
          <button
            className={`chip${mode === 'wrong' ? ' selected' : ''}`}
            role="tab"
            aria-selected={mode === 'wrong'}
            onClick={() => {
              audio.click();
              setMode('wrong');
            }}
          >
            📎 错词 {wrongWords.length}
          </button>
          <button
            className={`chip${mode === 'starred' ? ' selected' : ''}`}
            role="tab"
            aria-selected={mode === 'starred'}
            onClick={() => {
              audio.click();
              setMode('starred');
            }}
          >
            ⭐ 收藏 {starredWords.length}
          </button>
        </div>

        {isStarred ? (
          starredWords.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: 40 }}>
              <p style={{ fontSize: 40, margin: 0 }}>⭐</p>
              <p className="progress-note">还没收藏单词。词卡或词条页点右上角 ⭐ 就能收进来。</p>
            </div>
          ) : (
            starredWords.map(({ id, word }) => {
              const w = word!;
              const isFlipped = flipped.has(id);
              return (
                <div
                  key={id}
                  className="wrong-card starred-card"
                  role="button"
                  tabIndex={0}
                  onClick={() => toggle(id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      toggle(id);
                    }
                  }}
                  aria-expanded={isFlipped}
                >
                  <button
                    className="star-toggle"
                    aria-label="取消收藏"
                    title="点一下取消收藏"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleStar(id);
                    }}
                  >
                    ⭐
                  </button>
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
                      {w.meaningEn && (
                        <span className="wc-meaning-en" style={{ display: 'block', marginTop: 6 }}>
                          {w.meaningEn}
                        </span>
                      )}
                    </span>
                  )}
                </div>
              );
            })
          )
        ) : wrongWords.length === 0 ? (
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
                      {w.meaningEn && (
                        <span className="wc-meaning-en" style={{ display: 'block', marginTop: 6 }}>
                          {w.meaningEn}
                        </span>
                      )}
                      <span
                        role="button"
                        tabIndex={0}
                        className="star-inline"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleStar(w.id);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.stopPropagation();
                            toggleStar(w.id);
                          }
                        }}
                      >
                        {wp.starred ? '⭐ 取消收藏' : '☆ 收藏'}
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
