/**
 * 数据加载：网页版走 fetch，单文件离线版（双击打开的 html）从 window.__CET_DATA__ 里取。
 * 单文件版由 tools/build_single_html.mjs 把 data/*.json 内联进 HTML。
 */
type DataBag = Record<string, unknown>;

declare global {
  interface Window {
    __CET_DATA__?: DataBag;
  }
}

export async function loadJson<T>(path: string): Promise<T> {
  const bag = typeof window !== 'undefined' ? window.__CET_DATA__ : undefined;
  if (bag && Object.prototype.hasOwnProperty.call(bag, path)) {
    return bag[path] as T;
  }
  const res = await fetch(path, { cache: 'no-store' });
  if (!res.ok) throw new Error(`无法读取 ${path}（HTTP ${res.status}）`);
  return (await res.json()) as T;
}
