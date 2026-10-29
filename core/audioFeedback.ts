/** 音频反馈：WebAudio 合成音效（无外部资源），及 speechSynthesis 朗读 */
export interface VoiceDiag {
  supported: boolean;
  total: number;
  english: number;
  names: string[];
}

class AudioFeedback {
  private ctx: AudioContext | null = null;
  soundOn = true;
  speechOn = true;
  /** 没有本机英文语音包时，是否允许联网取在线发音 */
  onlineAudioOn = true;
  /** 系统语音明明有英文却读不出声时，用户可强制只用在线发音 */
  forceOnlineOnly = false;
  /** 发音口音：美音 / 英音 */
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

  /** 当前设备有没有可用的英文语音（没有的话朗读一定不会响） */
  static diagnose(): VoiceDiag {
    if (!AudioFeedback.speechSupported()) return { supported: false, total: 0, english: 0, names: [] };
    try {
      const voices = window.speechSynthesis.getVoices();
      const english = voices.filter((v) => /^en/i.test(v.lang));
      return {
        supported: true,
        total: voices.length,
        english: english.length,
        names: english.slice(0, 6).map((v) => `${v.name} (${v.lang})`),
      };
    } catch {
      return { supported: true, total: 0, english: 0, names: [] };
    }
  }

  private pickEnglishVoice(): SpeechSynthesisVoice | null {
    try {
      const voices = window.speechSynthesis.getVoices();
      if (!voices.length) return null;
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
        // 本机没有英文语音包：能用在线发音就用，否则如实告诉用户
        if (this.onlineAudioOn) return this.playOnline(text, opts.onEnd, 0);
        this.lastSpeechError = 'no-english-voice';
        return 'no-voice';
      }
      try {
        const utter = new SpeechSynthesisUtterance(text);
        utter.voice = voice;
        utter.lang = voice.lang;
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
      return doSpeak(this.pickEnglishVoice());
    }

    this.lastSpeechError = 'loading-voices';
    let fired = false;
    const onVoices = () => {
      if (fired) return;
      fired = true;
      doSpeak(this.pickEnglishVoice());
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
   * 只测通道、不播放：手机能不能连上在线发音的服务器。
   * 用 no-cors 拉一次（拿不到状态码也能区分「连不上」和「连上了」）。
   */
  async probeOnline(text = 'vocabulary'): Promise<{ source: string; ok: boolean; ms: number; note: string }[]> {
    const out: { source: string; ok: boolean; ms: number; note: string }[] = [];
    for (let i = 0; i < this.onlineSourceCount; i++) {
      const url = this.onlineUrl(text, i);
      const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
      let ok = false;
      let note = '失败（连不上）';
      try {
        const res = await fetch(url, { mode: 'no-cors', cache: 'no-store' });
        ok = true;
        note = res.type === 'opaque' ? '连上了' : `HTTP ${res.status}`;
      } catch {
        ok = false;
      }
      const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
      out.push({ source: this.onlineSourceLabel(i), ok, ms: Math.round(t1 - t0), note });
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

  /** 在线发音源：有道 → Google 词典静态音 → 有道换口音 */
  private onlineUrl(text: string, sourceIndex: number): string {
    if (sourceIndex === 1) {
      // Google 词典（牛津音源）：常见词都有，境外线路，作为第二手
      return `https://ssl.gstatic.com/dictionary/static/sounds/oxford/${encodeURIComponent(text.toLowerCase())}--_gb_1.mp3`;
    }
    const type = sourceIndex === 0 ? (this.accent === 'uk' ? 1 : 2) : this.accent === 'uk' ? 2 : 1;
    return `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(text)}&type=${type}`;
  }

  /** 当前这份音频来自哪个源，给界面提示用 */
  onlineSourceLabel(sourceIndex: number): string {
    if (sourceIndex === 1) return 'Google 词典';
    return sourceIndex === 0 ? '有道' : '有道（换口音）';
  }

  private readonly onlineSourceCount = 3;

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
   * 有道 → 百度 两个源依次尝试；播放被浏览器拦截时单独报 blocked。
   * 元素会挂到 DOM 上（部分手机浏览器对游离的 Audio 不出声）。
   */
  private playOnline(text: string, onEnd?: () => void, sourceIndex = 0): 'ok-online' | 'no-voice' {
    try {
      this.stopOnline();
      if (sourceIndex >= this.onlineSourceCount) {
        this.failOnline('network');
        return 'no-voice';
      }
      const url = this.onlineUrl(text, sourceIndex);
      this.lastOnlineUrl = url;
      this.lastOnlineSource = this.onlineSourceLabel(sourceIndex);
      const el = new Audio(url);
      el.preload = 'auto';
      el.volume = 1;
      el.muted = false;
      el.setAttribute('playsinline', '');
      el.style.position = 'fixed';
      el.style.left = '-9999px';
      el.style.width = '1px';
      el.style.height = '1px';
      el.setAttribute('aria-hidden', 'true');
      document.body.appendChild(el);
      this.currentOnline = el;

      const cleanup = () => {
        try {
          el.pause();
          el.remove();
        } catch {
          /* 忽略 */
        }
      };
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

export function voiceDiagnose(): VoiceDiag {
  return AudioFeedback.diagnose();
}

