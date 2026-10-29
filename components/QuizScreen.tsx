import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp, useStoreVersion, bumpStoreVersion } from '../state/AppContext';
import { useRoute } from '../router';
import { Tape, TopBar } from './shared';
import { DUE_REVIEW_UNIT, QuizPlanner, WRONG_REVIEW_UNIT, clearPlan, getOrCreatePlan } from '../core/quizSession';
import type { Question, QuestionStage, QuestionType, SpellingMode, UnitDef } from '../types';
import { audio } from '../core/audioFeedback';

type Feedback =
  | { kind: 'none' }
  | { kind: 'correct'; question: Question; chosen: string | null }
  | { kind: 'wrong'; question: Question; chosen: string | null };

const STAGE_TAG: Record<QuestionStage, string> = {
  'meaning-en': '① 英译中',
  'meaning-cn': '② 中译英',
  context: '③ 语境填空',
  spelling: '④ 拼写',
};

function shuffleLetters(text: string): string[] {
  const a = text.split('');
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  if (a.join('') === text && a.length > 1) {
    const t = a[0];
    a[0] = a[1];
    a[1] = t;
  }
  return a;
}

export default function QuizScreen({ unitId }: { unitId: string }) {
  const { store, units, bank, level } = useApp();
  useStoreVersion();
  const [, navigate] = useRoute();

  const mode: SpellingMode = store.settings.spellingMode ?? 'tiles';

  const unit: UnitDef | undefined =
    units.find((u) => u.id === unitId) ??
    (unitId === WRONG_REVIEW_UNIT.id ? WRONG_REVIEW_UNIT : undefined) ??
    (unitId === DUE_REVIEW_UNIT.id ? DUE_REVIEW_UNIT : undefined);

  // 会话缓存：同一局来回切页面 / 改完设置回来，都接着上次的进度，不重新出题
  const plan = unit ? getOrCreatePlan(bank, store, unit) : null;

  const [current, setCurrent] = useState<Question | null>(() => plan?.queue[0] ?? null);
  const [feedback, setFeedback] = useState<Feedback>({ kind: 'none' });
  const [tilesPicked, setTilesPicked] = useState<number[]>([]);
  const [typed, setTyped] = useState('');
  const [hintExcluded, setHintExcluded] = useState<string | null>(null);
  const [speakHint, setSpeakHint] = useState<string | null>(null);

  useEffect(() => {
    const onFail = () => setSpeakHint('在线发音也没播放成功：先检查网络，或按设置页「🗣️ 单词朗读」里的方法装英文语音包');
    window.addEventListener('dsh-speak-failed', onFail);
    return () => window.removeEventListener('dsh-speak-failed', onFail);
  }, []);
  const [renderedCount, setRenderedCount] = useState(0);
  const doneRef = useRef(false);
  /** 拼写题现场生成的字母块（缓存，避免重渲染时乱序跳动） */
  const tilesCache = useRef(new Map<string, string[]>());

  const totalPlanned = useMemo(
    () => (plan ? plan.answered.length + plan.queue.length : 0),
    [plan, renderedCount],
  );

  if (!unit || !plan) {
    return (
      <div className="screen">
        <p className="load-hint">该学习单元不存在。</p>
        <button className="btn btn-primary" onClick={() => navigate({ name: 'directory' })}>
          返回目录
        </button>
      </div>
    );
  }

  /** 实际渲染用的题型：拼写阶段跟随设置实时变化 */
  const eff = (q: Question | null): QuestionType | null => {
    if (!q) return null;
    if (q.stage !== 'spelling') return q.type;
    if (mode === 'typing') return 'spell-typing';
    if (mode === 'tiles') return 'letter-tiles';
    return q.type; // mixed：保持开局抽到的类型
  };

  const lettersFor = (q: Question): string[] => {
    if (q.tiles && q.tiles.length) return q.tiles;
    const hit = tilesCache.current.get(q.qid);
    if (hit) return hit;
    const fresh = shuffleLetters(q.answerText ?? '');
    tilesCache.current.set(q.qid, fresh);
    return fresh;
  };

  const progressPct = totalPlanned > 0 ? Math.round((plan.answered.length / totalPlanned) * 100) : 0;

  const speakWord = () => {
    if (!current) return;
    const r = audio.speak(current.prompt.word);
    if (r === 'no-voice') setSpeakHint('这台设备没有英文语音包，读不出单词。设置页「🗣️ 单词朗读」里有各浏览器的解决办法');
    else if (r === 'unsupported') setSpeakHint('当前浏览器不支持语音朗读');
    else if (r === 'off') setSpeakHint('单词朗读被关掉了，去设置里打开');
    else setSpeakHint(null);
  };

  const speakFeedback = () => {
    if (feedback.kind !== 'none') audio.speak(feedback.question.prompt.word);
  };

  const showFeedback = (q: Question, chosen: string | null, isCorrect: boolean) => {
    if (isCorrect) {
      audio.correct();
      setFeedback({ kind: 'correct', question: q, chosen });
    } else {
      audio.wrong();
      setFeedback({ kind: 'wrong', question: q, chosen });
    }
    setRenderedCount((c) => c + 1);
  };

  /** 选择题作答 */
  const answerOption = (key: string) => {
    if (!current || feedback.kind !== 'none' || !current.options) return;
    const q = current;
    const correct = key === current.answerKey;
    QuizPlanner.recordAnswer(bank, store, plan, q, key);
    showFeedback(q, key, correct);
  };

  /** 自由拼写：键盘输入提交 */
  const submitTyping = () => {
    if (!current || feedback.kind !== 'none' || eff(current) !== 'spell-typing') return;
    const answer = typed.trim();
    if (!answer) return;
    const q = current;
    const isCorrect = answer.toLowerCase() === (q.answerText ?? '').toLowerCase();
    QuizPlanner.recordAnswer(bank, store, plan, q, answer);
    showFeedback(q, answer, isCorrect);
  };

  /** 字母贴纸：点击字母块 */
  const pickTile = (tileIndex: number) => {
    if (!current || feedback.kind !== 'none' || eff(current) !== 'letter-tiles') return;
    audio.click();
    const tiles = lettersFor(current);
    setTilesPicked((prev) => {
      if (prev.includes(tileIndex)) return prev;
      const next = [...prev, tileIndex];
      const word = current.answerText ?? '';
      if (next.length === word.length) {
        const chosenStr = next.map((i) => tiles[i]).join('');
        const isCorrect = chosenStr.toLowerCase() === word.toLowerCase();
        QuizPlanner.recordAnswer(bank, store, plan, current, chosenStr);
        showFeedback(current, chosenStr, isCorrect);
      }
      return next;
    });
  };

  const unpickTile = (tileIndex: number) => {
    if (!current || feedback.kind !== 'none') return;
    setTilesPicked((prev) => prev.filter((i) => i !== tileIndex));
  };

  const useHint = () => {
    if (!current || !current.options || plan.hintUsed || feedback.kind !== 'none') return;
    const wrongKeys = current.options.filter((o) => o.key !== current.answerKey).map((o) => o.key);
    const toExclude = wrongKeys[Math.floor(Math.random() * wrongKeys.length)];
    setHintExcluded(toExclude);
    plan.hintUsed = true;
    audio.click();
  };

  const next = () => {
    if (feedback.kind === 'none') return;
    if (plan.queue.length > 0) {
      setCurrent(plan.queue[0]);
      setFeedback({ kind: 'none' });
      setTilesPicked([]);
      setTyped('');
      setHintExcluded(null);
      setRenderedCount((c) => c + 1);
    } else {
      if (doneRef.current) return;
      doneRef.current = true;
      const wordCount = new Set(plan.answered.map((a) => a.question.wordId)).size;
      store.finishUnit(unitId, unit.kind, {
        correct: plan.correct,
        total: plan.answered.length,
        maxCombo: plan.maxCombo,
        wrongWords: [...plan.wrongWordIds],
        masteredCount: [...plan.correctWordIds].filter((id) => {
          const w = bank.getById(id);
          if (!w) return false;
          return store.getWordProgress(id).status === 'mastered';
        }).length,
        score: plan.score,
        wordCount,
      });
      bumpStoreVersion();
      clearPlan(store.levelId, unitId);
      audio.stamp();
      navigate({ name: 'result', unitId });
    }
  };

  const renderTyping = () => (
    <div className="typing-board">
      <p className="progress-note">看释义把单词敲出来（不区分大小写）</p>
      <input
        className="typing-input"
        type="text"
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            submitTyping();
          }
        }}
        placeholder="在这里输入单词"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="none"
        spellCheck={false}
        aria-label="拼写输入框"
        autoFocus
      />
      <button className="btn btn-primary" style={{ width: '100%' }} onClick={submitTyping} disabled={!typed.trim()}>
        确定 ✓
      </button>
    </div>
  );

  const renderOptions = () => {
    if (!current) return null;
    const type = eff(current);
    if (type === 'letter-tiles') {
      const tiles = lettersFor(current);
      return (
        <div className="tiles-board">
          <div className="tiles-slots" role="group" aria-label="拼写槽位">
            {tiles.map((_, j) => {
              const tileIdx = tilesPicked[j];
              const letter = tileIdx !== undefined ? tiles[tileIdx] : null;
              return (
                <span key={j} className={`tile-slot${letter !== null ? ' filled' : ''}`}>
                  {letter !== null ? (
                    <button onClick={() => unpickTile(tileIdx)} aria-label={`移除字母 ${letter}`}>
                      {letter}
                    </button>
                  ) : (
                    <span aria-hidden="true">·</span>
                  )}
                </span>
              );
            })}
          </div>
          <div className="tiles-pool" role="group" aria-label="字母块">
            {tiles.map((t, i) => (
              <button
                key={i}
                className={`tile-btn${tilesPicked.includes(i) ? ' used' : ''}`}
                onClick={() => pickTile(i)}
                disabled={tilesPicked.includes(i) || feedback.kind !== 'none'}
                aria-label={`字母 ${t}`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      );
    }
    if (type === 'spell-typing') return renderTyping();
    return (
      <div
        className={`option-list${current.options!.some((o) => o.text.length > 18) ? ' single-col' : ''}`}
        role="radiogroup"
        aria-label="选项"
      >
        {current.options!.map((o) => {
          let cls = 'option-btn';
          if (type === 'meaning-to-word' || type === 'phonetic-to-word') cls += ' word-opt';
          if (hintExcluded === o.key) cls += ' dimmed';
          if (feedback.kind !== 'none') {
            if (o.key === current.answerKey) cls += ' correct-mark';
            else if (o.key === (feedback as { chosen: string | null }).chosen) cls += ' wrong-mark';
            else cls += ' dimmed';
          }
          return (
            <button
              key={o.key}
              className={cls}
              role="radio"
              aria-checked={false}
              onClick={() => answerOption(o.key)}
              disabled={feedback.kind !== 'none' || hintExcluded === o.key}
            >
              <span className="opt-key">{o.key}</span>
              {o.text}
            </button>
          );
        })}
      </div>
    );
  };

  const renderPrompt = () => {
    if (!current) return null;
    const q = current;
    const type = eff(q);
    const base = <span className={`q-stage-tag stage-${q.stage}`}>{STAGE_TAG[q.stage]}</span>;
    // 拼写阶段不给朗读按钮，否则等于送答案
    const speakBtn =
      type === 'letter-tiles' || type === 'spell-typing' ? null : (
        <button className="q-speak-btn" onClick={speakWord} aria-label={`朗读 ${q.prompt.word}`}>
          🔊
        </button>
      );

    switch (type) {
      case 'word-to-meaning':
        return (
          <>
            {base}
            <div className="q-word">{q.prompt.word}</div>
            <div className="q-phonetic">{q.prompt.phonetic}</div>
            <div>
              <span className="q-pos">{q.prompt.partOfSpeech}</span>
            </div>
            <p className="q-meaning-hint">选出正确的中文释义</p>
            {speakBtn}
            {speakHint && <p className="speak-hint">{speakHint}</p>}
          </>
        );
      case 'meaning-to-word':
        return (
          <>
            {base}
            <div className="q-meaning-hint" style={{ fontSize: 20, fontWeight: 700 }}>
              {q.prompt.meaning}
            </div>
            <div>
              <span className="q-pos">{q.prompt.partOfSpeech}</span>
            </div>
            <p className="q-meaning-hint">选出对应的英文单词</p>
            {speakBtn}
          </>
        );
      case 'phonetic-to-word':
        return (
          <>
            {base}
            <div className="q-phonetic" style={{ fontSize: 26, fontWeight: 700, marginTop: 12 }}>
              /{q.prompt.phonetic.replace(/^\//, '').replace(/\/$/, '')}/
            </div>
            <div>
              <span className="q-pos">{q.prompt.partOfSpeech}</span>
            </div>
            <p className="q-meaning-hint">这个音标是哪个单词？</p>
            {speakBtn}
          </>
        );
      case 'context-cloze':
        return (
          <>
            {base}
            <p className="q-sentence">{q.prompt.sentence}</p>
            {q.prompt.sentenceTranslation && <p className="q-trans">{q.prompt.sentenceTranslation}</p>}
            <div style={{ marginTop: 8 }}>
              <span className="q-pos">{q.prompt.partOfSpeech}</span>
            </div>
            <p className="q-meaning-hint">选出最合适的单词填进空格</p>
            {speakBtn}
          </>
        );
      case 'letter-fill':
        return (
          <>
            {base}
            <div className="q-word masked">{q.prompt.masked}</div>
            <div className="q-phonetic">{q.prompt.phonetic}</div>
            <div>
              <span className="q-pos">{q.prompt.partOfSpeech}</span>
            </div>
            <p className="q-meaning-hint">{q.prompt.meaning}</p>
            <p className="q-meaning-hint" style={{ fontSize: 13, color: 'var(--pencil)' }}>
              选择缺失的字母片段
            </p>
          </>
        );
      case 'letter-tiles':
        return (
          <>
            {base}
            <div className="q-phonetic" style={{ fontSize: 24, marginTop: 10 }}>
              {q.prompt.phonetic}
            </div>
            <div>
              <span className="q-pos">{q.prompt.partOfSpeech}</span>
            </div>
            <p className="q-meaning-hint">{q.prompt.meaning}</p>
            <p className="q-meaning-hint" style={{ fontSize: 13, color: 'var(--pencil)' }}>
              按顺序点击字母块拼出单词
            </p>
          </>
        );
      case 'spell-typing':
        return (
          <>
            {base}
            <div className="q-phonetic" style={{ fontSize: 24, marginTop: 10 }}>
              {q.prompt.phonetic}
            </div>
            <div>
              <span className="q-pos">{q.prompt.partOfSpeech}</span>
            </div>
            <p className="q-meaning-hint">{q.prompt.meaning}</p>
          </>
        );
      default:
        return base;
    }
  };

  const backTo =
    unit.id === WRONG_REVIEW_UNIT.id
      ? ({ name: 'wrong' } as const)
      : unit.id === DUE_REVIEW_UNIT.id
        ? ({ name: 'home' } as const)
        : ({ name: 'directory', day: unit.day } as const);

  return (
    <>
      <TopBar title={unit.label} backTo={backTo} />
      <main className="screen">
        <div className="quiz-top">
          <span className={`quiz-level-chip level-${level.id}`}>{level.badge} · {level.name}</span>
          <span className="quiz-progress-label">
            {Math.min(plan.answered.length + 1, totalPlanned)} / {totalPlanned}
          </span>
          <div className="quiz-progress" role="progressbar" aria-valuenow={progressPct} aria-valuemin={0} aria-valuemax={100}>
            <div className="quiz-progress-fill" style={{ width: `${progressPct}%` }} />
          </div>
          <span className="score-badge" aria-label={`本局得分 ${plan.score}`}>⭐ {plan.score}</span>
          <span className="combo-badge">{plan.combo >= 3 ? `🔥 ${plan.combo} 连击` : ''}</span>
        </div>

        {current && feedback.kind === 'none' ? (
          <>
            <section className="index-card" aria-label="题目">
              <Tape className="tape-mint" style={{ top: -13, left: 20, width: 60, transform: 'rotate(-4deg)' }} />
              <span className="paperclip" aria-hidden="true" />
              {renderPrompt()}
            </section>
            {renderOptions()}
            {current.options && (
              <div style={{ marginTop: 14, display: 'flex', justifyContent: 'center' }}>
                <button className="hint-btn" onClick={useHint} disabled={plan.hintUsed}>
                  {plan.hintUsed ? '小抄已用' : '🃏 翻小抄（排除一个错误选项）'}
                </button>
              </div>
            )}
          </>
        ) : null}

        {feedback.kind !== 'none' && (
          <div className={`feedback ${feedback.kind}`} role="status">
            <div className="feedback-title">
              {feedback.kind === 'correct' ? (
                <>
                  ✅ 记住了 <span className="stamp stamp-small">记住了</span>
                  {plan.lastGain > 0 && (
                    <span className="gain-float" key={`gain-${renderedCount}`}>
                      +{plan.lastGain}
                    </span>
                  )}
                </>
              ) : (
                <>❌ 折角了，再看一眼</>
              )}
            </div>
            <div className="feedback-detail">
              <strong style={{ fontFamily: 'var(--font-word)', fontSize: 18 }}>{feedback.question.prompt.word}</strong>{' '}
              <button className="q-speak-btn small" onClick={speakFeedback} aria-label="再听一遍">
                🔊
              </button>{' '}
              <span style={{ color: 'var(--pencil)' }}>{feedback.question.prompt.phonetic}</span>
              {(feedback.kind === 'wrong' ||
                eff(feedback.question) === 'spell-typing' ||
                eff(feedback.question) === 'letter-tiles') && (
                <div className="full-def">
                  <strong>{feedback.question.prompt.partOfSpeech}</strong>{' '}
                  {feedback.question.prompt.rawDefinition || feedback.question.prompt.meaning}
                </div>
              )}
              {feedback.question.prompt.sentence && (
                <div className="feedback-sentence">
                  {feedback.question.prompt.sentence.replace('____', feedback.question.prompt.word)}
                  {feedback.question.prompt.sentenceTranslation && (
                    <div style={{ color: 'var(--pencil)', fontSize: 13 }}>{feedback.question.prompt.sentenceTranslation}</div>
                  )}
                </div>
              )}
            </div>
            <button className="btn btn-primary feedback-next" onClick={next} autoFocus>
              {plan.queue.length > 0 ? '下一题 →' : '📖 看看本页收获'}
            </button>
          </div>
        )}
      </main>
    </>
  );
}
