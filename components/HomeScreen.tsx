import { useApp, useStoreVersion } from '../state/AppContext';
import { useRoute } from '../router';
import { BottomNav, BinderHoles, Tape, rankLabel } from './shared';
import { todayStr } from '../core/progressStore';
import { DUE_REVIEW_UNIT } from '../core/quizSession';
import { audio } from '../core/audioFeedback';

/** 最近 n 天（含今天），从早到晚 */
function lastNDays(n: number): { date: string; label: string; isToday: boolean }[] {
  const out: { date: string; label: string; isToday: boolean }[] = [];
  const base = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(base);
    d.setDate(base.getDate() - i);
    out.push({
      date: todayStr(d),
      label: `${d.getMonth() + 1}/${d.getDate()}`,
      isToday: i === 0,
    });
  }
  return out;
}

export default function HomeScreen() {
  const { store, units, bank, level } = useApp();
  useStoreVersion();
  const [, navigate] = useRoute();

  const dateStr = todayStr();
  const [y, m, d] = dateStr.split('-');
  const weekday = new Date().getDay();
  const weekNames = ['日', '一', '二', '三', '四', '五', '六'];

  const todayNewDone = store.data.daily.doneNewPages;
  const todayPlan = store.data.daily.newPages;
  const due = store.dueCount();
  const dueDoneToday = store.data.daily.doneDueWords;

  // 当前学习单元：第一个未完成的新词页优先
  const currentUnit =
    units.find((u) => u.kind === 'new' && !store.data.units[u.id]) ?? units.find((u) => !store.data.units[u.id]) ?? null;
  const doneUnits = Object.keys(store.data.units).length;
  const progressPct = Math.min(100, Math.round((doneUnits / units.length) * 100));

  const currentWords = currentUnit?.globalPage ? bank.getPageWords(currentUnit.globalPage) : [];
  const preview = currentWords.slice(0, 4).map((w) => w.word).join(' · ');

  const mastered = Object.values(store.data.words).filter((w) => w.status === 'mastered').length;
  const learned = store.data.learnedWords;

  // 最近 7 天打卡
  const days = lastNDays(7);
  const checkinMap = new Map(store.data.checkins.map((c) => [c.date, c]));
  const todayCheckin = checkinMap.get(dateStr) ?? null;
  const weekUnits = days.reduce((sum, day) => sum + (checkinMap.get(day.date)?.units ?? 0), 0);

  const goUnit = (unitId: string, kind: string) => {
    audio.click();
    navigate(kind === 'new' ? { name: 'preview', unitId } : { name: 'quiz', unitId });
  };

  return (
    <>
      <header className="topbar">
        <h1 className="topbar-title">📓 今日手账</h1>
        <button className="level-chip" onClick={() => navigate({ name: 'settings' })} aria-label="切换词库">
          {level.badge} · {level.name} ▾
        </button>
      </header>
      <main className="screen">
        <div className="card paper" style={{ position: 'relative' }}>
          <BinderHoles />
          <Tape className="tape-navy" style={{ top: -13, right: 30, width: 76, transform: 'rotate(4deg)' }} />
          <p className="date-line">
            📅 {y} 年 {Number(m)} 月 {Number(d)} 日 · 星期{weekNames[weekday]}
            <span style={{ marginLeft: 'auto' }}>🔥 连续 {store.data.streak} 天</span>
          </p>
          <p className="rank-line" style={{ textAlign: 'left' }}>
            🎖️ {rankLabel(store.data.totalScore)} · ⭐ {store.data.totalScore} 分
          </p>

          <div className="checkin-head">
            <span className="card-title" style={{ margin: 0 }}>
              ✅ 今日打卡
            </span>
            <span className={`checkin-state${todayCheckin ? ' done' : ''}`}>
              {todayCheckin
                ? `${todayCheckin.units} 个单元${todayCheckin.words > 0 ? ` · ${todayCheckin.words} 个词` : ''}`
                : doneUnits > 0
                  ? '今天还没有完整打卡'
                  : '完成一页就会盖章'}
            </span>
          </div>
          <div className="checkin-strip" role="group" aria-label="最近 7 天打卡记录">
            {days.map((day) => {
              const rec = checkinMap.get(day.date);
              return (
                <div
                  key={day.date}
                  className={`checkin-day${rec ? ' done' : ''}${day.isToday ? ' today' : ''}`}
                  title={rec ? `${rec.units} 个单元 / ${rec.words} 个词` : '没有记录'}
                >
                  <span className="checkin-mark">{rec ? '✓' : '·'}</span>
                  <span className="checkin-label">{day.label}</span>
                </div>
              );
            })}
          </div>
          <p className="progress-note" style={{ marginTop: 6 }}>
            最近 7 天打了 {weekUnits} 个单元
          </p>

          {currentUnit && (
            <>
              <p className="card-title" style={{ marginTop: 10 }}>
                ✏️ 当前进度
              </p>
              <p className="progress-note">
                {currentUnit.label} · 已打卡 {doneUnits} / {units.length} 个单元
              </p>
              <div className="progress-track" role="progressbar" aria-valuenow={progressPct} aria-valuemin={0} aria-valuemax={100}>
                <div className="progress-fill" style={{ width: `${progressPct}%` }} />
              </div>
              <p className="progress-note" style={{ marginTop: 6 }}>
                已学 {learned} 词 · 已掌握 {mastered} 词 · 今日新词页 {todayNewDone} / {todayPlan}
              </p>
            </>
          )}
        </div>

        <div className={`card due-card${due > 0 ? ' has-due' : ''}`}>
          <p className="card-title">🔔 艾宾浩斯复习</p>
          <p className="due-count">
            <strong>{due}</strong> 个词到期
            {dueDoneToday > 0 && <span className="due-done"> · 今日已复习 {dueDoneToday} 个</span>}
          </p>
          <p className="progress-note">
            按遗忘曲线排的：新学 5 分钟 → 30 分钟 → 12 小时 → 1 天 → 2 天 → 4 天 → 7 天 → 15 天。
          </p>
          <button className={`btn ${due > 0 ? 'btn-primary' : 'btn-secondary'}`} style={{ width: '100%' }} onClick={() => goUnit(DUE_REVIEW_UNIT.id, 'review')}>
            {due > 0 ? `🧠 开始复习（${Math.min(due, 12)} 词）` : '🧠 暂无到期词，先学新词'}
          </button>
        </div>

        <div className="card listen-card">
          <p className="card-title">🎧 每日一听</p>
          <p className="progress-note">一段英文、一篇科技新闻，每天换新，练耳朵也练嘴。</p>
          <div className="listen-actions">
            <button className="listen-tile recite" onClick={() => { audio.click(); navigate({ name: 'daily', tab: 'recite' }); }}>
              <span className="listen-emoji">🗣️</span>
              <span className="listen-name">每日一诵</span>
              <span className="listen-sub">逐句朗读 · 可跟读</span>
            </button>
            <button className="listen-tile news" onClick={() => { audio.click(); navigate({ name: 'daily', tab: 'news' }); }}>
              <span className="listen-emoji">📰</span>
              <span className="listen-name">英语新闻</span>
              <span className="listen-sub">前沿科技 · 可听标题</span>
            </button>
          </div>
        </div>

        {currentUnit && (
          <button
            className="current-page-card"
            style={{ width: '100%', textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit' }}
            onClick={() => goUnit(currentUnit.id, currentUnit.kind)}
          >
            <Tape className="tape-pink" style={{ top: -13, left: 24, width: 84, transform: 'rotate(-2deg)' }} />
            <p className="card-title" style={{ margin: 0 }}>
              📖 当前学习页
            </p>
            <p className="current-page-word">{preview || '（尚未开始）'}</p>
            <p className="current-page-meta">
              {currentUnit.label}
              {currentUnit.kind === 'new' && currentWords.length > 0
                ? ` · 本页 ${currentWords.length} 个单词`
                : currentUnit.kind === 'review'
                  ? ' · 复习页'
                  : ' · 测验'}
            </p>
            <span className="stamp stamp-small stamp-gold">开始 →</span>
          </button>
        )}

        <div className="card">
          <p className="card-title">🎒 快捷入口</p>
          <div className="result-actions">
            {currentUnit && (
              <button className="btn btn-primary" onClick={() => goUnit(currentUnit.id, currentUnit.kind)}>
                ▶️ 继续学习
              </button>
            )}
            <button className="btn btn-warm" onClick={() => navigate({ name: 'wrong' })}>
              📎 错词复习
            </button>
            <button className="btn btn-secondary" onClick={() => navigate({ name: 'directory' })}>
              🗂️ 手账目录
            </button>
          </div>
        </div>
      </main>
      <BottomNav active="home" />
    </>
  );
}
