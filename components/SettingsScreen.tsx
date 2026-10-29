import { useEffect, useState } from 'react';
import { useApp, useStoreVersion, bumpStoreVersion } from '../state/AppContext';
import { useRoute } from '../router';
import { BottomNav, TopBar } from './shared';
import { audio, voiceDiagnose } from '../core/audioFeedback';
import { canInstall, browserInfo, copyCurrentUrl, installGuide, isStandalone, promptInstall } from '../pwa';
import { exportAllProgress, exportLevelProgress, importIntoLevel, resetLevelProgress } from '../core/progressStore';
import { THEMES, applyTheme } from '../core/theme';
import { buildWordCsv, downloadText } from '../core/wordExport';
import type { LevelDef, SpellingMode, ThemeId } from '../types';

type Tab = 'learn' | 'sound' | 'look' | 'data' | 'about';

const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: 'learn', label: '学习', icon: '📚' },
  { key: 'sound', label: '声音', icon: '🔊' },
  { key: 'look', label: '外观', icon: '🎨' },
  { key: 'data', label: '数据', icon: '💾' },
  { key: 'about', label: '关于', icon: 'ℹ️' },
];

const SPELLING_OPTIONS: { key: SpellingMode; label: string; sub: string }[] = [
  { key: 'tiles', label: '🔤 字母贴纸', sub: '按顺序点击字母块拼词' },
  { key: 'typing', label: '⌨️ 自由拼写', sub: '用键盘把单词敲出来' },
  { key: 'mixed', label: '🎲 混合', sub: '两种随机出现' },
];

/** 主流手机浏览器怎么「添加到主屏幕」，逐条列清楚 */
const INSTALL_GUIDE: { brand: string; steps: string[] }[] = [
  {
    brand: '华为 / 荣耀（自带浏览器）',
    steps: ['用「浏览器」打开本页面', '点右下角「≡」更多菜单', '选「添加到主屏幕」，再点「添加」'],
  },
  {
    brand: '小米 / 红米（小米浏览器）',
    steps: ['打开页面后点底部「≡」', '选「工具箱」→「添加到桌面」', '确认后桌面出现「单词手账」图标'],
  },
  {
    brand: 'OPPO / 一加 / realme（自带浏览器）',
    steps: ['点右下角「≡」更多菜单', '选「添加到桌面」或「添加到主屏幕」', '弹出确认框点「添加」'],
  },
  {
    brand: 'vivo / iQOO（vivo 浏览器）',
    steps: ['点底部「≡」→「更多」', '选「添加到桌面」', '在弹窗里确认「添加」'],
  },
  {
    brand: '三星（Samsung Internet）',
    steps: ['点右下角「☰」', '选「添加页面到」→「主屏幕」', '点「添加」'],
  },
  {
    brand: 'Chrome（安卓 / 电脑）',
    steps: [
      '安卓：点右上角「⋮」→「安装应用」或「添加到主屏幕」',
      '电脑：点地址栏右侧的「安装」小图标',
      '没有图标就用「⋮」菜单里的「安装 单词手账」',
    ],
  },
  {
    brand: 'Edge（安卓 / 电脑）',
    steps: [
      '安卓：点底部「…」→「添加到手机」',
      '电脑：地址栏右侧「应用可用」图标，或「…」→「应用」→「安装此站点为应用」',
    ],
  },
  {
    brand: 'iPhone / iPad（只能用 Safari）',
    steps: [
      '必须用 Safari 打开（在微信里点右上角「…」→「在浏览器中打开」）',
      '点底部中间「分享」按钮（方框向上箭头）',
      '往下滑找「添加到主屏幕」→ 右上角「添加」',
    ],
  },
  {
    brand: '微信 / QQ 内置浏览器',
    steps: ['这两个内置浏览器不支持安装', '点右上角「…」→「在浏览器中打开」', '换到 Chrome / 自带浏览器后再按上面步骤添加'],
  },
];

export default function SettingsScreen() {
  const { store, level, levels, bank, switchLevel } = useApp();
  useStoreVersion();
  useRoute();
  const [tab, setTab] = useState<Tab>('learn');
  const [confirmReset, setConfirmReset] = useState<LevelDef | null>(null);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [installMsg, setInstallMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showInstallHelp, setShowInstallHelp] = useState(false);
  const [showImportHelp, setShowImportHelp] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);
  const [, setInstallTick] = useState(0);
  const [pageInput, setPageInput] = useState('');
  const [dailyInput, setDailyInput] = useState('');
  const [diag, setDiag] = useState(() => voiceDiagnose());
  const [voiceMsg, setVoiceMsg] = useState<string | null>(null);
  const [manualSrc, setManualSrc] = useState<string | null>(null);
  const [probeMsg, setProbeMsg] = useState<string | null>(null);
  const [storageWarn, setStorageWarn] = useState(false);

  const settings = store.settings;

  /** 设定每页词数（3~30），改动后重新分页并刷新 */
  const applyPageSize = (n: number) => {
    const v = Math.round(Number(n));
    if (!Number.isFinite(v) || v <= 0) return;
    const val = Math.max(3, Math.min(30, v));
    audio.click();
    if (val === settings.wordsPerPage) return;
    store.updateSettings({ wordsPerPage: val });
    bumpStoreVersion();
    window.setTimeout(() => window.location.reload(), 350);
  };

  /** 设定每日新词页（1~10） */
  const applyDailyPages = (n: number) => {
    const v = Math.round(Number(n));
    if (!Number.isFinite(v) || v <= 0) return;
    audio.click();
    store.updateSettings({ dailyNewPages: Math.max(1, Math.min(10, v)) });
    bumpStoreVersion();
  };

  const speechSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;
  const standalone = isStandalone();
  const installable = canInstall();
  const info = browserInfo();

  useEffect(() => {
    const onInstallable = () => setInstallTick((t) => t + 1);
    const onStorageFail = () => setStorageWarn(true);
    window.addEventListener('dsh-installable', onInstallable);
    window.addEventListener('dsh-installed', onInstallable);
    window.addEventListener('dsh-storage-failed', onStorageFail);
    // 语音包是异步加载的：挂载后再刷两次，避免刚进来显示 0 个
    const refresh = () => setDiag(voiceDiagnose());
    const t1 = window.setTimeout(refresh, 800);
    const t2 = window.setTimeout(refresh, 2500);
    try {
      window.speechSynthesis?.addEventListener?.('voiceschanged', refresh);
    } catch {
      /* 忽略 */
    }
    return () => {
      window.removeEventListener('dsh-installable', onInstallable);
      window.removeEventListener('dsh-installed', onInstallable);
      window.removeEventListener('dsh-storage-failed', onStorageFail);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      try {
        window.speechSynthesis?.removeEventListener?.('voiceschanged', refresh);
      } catch {
        /* 忽略 */
      }
    };
  }, []);

  const toggle = (key: 'soundOn' | 'animationOn' | 'speechOn') => {
    audio.click();
    const next = !settings[key];
    store.updateSettings({ [key]: next });
    if (key === 'animationOn') {
      document.body.classList.toggle('no-anim', !next);
    }
    bumpStoreVersion();
  };

  const pickTheme = (id: ThemeId) => {
    audio.click();
    store.updateSettings({ theme: id });
    applyTheme(id);
    bumpStoreVersion();
  };

  // ---------- 进度导出 ----------
  const download = (json: string, filename: string) => {
    downloadText(json, filename, 'application/json');
  };

  const exportOne = (lv: LevelDef) => {
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    download(exportLevelProgress(lv.id), `单词手账-${lv.name}-进度-${date}.json`);
    setImportMsg(`✅ 已导出「${lv.name}」的进度文件`);
  };

  const exportAll = () => {
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    download(exportAllProgress(levels.map((l) => l.id)), `单词手账-三词库进度-${date}.json`);
    setImportMsg('✅ 已导出三级 / 四级 / 六级 全部进度');
  };

  const exportWords = () => {
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    downloadText(buildWordCsv(bank.words, store), `单词手账-${level.name}词表-${date}.csv`, 'text/csv;charset=utf-8');
    setImportMsg(`✅ 已导出「${level.name}」${bank.words.length} 个词条（CSV，Excel 可直接打开）`);
  };

  // ---------- 进度导入 ----------
  const importData = (file: File, targetLevelId: string) => {
    const target = levels.find((l) => l.id === targetLevelId) ?? level;
    const reader = new FileReader();
    reader.onload = () => {
      const r = importIntoLevel(String(reader.result ?? ''), target.id);
      if (r.ok) {
        setImportMsg(`✅ 已导入到「${target.name}」：${r.words} 条词记录，马上刷新…`);
        bumpStoreVersion();
        setTimeout(() => window.location.reload(), 1200);
      } else {
        setImportMsg(`❌ 导入失败：${r.error ?? '文件格式无效'}`);
      }
    };
    reader.onerror = () => setImportMsg('❌ 读取文件失败');
    reader.readAsText(file, 'utf-8');
  };

  // ---------- 重置（按词库） ----------
  const doReset = (lv: LevelDef) => {
    resetLevelProgress(lv.id);
    setConfirmReset(null);
    if (lv.id === level.id) {
      window.location.reload();
    } else {
      setImportMsg(`✅ 已清空「${lv.name}」的进度`);
      bumpStoreVersion();
    }
  };

  // ---------- 安装 ----------
  const doInstall = async () => {
    const r = await promptInstall();
    if (r === 'accepted') setInstallMsg('✅ 已添加到主屏幕');
    else if (r === 'dismissed') setInstallMsg('已取消（随时可以再点一次）');
    else {
      setInstallMsg('当前浏览器没有弹出安装窗，看看下面的分步说明');
      setShowInstallHelp(true);
    }
  };

  const doCopy = async () => {
    const ok = await copyCurrentUrl();
    setCopied(ok);
    setInstallMsg(ok ? '✅ 链接已复制，去 Chrome / 自带浏览器粘贴打开' : '复制失败，请长按地址栏手动复制');
    if (ok) setTimeout(() => setCopied(false), 4000);
  };

  // ---------- 反馈 ----------
  const feedbackSubject = encodeURIComponent('单词手账 使用反馈');
  const feedbackBody = encodeURIComponent(
    `${feedbackText}\n\n——\n来自：单词手账（${level.name}）\n时间：${new Date().toLocaleString('zh-CN')}`,
  );
  const sendMail = () => {
    window.location.href = `mailto:717075493@qq.com?subject=${feedbackSubject}&body=${feedbackBody}`;
    setFeedbackMsg('已打开邮件应用，发送即可；没装邮件应用就点「复制内容」发到 QQ：717075493');
  };
  const copyFeedback = async () => {
    const text = `【单词手账反馈】\n${feedbackText}\n\n来自：${level.name} · ${new Date().toLocaleString('zh-CN')}`;
    try {
      await navigator.clipboard.writeText(text);
      setFeedbackMsg('✅ 已复制，可以直接粘贴发给 QQ 717075493 或邮箱 717075493@qq.com');
    } catch {
      setFeedbackMsg('复制失败，请手动复制：QQ 717075493 / 邮箱 717075493@qq.com');
    }
  };

  return (
    <>
      <TopBar title="⚙️ 设置" backTo={{ name: 'home' }} />
      <main className="screen">
        <div className="segmented settings-tabs" role="tablist" aria-label="设置分类">
          {TABS.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              className={`segment${tab === t.key ? ' active' : ''}`}
              onClick={() => {
                audio.click();
                setTab(t.key);
              }}
            >
              <span aria-hidden="true">{t.icon}</span>
              {t.label}
            </button>
          ))}
        </div>

        {storageWarn && (
          <div className="card storage-warn" role="alert">
            <p className="card-title" style={{ margin: 0 }}>
              ⚠️ 本地存储写不进去了
            </p>
            <p className="progress-note">
              进度可能保存失败（浏览器空间满了，或开了无痕模式）。先去下面的「数据」页导出备份，再重置不用的词库。
            </p>
          </div>
        )}

        {/* ================= 学习 ================= */}
        {tab === 'learn' && (
          <>
            <div className="card">
              <p className="card-title">📚 当前词库</p>
              <div className="level-grid" role="radiogroup" aria-label="选择词库">
                {levels.map((lv) => {
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
                    </button>
                  );
                })}
              </div>
              <p className="progress-note" style={{ marginTop: 6 }}>
                {level.fullName} · 三个词库的进度、错词、复习计划都分开保存。
              </p>
              <p className="progress-note">
                学习顺序：按语料词频从高到低（最常用的冠词、代词等已排到每套词库的最后，避免一上来背 the / a）。
              </p>
            </div>

            <div className="card">
              <p className="card-title">📋 每天学多少</p>
              <p className="progress-note">每日新词页</p>
              <div className="plan-row" style={{ flexWrap: 'wrap' }}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    className={`chip${settings.dailyNewPages === n ? ' selected' : ''}`}
                    onClick={() => applyDailyPages(n)}
                  >
                    {n} 页
                  </button>
                ))}
                {![1, 2, 3, 4, 5].includes(settings.dailyNewPages) && (
                  <button className="chip selected" onClick={() => applyDailyPages(settings.dailyNewPages)}>
                    {settings.dailyNewPages} 页（自定义）
                  </button>
                )}
              </div>
              <div className="num-row">
                <input
                  className="num-input"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={10}
                  value={dailyInput}
                  placeholder="1~10"
                  onChange={(e) => setDailyInput(e.target.value)}
                  aria-label="自定义每日新词页"
                />
                <button className="btn btn-secondary" onClick={() => applyDailyPages(Number(dailyInput))} disabled={!dailyInput}>
                  设定
                </button>
              </div>

              <p className="progress-note" style={{ marginTop: 14 }}>
                每页词数（{settings.wordsPerPage} 词）
              </p>
              <div className="plan-row" style={{ flexWrap: 'wrap' }}>
                {[6, 8, 10, 12, 15, 20].map((n) => (
                  <button
                    key={n}
                    className={`chip${settings.wordsPerPage === n ? ' selected' : ''}`}
                    onClick={() => applyPageSize(n)}
                  >
                    {n} 词
                  </button>
                ))}
                {![6, 8, 10, 12, 15, 20].includes(settings.wordsPerPage) && (
                  <button className="chip selected" onClick={() => applyPageSize(settings.wordsPerPage)}>
                    {settings.wordsPerPage} 词（自定义）
                  </button>
                )}
              </div>
              <div className="num-row">
                <input
                  className="num-input"
                  type="number"
                  inputMode="numeric"
                  min={3}
                  max={30}
                  value={pageInput}
                  placeholder="3~30"
                  onChange={(e) => setPageInput(e.target.value)}
                  aria-label="自定义每页词数"
                />
                <button className="btn btn-secondary" onClick={() => applyPageSize(Number(pageInput))} disabled={!pageInput}>
                  设定
                </button>
              </div>
              <p className="progress-note" style={{ marginTop: 8 }}>
                改「每页词数」会重新划分词页（学习进度不受影响），页面会自动刷新一次。
              </p>
            </div>

            <div className="card">
              <p className="card-title">✍️ 拼写题方式</p>
              {SPELLING_OPTIONS.map((o) => (
                <button
                  key={o.key}
                  className={`mode-row${settings.spellingMode === o.key ? ' selected' : ''}`}
                  onClick={() => {
                    audio.click();
                    store.updateSettings({ spellingMode: o.key });
                    bumpStoreVersion();
                  }}
                  aria-pressed={settings.spellingMode === o.key}
                >
                  <span>
                    <span className="setting-label">{o.label}</span>
                    <span className="setting-sub">{o.sub}</span>
                  </span>
                  <span className="mode-check">{settings.spellingMode === o.key ? '✓' : ''}</span>
                </button>
              ))}
              <p className="progress-note">选中后立刻生效，不用等下一局。每次会话最多 20 个拼写词。</p>
            </div>
          </>
        )}

        {/* ================= 声音 ================= */}
        {tab === 'sound' && (
          <>
            <div className="card">
              <p className="card-title">🔊 开关</p>
              <div className="setting-row">
                <div>
                  <div className="setting-label">音效</div>
                  <div className="setting-sub">答题对错的提示音</div>
                </div>
                <button
                  className={`switch${settings.soundOn ? ' on' : ''}`}
                  role="switch"
                  aria-checked={settings.soundOn}
                  aria-label="音效开关"
                  onClick={() => toggle('soundOn')}
                />
              </div>
              <div className="setting-row">
                <div>
                  <div className="setting-label">单词朗读</div>
                  <div className="setting-sub">{speechSupported ? '点 🔊 朗读（系统语音或在线发音）' : '当前浏览器不支持系统朗读，会自动用在线发音'}</div>
                </div>
                <button
                  className={`switch${settings.speechOn ? ' on' : ''}`}
                  role="switch"
                  aria-checked={settings.speechOn}
                  aria-label="单词朗读开关"
                  onClick={() => toggle('speechOn')}
                />
              </div>
              <div className="setting-row">
                <div>
                  <div className="setting-label">动画</div>
                  <div className="setting-sub">翻卡、盖章等过渡动画</div>
                </div>
                <button
                  className={`switch${settings.animationOn ? ' on' : ''}`}
                  role="switch"
                  aria-checked={settings.animationOn}
                  aria-label="动画开关"
                  onClick={() => toggle('animationOn')}
                />
              </div>
            </div>

            <div className="card">
              <p className="card-title">🗣️ 发音</p>
              <p className="progress-note">
                {!diag.supported
                  ? '语音检测：这台设备的浏览器没有系统语音合成功能，只能用在线发音'
                  : `语音检测：系统语音 ${diag.total} 个，英文语音 ${diag.english} 个${
                      diag.english === 0
                        ? '（本机没有英文语音包 → 现在走在线发音）'
                        : `（${diag.names[0] ?? ''}）→ 现在走系统朗读`
                    }`}
              </p>
              <div className="setting-row">
                <div>
                  <div className="setting-label">在线发音兜底</div>
                  <div className="setting-sub">本机没有英文语音包时，联网取词典发音（约 15KB/词）</div>
                </div>
                <button
                  className={`switch${settings.onlineAudio !== false ? ' on' : ''}`}
                  role="switch"
                  aria-checked={settings.onlineAudio !== false}
                  aria-label="在线发音开关"
                  onClick={() => {
                    audio.click();
                    store.updateSettings({ onlineAudio: !(settings.onlineAudio !== false) });
                    bumpStoreVersion();
                  }}
                />
              </div>
              <div className="setting-row">
                <div>
                  <div className="setting-label">只用在线发音</div>
                  <div className="setting-sub">
                    系统语音显示有英文、但点 🔊 就是不出声时打开：彻底绕开手机语音引擎（需要联网）
                  </div>
                </div>
                <button
                  className={`switch${settings.forceOnlineAudio ? ' on' : ''}`}
                  role="switch"
                  aria-checked={settings.forceOnlineAudio === true}
                  aria-label="只用在线发音"
                  onClick={() => {
                    audio.click();
                    store.updateSettings({ forceOnlineAudio: !(settings.forceOnlineAudio === true) });
                    bumpStoreVersion();
                  }}
                />
              </div>
              <div className="setting-row">
                <div>
                  <div className="setting-label">发音口音</div>
                  <div className="setting-sub">系统语音和在线发音都按这个选（英音只有部分引擎 / 在线源有）</div>
                </div>
                <div className="accent-switch" role="radiogroup" aria-label="发音口音">
                  <button
                    className={`chip${settings.accent !== 'uk' ? ' selected' : ''}`}
                    role="radio"
                    aria-checked={settings.accent !== 'uk'}
                    onClick={() => {
                      audio.click();
                      store.updateSettings({ accent: 'us' });
                      bumpStoreVersion();
                    }}
                  >
                    美音
                  </button>
                  <button
                    className={`chip${settings.accent === 'uk' ? ' selected' : ''}`}
                    role="radio"
                    aria-checked={settings.accent === 'uk'}
                    onClick={() => {
                      audio.click();
                      store.updateSettings({ accent: 'uk' });
                      bumpStoreVersion();
                    }}
                  >
                    英音
                  </button>
                </div>
              </div>
              <div className="result-actions">
                <button
                  className="btn btn-secondary"
                  onClick={() => {
                    audio.speechOn = true;
                    const r = audio.speak('vocabulary');
                    setDiag(voiceDiagnose());
                    if (r === 'ok') setVoiceMsg('✅ 已交给系统朗读（有声音就说明语音包可用）');
                    else if (r === 'ok-online') setVoiceMsg('✅ 本机没有英文语音包，已改用在线发音（有道 / 百度自动切换）');
                    else setVoiceMsg('❌ 系统朗读和在线发音都没起来，看下面「先做这两个判断」');
                  }}
                >
                  🔊 测试朗读 vocabulary
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={() => {
                    audio.speechOn = true;
                    const r = audio.speakOnline('vocabulary');
                    setManualSrc(audio.lastOnlineUrl);
                    if (r === 'ok-online') setVoiceMsg(`✅ 正在用「${audio.lastOnlineSource ?? '在线发音'}」播放；听到声音说明网络和浏览器都没问题`);
                    else setVoiceMsg('❌ 在线发音没起来：先点右边的「测通道」，看是网络不通还是浏览器拦了自动播放');
                  }}
                >
                  🌐 测试在线发音
                </button>
                <button
                  className="btn btn-plain"
                  onClick={async () => {
                    setProbeMsg('正在测在线发音服务器…');
                    const rows = await audio.probeOnline('vocabulary');
                    setProbeMsg(rows.map((x) => `${x.source}：${x.ok ? '✅ 通' : '❌ 不通'}（${x.ms}ms）`).join('　·　'));
                  }}
                >
                  🧪 测通道
                </button>
                <button className="btn btn-plain" onClick={() => { setDiag(voiceDiagnose()); setVoiceMsg(null); }}>
                  🔄 重新检测
                </button>
              </div>
              {voiceMsg && (
                <p className="progress-note" role="status">
                  {voiceMsg}
                </p>
              )}
              {probeMsg && (
                <p className="progress-note" role="status">
                  {probeMsg}
                </p>
              )}
              {manualSrc && (
                <div style={{ marginTop: 8 }}>
                  <p className="progress-note">自动播放被拦或没声音时，点下面的播放器手动放一次：</p>
                  <audio controls src={manualSrc} style={{ width: '100%' }} />
                </div>
              )}

              <details className="speech-help">
                <summary>点 🔊 没声音？先做通用三步，再按手机品牌查</summary>

                <div className="guide-block guide-callout">
                  <p className="guide-brand">通用三步（所有手机都先做这个）</p>
                  <ol className="guide-steps">
                    <li>设置里搜「文字转语音」或「TTS」，进到「文字转语音输出」页面。</li>
                    <li>
                      看「首选引擎」：只留一个带英文的引擎；点它的设置 / 齿轮，安装「英语（美国）」语音数据。
                    </li>
                    <li>
                      在同一页点「播放」或「试听」：有声音 → 回本页点「测试朗读」；
                      没声音 → 这个引擎没有英文数据，换引擎，或回本页打开「只用在线发音」。
                    </li>
                  </ol>
                </div>

                <div className="guide-block">
                  <p className="guide-brand">小米 / 红米（HyperOS / MIUI）</p>
                  <ol className="guide-steps">
                    <li>设置 → 更多设置 → 无障碍 → 文字转语音（TTS）输出（部分版本在「无障碍 → 视觉」）</li>
                    <li>首选引擎：默认「系统语音引擎」一般没有英文；换成「讯飞语音引擎」或「Google 文字转语音」</li>
                    <li>
                      安全下载：在官方商店里搜「讯飞语音引擎」，认准开发者「科大讯飞」——
                      <a href="https://sj.qq.com/search?q=%E8%AE%AF%E9%A3%9E%E8%AF%AD%E9%9F%B3%E5%BC%95%E6%93%8E" target="_blank" rel="noopener noreferrer">应用宝</a>
                      {' · '}
                      <a href="https://appgallery.huawei.com/search/%E8%AE%AF%E9%A3%9E%E8%AF%AD%E9%9F%B3%E5%BC%95%E6%93%8E" target="_blank" rel="noopener noreferrer">华为应用市场</a>
                      {' · '}
                      <a href="https://app.mi.com/search?keywords=%E8%AE%AF%E9%A3%9E%E8%AF%AD%E9%9F%B3%E5%BC%95%E6%93%8E" target="_blank" rel="noopener noreferrer">小米应用商店</a>
                      。
                      讯飞官网 xfyun.cn 是开发者平台，没有消费级 APK 直链；网盘 / 下载站的安装包一律别装。
                    </li>
                    <li>点引擎右侧齿轮 → 安装语音数据 → 英语（美国）→ 下载</li>
                    <li>语言选英语（美国），语速中间，回上一层点「播放」试听</li>
                    <li>没声音就别再改语言了，换引擎；装不了就打开本页「只用在线发音」</li>
                  </ol>
                </div>

                <div className="guide-block">
                  <p className="guide-brand">华为 / 荣耀（HarmonyOS / EMUI）</p>
                  <ol className="guide-steps">
                    <li>设置 → 辅助功能 → 无障碍 → 文字转语音（部分版本在「智慧助手 → 语音」）</li>
                    <li>首选引擎保持「华为语音引擎」；没有英文就装「讯飞语音引擎」再选它</li>
                    <li>进引擎右侧设置 → 安装语音数据 → 英语（美国）→ 下载</li>
                    <li>语言英语（美国），点「试听」</li>
                    <li>试听没声 → 换引擎，或打开「只用在线发音」</li>
                  </ol>
                </div>

                <div className="guide-block">
                  <p className="guide-brand">OPPO / 一加 / realme（ColorOS）</p>
                  <ol className="guide-steps">
                    <li>设置 → 系统设置 → 无障碍 → 文字转语音</li>
                    <li>ColorOS 自带引擎多数没有英文，先装「讯飞语音引擎」</li>
                    <li>首选引擎选讯飞 → 语言英语（美国）→ 安装语音数据</li>
                    <li>点「试听」；没声就打开「只用在线发音」</li>
                  </ol>
                </div>

                <div className="guide-block">
                  <p className="guide-brand">vivo / iQOO（OriginOS）</p>
                  <ol className="guide-steps">
                    <li>设置 → 快捷与辅助 → 无障碍 → 文字转语音输出</li>
                    <li>首选引擎换成「讯飞语音引擎」或「Google 文字转语音」</li>
                    <li>语言英语（美国）→ 安装语音数据 → 点「播放」试听</li>
                    <li>没声就打开本页「只用在线发音」</li>
                  </ol>
                </div>

                <div className="guide-block">
                  <p className="guide-brand">三星（One UI）</p>
                  <ol className="guide-steps">
                    <li>设置 → 常规管理 → 语言和输入 → 文字转语音输出</li>
                    <li>首选引擎选 Samsung 或 Google → 齿轮 → 安装语音数据 → 英语（美国）</li>
                    <li>语言英语（美国），点「播放」试听</li>
                    <li>没声就打开「只用在线发音」</li>
                  </ol>
                </div>

                <div className="guide-block">
                  <p className="guide-brand">iPhone / iPad</p>
                  <ol className="guide-steps">
                    <li>设置 → 辅助功能 → 朗读内容 → 声音 → 英语 → 下载一个语音</li>
                    <li>确认左侧静音键没开、媒体音量不是 0</li>
                    <li>回本页点「测试朗读」</li>
                    <li>仍没声：用 Safari / Chrome 打开，或打开「只用在线发音」</li>
                  </ol>
                </div>

                <div className="guide-block">
                  <p className="guide-brand">电脑 Chrome / Edge</p>
                  <ol className="guide-steps">
                    <li>Windows：设置 → 时间和语言 → 语言和区域 → 添加英语（美国）→ 语言选项 → 下载语音包</li>
                    <li>Mac：系统设置 → 辅助功能 → 朗读内容 → 系统声音 → 管理声音 → 下载英语</li>
                    <li>检查标签页是否被静音（标签上的小喇叭）</li>
                    <li>回本页点「测试朗读」</li>
                  </ol>
                </div>

                <div className="guide-block">
                  <p className="guide-brand">微信 / QQ / 内置浏览器</p>
                  <ol className="guide-steps">
                    <li>这类浏览器常常没有语音合成，也会拦自动播放</li>
                    <li>点右上角「…」→「在浏览器中打开」，用 Chrome 或系统浏览器</li>
                    <li>再按上面的品牌步骤设置</li>
                  </ol>
                </div>

                <div className="guide-block">
                  <p className="guide-brand">在线发音（不想装引擎就用这个）</p>
                  <ol className="guide-steps">
                    <li>保持「在线发音兜底」打开，手机能上网</li>
                    <li>点「🌐 测试在线发音」：先有道，不通自动换百度</li>
                    <li>没反应就再点一次（浏览器可能拦自动播放），或换 Chrome</li>
                    <li>每句约 15~20KB 流量</li>
                  </ol>
                </div>

                <div className="guide-block">
                  <p className="guide-brand">两个都试过还是没声音</p>
                  <ol className="guide-steps">
                    <li>把本页「语音检测：系统语音 X 个，英文语音 X 个」那行截图发我</li>
                    <li>说一下手机品牌 + 在哪个浏览器里打开</li>
                    <li>再说一句：点 🔊 时是完全没声，还是有一声“哒”</li>
                  </ol>
                </div>
              </details>
            </div>
          </>
        )}

        {/* ================= 外观 ================= */}
        {tab === 'look' && (
          <div className="card">
            <p className="card-title">🎨 主题色</p>
            <p className="progress-note">换一套纸和胶带的颜色，选完立刻生效，下次打开还是它。</p>
            <div className="theme-grid" role="radiogroup" aria-label="主题色">
              {THEMES.map((t) => {
                const active = (settings.theme ?? 'paper') === t.id;
                return (
                  <button
                    key={t.id}
                    className={`theme-card${active ? ' active' : ''}`}
                    role="radio"
                    aria-checked={active}
                    onClick={() => pickTheme(t.id)}
                  >
                    <span className="theme-swatch" aria-hidden="true">
                      {t.swatch.map((c) => (
                        <span key={c} style={{ background: c }} />
                      ))}
                    </span>
                    <span className="theme-name">{t.name}</span>
                    <span className="theme-desc">{t.desc}</span>
                    {active && <span className="theme-check">✓</span>}
                  </button>
                );
              })}
            </div>
            <p className="progress-note">「夜航」是深色模式，关灯背词不刺眼；答题、目录、设置页都会跟着变。</p>
          </div>
        )}

        {/* ================= 数据 ================= */}
        {tab === 'data' && (
          <>
            <div className="card">
              <p className="card-title">📤 导出</p>
              <p className="progress-note">进度文件可以换手机、换浏览器继续用；词表 CSV 用来打印或自己整理。</p>
              <div className="backup-grid">
                {levels.map((lv) => (
                  <button key={lv.id} className="btn btn-secondary" onClick={() => exportOne(lv)}>
                    📤 导出{lv.name}进度
                  </button>
                ))}
                <button className="btn btn-primary" onClick={exportAll}>
                  📤 导出全部进度
                </button>
                <button className="btn btn-warm" onClick={exportWords}>
                  📄 导出{level.name}词表（CSV）
                </button>
              </div>
            </div>

            <div className="card">
              <p className="card-title">📥 导入</p>
              <p className="progress-note">选好目标词库，再选 .json 文件，导入后自动刷新。</p>
              <div className="backup-grid">
                {levels.map((lv) => (
                  <label key={lv.id} className="btn btn-secondary btn-file">
                    📥 导入到{lv.name}
                    <input
                      type="file"
                      accept="application/json,.json"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        setImportMsg(f ? `正在读取「${lv.name}」的进度文件…` : `已取消导入（目标：${lv.name}）`);
                        if (f) importData(f, lv.id);
                        e.target.value = '';
                      }}
                    />
                  </label>
                ))}
                <button className="btn btn-plain" onClick={() => setShowImportHelp(true)}>
                  ❓ 导入怎么用
                </button>
              </div>
              {importMsg && (
                <p className="progress-note" role="status">
                  {importMsg}
                </p>
              )}
            </div>

            <div className="card">
              <p className="card-title">⚠️ 重置</p>
              <p className="progress-note">三个词库各自独立，点哪个就清空哪个；清空前建议先导出。</p>
              <div className="backup-grid">
                {levels.map((lv) => (
                  <button key={lv.id} className="btn btn-danger" onClick={() => setConfirmReset(lv)}>
                    🗑️ 重置{lv.name}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {/* ================= 关于 ================= */}
        {tab === 'about' && (
          <>
            <div className="card">
              <p className="card-title">ℹ️ 关于单词手账</p>
              <p className="progress-note" style={{ lineHeight: 1.9 }}>
                三级 {levels.find((l) => l.id === 'cet3')?.wordCount ?? 0} 词 / 四级{' '}
                {levels.find((l) => l.id === 'cet4')?.wordCount ?? 0} 词 / 六级{' '}
                {levels.find((l) => l.id === 'cet6')?.wordCount ?? 0} 词，进度分开保存。
                <br />
                每局顺序：英译中 → 中译英 → 语境填空 → 拼写（每次最多 20 个）；复习按艾宾浩斯曲线排期。
                <br />
                学习顺序：按词频从高到低；最基础的常用词和虚词排在每套词库最后。
                <br />
                <strong>开发者：刘晨曦</strong>
                <br />
                版本 2.7 · lcx2008.github.io/cet4-handbook
              </p>
            </div>

            <div className="card">
              <p className="card-title">🧩 关于词库重叠</p>
              <p className="progress-note" style={{ lineHeight: 1.8 }}>
                三套词库来自不同词表，同一个单词可能同时属于两级（例如某个词既在高中大纲、也在六级词表里）。
                答题页左上角一直标着当前词库，切换词库时也会整局重开——如果你看到「三级里出了六级词」，
                先看这个标记；确实是标记词库之外的词，请把单词发我。
              </p>
            </div>

            <div className="card">
              <p className="card-title">💬 建议与反馈</p>
              <p className="progress-note">
                发现问题、想要新功能、或者哪里用着别扭，都可以告诉我：
                <br />
                QQ：<strong>717075493</strong>　邮箱：<strong>717075493@qq.com</strong>
              </p>
              <button className="btn btn-primary" style={{ width: '100%' }} onClick={() => setShowFeedback(true)}>
                ✍️ 写反馈
              </button>
            </div>

            <div className="card">
              <p className="card-title">📲 添加到主屏幕</p>
              {standalone ? (
                <p className="progress-note">✅ 已经以独立窗口运行（已添加到主屏幕）。</p>
              ) : (
                <>
                  {installable ? (
                    <button className="btn btn-primary" style={{ width: '100%' }} onClick={doInstall}>
                      📲 一键添加到主屏幕
                    </button>
                  ) : (
                    <button className="btn btn-primary" style={{ width: '100%' }} onClick={doCopy}>
                      {copied ? '✅ 链接已复制' : '📋 复制链接（换浏览器打开）'}
                    </button>
                  )}
                  <button className="btn btn-secondary" style={{ width: '100%', marginTop: 8 }} onClick={() => setShowInstallHelp(true)}>
                    📖 各品牌手机怎么添加（分步说明）
                  </button>
                  <p className="progress-note" style={{ marginTop: 8 }}>
                    {installGuide(info)}
                  </p>
                  {installMsg && <p className="progress-note">{installMsg}</p>}
                </>
              )}
              <p className="progress-note">添加到主屏幕后可以全屏打开，断网也能继续背。</p>
            </div>
          </>
        )}
      </main>

      {/* ---------- 安装教程 ---------- */}
      {showInstallHelp && (
        <div className="modal-mask" role="dialog" aria-modal="true" aria-labelledby="install-title">
          <div className="modal-card wide">
            <p className="modal-title" id="install-title">
              各品牌手机怎么添加到主屏幕
            </p>
            <div className="modal-body" style={{ textAlign: 'left', maxHeight: '58vh', overflowY: 'auto' }}>
              {INSTALL_GUIDE.map((g) => (
                <div key={g.brand} className="guide-block">
                  <p className="guide-brand">{g.brand}</p>
                  <ol className="guide-steps">
                    {g.steps.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ol>
                </div>
              ))}
              <p className="progress-note" style={{ marginTop: 8 }}>
                找不到的话：点「复制链接」，把网址发给自己，再用 Chrome 或手机自带浏览器打开，按上面步骤操作。
              </p>
            </div>
            <div className="modal-actions">
              <button className="btn btn-plain" onClick={() => setShowInstallHelp(false)}>
                关闭
              </button>
              <button className="btn btn-primary" onClick={doCopy}>
                {copied ? '✅ 已复制' : '📋 复制链接'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---------- 导入教程 ---------- */}
      {showImportHelp && (
        <div className="modal-mask" role="dialog" aria-modal="true" aria-labelledby="import-title">
          <div className="modal-card wide">
            <p className="modal-title" id="import-title">
              怎么导入学习进度
            </p>
            <div className="modal-body" style={{ textAlign: 'left', lineHeight: 1.9 }}>
              <ol className="guide-steps" style={{ paddingLeft: 18 }}>
                <li>
                  先切换到你想要导入的<strong>词库</strong>（三级 / 四级 / 六级）
                </li>
                <li>点「📥 导入到{level.name}」，手机会弹出文件选择框</li>
                <li>
                  找到之前导出的 <strong>.json</strong> 文件（一般在下面这些位置）：
                </li>
              </ol>
              <ul className="guide-steps" style={{ paddingLeft: 34, listStyle: 'disc' }}>
                <li>安卓手机：文件管理 →「下载 / Download」文件夹</li>
                <li>iPhone：文件 App →「下载」或「我的 iPhone → 最近项目」</li>
                <li>电脑：浏览器的「下载」文件夹</li>
              </ul>
              <ol className="guide-steps" start={4} style={{ paddingLeft: 18 }}>
                <li>选中文件后会自动导入，页面刷新一次即完成</li>
              </ol>
              <p className="progress-note" style={{ marginTop: 6 }}>
                说明：导入会<strong>覆盖当前词库</strong>的进度；导错了不要紧，重新导入一次正确的就行。三合一的文件也能导入，会自动取出对应词库的那一份。
              </p>
            </div>
            <div className="modal-actions">
              <button className="btn btn-primary" onClick={() => setShowImportHelp(false)}>
                知道了
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---------- 反馈 ---------- */}
      {showFeedback && (
        <div className="modal-mask" role="dialog" aria-modal="true" aria-labelledby="fb-title">
          <div className="modal-card wide">
            <p className="modal-title" id="fb-title">
              写反馈
            </p>
            <div className="modal-body" style={{ textAlign: 'left' }}>
              <textarea
                className="feedback-input"
                value={feedbackText}
                onChange={(e) => setFeedbackText(e.target.value)}
                placeholder="比如：拼写题太长了 / 想要夜间模式 / 某个词的解释不对……"
                rows={6}
                aria-label="反馈内容"
              />
              {feedbackMsg && <p className="progress-note">{feedbackMsg}</p>}
              <p className="progress-note">
                会发到：QQ <strong>717075493</strong> / 邮箱 <strong>717075493@qq.com</strong>
              </p>
            </div>
            <div className="modal-actions">
              <button className="btn btn-plain" onClick={() => setShowFeedback(false)}>
                关闭
              </button>
              <button className="btn btn-secondary" onClick={copyFeedback} disabled={!feedbackText.trim()}>
                📋 复制内容
              </button>
              <button className="btn btn-primary" onClick={sendMail} disabled={!feedbackText.trim()}>
                📧 邮件发送
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---------- 重置确认 ---------- */}
      {confirmReset && (
        <div className="modal-mask" role="dialog" aria-modal="true" aria-labelledby="reset-title">
          <div className="modal-card">
            <p className="modal-title" id="reset-title">
              确认重置「{confirmReset.name}」的进度？
            </p>
            <p className="modal-body">
              只会清空{confirmReset.name}词库的单词状态、星级、连续天数与错词记录。
              {levels
                .filter((l) => l.id !== confirmReset.id)
                .map((l) => l.name)
                .join('、')}{' '}
              的进度不受影响。
            </p>
            <div className="modal-actions">
              <button className="btn btn-plain" onClick={() => setConfirmReset(null)}>
                取消
              </button>
              <button className="btn btn-danger" onClick={() => doReset(confirmReset)}>
                确认重置{confirmReset.name}
              </button>
            </div>
          </div>
        </div>
      )}
      <BottomNav active="settings" />
    </>
  );
}
