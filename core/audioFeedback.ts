/** 音频反馈：WebAudio 合成音效（无外部资源），及 speechSynthesis 朗读 */
export interface VoiceDiag {
  supported: boolean;
  total: number;
  english: number;
  /** 本机韩语语音包数量（2.8.1 加） */
  korean: number;
  names: string[];
}

/** 有没有韩文（谚文音节/字母）：有就按韩语取发音，不用问页面当前是哪套词库 */
const HANGUL_RE = /[\uAC00-\uD7A3\u1100-\u11FF\u3130-\u318F]/;
export function isKoreanText(text: string): boolean {
  return HANGUL_RE.test(text);
}

class AudioFeedback {
  private ctx: AudioContext | null = null;
  soundOn = true;
  speechOn = true;
  /** 没有本机语音包时，是否允许联网取在线发音（英语/韩语都适用） */
  onlineAudioOn = true;
  /** 系统语音明明有英文却读不出声时，用户可强制只用在线发音 */
  forceOnlineOnly = false;
  /** 发音口音：美音 / 英音（只影响英语） */
  accent: 'us' | 'uk' = 'us';
  /** 最近一次朗读失败的原因，给界面提示用 */
  lastSpeechError: string | null = null;
  /** 最近一次在线发音的地址：自动播放被拦时，界面可以放一个手动播放器 */
  lastOnlineUrl: string | null = null;
  /** 最近一次在线发音用的源（有道 / Google 词典） */
  lastOnlineSource: string | null = null;
  private currentOnline: HTMLAudioElement | null = null;

  private ensureCtx(): AudioContext | null {
    if (!this.soundOn) return null;
    try {
      if (!this.ctx) {
        const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AC) return null;
        this.ctx = new AC();
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return this.ctx;
    } catch {
      return null;
    }
  }

  private tone(freq: number, start: number, dur: number, type: OscillatorType = 'sine', gain = 0.12): void {
    const ctx = this.ensureCtx();
    if (!ctx) return;
    const t0 = ctx.currentTime + start;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  click(): void {
    this.tone(660, 0, 0.06, 'triangle', 0.08);
  }

  flip(): void {
    this.tone(520, 0, 0.05, 'triangle', 0.07);
    this.tone(700, 0.05, 0.06, 'triangle', 0.06);
  }

  correct(): void {
    this.tone(523.25, 0, 0.09, 'sine', 0.12);
    this.tone(659.25, 0.09, 0.12, 'sine', 0.12);
  }

  wrong(): void {
    this.tone(220, 0, 0.16, 'sine', 0.12);
    this.tone(196, 0.12, 0.2, 'sine', 0.1);
  }

  stamp(): void {
    this.tone(180, 0, 0.09, 'square', 0.07);
    this.tone(392, 0.05, 0.16, 'sine', 0.1);
  }

  static speechSupported(): boolean {
    return typeof window !== 'undefined' && 'speechSynthesis' in window;
  }

  /** 当前设备有没有可用的语音（lang: en / ko） */
  static diagnose(lang: 'en' | 'ko' = 'en'): VoiceDiag {
    if (!AudioFeedback.speechSupported()) return { supported: false, total: 0, english: 0, korean: 0, names: [] };
    try {
      const voices = window.speechSynthesis.getVoices();
      const english = voices.filter((v) => /^en/i.test(v.lang));
      const korean = voices.filter((v) => /^ko/i.test(v.lang));
      const list = lang === 'ko' ? korean : english;
      return {
        supported: true,
        total: voices.length,
        english: english.length,
        korean: korean.length,
        names: list.slice(0, 6).map((v) => `${v.name} (${v.lang})`),
      };
    } catch {
      return { supported: true, total: 0, english: 0, korean: 0, names: [] };
    }
  }

  /** 按语言挑一个最像样的系统语音；没有就返回 null（调用方转在线发音） */
  private pickVoiceFor(lang: 'en' | 'ko'): SpeechSynthesisVoice | null {
    try {
      const voices = window.speechSynthesis.getVoices();
      if (!voices.length) return null;
      if (lang === 'ko') {
        // 韩语：优先 google / microsoft 这类音质好的，再退任意 ko-KR
        return (
          voices.find((v) => /^ko/i.test(v.lang) && /google|microsoft|natural|yuna|heami|sora/i.test(v.name)) ??
          voices.find((v) => /^ko-KR/i.test(v.lang)) ??
          voices.find((v) => /^ko/i.test(v.lang)) ??
          null
        );
      }
      const want = this.accent === 'uk' ? /en-GB/i : /en-US/i;
      const other = this.accent === 'uk' ? /en-US/i : /en-GB/i;
      return (
        voices.find((v) => want.test(v.lang) && /google|microsoft|samantha|daniel|natural/i.test(v.name)) ??
        voices.find((v) => want.test(v.lang)) ??
        voices.find((v) => other.test(v.lang)) ??
        voices.find((v) => /^en/i.test(v.lang)) ??
        null
      );
    } catch {
      return null;
    }
  }

  /**
   * 朗读单词或句子。
   * 返回 'ok' 表示已交给系统朗读；'no-voice' 表示设备没有英文语音包；
   * 'unsupported' 表示浏览器不支持；'off' 表示用户关掉了朗读。
   * opts.onEnd 在朗读结束（或在线音频播放完）时回调，供「每日一诵」逐句连播用。
   * opts.forceOnline 强制走在线发音（用于设置页「测试在线发音」，绕开系统语音）。
   */
  speak(
    text: string,
    opts: { rate?: number; onEnd?: () => void; forceOnline?: boolean } = {},
  ): 'ok' | 'ok-online' | 'no-voice' | 'unsupported' | 'off' {
    if (!this.speechOn) return 'off';
    if (!text) return 'unsupported';
    // 语言跟着文本走：韩文一律用 ko-KR 语音，否则会拿英文引擎念韩文（读出来是乱码音）
    const lang: 'en' | 'ko' = isKoreanText(text) ? 'ko' : 'en';
    if (opts.forceOnline || this.forceOnlineOnly) {
      if (!this.onlineAudioOn) {
        this.lastSpeechError = 'online-off';
        return 'no-voice';
      }
      return this.playOnline(text, opts.onEnd, 0);
    }
    if (!AudioFeedback.speechSupported()) {
      // 浏览器根本不支持语音合成 → 直接走在线发音
      if (this.onlineAudioOn) return this.playOnline(text, opts.onEnd, 0);
      this.lastSpeechError = 'unsupported';
      return 'unsupported';
    }
    const synth = window.speechSynthesis;

    const doSpeak = (voice: SpeechSynthesisVoice | null): 'ok' | 'ok-online' | 'no-voice' => {
      if (!voice) {
        // 本机没有对应语言的语音包：能用在线发音就用，否则如实告诉用户
        if (this.onlineAudioOn) return this.playOnline(text, opts.onEnd, 0);
        this.lastSpeechError = lang === 'ko' ? 'no-korean-voice' : 'no-english-voice';
        return 'no-voice';
      }
      try {
        const utter = new SpeechSynthesisUtterance(text);
        utter.voice = voice;
        utter.lang = voice.lang || (lang === 'ko' ? 'ko-KR' : 'en-US');
        utter.rate = opts.rate ?? 0.85;
        utter.pitch = 1;
        utter.volume = 1;
        let ended = false;
        // 有的手机「有英文 voice 但不出声」：2 秒内引擎没真正开口就走在线发音
        const watchdog = window.setTimeout(() => {
          if (ended) return;
          if (!synth.speaking && !synth.pending) {
            this.lastSpeechError = 'system-tts-silent';
            if (this.onlineAudioOn) this.playOnline(text, opts.onEnd, 0);
            else opts.onEnd?.();
          }
        }, 2000);
        utter.onend = () => {
          ended = true;
          window.clearTimeout(watchdog);
          opts.onEnd?.();
        };
        utter.onerror = (e) => {
          ended = true;
          window.clearTimeout(watchdog);
          this.lastSpeechError = (e as SpeechSynthesisErrorEvent).error || 'error';
          opts.onEnd?.();
        };
        // 不要在未播放时 cancel（部分安卓机 cancel 后本次 speak 会被吞掉）
        if (synth.speaking || synth.pending) synth.cancel();
        if (synth.paused) synth.resume();
        synth.speak(utter);
      } catch {
        /* 忽略 */
      }
      return 'ok';
    };

    // 语音包是异步加载的：没有就先等 voiceschanged（最多 1.2 秒）
    const voices = synth.getVoices();
    if (voices.length > 0) {
      return doSpeak(this.pickVoiceFor(lang));
    }

    this.lastSpeechError = 'loading-voices';
    let fired = false;
    const onVoices = () => {
      if (fired) return;
      fired = true;
      doSpeak(this.pickVoiceFor(lang));
    };
    try {
      synth.addEventListener?.('voiceschanged', onVoices, { once: true });
    } catch {
      /* 老浏览器没有 addEventListener */
    }
    window.setTimeout(onVoices, 1200);
    return 'ok';
  }

  /** 直接测在线发音（设置页用） */
  speakOnline(text: string): 'ok-online' | 'no-voice' | 'off' {
    const r = this.speak(text, { forceOnline: true });
    return r === 'ok-online' ? 'ok-online' : r === 'off' ? 'off' : 'no-voice';
  }

  /**
   * 测通道：真去把音频拉下来、等 canplay，而不是只发一个请求。
   *
   * 为什么不用 fetch 判：百度防盗链会返回 **200 + 0 字节 HTML**，
   * no-cors 的 fetch 只能看到「请求成功」，看不出能不能播——
   * 之前「测通道全绿、点播放没声」就是这么来的。
   */
  private probePlayable(url: string, timeout = 6000): Promise<boolean> {
    return new Promise((resolve) => {
      let done = false;
      const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const el = new Audio();
      (el as unknown as { referrerPolicy?: string }).referrerPolicy = 'no-referrer';
      el.preload = 'auto';
      el.src = url;
      const finish = (ok: boolean) => {
        if (done) return;
        done = true;
        try {
          el.pause();
          el.removeAttribute('src');
          el.load();
        } catch {
          /* 忽略 */
        }
        void t0;
        resolve(ok);
      };
      el.addEventListener('canplay', () => finish(true), { once: true });
      el.addEventListener('loadeddata', () => finish(true), { once: true });
      el.addEventListener('error', () => finish(false), { once: true });
      try {
        el.load();
      } catch {
        finish(false);
      }
      window.setTimeout(() => finish(false), timeout);
    });
  }

  async probeOnline(text = 'vocabulary'): Promise<{ source: string; ok: boolean; ms: number; note: string }[]> {
    const out: { source: string; ok: boolean; ms: number; note: string }[] = [];
    const sources = this.onlineSources(text);
    for (let i = 0; i < sources.length; i++) {
      const url = sources[i].url;
      const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const ok = await this.probePlayable(url);
      const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
      out.push({
        source: sources[i].label,
        ok,
        ms: Math.round(t1 - t0),
        note: ok ? '能取到音频' : '拿不到音频（0 字节或被拦）',
      });
    }
    return out;
  }

  /** 提前把系统语音包列表拉出来，点 🔊 时才不会因为异步等待而丢掉用户手势 */
  static warmUpVoices(): void {
    if (!AudioFeedback.speechSupported()) return;
    try {
      const synth = window.speechSynthesis;
      synth.getVoices();
      synth.addEventListener?.('voiceschanged', () => {
        try {
          synth.getVoices();
        } catch {
          /* 忽略 */
        }
      });
    } catch {
      /* 忽略 */
    }
  }

  /**
   * 在线发音候选源。
   *
   * 单词：有道词典（快、常见词全）→ Google 词典静态音 → 有道换口音
   * 句子：百度翻译 gettts 是第一手（实测整句 16 KB mp3）；有道对整句经常回 500，只能当第二手。
   *
   * 注意：百度这个接口**带 Referer 就返回 0 字节 HTML**（防盗链），
   * 所以 index.html 里设了 <meta name="referrer" content="no-referrer">，
   * 整个页面的请求都不发 Referer——这是手机上「有网却没声音」的真正原因。
   */
  private onlineSources(text: string): { url: string; label: string }[] {
    // 韩语：**单词和整句要分源**（2.8.2 修的）。
    // 有道的 dictvoice 只认词条，传整句会返回非音频内容 → <audio> 报 Format error，
    // 再回退时已经离开用户手势，手机上会被自动播放策略拦掉 —— 表现就是「单词有声、例句哑」。
    // 实测：整句只有百度 lan=kor 能播；单词有道 le=ko 最好（1.4s，音色自然）。
    // 另外百度必须写 lan=kor，写 ko 会 403。
    if (isKoreanText(text)) {
      const youdao = (type: number) => `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(text)}&type=${type}&le=ko`;
      const baidu = `https://fanyi.baidu.com/gettts?lan=kor&text=${encodeURIComponent(text)}&spd=3&source=web`;
      const isSentence = /\s/.test(text.trim());
      return isSentence
        ? [
            { url: baidu, label: '百度翻译（韩语整句）' },
            { url: youdao(2), label: '有道（韩语）' },
            { url: youdao(1), label: '有道（韩语，另一路）' },
          ]
        : [
            { url: youdao(2), label: '有道（韩语）' },
            { url: baidu, label: '百度翻译（韩语）' },
            { url: youdao(1), label: '有道（韩语，另一路）' },
          ];
    }
    const isSentence = /\s/.test(text.trim());
    if (isSentence) {
      return [
        {
          url: `https://fanyi.baidu.com/gettts?lan=${this.accent === 'uk' ? 'en-GB' : 'en'}&text=${encodeURIComponent(
            text,
          )}&spd=3&source=web`,
          label: '百度翻译',
        },
        {
          url: `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(text)}&type=2`,
          label: '有道（整句）',
        },
      ];
    }
    const first = this.accent === 'uk' ? 1 : 2;
    const second = this.accent === 'uk' ? 2 : 1;
    return [
      { url: `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(text)}&type=${first}`, label: '有道' },
      {
        url: `https://ssl.gstatic.com/dictionary/static/sounds/oxford/${encodeURIComponent(
          text.toLowerCase(),
        )}--_gb_1.mp3`,
        label: 'Google 词典',
      },
      { url: `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(text)}&type=${second}`, label: '有道（换口音）' },
    ];
  }

  /** 当前这份音频来自哪个源，给界面提示用 */
  onlineSourceLabel(sourceIndex: number, text = ''): string {
    const list = this.onlineSources(text || 'word');
    return list[Math.min(sourceIndex, list.length - 1)]?.label ?? '在线发音';
  }

  private failOnline(reason: string): void {
    this.lastSpeechError = `online-audio-${reason}`;
    try {
      window.dispatchEvent(new CustomEvent('dsh-speak-failed', { detail: { reason } }));
    } catch {
      /* 忽略 */
    }
  }

  /**
   * 在线发音兜底：设备没有英文语音包时，联网取词典发音。
   * 单词走有道，整句走百度翻译，按顺序换源；播放被浏览器拦截时单独报 blocked。
   * 元素会挂到 DOM 上（部分手机浏览器对游离的 Audio 不出声）。
   */
  private playOnline(text: string, onEnd?: () => void, sourceIndex = 0): 'ok-online' | 'no-voice' {
    try {
      this.stopOnline();
      const sources = this.onlineSources(text);
      if (sourceIndex >= sources.length) {
        this.failOnline('network');
        return 'no-voice';
      }
      const url = sources[sourceIndex].url;
      this.lastOnlineUrl = url;
      this.lastOnlineSource = sources[sourceIndex].label;
      const el = new Audio(url);
      el.preload = 'auto';
      el.volume = 1;
      el.muted = false;
      el.setAttribute('playsinline', '');
      // 双保险：即使 meta 失效，也让音频请求不带 Referer（百度防盗链会回 0 字节）
      (el as unknown as { referrerPolicy?: string }).referrerPolicy = 'no-referrer';
      // 立刻发起请求，避免等到 play() 才开始拉
      try {
        el.load();
      } catch {
        /* 忽略 */
      }
      el.style.position = 'fixed';
      el.style.left = '-9999px';
      el.style.width = '1px';
      el.style.height = '1px';
      el.setAttribute('aria-hidden', 'true');
      document.body.appendChild(el);
      this.currentOnline = el;

      const cleanup = () => {
        window.clearTimeout(watchdog);
        try {
          el.pause();
          el.remove();
        } catch {
          /* 忽略 */
        }
      };
      // 看门狗：有些网络下这个源既不报错也不出声（一直卡在 loading），
      // 6 秒还没拿到元数据就换下一个源，别让用户干等（2.8.2 加）
      const watchdog = window.setTimeout(() => {
        try {
          if (el.readyState < 2) {
            cleanup();
            this.playOnline(text, onEnd, sourceIndex + 1);
          }
        } catch {
          /* 忽略 */
        }
      }, 6000);
      el.onended = () => {
        cleanup();
        onEnd?.();
      };
      el.onerror = () => {
        cleanup();
        // 当前源拿不到音频，换下一个
        this.playOnline(text, onEnd, sourceIndex + 1);
      };
      const p = el.play();
      if (p && typeof p.catch === 'function') {
        p.catch((err: unknown) => {
          const name = String((err as Error)?.name ?? 'blocked');
          cleanup();
          if (name === 'NotAllowedError') {
            this.failOnline('blocked');
          } else {
            this.playOnline(text, onEnd, sourceIndex + 1);
          }
        });
      }
      return 'ok-online';
    } catch {
      this.lastSpeechError = 'online-audio-error';
      return 'no-voice';
    }
  }

  private stopOnline(): void {
    try {
      if (this.currentOnline) {
        this.currentOnline.pause();
        this.currentOnline.remove();
        this.currentOnline = null;
      }
    } catch {
      /* 忽略 */
    }
  }

  stopSpeaking(): void {
    try {
      if (AudioFeedback.speechSupported()) window.speechSynthesis.cancel();
    } catch {
      /* 忽略 */
    }
    this.stopOnline();
  }
}

export const audio = new AudioFeedback();

/** 启动时提前读语音包（见 main.tsx） */
export function warmUpVoices(): void {
  AudioFeedback.warmUpVoices();
}

export function voiceDiagnose(lang: 'en' | 'ko' = 'en'): VoiceDiag {
  return AudioFeedback.diagnose(lang);
}

