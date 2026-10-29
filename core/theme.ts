import type { ThemeId } from '../types';

export interface ThemeDef {
  id: ThemeId;
  name: string;
  desc: string;
  /** 预览色块：[纸面, 主色, 强调色] */
  swatch: [string, string, string];
  /** 浏览器地址栏 / 状态栏颜色 */
  meta: string;
}

export const THEMES: ThemeDef[] = [
  {
    id: 'paper',
    name: '米白手账',
    desc: '默认 · 纸张与胶带',
    swatch: ['#f7f1e3', '#4d657b', '#f2d56b'],
    meta: '#243447',
  },
  {
    id: 'mint',
    name: '薄荷绿',
    desc: '清爽 · 久看不累',
    swatch: ['#eef6f0', '#2f6b55', '#f3d97e'],
    meta: '#2f6b55',
  },
  {
    id: 'rose',
    name: '樱粉',
    desc: '温柔 · 少女手账',
    swatch: ['#fbf0f1', '#8a4b5c', '#f0c9a8'],
    meta: '#8a4b5c',
  },
  {
    id: 'night',
    name: '夜航',
    desc: '深色 · 关灯背词',
    swatch: ['#1b202a', '#9fb6c9', '#e8c97a'],
    meta: '#151a23',
  },
  {
    id: 'sky',
    name: '雾蓝',
    desc: '安静 · 像雨后的天空',
    swatch: ['#edf3f8', '#3f6d8f', '#f2d56b'],
    meta: '#3f6d8f',
  },
  {
    id: 'latte',
    name: '奶咖',
    desc: '暖棕 · 旧书店的味道',
    swatch: ['#f7f0e6', '#7a5c43', '#f0cf87'],
    meta: '#7a5c43',
  },
  {
    id: 'forest',
    name: '墨绿',
    desc: '沉静 · 纸上森林',
    swatch: ['#eef4ed', '#2f5d45', '#e8cd7a'],
    meta: '#2f5d45',
  },
];

export function themeById(id: string | null | undefined): ThemeDef {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}

/** 把主题挂到 <html data-theme>，并同步浏览器状态栏颜色 */
export function applyTheme(id: string | null | undefined): void {
  if (typeof document === 'undefined') return;
  const theme = themeById(id);
  document.documentElement.dataset.theme = theme.id;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme.meta);
}

/** 当前是否深色主题（给需要单独处理的组件用） */
export function isDarkTheme(id: string | null | undefined): boolean {
  return themeById(id).id === 'night';
}
