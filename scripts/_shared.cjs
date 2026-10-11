// _shared.cjs — zys-ima-categorize 脚本共享工具
// 职责：定位 ima_api.cjs、CSV 解析/写入、文本归一化等
const fs = require('fs');
const path = require('path');
const os = require('os');

/** 定位「腾讯ima」技能包的 ima_api.cjs（支持常见路径 + 深度搜索） */
function findImaApi() {
  const home = os.homedir();
  const direct = path.join(home, '.workbuddy', 'skills', 'ima-skills', 'ima_api.cjs');
  if (fs.existsSync(direct)) return direct;
  const root = path.join(home, '.workbuddy', 'skills');
  const stack = [{ dir: root, depth: 0 }];
  while (stack.length) {
    const { dir, depth } = stack.pop();
    if (depth > 3) continue;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isFile() && e.name === 'ima_api.cjs') return full;
      if (e.isDirectory()) stack.push({ dir: full, depth: depth + 1 });
    }
  }
  throw new Error(
    '未找到 ima_api.cjs：请先安装「腾讯ima」技能包（ima-skills），并配置凭证（~/.config/ima/ 或环境变量）。'
  );
}

/** 加载官方 imaApi 函数（require 直调，避免 spawn 子进程的 EBUSY 问题） */
function loadImaApi() {
  const p = findImaApi();
  const mod = require(p);
  if (!mod || typeof mod.imaApi !== 'function') {
    throw new Error('ima_api.cjs 未导出 imaApi 函数（版本可能不兼容）：' + p);
  }
  return mod.imaApi;
}

/** 简易 CSV 解析（支持引号包裹、转义、CRLF、BOM） */
function parseCsv(text) {
  const s = String(text).replace(/^\uFEFF/, '');
  const rows = [];
  let i = 0,
    cur = '',
    row = [],
    inQ = false;
  while (i < s.length) {
    const c = s[i];
    if (inQ) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          cur += '"';
          i += 2;
          continue;
        }
        inQ = false;
        i++;
        continue;
      }
      cur += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQ = true;
      i++;
      continue;
    }
    if (c === ',') {
      row.push(cur);
      cur = '';
      i++;
      continue;
    }
    if (c === '\r') {
      i++;
      continue;
    }
    if (c === '\n') {
      row.push(cur);
      rows.push(row);
      row = [];
      cur = '';
      i++;
      continue;
    }
    cur += c;
    i++;
  }
  if (cur || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows;
}

/** CSV 字段转义 */
function esc(s) {
  return '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"';
}

/** 写 UTF-8（带 BOM）CSV */
function writeCsv(file, header, rows) {
  const lines = [header.map(esc).join(',')];
  for (const r of rows) lines.push(r.map(esc).join(','));
  fs.writeFileSync(file, '\uFEFF' + lines.join('\r\n'), 'utf8');
}

/** 标题归一化：连续空白 → 单空格 */
function normTitle(t) {
  return String(t == null ? '' : t)
    .replace(/\s+/g, ' ')
    .trim();
}

/** 本地日期 YYYYMMDD */
function todayStr() {
  const d = new Date();
  return (
    d.getFullYear() +
    String(d.getMonth() + 1).padStart(2, '0') +
    String(d.getDate()).padStart(2, '0')
  );
}

/** 文件名清洗（去非法字符） */
function sanitizeFileName(s) {
  return String(s == null ? '' : s).replace(/[\\/:*?"<>|]/g, '_');
}

module.exports = {
  findImaApi,
  loadImaApi,
  parseCsv,
  esc,
  writeCsv,
  normTitle,
  todayStr,
  sanitizeFileName,
};
