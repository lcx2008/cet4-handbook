import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp, useStoreVersion } from '../state/AppContext';
import { useRoute } from '../router';
import { BottomNav, Stars } from './shared';
import { audio } from '../core/audioFeedback';
import type { UnitDef } from '../types';

/** 每屏展示多少页（目录按页分段，不再出现 Day） */
const PAGE_BLOCK = 20;

function rangeOf(u: UnitDef): [number, number] {
  if (u.coversPages) return u.coversPages;
  const p = u.globalPage ?? 1;
  return [p, p];
}

export default function DirectoryScreen({ initialDay }: { initialDay?: number }) {
  const { store, units, level, bank } = useApp();
  useStoreVersion();
  const [, navigate] = useRoute();
  void initialDay;

  const blocks = useMemo(() => {
    const out: { from: number; to: number }[] = [];
    for (let p = 1; p <= bank.pageCount; p += PAGE_BLOCK) {
      out.push({ from: p, to: Math.min(bank.pageCount, p + PAGE_BLOCK - 1) });
    }
    return out;
  }, [bank.pageCount]);

  const currentUnit = units.find((u) => !store.data.units[u.id]) ?? null;
  const currentPage = currentUnit ? rangeOf(currentUnit)[0] : 1;
  const [blockIdx, setBlockIdx] = useState(() => Math.max(0, Math.floor((currentPage - 1) / PAGE_BLOCK)));
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    const el = tabRefs.current[blockIdx];
    el?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [blockIdx]);

  const block = blocks[blockIdx] ?? blocks[0] ?? { from: 1, to: 1 };
  const blockUnits = units.filter((u) => {
    const [a, b] = rangeOf(u);
    return b >= block.from && a <= block.to;
  });

  // 2.7：目录不再上锁，所有页都能直接进
  const isUnlocked = (_u: UnitDef): boolean => true;

  const unitState = (u: UnitDef): 'done' | 'current' | 'locked' => {
    if (store.data.units[u.id]) return 'done';
    if (!isUnlocked(u)) return 'locked';
    return 'current';
  };

  const openUnit = (u: UnitDef) => {
    if (!isUnlocked(u)) return;
    audio.click();
    navigate(u.kind === 'new' ? { name: 'preview', unitId: u.id } : { name: 'quiz', unitId: u.id });
  };

  const unitIcon = (u: UnitDef): string => {
    if (store.data.units[u.id]) {
      if (u.kind === 'test' && store.data.units[u.id]?.goldStamp) return '🏅';
      return '⭐';
    }
    switch (u.kind) {
      case 'new':
        return '📄';
      case 'review':
        return '🔄';
      case 'test':
        return '🎯';
    }
  };

  return (
    <>
      <header className="topbar">
        <h1 className="topbar-title">🗂️ 手账目录</h1>
        <span className="level-chip static">
          {level.badge} · {level.name}
        </span>
      </header>
      <main className="screen">
        <div className="day-tabs" role="tablist" aria-label="按页分段">
          {blocks.map((b, i) => {
            const inBlock = units.filter((u) => {
              const [a, z] = rangeOf(u);
              return z >= b.from && a <= b.to;
            });
            const doneCount = inBlock.filter((u) => store.data.units[u.id]).length;
            const done = inBlock.length > 0 && doneCount === inBlock.length;
            return (
              <button
                key={b.from}
                ref={(el) => {
                  tabRefs.current[i] = el;
                }}
                className={`day-tab${blockIdx === i ? ' active' : ''}${done ? ' done' : ''}`}
                role="tab"
                aria-selected={blockIdx === i}
                onClick={() => setBlockIdx(i)}
              >
                第 {b.from}–{b.to} 页
              </button>
            );
          })}
        </div>

        <p className="progress-note" style={{ margin: '4px 2px 10px' }}>
          {level.name}共 {bank.pageCount} 页 · 当前显示第 {block.from}–{block.to} 页 · 每页 {store.settings.wordsPerPage} 词
        </p>

        <div className="unit-list">
          {blockUnits.map((u) => {
            const state = unitState(u);
            const result = store.data.units[u.id];
            const [a, b] = rangeOf(u);
            return (
              <button
                key={u.id}
                className={`unit-row ${state}`}
                onClick={() => openUnit(u)}
                disabled={state === 'locked'}
                aria-label={`${u.label}，${state === 'done' ? '已完成' : state === 'locked' ? '未开放' : '当前可进入'}`}
              >
                <span className={`unit-badge ${u.kind}`} aria-hidden="true">
                  {unitIcon(u)}
                </span>
                <span className="unit-info">
                  <span className="unit-name">{u.label}</span>
                  <span className="unit-sub">
                    {u.kind === 'new' && u.globalPage
                      ? `${bank.getPageWords(u.globalPage).length} 个词`
                      : u.kind === 'review'
                        ? `复习第 ${a}~${b} 页的词`
                        : `第 ${a}~${b} 页 · 词意 + 拼写 · 90% 得金章`}
                  </span>
                </span>
                {result ? <Stars count={result.stars} gold={result.goldStamp} /> : <span className="unit-stars">{state === 'locked' ? '🔒' : '▶'}</span>}
              </button>
            );
          })}
        </div>
      </main>
      <BottomNav active="directory" />
    </>
  );
}
