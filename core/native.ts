import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

/**
 * 原生壳（Capacitor / 安卓 APK）适配层。
 *
 * 网页版、单文件版里这些函数一律是空操作，所以可以放心从任何地方 import。
 * 判断依据是 Capacitor 的运行时标记，不靠 UA 猜。
 */

/** 当前是否跑在 Capacitor 原生壳里 */
export function isNativeApp(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

/** 壳里的平台名，网页版返回 'web' */
export function nativePlatform(): string {
  try {
    return Capacitor.getPlatform();
  } catch {
    return 'web';
  }
}

/**
 * 接管安卓返回键。
 * 老大的要求：一按返回就回首页（不要逐级回退），已经在首页 / 起始页时才退出。
 */
export function setupBackButton(): void {
  if (!isNativeApp()) return;
  void CapacitorApp.addListener('backButton', () => {
    const hash = window.location.hash || '#/';
    // 首页和起始页算「到头了」，再按一次才真的退出
    if (hash === '#/home' || hash === '#/' || hash === '') {
      void CapacitorApp.exitApp();
      return;
    }
    window.location.hash = '#/home';
  });
}

/**
 * 壳里保存文本文件。
 * WebView 里 <a download> 点了没反应，所以改成：
 * 先写进 App 缓存目录，再弹系统分享面板（可「保存到文件」或发给微信/QQ）。
 * 返回 true 表示文件已经落地（分享面板弹没弹出来另说）。
 */
export async function saveTextNative(text: string, filename: string): Promise<boolean> {
  if (!isNativeApp()) return false;
  try {
    const written = await Filesystem.writeFile({
      path: filename,
      data: text,
      directory: Directory.Cache,
      encoding: Encoding.UTF8,
    });
    await Share.share({
      title: filename,
      url: written.uri,
      dialogTitle: '保存或发到别的应用',
    });
    return true;
  } catch {
    return false;
  }
}
