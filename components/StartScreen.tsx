import { useEffect, useState } from 'react';
import { useApp, useStoreVersion } from '../state/AppContext';
import { useRoute } from '../router';
import { BinderHoles, Tape, rankLabel } from './shared';
import { audio } from '../core/audioFeedback';
import { APP_VERSION, latestChangelog, markVersionSeen, needsUpdateNotice } from '../core/changelog';
import type { Language } from '../types';

export default function StartScreen() {
  const { store, units, level, levels, languages, switchLevel } = useApp();
  useStoreVersion();
  const [, navigate] = useRoute();
  const [showUpdate, setShowUpdate] = useState(() => needsUpdateNotice());
  const changelog = latestChangelog();

  // 两级选择：先选语言（英语 / 韩语），再选分级
  const [langTab, setLangTab] = useState<Language>(() => level.language ?? 'en');
  useEffect(() => {
    setLangTab(level.language ?? 'en');
  }, [level.id, level.language]);
  const shownLevels = levels.filter((l) => (l.language ?? 'en') === langTab);
  const otherLang = level.language ?? 'en';

  const mastered = Object.values(store.data.words).filter((w) => w.status === 'mastered').length;
  const learned = store.data.learnedWords;
  const streak = store.data.streak;

  // 继续上次位置：上次单元，否则第一个未完成单元
  const nextUnit = store.data.lastUnitId
    ? units.find((u) => u.id === store.data.lastUnitId) ?? units.find((u) => !store.data.units[u.id]) ?? units[0]
    : units.find((u) => !store.data.units[u.id]) ?? units[0];

  const todayNewDone = store.data.daily.doneNewPages;
  const todayPlan = store.data.daily.newPages;

  return (
    <div className="start-screen">
      <div className="notebook">
        <BinderHoles />
        <div className="notebook-inner">
          <Tape className="tape-mint" style={{ top: -12, left: '38%', width: 90, transform: 'rotate(-3deg)' }} />
          <h1 className="start-title">单词手账</h1>
          <p className="start-subtitle">
            每天贴好一页单词，{level.name}词汇慢慢集齐。
          </p>
          <p className="rank-line">
            🎖️ {rankLabel(store.data.totalScore)} · ⭐ {store.data.totalScore} 分
          </p>
          <div className="start-stats">
            <div className="stat-box">
              <div className="stat-num">{learned}</div>
              <div className="stat-label">累计学习</div>
            </div>
            <div className="stat-box">
              <div className="stat-num">{mastered}</div>
              <div className="stat-label">已掌握</div>
            </div>
            <div className="stat-box">
              <div className="stat-num">{streak}</div>
              <div className="stat-label">连续天数</div>
            </div>
          </div>
          {todayPlan > 0 && (
            <p className="progress-note" style={{ textAlign: 'center', marginTop: 12 }}>
              ✏️ 今日进度：{Math.min(todayNewDone, todayPlan)} / {todayPlan} 页
            </p>
          )}
        </div>
      </div>

      <div className="card level-picker">
        <p className="card-title">📚 选择语言与词库</p>
        <div className="lang-grid" role="tablist" aria-label="选择语言">
          {languages.map((lg) => {
            const on = lg.id === langTab;
            return (
              <button
                key={lg.id}
                role="tab"
                aria-selected={on}
                className={`lang-card${on ? ' active' : ''}`}
                onClick={() => {
                  if (on) return;
                  audio.click();
                  setLangTab(lg.id);
                }}
              >
                <span className="lang-emoji">{lg.emoji}</span>
                <span className="lang-name">{lg.name}</span>
                <span className="lang-desc">{lg.desc}</span>
              </button>
            );
          })}
        </div>
        <div className="level-grid" role="radiogroup" aria-label="选择词库">
          {shownLevels.map((lv) => {
            const active = lv.id === level.id;
            return (
              <button
                key={lv.id}
                className={`level-card${active ? ' active' : ''}`}
                role="radio"
                aria-checked={active}
                onClick={() => {
                  if (active) return;
                  audio.click();
                  switchLevel(lv.id);
                }}
              >
                <span className="level-badge">{lv.badge}</span>
                <span className="level-name">{lv.name}</span>
                <span className="level-count">{lv.wordCount} 词</span>
                <span className="level-days">{lv.pageCount} 页</span>
              </button>
            );
          })}
        </div>
        <p className="progress-note" style={{ marginTop: 8 }}>
          {level.fullName} · {level.note}
        </p>
        <p className="progress-note">
          {langTab === otherLang
            ? `当前在学：${level.name}。每套词库的进度各自独立保存，切换不会互相覆盖。`
            : `当前在学：${level.name}（${level.language === 'ko' ? '韩语' : '英语'}）。先点上面的分级切过去，进度各自独立保存。`}
        </p>
      </div>

      <div className="start-actions">
        <button className="btn btn-primary" onClick={() => navigate({ name: 'home' })}>
          📖 开始学习（{level.name}）
        </button>
        <button
          className="btn btn-secondary"
          onClick={() =>
            navigate(nextUnit.kind === 'new' ? { name: 'preview', unitId: nextUnit.id } : { name: 'quiz', unitId: nextUnit.id })
          }
        >
          🔖 继续上次位置
        </button>
      </div>

      <p className="start-version">
        v{APP_VERSION}
        <button
          className="link-plain"
          onClick={() => {
            audio.click();
            setShowUpdate(true);
          }}
        >
          更新说明
        </button>
      </p>

      {showUpdate && (
        <div className="modal-mask" role="dialog" aria-modal="true" aria-labelledby="update-title">
          <div className="modal-card wide">
            <p className="modal-title" id="update-title">
              🎉 更新到 v{changelog.version}
            </p>
            <div className="modal-body" style={{ textAlign: 'left', maxHeight: '58vh', overflowY: 'auto' }}>
              <p className="progress-note" style={{ marginTop: 0 }}>
                {changelog.date}
              </p>
              <ul className="update-list">
                {changelog.items.map((it) => (
                  <li key={it}>{it}</li>
                ))}
              </ul>
            </div>
            <div className="modal-actions">
              <button
                className="btn btn-primary"
                onClick={() => {
                  markVersionSeen();
                  setShowUpdate(false);
                  audio.click();
                }}
              >
                知道了
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
