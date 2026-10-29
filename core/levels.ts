import type { LevelDef, LevelsConfig } from '../types';

const LEVELS_URL = './data/levels.json';

let cache: LevelsConfig | null = null;

/** 读取分级清单（三级 / 四级 / 六级） */
export async function loadLevels(url = LEVELS_URL): Promise<LevelsConfig> {
  if (cache) return cache;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`无法读取 levels.json（HTTP ${res.status}）`);
  const cfg = (await res.json()) as LevelsConfig;
  if (!cfg || !Array.isArray(cfg.levels) || cfg.levels.length === 0) {
    throw new Error('levels.json 结构无效：缺少 levels 数组');
  }
  cache = cfg;
  return cfg;
}

export function findLevel(cfg: LevelsConfig, id: string | null | undefined): LevelDef {
  const hit = cfg.levels.find((l) => l.id === id);
  if (hit) return hit;
  return cfg.levels.find((l) => l.id === cfg.default) ?? cfg.levels[0];
}

/** 分级配色（用于启动页与设置页的标签） */
export function levelAccent(id: string): string {
  switch (id) {
    case 'cet3':
      return 'var(--mint)';
    case 'cet6':
      return 'var(--pink)';
    default:
      return 'var(--navy)';
  }
}
