import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp, useStoreVersion } from '../state/AppContext';
import { audio } from '../core/audioFeedback';
import { statusLabel } from './shared';
import type { WordEntry } from '../types';

type Mode = 'words' | 'passage';
type Score = {
  overall: number;
  volume: number;
  rhythm: number;
  accuracy: number | null;
  heard: string;
  seconds: number;
  expected: number;
};

/** 按拼写拆音节（最大音节首原则）：af·fect / ap·ple / lit·tle / make（不拆） */
const ONSET2 = /^(bl|br|ch|ck|cl|cr|dr|fl|fr|gh|gl|gr|ph|pl|pr|qu|sc|sh|sk|sl|sm|sn|sp|st|sw|th|tr|tw|wh|wr)$/;
const ONSET3 = /^(chr|phr|sch|scr|shr|spl|spr|squ|str|thr)$/;

export function syllables(word: string): string[] {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (w.length < 3) return [word];
  const isV = (c: string, i: number) => 'aeiou'.includes(c) || (c === 'y' && i > 0 && !'aeiou'.includes(w[i - 1]));
  const nuclei: [number, number][] = [];
  for (let i = 0; i < w.length; ) {
    if (!isV(w[i], i)) {
      i++;
      continue;
    }
    let j = i;
    while (j < w.length && isV(w[j], j)) j++;
    nuclei.push([i, j]);
    i = j;
  }
  if (nuclei.length <= 1) return [word];
  // 词尾不发音的 e（make / hope）；-Cle 结尾（table / apple）不算
  const last = nuclei[nuclei.length - 1];
  if (last[0] === w.length - 1 && w[last[0]] === 'e' && !/[^aeiou]le$/.test(w)) nuclei.pop();
  if (nuclei.length <= 1) return [word];
  const cuts: number[] = [];
  for (let k = 0; k < nuclei.length - 1; k++) {
    const cluster = w.slice(nuclei[k][1], nuclei[k + 1][0]);
    let take = 1;
    if (cluster.length >= 3 && ONSET3.test(cluster.slice(-3))) take = 3;
    else if (cluster.length >= 2 && ONSET2.test(cluster.slice(-2))) take = 2;
    else if (cluster.length >= 3) take = cluster.length - 1;
    cuts.push(nuclei[k + 1][0] - take);
  }
  const parts: string[] = [];
  let prev = 0;
  for (const c of cuts) {
    parts.push(w.slice(prev, c));
    prev = c;
  }
  parts.push(w.slice(prev));
  const out = parts.filter(Boolean);
  return out.length > 1 ? out : [word];
}

const IPAV = 'aeiouyæɑɒɔəɜɛɪʊʌɐɚɝɞɘɵɤɯøœ';

/** 按音标自己的音节点拆：ə·'fɛkt */
export function splitPhonetic(phonetic: string): string[] {
  const s = (phonetic || '').replace(/^\/+|\/+$/g, '').trim();
  if (!s) return [];
  const isV = (c: string) => IPAV.includes(c);
  const parts: string[] = [];
  let i = 0;
  while (i < s.length) {
    let j = i;
    while (j < s.length && !isV(s[j])) j++;
    if (j >= s.length) {
      parts.push(s.slice(i));
      break;
    }
    let k = j;
    while (k < s.length && isV(s[k])) k++;
    let m = k;
    while (m < s.length && !isV(s[m])) m++;
    if (m >= s.length) {
      parts.push(s.slice(i));
      break;
    }
    const cluster = s.slice(k, m);
    let take = 1;
    if (cluster.length >= 3 && ONSET3.test(cluster.slice(-3))) take = 3;
    else if (cluster.length >= 2 && ONSET2.test(cluster.slice(-2))) take = 2;
    else if (cluster.length >= 3) take = cluster.length - 1;
    parts.push(s.slice(i, m - take));
    i = m - take;
  }
  return parts.filter(Boolean);
}

/**
 * 让音标的分段跟单词音节数对齐：
 * - 音标段数少了（apple 的 /l/ 成音节）→ 只在结尾 l/n/m 前补切一刀
 * - 音标段数多了（有哑音字母）→ 合并最短的相邻两段
 */
export function alignPhonetic(ipaParts: string[], n: number): string[] {
  const out = [...ipaParts];
  if (out.length === 0 || n <= 1) return out;
  while (out.length < n) {
    const tail = out[out.length - 1];
    if (!/[lnm]$/.test(tail) || tail.length < 3) break;
    out.splice(out.length - 1, 1, tail.slice(0, -1), tail.slice(-1));
  }
  while (out.length > n) {
    let idx = 0;
    let min = Infinity;
    for (let i = 0; i < out.length - 1; i++) {
      const len = out[i].length + out[i + 1].length;
      if (len < min) {
        min = len;
        idx = i;
      }
    }
    out.splice(idx, 2, out[idx] + out[idx + 1]);
  }
  // 重音符号 ' / ˈ 归后一个音节：ə'·fekt -> ə·'fekt
  for (let i = 0; i < out.length - 1; i++) {
    let moved = '';
    while (out[i].length > 1 && /['ˈ]/.test(out[i].slice(-1))) {
      moved = out[i].slice(-1) + moved;
      out[i] = out[i].slice(0, -1);
    }
    if (moved) out[i + 1] = moved + out[i + 1];
  }
  return out;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const d = levenshtein(a, b);
  return Math.max(0, 1 - d / Math.max(a.length, b.length));
}

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

function praise(score: number): string {
  if (score >= 90) return '很稳，接近示范了';
  if (score >= 75) return '不错，再顺一遍就更自然';
  if (score >= 55) return '能听清，注意重音和停顿';
  return '先跟示范慢读两遍，再录一次';
}

export default function ReadAloud() {
  const { bank, store } = useApp();
  useStoreVersion();
  const [mode, setMode] = useState<Mode>('words');
  const [selected, setSelected] = useState(0);

  // ---------- 单词卡：按学习情况排序（到期的、错得多的先来） ----------
  const words = useMemo(() => {
    const learned = bank.words.filter((w) => {
      const wp = store.peekWordProgress(w.id);
      return Boolean(wp && (wp.status !== 'unlearned' || wp.inWrongPool));
    });
    const pool = learned.length >= 8 ? learned : bank.getPageWords(1);
    const score = (w: WordEntry): number => {
      const wp = store.peekWordProgress(w.id);
      if (!wp) return 0;
      let s = 0;
      if (wp.nextReviewAt !== null && wp.nextReviewAt <= Date.now()) s -= 100;
      s -= (wp.wrongCount ?? 0) * 4;
      if (wp.status === 'mastered') s += 30;
      return s;
    };
    return [...pool].sort((a, b) => score(a) - score(b)).slice(0, 40);
  }, [bank, store]);

  const [wordIndex, setWordIndex] = useState(0);
  const word = words[Math.min(wordIndex, Math.max(0, words.length - 1))] ?? null;

  // ---------- 今日短文（朗诵用） ----------
  const [daily, setDaily] = useState<{ en: string; zh: string }[][]>([]);
  useEffect(() => {
    fetch('./data/daily.json')
      .then((r) => r.json())
      .then((d: { passages: { sentences: { en: string; zh: string }[] }[] }) => {
        setDaily(d.passages.map((p) => p.sentences));
      })
      .catch(() => undefined);
  }, []);
  const sentences = daily.length > 0 ? daily[Math.floor(Date.now() / 86400000) % daily.length] : [];
  const sentence = sentences[Math.min(selected, Math.max(0, sentences.length - 1))];

  // ---------- 录音与打分 ----------
  const [recording, setRecording] = useState(false);
  const [recUrl, setRecUrl] = useState<string | null>(null);
  const [score, setScore] = useState<Score | null>(null);
  const [recError, setRecError] = useState<string | null>(null);
  const recRef = useRef<{
    rec: MediaRecorder;
    stream: MediaStream;
    ctx: AudioContext;
    timer: number;
    samples: number[];
    startedAt: number;
    target: string;
    recognition: { stop: () => void } | null;
    heard: string;
  } | null>(null);

  const stopRecording = () => {
    const cur = recRef.current;
    if (!cur) return;
    try {
      cur.rec.stop();
    } catch {
      /* 忽略 */
    }
  };

  const startRecording = async (target: string) => {
    setRecError(null);
    setScore(null);
    setRecUrl(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setRecError('这个浏览器不支持录音，换 Chrome 或系统浏览器试试');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ctx = new AudioContext();
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      src.connect(analyser);
      const samples: number[] = [];
      const timer = window.setInterval(() => {
        const buf = new Uint8Array(analyser.fftSize);
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128;
          sum += v * v;
        }
        samples.push(Math.sqrt(sum / buf.length));
      }, 100);

      const chunks: BlobPart[] = [];
      const rec = new MediaRecorder(stream);
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      // 有语音识别就顺便判准确度（没有就只评音量/节奏）
      let recognition: { stop: () => void } | null = null;
      let heard = '';
      const SR = (window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown }).SpeechRecognition ||
        (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
      if (SR) {
        try {
          const r = new (SR as new () => {
            lang: string;
            interimResults: boolean;
            continuous: boolean;
            onresult: (e: { results: { [k: number]: { [k: number]: { transcript: string } } } }) => void;
            start: () => void;
            stop: () => void;
          })();
          r.lang = 'en-US';
          r.interimResults = false;
          r.continuous = false;
          r.onresult = (e) => {
            let text = '';
            for (let i = 0; i < Object.keys(e.results).length; i++) {
              text += ` ${e.results[i][0].transcript}`;
            }
            heard = text.trim();
            if (recRef.current) recRef.current.heard = heard;
          };
          r.start();
          recognition = { stop: () => r.stop() };
        } catch {
          recognition = null;
        }
      }

      rec.onstop = () => {
        window.clearInterval(timer);
        try {
          stream.getTracks().forEach((t) => t.stop());
        } catch {
          /* 忽略 */
        }
        try {
          recognition?.stop();
        } catch {
          /* 忽略 */
        }
        try {
          void ctx.close();
        } catch {
          /* 忽略 */
        }
        const blob = new Blob(chunks, { type: chunks[0] instanceof Blob ? (chunks[0] as Blob).type : 'audio/webm' });
        setRecUrl(URL.createObjectURL(blob));
        const seconds = (Date.now() - startedAt) / 1000;
        const avg = samples.length ? samples.reduce((a, b) => a + b, 0) / samples.length : 0;
        const volume = clamp(Math.round(avg * 900));
        const expected = Math.max(0.8, target.split(/\s+/).length * 0.42);
        const rhythm = clamp(Math.round(100 - (Math.abs(seconds - expected) / expected) * 100));
        const heardText = recRef.current?.heard ?? heard;
        const accuracy = heardText ? Math.round(similarity(heardText.toLowerCase(), target.toLowerCase()) * 100) : null;
        const overall = accuracy === null
          ? Math.round(volume * 0.45 + rhythm * 0.55)
          : Math.round(accuracy * 0.7 + volume * 0.15 + rhythm * 0.15);
        setScore({ overall, volume, rhythm, accuracy, heard: heardText, seconds, expected });
        setRecording(false);
        recRef.current = null;
      };

      const startedAt = Date.now();
      rec.start();
      recRef.current = {
        rec,
        stream,
        ctx,
        timer,
        samples,
        startedAt,
        target,
        recognition,
        heard: '',
      };
      setRecording(true);
    } catch (e) {
      setRecError(e instanceof Error && e.name === 'NotAllowedError' ? '麦克风权限被拒了：在浏览器地址栏的权限里允许麦克风' : '录音没启动：检查麦克风权限');
    }
  };

  const toggleRecord = (target: string) => {
    if (recording) stopRecording();
    else void startRecording(target);
  };

  const speakSyllables = (parts: string[]) => {
    const step = (i: number) => {
      if (i >= parts.length) return;
      audio.speak(parts[i], { rate: 0.7, onEnd: () => window.setTimeout(() => step(i + 1), 260) });
    };
    step(0);
  };

  const wordParts = word ? syllables(word.word) : [];
  const phoneticParts = word ? alignPhonetic(splitPhonetic(word.phonetic), wordParts.length) : [];
  const target = mode === 'words' ? word?.word ?? '' : sentence?.en ?? '';
  const targetLabel = mode === 'words' ? word?.word ?? '' : '这句话';

  return (
    <div className="read-aloud">
      <div className="segmented recite-mode" role="tablist" aria-label="朗诵内容">
        <button
          role="tab"
          aria-selected={mode === 'words'}
          className={`segment${mode === 'words' ? ' active' : ''}`}
          onClick={() => {
            audio.click();
            setMode('words');
            setScore(null);
            setRecUrl(null);
          }}
        >
          🔤 单词朗诵
        </button>
        <button
          role="tab"
          aria-selected={mode === 'passage'}
          className={`segment${mode === 'passage' ? ' active' : ''}`}
          onClick={() => {
            audio.click();
            setMode('passage');
            setScore(null);
            setRecUrl(null);
          }}
        >
          📖 短文朗诵
        </button>
      </div>

      <p className="progress-note" style={{ margin: '0 2px 8px' }}>
        朗诵不计入手账分数；按你的学习情况排序（到期的、错得多的先来）。
      </p>

      {mode === 'words' && word && (
        <div className="card read-card">
          <p className="read-word">{wordParts.join('·')}</p>
          <p className="read-phonetic">{phoneticParts.length > 0 ? `/${phoneticParts.join('·')}/` : word.phonetic}</p>
          <p className="progress-note" style={{ marginTop: 0 }}>
            单词按音标音节用「·」隔开；拼读会一段一段慢读。
          </p>
          <p className="read-meaning">{word.meaning}</p>
          <div className="read-meta">
            <span className="status-pill">{statusLabel(store.peekWordProgress(word.id)?.status ?? 'unlearned')}</span>
            <span className="progress-note" style={{ marginLeft: 'auto' }}>
              第 {word.globalPage} 页
            </span>
          </div>
          <div className="read-actions">
            <button className="btn btn-secondary" onClick={() => audio.speak(word.word)}>
              🔊 范读
            </button>
            <button className="btn btn-secondary" onClick={() => speakSyllables(wordParts)}>
              🧩 拼读
            </button>
            <button className="btn btn-secondary" onClick={() => audio.speak(word.example || word.word)} disabled={!word.example}>
              📖 读例句
            </button>
          </div>
          <div className="read-deck-nav">
            <button className="btn btn-plain" onClick={() => setWordIndex((i) => Math.max(0, i - 1))} disabled={wordIndex === 0}>
              ← 上一个
            </button>
            <span className="progress-note">
              {wordIndex + 1} / {words.length}
            </span>
            <button
              className="btn btn-plain"
              onClick={() => setWordIndex((i) => Math.min(words.length - 1, i + 1))}
              disabled={wordIndex >= words.length - 1}
            >
              下一个 →
            </button>
          </div>
        </div>
      )}

      {mode === 'passage' && sentence && (
        <div className="card read-card">
          <p className="read-sentence">{sentence.en}</p>
          <p className="read-meaning">{sentence.zh}</p>
          <div className="read-actions">
            <button className="btn btn-secondary" onClick={() => audio.speak(sentence.en)}>
              🔊 范读
            </button>
          </div>
          <div className="passage-picker">
            {sentences.map((_s, i) => (
              <button
                key={i}
                className={`chip${selected === i ? ' selected' : ''}`}
                onClick={() => setSelected(i)}
              >
                {i + 1}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="card read-record">
        <p className="card-title" style={{ marginTop: 0 }}>
          🎙 跟读 / 自由朗读
        </p>
        <p className="progress-note">
          先听范读，再按下面的麦克风开始读；读完再点一次停止，会给音量、节奏{score?.accuracy !== null ? '和识别准确度' : ''}打分。
        </p>
        <div className="read-actions">
          <button
            className="btn btn-secondary"
            onClick={() => {
              if (!target) return;
              audio.speak(target, { onEnd: () => void startRecording(target) });
            }}
            disabled={!target || recording}
          >
            🎧 跟读（先范读再录）
          </button>
          <button className={`btn ${recording ? 'btn-danger' : 'btn-primary'}`} onClick={() => toggleRecord(target)} disabled={!target}>
            {recording ? '⏹ 停止录音' : '🎙 自由朗读'}
          </button>
        </div>
        {recError && <p className="progress-note speak-hint">{recError}</p>}
        {recUrl && (
          <div className="read-playback">
            <audio controls src={recUrl} />
            <button className="btn btn-plain" onClick={() => setRecUrl(null)}>
              清除
            </button>
          </div>
        )}
        {score && (
          <div className="read-score">
            <div className="read-score-main">
              <span className="read-score-num">{score.overall}</span>
              <span className="read-score-unit">分</span>
            </div>
            <p className="read-score-praise">{praise(score.overall)}</p>
            <div className="read-score-bars">
              <span>音量 {score.volume}</span>
              <span>节奏 {score.rhythm}</span>
              <span>准确度 {score.accuracy === null ? '不支持' : score.accuracy}</span>
              <span>
                时长 {score.seconds.toFixed(1)}s / 参考 {score.expected.toFixed(1)}s
              </span>
            </div>
            {score.accuracy === null && (
              <p className="progress-note">
                这台浏览器不支持语音识别，所以只评了音量和节奏；准确度需要在 Chrome 里用（会调用系统语音识别）。
              </p>
            )}
            {score.heard && <p className="progress-note">听到：{score.heard}</p>}
            <p className="progress-note">对照：{targetLabel}</p>
          </div>
        )}

        <details className="speech-help">
          <summary>麦克风没反应？各品牌怎么开权限</summary>
          <div className="guide-block guide-callout">
            <p className="guide-brand">先确认两件事</p>
            <ol className="guide-steps">
              <li>本站必须是 https 打开（现在就是），http 下浏览器不给麦克风。</li>
              <li>第一次点录音时，浏览器会弹权限框，选「允许」；没弹就按下面品牌手动开。</li>
            </ol>
          </div>
          <div className="guide-block">
            <p className="guide-brand">小米 / 红米（HyperOS / MIUI）</p>
            <ol className="guide-steps">
              <li>设置 → 应用设置 → 应用管理 → 找到你用的浏览器（Chrome / 小米浏览器）</li>
              <li>权限管理 → 麦克风 → 选「允许」</li>
              <li>回到页面刷新一次，再点录音</li>
              <li>如果开了「隐私保护 / 照明弹」，还要在隐私保护里放行麦克风</li>
            </ol>
          </div>
          <div className="guide-block">
            <p className="guide-brand">Chrome（安卓 / 电脑）</p>
            <ol className="guide-steps">
              <li>点地址栏左边的锁 / 调节图标 → 权限 → 麦克风 → 允许</li>
              <li>找不到就进浏览器设置 → 网站设置 → 麦克风 → 找到本站在白名单里</li>
              <li>电脑还要看系统：Windows 设置 → 隐私 → 麦克风 → 允许桌面应用访问</li>
            </ol>
          </div>
          <div className="guide-block">
            <p className="guide-brand">华为 / 荣耀（HarmonyOS / EMUI）</p>
            <ol className="guide-steps">
              <li>设置 → 应用 → 应用管理 → 浏览器 → 权限 → 麦克风 → 允许</li>
              <li>或在「设置 → 隐私 → 权限管理 → 麦克风」里给浏览器打勾</li>
              <li>回页面刷新再试</li>
            </ol>
          </div>
          <div className="guide-block">
            <p className="guide-brand">OPPO / 一加 / realme（ColorOS）</p>
            <ol className="guide-steps">
              <li>设置 → 应用管理 → 浏览器 → 权限 → 麦克风 → 允许</li>
              <li>或在「权限管理 → 麦克风」里允许浏览器</li>
            </ol>
          </div>
          <div className="guide-block">
            <p className="guide-brand">vivo / iQOO（OriginOS）</p>
            <ol className="guide-steps">
              <li>设置 → 应用与权限 → 权限管理 → 麦克风 → 找到浏览器 → 允许</li>
              <li>回页面刷新再试</li>
            </ol>
          </div>
          <div className="guide-block">
            <p className="guide-brand">三星（One UI）</p>
            <ol className="guide-steps">
              <li>设置 → 应用 → 浏览器 → 权限 → 麦克风 → 允许</li>
            </ol>
          </div>
          <div className="guide-block">
            <p className="guide-brand">iPhone / iPad（Safari）</p>
            <ol className="guide-steps">
              <li>设置 → Safari 浏览器 → 麦克风 → 允许</li>
              <li>或 设置 → 隐私与安全性 → 麦克风 → 打开 Safari 的开关</li>
              <li>回页面刷新再试</li>
            </ol>
          </div>
          <div className="guide-block">
            <p className="guide-brand">微信 / QQ 内置浏览器</p>
            <ol className="guide-steps">
              <li>这两类内置浏览器多数不支持录音，也不给麦克风权限</li>
              <li>点右上角「…」→「在浏览器中打开」，用 Chrome 或系统浏览器</li>
            </ol>
          </div>
        </details>
      </div>
    </div>
  );
}
