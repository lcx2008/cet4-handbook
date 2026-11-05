/**
 * 重新生成《源码合订本.md》：把 src 下的 .ts/.tsx 和 scripts/validate.ts 拼成一册。
 * 用法：node tools/make_bundle.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, '源码合订本.md');

function walk(dir) {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const abs = path.join(dir, name);
    const st = fs.statSync(abs);
    if (st.isDirectory()) out.push(...walk(abs));
    else if (/\.(ts|tsx)$/.test(name)) out.push(abs);
  }
  return out;
}

const files = [...walk(path.join(ROOT, 'src')), path.join(ROOT, 'scripts', 'validate.ts')]
  .map((abs) => ({
    abs,
    rel: path.relative(ROOT, abs).split(path.sep).join('/'),
    lines: fs.readFileSync(abs, 'utf8').split('\n'),
  }))
  .sort((a, b) => a.rel.localeCompare(b.rel, 'en'));

const total = files.reduce((n, f) => n + f.lines.length, 0);

const index = files
  .map((f) => `| \`${f.rel}\` | ${f.lines.length} |`)
  .join('\n');

const body = files
  .map((f) => {
    const lang = f.rel.endsWith('.tsx') ? 'tsx' : f.rel.endsWith('.css') ? 'css' : 'ts';
    const code = f.lines.join('\n').replace(/\n$/, '');
    return `## 文件: ${f.rel}（${f.lines.length} 行）\n\n\`\`\`${lang}\n${code}\n\`\`\`\n`;
  })
  .join('\n---\n\n');

const head = `# 源码合订本 · 单词手账 2.5

> 全部源码按路径顺序拼在一起，方便一次性检索。
> 每个文件以 \`## 文件: 路径\` 开头；先 grep 定位再按行号截取。
> 先读 \`代码地图.md\`，别从这儿开始。
> 样式（\`src/styles/global.css\`）单独放，不拼进来。

---

## 文件索引

| 文件 | 行 |
|---|---|
${index}
| **合计 ${files.length} 个文件** | **${total}** |

---

`;

fs.writeFileSync(OUT, head + body, 'utf8');
console.log(`写入 ${path.relative(ROOT, OUT)}：${files.length} 个文件 / ${total} 行`);
