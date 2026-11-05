// 通过 GitHub REST API 发布到 GitHub Pages（本机没有 git，所以用 API 造树/提交）
// 用法: set GH_TOKEN, then: node tools/deploy_pages.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const TOKEN = process.env.GH_TOKEN;
const OWNER = 'lcx2008';
const REPO = 'cet4-handbook';
const API = 'https://api.github.com';

if (!TOKEN) { console.error('missing GH_TOKEN'); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(p, opts = {}) {
  // 这台机器到 api.github.com 偶发连接超时（Node fetch / IPv6），失败重试几次
  let lastErr;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(API + p, {
        method: opts.method || 'GET',
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'cet4-handbook-deploy',
          ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
      });
      const text = await res.text();
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
      if (!res.ok && !opts.allowFail) {
        throw new Error(`${res.status} ${opts.method || 'GET'} ${p} -> ${text.slice(0, 400)}`);
      }
      return { status: res.status, data: json };
    } catch (e) {
      lastErr = e;
      const msg = String(e && e.message);
      const retriable = /fetch failed|timeout|ECONNRESET|EAI_AGAIN|socket hang up/i.test(msg) || (e && e.cause);
      if (!retriable || attempt === 4) throw e;
      console.log(`  重试 ${attempt + 1}/4：${p}（${msg.slice(0, 60)}）`);
      await sleep(1500 * (attempt + 1));
    }
  }
  throw lastErr;
}

function walk(dir, base = dir, out = {}) {
  for (const name of fs.readdirSync(dir)) {
    const abs = path.join(dir, name);
    const st = fs.statSync(abs);
    if (st.isDirectory()) walk(abs, base, out);
    else out[path.relative(base, abs).split(path.sep).join('/')] = abs;
  }
  return out;
}

async function publish(branch, files, message) {
  const entries = [];
  let i = 0;
  for (const [rel, abs] of Object.entries(files)) {
    const content = fs.readFileSync(abs).toString('base64');
    const blob = await api(`/repos/${OWNER}/${REPO}/git/blobs`, {
      method: 'POST',
      body: { content, encoding: 'base64' },
    });
    entries.push({ path: rel, mode: '100644', type: 'blob', sha: blob.data.sha });
    if (++i % 5 === 0) await sleep(150);
  }
  const tree = await api(`/repos/${OWNER}/${REPO}/git/trees`, {
    method: 'POST',
    body: { tree: entries },
  });
  const commit = await api(`/repos/${OWNER}/${REPO}/git/commits`, {
    method: 'POST',
    body: { message, tree: tree.data.sha },
  });
  const created = await api(`/repos/${OWNER}/${REPO}/git/refs`, {
    method: 'POST',
    allowFail: true,
    body: { ref: `refs/heads/${branch}`, sha: commit.data.sha },
  });
  if (created.status >= 400) {
    await api(`/repos/${OWNER}/${REPO}/git/refs/heads/${branch}`, {
      method: 'PATCH',
      body: { sha: commit.data.sha, force: true },
    });
  }
  console.log(`[${branch}] ${entries.length} files -> ${commit.data.sha.slice(0, 10)}`);
  return commit.data.sha;
}

// ---------- 1. 建仓库 ----------
const me = await api('/user');
console.log('user:', me.data.login);

const repo = await api(`/repos/${OWNER}/${REPO}`, { allowFail: true });
if (repo.status === 404) {
  await api('/user/repos', {
    method: 'POST',
    body: {
      name: REPO,
      description: '四级单词手账 · 校园手账风单词学习游戏（React + Vite，纯前端）',
      homepage: `https://${OWNER}.github.io/${REPO}/`,
      private: false,
      has_issues: false,
      has_wiki: false,
    },
  });
  console.log('repo created');
} else {
  console.log('repo exists:', repo.data.full_name, 'default_branch=' + repo.data.default_branch);
}

// ---------- 1.5 空仓库需要先有一个提交，否则 blobs API 报 409 ----------
const branches = await api(`/repos/${OWNER}/${REPO}/branches`, { allowFail: true });
if (!Array.isArray(branches.data) || branches.data.length === 0) {
  await api(`/repos/${OWNER}/${REPO}/contents/.gitkeep`, {
    method: 'PUT',
    body: { message: 'init', content: Buffer.from('').toString('base64') },
  });
  console.log('repo initialized with first commit');
  await sleep(1500);
}

// ---------- 2. 源码 -> main ----------
const srcFiles = {};
for (const f of ['index.html', 'package.json', 'vite.config.ts', 'tsconfig.json', 'README.md', 'pnpm-lock.yaml', '项目交付汇总.md', '代码地图.md', '源码合订本.md', 'tools/deploy_pages.mjs', 'tools/make_docx.py', 'tools/add_frequency.mjs', 'tools/make_bundle.mjs', 'tools/freq/en_zipf.tsv']) {
  const abs = path.join(ROOT, f);
  if (fs.existsSync(abs)) srcFiles[f] = abs;
}
for (const d of ['src', 'public', 'scripts']) {
  const abs = path.join(ROOT, d);
  if (fs.existsSync(abs)) Object.assign(srcFiles, walk(abs));
}
srcFiles['.gitignore'] = path.join(ROOT, 'tools', '.gitignore.tmp');
fs.writeFileSync(srcFiles['.gitignore'], 'node_modules/\ndist/\n.tools/\n');

await publish('main', srcFiles, '文档：补充在线地址与部署说明');

// ---------- 3. 构建产物 -> gh-pages ----------
const distDir = path.join(ROOT, 'dist');
const distFiles = walk(distDir);
const nojekyll = path.join(ROOT, 'tools', '.nojekyll.tmp');
fs.writeFileSync(nojekyll, '');
distFiles['.nojekyll'] = nojekyll;

const sha = await publish('gh-pages', distFiles, '构建产物：GitHub Pages');

// ---------- 4. 开启 Pages ----------
const pages = await api(`/repos/${OWNER}/${REPO}/pages`, { allowFail: true });
if (pages.status === 404) {
  const made = await api(`/repos/${OWNER}/${REPO}/pages`, {
    method: 'POST',
    allowFail: true,
    body: { source: { branch: 'gh-pages', path: '/' } },
  });
  console.log('pages create:', made.status, JSON.stringify(made.data).slice(0, 300));
} else {
  console.log('pages already:', pages.data.status, pages.data.html_url);
  const upd = await api(`/repos/${OWNER}/${REPO}/pages`, {
    method: 'PUT',
    allowFail: true,
    body: { source: { branch: 'gh-pages', path: '/' } },
  });
  console.log('pages update:', upd.status);
  await api(`/repos/${OWNER}/${REPO}/pages/builds`, { method: 'POST', allowFail: true });
}

// ---------- 5. 等构建 ----------
for (let t = 0; t < 30; t++) {
  await sleep(6000);
  const p = await api(`/repos/${OWNER}/${REPO}/pages`, { allowFail: true });
  const b = await api(`/repos/${OWNER}/${REPO}/pages/builds/latest`, { allowFail: true });
  console.log(`poll ${t}: status=${p.data && p.data.status} build=${b.data && b.data.status}`);
  if (p.data && p.data.status === 'built') break;
}
const final = await api(`/repos/${OWNER}/${REPO}/pages`, { allowFail: true });
console.log('FINAL', JSON.stringify({ url: final.data && final.data.html_url, status: final.data && final.data.status }));
console.log('commit', sha);
