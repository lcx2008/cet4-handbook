import type { ReactNode } from 'react';
import { useRoute, type Route } from '../router';

export function BinderHoles(): ReactNode {
  return (
    <div className="binder-holes" aria-hidden="true">
      {[0, 1, 2, 3, 4].map((i) => (
        <span key={i} className="binder-hole" />
      ))}
    </div>
  );
}

export function TopBar({
  title,
  backTo,
  right,
}: {
  title: string;
  backTo?: Route;
  right?: ReactNode;
}) {
  const [, navigate] = useRoute();
  return (
    <header className="topbar">
      {backTo && (
        <button
          className="icon-btn"
          aria-label="返回"
          onClick={() => navigate(backTo)}
        >
          ←
        </button>
      )}
      <h1 className="topbar-title">{title}</h1>
      {right}
    </header>
  );
}

export function BottomNav({ active }: { active: 'home' | 'directory' | 'daily' | 'wrong' | 'words' | 'settings' }) {
  const [, navigate] = useRoute();
  const items: { key: typeof active; icon: string; label: string; route: Route }[] = [
    { key: 'home', icon: '📖', label: '今日', route: { name: 'home' } },
    { key: 'directory', icon: '🗂️', label: '目录', route: { name: 'directory' } },
    { key: 'daily', icon: '🎧', label: '听力', route: { name: 'daily' } },
    { key: 'wrong', icon: '📎', label: '错词', route: { name: 'wrong' } },
    { key: 'words', icon: '📇', label: '总表', route: { name: 'words' } },
    { key: 'settings', icon: '⚙️', label: '设置', route: { name: 'settings' } },
  ];
  return (
    <nav className="bottom-nav" aria-label="主导航">
      {items.map((it) => (
        <button
          key={it.key}
          className={`nav-item${active === it.key ? ' active' : ''}`}
          aria-current={active === it.key ? 'page' : undefined}
          onClick={() => navigate(it.route)}
        >
          <span className="nav-icon" aria-hidden="true">
            {it.icon}
          </span>
          {it.label}
        </button>
      ))}
    </nav>
  );
}

export function Stars({ count, gold = false }: { count: number; gold?: boolean }) {
  const full = gold ? '★'.repeat(Math.max(count, 1)) : '★'.repeat(count) + '☆'.repeat(3 - count);
  return (
    <span className="unit-stars" aria-label={`${count} 星`} role="img">
      {full}
    </span>
  );
}

export function Tape({ className = 'tape-navy', style }: { className?: string; style?: React.CSSProperties }) {
  return <span className={`tape ${className}`} style={style} aria-hidden="true" />;
}

/** 词性展示 */
export function PosBadge({ pos }: { pos: string }) {
  return <span className="wc-pos">{pos}</span>;
}

export function statusLabel(status: string): string {
  switch (status) {
    case 'unlearned':
      return '未学习';
    case 'learning':
      return '学习中';
    case 'reviewing':
      return '复习中';
    case 'mastered':
      return '已掌握';
    default:
      return status;
  }
}

/** 总分数 → 手账段位称号（游戏化进度） */
export function rankLabel(totalScore: number): string {
  if (totalScore >= 60000) return '词汇收藏家';
  if (totalScore >= 40000) return '单词大师';
  if (totalScore >= 25000) return '背词达人';
  if (totalScore >= 12000) return '手账老手';
  if (totalScore >= 5000) return '勤学贴纸控';
  if (totalScore >= 1000) return '翻页新手';
  return '手账萌新';
}
