import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRoute } from '../router';
import { useApp } from '../state/AppContext';
import { BottomNav, Tape, TopBar } from './shared';
import ReadAloud from './ReadAloud';
import { audio } from '../core/audioFeedback';
import type { WordEntry } from '../types';

interface Sentence {
  en: string;
  zh: string;
}
interface Passage {
  id: string;
  title: string;
  topic: string;
  sentences: Sentence[];
  keywords: { word: string; meaning: string }[];
}
interface DailyData {
  schemaVersion: string;
  passages: Passage[];
}

interface NewsItem {
  title: string;
  url: string;
  points: number;
  time: number;
  source: string;
}

const NEWS_CACHE_KEY = 'dsh-news-cache-v1';
const NEWS_TTL = 30 * 60 * 1000;

/** 兜底：新闻源连不上时，给几个能练英语的固定入口（不编造标题） */
const FALLBACK_LINKS: { name: string; url: string; note: string }[] = [
  { name: 'BBC Learning English', url: 'https://www.bbc.co.uk/learningenglish/', note: '短新闻 + 地道表达' },
  { name: 'VOA Learning English', url: 'https://learningenglish.voanews.com/', note: '语速慢，适合跟读' },
  { name: 'China Daily', url: 'https://www.chinadaily.com.cn/', note: '中国新闻英文版' },
  { name: 'NASA Breaking News', url: 'https://www.nasa.gov/news/', note: '科技前沿，句子短' },
];

function dayOfYear(d = new Date()): number {
  const start = new Date(d.getFullYear(), 0, 0);
  return Math.floor((d.getTime() - start.getTime()) / 86400000);
}

function fmtTime(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${Math.max(1, mins)} 分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

export default function DailyScreen({ initialTab = 'recite' }: { initialTab?: 'recite' | 'news' | 'read' }) {
  const [, navigate] = useRoute();
  const { bank, level } = useApp();
  const [tab, setTab] = useState<'recite' | 'news' | 'read'>(initialTab);

  // 从别的页面点「英语新闻」进来时，路由里的 tab 变了要跟着切
  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);
  const [data, setData] = useState<DailyData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // ---------- 每日一诵 ----------
  const [playing, setPlaying] = useState<number | null>(null);
  const [shadow, setShadow] = useState(false);
  const [rate, setRate] = useState(0.85);
  const [showZh, setShowZh] = useState(true);
  const [hint, setHint] = useState<string | null>(null);
  const [canRetry, setCanRetry] = useState(false);
  const stopRef = useRef(true);
  const timerRef = useRef<number | null>(null);
  const shadowRef = useRef(false);

  useEffect(() => {
    fetch('./data/daily.json')
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<DailyData>;
      })
      .then(setData)
      .catch((e: unknown) => setLoadError(e instanceof Error ? e.message : String(e)));
  }, []);

  const passage = useMemo(() => {
    if (!data || data.passages.length === 0) return null;
    return data.passages[dayOfYear() % data.passages.length];
  }, [data]);

  /** 短文 / 每日五句（从当前词库真实例句里抽，量足够大） */
  const [mode, setMode] = useState<'passage' | 'sentences'>('passage');
  const five = useMemo(() => pickDailySentences(bank.words, dayOfYear()), [bank]);
  const lines: { en: string; zh: string; word?: string; meaning?: string }[] = useMemo(
    () => (mode === 'passage' ? (passage?.sentences ?? []) : five),
    [mode, passage, five],
  );

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const stop = useCallback(() => {
    stopRef.current = true;
    clearTimer();
    audio.stopSpeaking();
    setPlaying(null);
  }, []);

  useEffect(() => () => stop(), [stop]);

  // 在线发音也放不出来时，别让「正在读第 N 句」卡死
  useEffect(() => {
    const onFail = (e: Event) => {
      const reason = (e as CustomEvent<{ reason?: string }>).detail?.reason;
      stop();
      setCanRetry(true);
      setHint(
        reason === 'blocked'
          ? '浏览器拦截了自动播放：点下面的「重试」再放一次（还不行就在浏览器设置里允许声音）'
          : '在线发音连不上（有道、百度两个源都试过了）：检查网络后再点「重试」',
      );
    };
    window.addEventListener('dsh-speak-failed', onFail);
    return () => window.removeEventListener('dsh-speak-failed', onFail);
  }, [stop]);

  const playLines = (sentences: { en: string; zh: string }[], start: number) => {
    if (sentences.length === 0) return;
    stop();
    setCanRetry(false);
    setHint(null);
    stopRef.current = false;
    const step = (i: number) => {
      if (stopRef.current || i >= sentences.length) {
        setPlaying(null);
        return;
      }
      setPlaying(i);
      const text = sentences[i].en;
      const res = audio.speak(text, {
        rate,
        onEnd: () => {
          if (stopRef.current) return;
          const words = text.split(/\s+/).filter(Boolean).length;
          const pause = shadowRef.current ? Math.max(1600, Math.min(6500, words * 420)) : 240;
          timerRef.current = window.setTimeout(() => step(i + 1), pause);
        },
      });
      if (res === 'no-voice' || res === 'unsupported' || res === 'off') {
        stopRef.current = true;
        setPlaying(null);
        setCanRetry(res !== 'off');
        setHint(
          res === 'off'
            ? '朗读开关关着，去「设置 → 声音」打开'
            : '这台设备没有能用的英文发音，去「设置 → 声音 → 发音」点「测试在线发音」看是哪种情况',
        );
      }
    };
    // 必须在点击的同一个调用栈里播，晚一点点都可能被浏览器判成「非用户操作」而拦截
    step(start);
  };

  const togglePlay = () => {
    if (playing !== null) stop();
    else playLines(lines, 0);
  };

  // ---------- 英语新闻 ----------
  const [news, setNews] = useState<NewsItem[] | null>(null);
  const [newsState, setNewsState] = useState<'idle' | 'loading' | 'ok' | 'fail'>('idle');
  const [newsHint, setNewsHint] = useState<string | null>(null);
  /** 点开哪条新闻：在应用内弹层里看，不直接跳走 */
  const [newsOpen, setNewsOpen] = useState<NewsItem | null>(null);
  const [newsCopyMsg, setNewsCopyMsg] = useState<string | null>(null);

  const loadNews = useCallback(async (force = false) => {
    setNewsState('loading');
    setNewsHint(null);
    try {
      const raw = localStorage.getItem(NEWS_CACHE_KEY);
      if (!force && raw) {
        const cache = JSON.parse(raw) as { at: number; items: NewsItem[] };
        if (Date.now() - cache.at < NEWS_TTL && Array.isArray(cache.items) && cache.items.length > 0) {
          setNews(cache.items);
          setNewsState('ok');
          return;
        }
      }
    } catch {
      /* 缓存坏了就重下 */
    }
    try {
      const ctrl = new AbortController();
      const timeout = window.setTimeout(() => ctrl.abort(), 9000);
      const res = await fetch('https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=10', {
        signal: ctrl.signal,
      });
      window.clearTimeout(timeout);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as {
        hits?: { title?: string; url?: string; points?: number; created_at_i?: number; objectID?: string }[];
      };
      const items: NewsItem[] = (json.hits ?? [])
        .filter((h) => Boolean(h.title))
        .map((h) => ({
          title: h.title!,
          url: h.url || `https://news.ycombinator.com/item?id=${h.objectID ?? ''}`,
          points: h.points ?? 0,
          time: (h.created_at_i ?? Math.floor(Date.now() / 1000)) * 1000,
          source: h.url ? safeHost(h.url) : 'news.ycombinator.com',
        }));
      if (items.length === 0) throw new Error('空列表');
      setNews(items);
      setNewsState('ok');
      setNewsHint('来自 Hacker News 今日头条，英文原文，点标题去原站看全文。');
      try {
        localStorage.setItem(NEWS_CACHE_KEY, JSON.stringify({ at: Date.now(), items }));
      } catch {
        /* 缓存失败不影响阅读 */
      }
    } catch {
      setNews(null);
      setNewsState('fail');
      setNewsHint('新闻源连不上（可能没网或被拦了）。下面这几个站可以手动打开，都是每天更新的英文材料。');
    }
  }, []);

  useEffect(() => {
    if (tab === 'news' && newsState === 'idle') void loadNews();
  }, [tab, newsState, loadNews]);

  const speak = (text: string) => {
    const r = audio.speak(text);
    if (r === 'no-voice' || r === 'unsupported' || r === 'off') {
      setHint('这台设备的英文发音不可用，设置页里有各机型的解决办法');
    }
  };

  return (
    <>
      <TopBar title="🎧 每日一听" backTo={{ name: 'home' }} />
      <main className="screen">
        <div className="segmented" role="tablist" aria-label="听力内容">
          <button
            role="tab"
            aria-selected={tab === 'recite'}
            className={`segment${tab === 'recite' ? ' active' : ''}`}
            onClick={() => {
              audio.click();
              stop();
              setTab('recite');
              navigate({ name: 'daily', tab: 'recite' });
            }}
          >
            🗣️ 每日一诵
          </button>
          <button
            role="tab"
            aria-selected={tab === 'news'}
            className={`segment${tab === 'news' ? ' active' : ''}`}
            onClick={() => {
              audio.click();
              stop();
              setTab('news');
              navigate({ name: 'daily', tab: 'news' });
            }}
          >
            📰 英语新闻
          </button>
          <button
            role="tab"
            aria-selected={tab === 'read'}
            className={`segment${tab === 'read' ? ' active' : ''}`}
            onClick={() => {
              audio.click();
              stop();
              setTab('read');
              navigate({ name: 'daily', tab: 'read' });
            }}
          >
            🎙 朗诵
          </button>
        </div>

        {tab === 'read' && <ReadAloud />}

        {tab === 'recite' && (
          <>
            {loadError && <p className="progress-note">每日一诵加载失败：{loadError}</p>}
            {!data && !loadError && <p className="load-hint">正在取出今天的短文……</p>}

            <div className="segmented recite-mode" role="tablist" aria-label="朗读内容">
              <button
                role="tab"
                aria-selected={mode === 'passage'}
                className={`segment${mode === 'passage' ? ' active' : ''}`}
                onClick={() => {
                  audio.click();
                  stop();
                  setMode('passage');
                }}
              >
                📖 短文
              </button>
              <button
                role="tab"
                aria-selected={mode === 'sentences'}
                className={`segment${mode === 'sentences' ? ' active' : ''}`}
                onClick={() => {
                  audio.click();
                  stop();
                  setMode('sentences');
                }}
              >
                🗣️ 每日五句
              </button>
            </div>

            {mode === 'passage' && passage && (
              <>
                <div className="card recite-head">
                  <Tape className="tape-mint" style={{ top: -12, left: 24, width: 76, transform: 'rotate(-3deg)' }} />
                  <p className="recite-kicker">
                    第 {dayOfYear() % data!.passages.length + 1} 期 · {passage.topic}
                  </p>
                  <h2 className="recite-title">{passage.title}</h2>
                  <p className="progress-note">
                    {passage.sentences.length} 句 · 约 {passage.sentences.reduce((n, s) => n + s.en.split(/\s+/).length, 0)} 词
                  </p>

                  <div className="recite-controls">
                    <button className="btn btn-primary" onClick={togglePlay}>
                      {playing !== null ? '⏸ 暂停' : '▶️ 整段播放'}
                    </button>
                    <button
                      className={`btn ${shadow ? 'btn-warm' : 'btn-secondary'}`}
                      onClick={() => {
                        const next = !shadow;
                        shadowRef.current = next;
                        setShadow(next);
                      }}
                      aria-pressed={shadow}
                    >
                      {shadow ? '🔁 跟读模式已开' : '🔁 跟读模式'}
                    </button>
                    <button className="btn btn-plain" onClick={() => setShowZh((v) => !v)}>
                      {showZh ? '🙈 收起翻译' : '👀 显示翻译'}
                    </button>
                  </div>
                  <div className="recite-rate" role="group" aria-label="语速">
                    {[
                      [0.75, '慢速'],
                      [0.85, '正常'],
                      [1, '稍快'],
                    ].map(([v, label]) => (
                      <button
                        key={String(v)}
                        className={`chip${rate === v ? ' selected' : ''}`}
                        onClick={() => setRate(v as number)}
                        aria-pressed={rate === v}
                      >
                        {label}
                      </button>
                    ))}
                    <span className="progress-note" style={{ marginLeft: 8 }}>
                      {playing !== null ? `正在读第 ${playing + 1} 句` : '点任意一句可以单句听'}
                    </span>
                  </div>
                  {hint && (
                    <div className="speak-hint-row">
                      <p className="progress-note speak-hint" style={{ margin: 0 }}>
                        {hint}
                      </p>
                      {canRetry && (
                        <button className="btn btn-secondary" onClick={() => playLines(lines, 0)}>
                          重试
                        </button>
                      )}
                    </div>
                  )}
                </div>

                <div className="recite-lines">
                  {passage.sentences.map((s, i) => (
                    <button
                      key={i}
                      className={`recite-line${playing === i ? ' active' : ''}`}
                      onClick={() => {
                        stop();
                        stopRef.current = false;
                        setCanRetry(false);
                        setHint(null);
                        setPlaying(i);
                        const r = audio.speak(s.en, { rate, onEnd: () => setPlaying(null) });
                        if (r === 'no-voice' || r === 'unsupported' || r === 'off') {
                          setPlaying(null);
                          setCanRetry(r !== 'off');
                          setHint('这台设备的英文发音不可用，去「设置 → 声音 → 发音」点「测试在线发音」看是哪种情况');
                        }
                      }}
                      aria-label={`朗读第 ${i + 1} 句`}
                    >
                      <span className="recite-index">{i + 1}</span>
                      <span className="recite-en">{s.en}</span>
                      {showZh && <span className="recite-zh">{s.zh}</span>}
                    </button>
                  ))}
                </div>

                {passage.keywords.length > 0 && (
                  <div className="card">
                    <p className="card-title">🔑 今天记这几个</p>
                    <div className="keyword-row">
                      {passage.keywords.map((k) => (
                        <button key={k.word} className="keyword-chip" onClick={() => speak(k.word)}>
                          <strong>{k.word}</strong>
                          <span>{k.meaning}</span>
                          <span aria-hidden="true">🔊</span>
                        </button>
                      ))}
                    </div>
                    <p className="progress-note">跟读要点：先听整句，再照着停顿自己说一遍，最后看一眼翻译。</p>
                  </div>
                )}
              </>
            )}

            {mode === 'sentences' && (
              <>
                <div className="card recite-head">
                  <Tape className="tape-mint" style={{ top: -12, left: 24, width: 76, transform: 'rotate(-3deg)' }} />
                  <p className="recite-kicker">
                    每日五句 · {level.name} · 第 {dayOfYear() + 1} 天
                  </p>
                  <h2 className="recite-title">从词库里抽五句</h2>
                  <p className="progress-note">都是词条自带的中英例句，每天换一批，不会重样。</p>

                  <div className="recite-controls">
                    <button className="btn btn-primary" onClick={togglePlay}>
                      {playing !== null ? '⏸ 暂停' : '▶️ 连播五句'}
                    </button>
                    <button
                      className={`btn ${shadow ? 'btn-warm' : 'btn-secondary'}`}
                      onClick={() => {
                        const next = !shadow;
                        shadowRef.current = next;
                        setShadow(next);
                      }}
                      aria-pressed={shadow}
                    >
                      {shadow ? '🔁 跟读模式已开' : '🔁 跟读模式'}
                    </button>
                    <button className="btn btn-plain" onClick={() => setShowZh((v) => !v)}>
                      {showZh ? '🙈 收起翻译' : '👀 显示翻译'}
                    </button>
                  </div>
                  <div className="recite-rate" role="group" aria-label="语速">
                    {[
                      [0.75, '慢速'],
                      [0.85, '正常'],
                      [1, '稍快'],
                    ].map(([v, label]) => (
                      <button
                        key={String(v)}
                        className={`chip${rate === v ? ' selected' : ''}`}
                        onClick={() => setRate(v as number)}
                        aria-pressed={rate === v}
                      >
                        {label}
                      </button>
                    ))}
                    <span className="progress-note" style={{ marginLeft: 8 }}>
                      {playing !== null ? `正在读第 ${playing + 1} 句` : '点任意一句可以单句听'}
                    </span>
                  </div>
                  {hint && (
                    <div className="speak-hint-row">
                      <p className="progress-note speak-hint" style={{ margin: 0 }}>
                        {hint}
                      </p>
                      {canRetry && (
                        <button className="btn btn-secondary" onClick={() => playLines(lines, 0)}>
                          重试
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {five.length === 0 ? (
                  <p className="progress-note">当前词库没有可用例句。</p>
                ) : (
                  <div className="recite-lines">
                    {five.map((s, i) => (
                      <button
                        key={`${s.word}-${i}`}
                        className={`recite-line${playing === i ? ' active' : ''}`}
                        onClick={() => {
                          stop();
                          stopRef.current = false;
                          setCanRetry(false);
                          setHint(null);
                          setPlaying(i);
                          const r = audio.speak(s.en, { rate, onEnd: () => setPlaying(null) });
                          if (r === 'no-voice' || r === 'unsupported' || r === 'off') {
                            setPlaying(null);
                            setCanRetry(r !== 'off');
                            setHint('这台设备的英文发音不可用，去「设置 → 声音 → 发音」点「测试在线发音」看是哪种情况');
                          }
                        }}
                        aria-label={`朗读第 ${i + 1} 句`}
                      >
                        <span className="recite-index">{i + 1}</span>
                        <span className="recite-en">{s.en}</span>
                        {showZh && <span className="recite-zh">{s.zh}</span>}
                        {s.word && (
                          <span className="recite-word-tag">
                            {s.word} · {s.meaning}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </>
        )}

        {tab === 'news' && (
          <>
            <div className="card news-head">
              <p className="card-title">📰 今日英语新闻</p>
              <p className="progress-note">
                取 Hacker News 今日头条（科技、产品、科研为主），英文原题，点开去原站读全文。
              </p>
              <div className="result-actions">
                <button className="btn btn-secondary" onClick={() => void loadNews(true)} disabled={newsState === 'loading'}>
                  {newsState === 'loading' ? '刷新中…' : '🔄 刷新'}
                </button>
              </div>
              {newsHint && <p className="progress-note">{newsHint}</p>}
            </div>

            {newsState === 'loading' && <p className="load-hint">正在取今天的头条……</p>}

            {news && news.length > 0 && (
              <div className="news-list">
                {news.map((n, i) => (
                  <div className="news-item" key={`${n.url}-${i}`}>
                    <div className="news-meta">
                      <span className="news-index">{i + 1}</span>
                      <span className="news-source">{n.source}</span>
                      <span className="news-time">{fmtTime(n.time)}</span>
                      <span className="news-points">🔥 {n.points}</span>
                      <button className="q-speak-btn small" onClick={() => speak(n.title)} aria-label="朗读标题">
                        🔊
                      </button>
                    </div>
                    <button
                      className="news-title"
                      onClick={() => {
                        audio.click();
                        setNewsCopyMsg(null);
                        setNewsOpen(n);
                      }}
                    >
                      {n.title}
                    </button>
                  </div>
                ))}
              </div>
            )}

            {newsState === 'fail' && (
              <div className="card">
                <p className="card-title">📚 备用入口</p>
                <div className="fallback-links">
                  {FALLBACK_LINKS.map((l) => (
                    <a key={l.url} href={l.url} target="_blank" rel="noreferrer noopener" className="fallback-link">
                      <strong>{l.name}</strong>
                      <span>{l.note}</span>
                    </a>
                  ))}
                </div>
                <p className="progress-note">这些站点每天更新，找到一篇就点「🔊」听标题，再挑两句跟读。</p>
              </div>
            )}
          </>
        )}
      </main>

      {newsOpen && (
        <div className="modal-mask" role="dialog" aria-modal="true" aria-labelledby="news-detail-title">
          <div className="modal-card wide">
            <p className="modal-title" id="news-detail-title">
              英语新闻
            </p>
            <div className="modal-body" style={{ textAlign: 'left' }}>
              <p className="news-meta" style={{ marginTop: 0 }}>
                <span className="news-source">{newsOpen.source}</span>
                <span className="news-time">{fmtTime(newsOpen.time)}</span>
                <span className="news-points">🔥 {newsOpen.points}</span>
              </p>
              <p className="news-detail-title">{newsOpen.title}</p>
              <p className="progress-note">
                新闻源只提供标题，正文要去原站。点「打开原文」后，按手机的返回键 / 返回手势就能回到手账；
                如果卡在别的浏览器里，直接切回本应用即可。
              </p>
              {newsCopyMsg && <p className="progress-note">{newsCopyMsg}</p>}
            </div>
            <div className="modal-actions">
              <button className="btn btn-plain" onClick={() => setNewsOpen(null)}>
                关闭
              </button>
              <button className="btn btn-secondary" onClick={() => speak(newsOpen.title)}>
                🔊 读标题
              </button>
              <button
                className="btn btn-secondary"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(newsOpen.url);
                    setNewsCopyMsg('✅ 链接已复制');
                  } catch {
                    setNewsCopyMsg(`复制失败，长按复制：${newsOpen.url}`);
                  }
                }}
              >
                📋 复制链接
              </button>
              <a
                className="btn btn-primary"
                href={newsOpen.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{ textDecoration: 'none' }}
              >
                🌐 打开原文
              </a>
            </div>
          </div>
        </div>
      )}

      <BottomNav active="daily" />
    </>
  );
}

/** 按日期从词库例句里抽 5 条（同一天结果固定，换天就换） */
function pickDailySentences(
  words: WordEntry[],
  day: number,
  count = 5,
): { en: string; zh: string; word: string; meaning: string }[] {
  const pool = words.filter((w) => w.example && w.example.length >= 25 && w.exampleTranslation);
  if (pool.length === 0) return [];
  const out: { en: string; zh: string; word: string; meaning: string }[] = [];
  const used = new Set<number>();
  let idx = (day * 131 + 17) % pool.length;
  for (let i = 0; i < pool.length && out.length < count; i++) {
    idx = (idx + 97) % pool.length;
    if (used.has(idx)) continue;
    used.add(idx);
    const w = pool[idx];
    out.push({ en: w.example, zh: w.exampleTranslation, word: w.word, meaning: w.meaning });
  }
  return out;
}

function safeHost(url: string): string {  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'news';
  }
}
