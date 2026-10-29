import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { LevelDef, LevelsConfig, SettingsData, UnitDef } from '../types';
import { ProgressStore, SETTINGS_KEY, loadSettings } from '../core/progressStore';
import { WordBank, buildUnits } from '../core/wordBank';
import { findLevel, loadLevels } from '../core/levels';
import { clearAllPlans } from '../core/quizSession';
import { audio } from '../core/audioFeedback';
import { applyTheme } from '../core/theme';

export interface AppState {
  bank: WordBank;
  units: UnitDef[];
  store: ProgressStore;
  settings: SettingsData;
  level: LevelDef;
  levels: LevelDef[];
  ready: boolean;
  error: string | null;
  /** 切换分级（三级 / 四级 / 六级） */
  switchLevel: (id: string) => void;
  /** 加载/出错后刷新用 */
  reload: () => void;
}

const Ctx = createContext<AppState | null>(null);

interface Loaded {
  levelId: string;
  bank: WordBank;
  store: ProgressStore;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [cfg, setCfg] = useState<LevelsConfig | null>(null);
  const [levelId, setLevelId] = useState<string>(() => loadSettings().levelId ?? '');
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  // 1) 分级清单
  useEffect(() => {
    loadLevels()
      .then(setCfg)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [tick]);

  // 2) 词库 + 进度（按分级隔离）
  //    bank / store / levelId 放在同一个状态里，避免「标题已经是六级、词库还是三级」的那一帧
  useEffect(() => {
    if (!cfg) return;
    const def = findLevel(cfg, levelId);
    if (levelId !== def.id) {
      setLevelId(def.id);
      return;
    }
    let cancelled = false;
    setLoaded(null);
    setError(null);
    const settings = loadSettings();
    const pageSize = settings.wordsPerPage || 10;
    WordBank.load(def, pageSize)
      .then((b) => {
        if (cancelled) return;
        const st = ProgressStore.load(def.id, settings);
        setLoaded({ levelId: def.id, bank: b, store: st });
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [cfg, levelId, tick]);

  // 同步音效设置 + 主题
  useEffect(() => {
    if (!loaded) return;
    const s = loaded.store.settings;
    audio.soundOn = s.soundOn;
    audio.speechOn = s.speechOn;
    audio.onlineAudioOn = s.onlineAudio !== false;
    audio.forceOnlineOnly = s.forceOnlineAudio === true;
    audio.accent = s.accent === 'uk' ? 'uk' : 'us';
    applyTheme(s.theme);
  }, [loaded, loaded?.store.settings]);

  const level = useMemo<LevelDef | null>(() => (cfg ? findLevel(cfg, levelId) : null), [cfg, levelId]);

  const value = useMemo<AppState | null>(() => {
    // 只认「加载完成且层级一致」的那一份，绝不把旧词库混给新分级
    if (!loaded || !level || !cfg || loaded.levelId !== level.id) return null;
    const { bank, store } = loaded;
    return {
      bank,
      units: buildUnits(bank.pageCount, 3, level.dayCount),
      store,
      settings: store.settings,
      level,
      levels: cfg.levels,
      ready: true,
      error,
      switchLevel: (id: string) => {
        if (id === level.id) return;
        // 先把当前进度落盘，再换词库；旧局的出题计划一并作废
        store.save();
        clearAllPlans();
        const s = loadSettings();
        const next = { ...s, levelId: id };
        try {
          localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
        } catch {
          /* 忽略 */
        }
        setLevelId(id);
      },
      reload: () => setTick((t) => t + 1),
    };
  }, [loaded, level, cfg, error]);

  if (error) {
    return (
      <div className="load-screen" role="alert">
        <div className="load-paper">
          <h1>📓 单词手账</h1>
          <p className="load-error">数据加载失败</p>
          <p className="load-error-detail">{error}</p>
          <p className="load-hint">请确认 data 目录中包含 levels.json、cet3_words.json、cet4_words.json、cet6_words.json。</p>
          <button className="btn btn-primary" onClick={() => setTick((t) => t + 1)}>
            重新加载
          </button>
        </div>
      </div>
    );
  }
  if (!value) {
    return (
      <div className="load-screen">
        <div className="load-paper">
          <h1>📓 单词手账</h1>
          <p className="load-hint">正在翻开手账……</p>
          <p className="load-hint" style={{ fontSize: 13 }}>
            首次打开要下载词库（约 0.7~0.8 MB），之后会缓存在本地，秒开。
          </p>
        </div>
      </div>
    );
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp must be used inside AppProvider');
  return v;
}

/** 进度变化通知：store 是可变对象，用版本号触发重渲染 */
export function useStoreVersion(): number {
  const [ver, setVer] = useState(0);
  useEffect(() => {
    const handler = () => setVer((v) => v + 1);
    window.addEventListener('dsh-store-changed', handler);
    window.addEventListener('dsh-storage-failed', handler);
    return () => {
      window.removeEventListener('dsh-store-changed', handler);
      window.removeEventListener('dsh-storage-failed', handler);
    };
  }, []);
  return ver;
}

export function bumpStoreVersion(): void {
  window.dispatchEvent(new Event('dsh-store-changed'));
}
