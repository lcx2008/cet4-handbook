import { useApp, useStoreVersion } from '../state/AppContext';
import { useRoute } from '../router';
import { BinderHoles, Tape, TopBar } from './shared';
import { audio } from '../core/audioFeedback';

export default function ResultScreen({ unitId }: { unitId: string }) {
  const { store, units, bank } = useApp();
  useStoreVersion();
  const [, navigate] = useRoute();

  const unit = units.find((u) => u.id === unitId);
  const result = store.data.units[unitId];
  const nextUnit = units.find((u) => u.seq === (unit?.seq ?? 0) + 1);

  if (!unit || !result) {
    return (
      <div className="screen">
        <p className="load-hint">没有找到结算记录。</p>
        <button className="btn btn-primary" onClick={() => navigate({ name: 'home' })}>
          回首页
        </button>
      </div>
    );
  }

  const starStr = '★'.repeat(result.stars) + '☆'.repeat(3 - result.stars);
  const wrongWords = result.wrongWords.map((id) => bank.getById(id)).filter((w) => Boolean(w));

  const goNext = () => {
    audio.click();
    if (nextUnit) {
      navigate(nextUnit.kind === 'new' ? { name: 'preview', unitId: nextUnit.id } : { name: 'quiz', unitId: nextUnit.id });
    } else {
      navigate({ name: 'directory' });
    }
  };

  return (
    <>
      <TopBar title="本页结算" backTo={{ name: 'home' }} />
      <main className="screen">
        <div className="result-card">
          <BinderHoles />
          <Tape className="tape-pink" style={{ top: -13, left: '40%', width: 96, transform: 'rotate(2deg)' }} />
          <p className="result-title">{unit.label}</p>
          {result.goldStamp && (
            <div className="stamp stamp-large stamp-gold" style={{ margin: '8px auto 0' }}>
              金色阶段印章
            </div>
          )}
          <div className="result-stars" role="img" aria-label={`${result.stars} 星`}>
            {starStr}
          </div>
          <div className="result-score" aria-label={`本页得分 ${result.score ?? 0}`}>
            ⭐ 本页得分 +{result.score ?? 0}
            <span className="result-total">（累计 {store.data.totalScore}）</span>
          </div>
          <div className="result-meta">
            <div className="result-meta-item">
              <div className="result-meta-num">{Math.round(result.accuracy * 100)}%</div>
              <div className="result-meta-label">正确率</div>
            </div>
            <div className="result-meta-item">
              <div className="result-meta-num">{result.maxCombo}</div>
              <div className="result-meta-label">最高连击</div>
            </div>
            <div className="result-meta-item">
              <div className="result-meta-num">
                {result.correct}/{result.total}
              </div>
              <div className="result-meta-label">答对题数</div>
            </div>
            <div className="result-meta-item">
              <div className="result-meta-num">{result.masteredCount}</div>
              <div className="result-meta-label">本页掌握</div>
            </div>
          </div>
          <p className="progress-note" style={{ textAlign: 'center', marginTop: 8 }}>
            ✅ 已记入今日打卡
            {store.todayCheckin()
              ? ` · 今天第 ${store.todayCheckin()!.units} 个单元${
                  store.todayCheckin()!.words > 0 ? `，共 ${store.todayCheckin()!.words} 个词` : ''
                }`
              : ''}
          </p>

          {wrongWords.length > 0 ? (
            <div className="result-wrong-list">
              <h4>📎 本页折角错词（{wrongWords.length}）</h4>
              {wrongWords.map((w) => (
                <span key={w!.id} className="wrong-word-chip">
                  <span className="ww">{w!.word}</span>
                  <span className="wm">{w!.meaning}</span>
                </span>
              ))}
            </div>
          ) : (
            <div className="result-wrong-list" style={{ background: 'rgba(188,217,200,.35)', borderColor: 'var(--mint-tape)' }}>
              <h4 style={{ color: 'var(--success)' }}>🎉 本页没有错词！</h4>
            </div>
          )}

          <div className="result-actions">
            {wrongWords.length > 0 && (
              <button className="btn btn-warm" onClick={() => navigate({ name: 'wrong' })}>
                📎 整理错词
              </button>
            )}
            <button
              className="btn btn-secondary"
              onClick={() => {
                audio.click();
                navigate(unit.kind === 'new' ? { name: 'preview', unitId } : { name: 'quiz', unitId });
              }}
            >
              🔁 再翻一次
            </button>
            <button className="btn btn-primary" onClick={goNext}>
              {nextUnit ? `继续下一页 →` : '🗂️ 回到目录'}
            </button>
          </div>
        </div>
      </main>
    </>
  );
}
