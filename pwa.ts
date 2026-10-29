/** PWA 支持：安装到主屏幕 + 离线缓存 */

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

let deferred: BeforeInstallPromptEvent | null = null;

/** 在应用启动时调用一次：捕获浏览器的安装提示事件 */
export function initPwa(): void {
  if (typeof window === 'undefined') return;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    window.dispatchEvent(new Event('dsh-installable'));
  });

  window.addEventListener('appinstalled', () => {
    deferred = null;
    window.dispatchEvent(new Event('dsh-installed'));
  });

  registerServiceWorker();
}

/** 浏览器是否已经允许“一键安装” */
export function canInstall(): boolean {
  return deferred !== null;
}

/** 触发安装弹窗 */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  if (!deferred) return 'unavailable';
  const evt = deferred;
  deferred = null;
  await evt.prompt();
  const choice = await evt.userChoice;
  return choice.outcome;
}

/** 是否已经在“独立窗口”里打开（即已添加到主屏幕） */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const mq = window.matchMedia?.('(display-mode: standalone)').matches;
  const ios = (window.navigator as unknown as { standalone?: boolean }).standalone === true;
  return Boolean(mq || ios);
}

export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (ua.includes('Macintosh') && 'ontouchstart' in window);
}

export interface BrowserInfo {
  /** 微信 / QQ / 微博 等内置浏览器：完全不支持安装 */
  inApp: boolean;
  /** 国内手机浏览器（华为 / 小米 / UC / 夸克 / 百度 / vivo / oppo…） */
  domestic: boolean;
  ios: boolean;
  android: boolean;
  /** Safari（iOS 上唯一能用的那个） */
  safari: boolean;
  /** Chrome / Edge / 三星浏览器等标准 Chromium 内核 */
  chromium: boolean;
}

/** 判断当前浏览器，用来给「添加到主屏幕」的正确操作步骤 */
export function browserInfo(): BrowserInfo {
  if (typeof navigator === 'undefined') {
    return { inApp: false, domestic: false, ios: false, android: false, safari: false, chromium: false };
  }
  const ua = navigator.userAgent;
  const inApp = /MicroMessenger|QQ\/|QQBrowser|Weibo|AlipayClient|DingTalk/i.test(ua);
  const domestic = /HuaweiBrowser|MiuiBrowser|MiBrowser|UCBrowser|Quark|BIDUBrowser|baidubrowser|VivoBrowser|HeyTap|OppoBrowser|SogouMobileBrowser|360SE|QihooBrowser/i.test(ua);
  const ios = isIOS();
  const android = /Android/i.test(ua);
  const safari = /Safari/i.test(ua) && !/Chrome|CriOS|Edg/i.test(ua);
  const chromium = /Chrome|CriOS|EdgA|SamsungBrowser/i.test(ua) && !domestic;
  return { inApp, domestic, ios, android, safari, chromium };
}

/** 当前情况下该怎么添加（给设置页显示） */
export function installGuide(b: BrowserInfo): string {
  if (b.ios) return 'iPhone / iPad：用 Safari 打开 → 点底部「分享」按钮 → 选「添加到主屏幕」→ 右上角「添加」。';
  if (b.inApp) return '你现在是在微信 / QQ 这类内置浏览器里打开的，它们不支持安装。点下面的「复制链接」，再用 Chrome 打开粘贴进去。';
  if (b.domestic) return '这个手机浏览器不一定支持安装。最稳的办法：点下面「复制链接」，用 Chrome 打开后点右上角 ⋮ →「添加到主屏幕 / 安装应用」。';
  if (b.android) return '安卓 Chrome：点右上角 ⋮ →「安装应用」或「添加到主屏幕」。装好后桌面会出现「单词手账」图标。';
  return '电脑 Chrome / Edge：点地址栏右侧的「安装」图标（小显示器带箭头），或菜单 →「安装 单词手账」。';
}

/** 复制当前网址（兼容老浏览器） */
export async function copyCurrentUrl(): Promise<boolean> {
  const url = location.href;
  try {
    await navigator.clipboard.writeText(url);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = url;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, url.length);
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
    // http 局域网环境下 SW 不可用，静默跳过
    return;
  }
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* 注册失败不影响使用 */
    });
  });
}
