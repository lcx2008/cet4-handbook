/** 版本号与更新公告：每次发版改这里，开始页会自动弹一次 */

export const APP_VERSION = '2.7.1';

export interface ChangelogEntry {
  version: string;
  date: string;
  items: string[];
}

export const CHANGELOGS: ChangelogEntry[] = [
  {
    version: '2.7.1',
    date: '2026-10-29',
    items: [
      '「今日」页去掉了今日计划卡，每天学多少去设置 → 学习里改。',
      '搜索后直接弹大字词卡：按回车、只搜到一个词、或点搜索结果都会弹。',
      '朗读页补了麦克风权限教学，按手机品牌写了怎么允许录音。',
      '在线发音换源修好：百度接口已失效，改成「有道 → Google 词典」两路自动切换；声音页新增「🧪 测通道」，能看出是网络不通还是被浏览器拦。',
      '语音包改成启动时预加载，点 🔊 当场判断要不要走在线发音，不再等一两秒后被浏览器拦掉。',
      '声音设置里给了讯飞语音引擎的官方商店入口（应用宝 / 华为应用市场 / 小米应用商店），认准开发者「科大讯飞」。',
      '音节拆分重做：拼读按音节拆（af·fect、ap·ple、lit·tle），音标按同一组分段（/ə·\'fɛkt/），不再按字母硬切。',
      '手账目录不再上锁，任何一页都能直接进。',
      '修了「点导入没反应」：导入按钮换成原生文件选择框，点一下必定弹系统选文件。',
      '以后每次更新都会在开始页弹这条公告，写清解决了什么、增加了什么。',
    ],
  },
  {
    version: '2.6',
    date: '2026-10-29',
    items: ['朗诵栏目、30 篇短文、美音英音、7 套主题、按页目录、释义补全。'],
  },
];

const SEEN_KEY = 'dsh-seen-version';

export function latestChangelog(): ChangelogEntry {
  return CHANGELOGS[0];
}

/** 这次启动要不要弹更新公告 */
export function needsUpdateNotice(version = APP_VERSION): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) !== version;
  } catch {
    return false;
  }
}

export function markVersionSeen(version = APP_VERSION): void {
  try {
    localStorage.setItem(SEEN_KEY, version);
  } catch {
    /* 忽略 */
  }
}
