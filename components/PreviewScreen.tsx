import { useMemo, useState } from 'react';
import { useApp, useStoreVersion, bumpStoreVersion } from '../state/AppContext';
import { useRoute } from '../router';
import { BinderHoles, PosBadge, Tape, TopBar } from './shared';
import { audio } from '../core/audioFeedback';

export default function PreviewScreen({ unitId }: { unitId: string }) {
  const { store, units, bank, level } = useApp();
  useStoreVersion();
  const [, navigate] = useRoute();

  const unit = units.find((u) => u.id === unitId);
  const words = useMemo(
    () => (unit?.kind === 'new' && unit.globalPage ? bank.getPageWords(unit.globalPage) : []),
    [unit, bank],
  );

  const [flipped, setFlipped] = useState<Set<string>>(new Set());
  const [started, setStarted] = useState(false);

  if (!unit || unit.kind !== 'new') {
    return (
      <div className="screen">
        <p className="load-hint">该页面不存在。</p>
        <button className="btn btn-primary" onClick={() => navigate({ name: 'directory' })}>
          返回目录
        </button>
      </div>
    );
  }

  const toggle = (id: string) => {
    audio.flip();
    setFlipped((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const startQuiz = () => {
    // 进入预览即标记学习中
    for (const w of words) store.markLearned(w.id);
    store.save();
    bumpStoreVersion();
    setStarted(true);
    audio.click();
    navigate({ name: 'quiz', unitId });
  };

  return (
    <>
      <TopBar title={unit.label} backTo={{ name: 'directory', day: unit.day }} />
      <main className="screen">
        <div className="card" style={{ position: 'relative', paddingTop: 22 }}>
          <BinderHoles />
          <Tape className="tape-mint" style={{ top: -13, left: '42%', width: 88, transform: 'rotate(2deg)' }} />
          <p className="card-title" style={{ margin: '6px 0 4px' }}>
            👀 先翻一翻本页单词
            <span className="quiz-level-chip" style={{ marginLeft: 8 }}>
              {level.badge} · {level.name}
            </span>
          </p>
          <p className="progress-note">点卡片翻面看释义，翻完再开始答题</p>
        </div>

        <div className="preview-list">
          {words.map((w) => {
            const isFlipped = flipped.has(w.id);
            return (
              <button
                key={w.id}
                className={`word-card${isFlipped ? ' flipped dog-ear' : ''}`}
                onClick={() => toggle(w.id)}
                aria-expanded={isFlipped}
                aria-label={`${w.word}，点击${isFlipped ? '翻回' : '翻面看释义'}`}
              >
                {isFlipped ? (
                  <div className="wc-back">
                    <div>
                      <PosBadge pos={w.partOfSpeech} />
                      <span
                        className="wc-speak"
                        role="button"
                        tabIndex={0}
                        aria-label={`朗读 ${w.word}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          audio.speak(w.word);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            e.stopPropagation();
                            audio.speak(w.word);
                          }
                        }}
                      >
                        🔊
                      </span>
                    </div>
                    <div className="wc-meaning">{w.meaning}</div>
                    {w.example ? (
                      <div className="wc-meaning" style={{ fontSize: 14, color: 'var(--ink-soft)' }}>
                        e.g. {w.example}
                        {w.exampleTranslation ? `（${w.exampleTranslation}）` : ''}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div>
                    <div className="wc-front">
                      <span className="wc-word">{w.word}</span>
                      <span className="wc-phonetic">{w.phonetic}</span>
                      <span
                        className="wc-speak"
                        role="button"
                        tabIndex={0}
                        aria-label={`朗读 ${w.word}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          audio.speak(w.word);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            e.stopPropagation();
                            audio.speak(w.word);
                          }
                        }}
                      >
                        🔊
                      </span>
                    </div>
                    <div className="wc-hint">👆 点我翻面</div>
                  </div>
                )}
              </button>
            );
          })}
        </div>

        <div style={{ marginTop: 20 }}>
          <button className="btn btn-primary" style={{ width: '100%' }} onClick={startQuiz} disabled={started}>
            {started ? '准备中……' : '✏️ 开始答题'}
          </button>
        </div>
      </main>
    </>
  );
}
