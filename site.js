// HOMO_eew 報告網站：讀 data/ 的 JSON（HOMO_eew 程式上傳），畫事件列表與精度收斂圖。不用任何外部函式庫。
// 資料：data/years.json = ["2026", …]；data/{年}/index.json = 事件摘要陣列；data/{年}/{事件代號}.json = 事件記錄（homo-sidecar records.rs）

const TZ_OFFSET_MS = 8 * 3600 * 1000;
const pad = (n) => String(n).padStart(2, '0');
// 台灣時間 YYYY/MM/DD HH:MM:SS
function fmtTime(ms) {
  if (!Number.isFinite(ms)) return '—';
  const d = new Date(ms + TZ_OFFSET_MS);
  return `${d.getUTCFullYear()}/${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}
function km(lat1, lng1, lat2, lng2) {
  const r = Math.PI / 180;
  const x = Math.sin((lat2 - lat1) * r / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin((lng2 - lng1) * r / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(x));
}
const fix = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '—');
async function getJson(path) {
  const r = await fetch(path, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${path}：HTTP ${r.status}`);
  return r.json();
}
function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else e.setAttribute(k, v);
  }
  for (const c of children) if (c != null) e.append(c);
  return e;
}
const SVG = 'http://www.w3.org/2000/svg';
function svg(tag, attrs = {}) {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}
function niceTicks(min, max, count = 5) {
  const span = max - min || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || raw;
  const out = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(+v.toFixed(6));
  return out;
}

// 單一序列折線圖：points = [{x, y, low, label}]；truth = 真值（水平虛線）或 null
function lineChart(host, { points, truth, truthLabel, yUnit, yMin, yFloorSpan = 1, xUnit = 's' }) {
  host.replaceChildren();
  const pts = points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (!pts.length) {
    host.append(el('div', { class: 'empty', text: '沒有資料' }));
    return;
  }
  const W = 520; const H = 230; const m = { l: 40, r: 56, t: 12, b: 30 };
  const xs = pts.map((p) => p.x); const ys = pts.map((p) => p.y).concat(Number.isFinite(truth) ? [truth] : []);
  const x0 = Math.min(0, ...xs); const x1 = Math.max(...xs, x0 + 1);
  let y0 = Math.min(...ys); let y1 = Math.max(...ys);
  if (Number.isFinite(yMin)) y0 = Math.min(yMin, y0);
  if (y1 - y0 < yFloorSpan) { const c = (y0 + y1) / 2; y0 = Number.isFinite(yMin) ? Math.max(yMin, c - yFloorSpan / 2) : c - yFloorSpan / 2; y1 = y0 + yFloorSpan; }
  const padY = (y1 - y0) * 0.08; y1 += padY; if (!Number.isFinite(yMin) || y0 - padY >= yMin) y0 -= padY;
  const X = (v) => m.l + (v - x0) / (x1 - x0) * (W - m.l - m.r);
  const Y = (v) => H - m.b - (v - y0) / (y1 - y0) * (H - m.t - m.b);
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img' });
  const grid = svg('g', { class: 'grid' }); const axis = svg('g', { class: 'axis' });
  for (const t of niceTicks(y0, y1)) {
    grid.append(svg('line', { x1: m.l, x2: W - m.r, y1: Y(t), y2: Y(t) }));
    const tx = svg('text', { x: m.l - 6, y: Y(t) + 4, 'text-anchor': 'end' }); tx.textContent = `${+t.toFixed(2)}`; axis.append(tx);
  }
  for (const t of niceTicks(x0, x1, 6)) {
    const tx = svg('text', { x: X(t), y: H - m.b + 16, 'text-anchor': 'middle' }); tx.textContent = `${+t.toFixed(1)}`; axis.append(tx);
  }
  const xl = svg('text', { x: W - m.r, y: H - 2, 'text-anchor': 'end' }); xl.textContent = `第一個觸發後（${xUnit}）`; axis.append(xl);
  const yl = svg('text', { x: m.l - 6, y: m.t - 2, 'text-anchor': 'end' }); yl.textContent = yUnit; axis.append(yl);
  root.append(grid, axis);
  if (Number.isFinite(truth)) {
    root.append(svg('line', { class: 'truth-line', x1: m.l, x2: W - m.r, y1: Y(truth), y2: Y(truth) }));
    const t = svg('text', { class: 'truth-label', x: W - m.r + 4, y: Y(truth) + 4 }); t.textContent = truthLabel; root.append(t);
  }
  root.append(svg('path', { class: 'series-line', d: pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join('') }));
  for (const p of pts) root.append(svg('circle', { class: `series-dot${p.low ? ' low' : ''}`, cx: X(p.x), cy: Y(p.y), r: 4 }));
  // 最後一點直接標數值
  const last = pts[pts.length - 1];
  const end = svg('text', { class: 'end-label', x: X(last.x) + 7, y: Y(last.y) - 7 }); end.textContent = `${+last.y.toFixed(1)}`;
  if (!Number.isFinite(truth) || Math.abs(Y(last.y) - Y(truth)) > 12) root.append(end);
  // 懸停：十字線＋提示，命中範圍是整個繪圖區（找最近的報）
  const cross = svg('line', { class: 'crosshair', y1: m.t, y2: H - m.b, visibility: 'hidden' });
  const hit = svg('rect', { x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b, fill: 'transparent' });
  root.append(cross, hit);
  const tip = document.getElementById('tooltip');
  hit.addEventListener('pointermove', (e) => {
    const box = root.getBoundingClientRect();
    const sx = (e.clientX - box.left) / box.width * W;
    const p = pts.reduce((a, b) => (Math.abs(X(b.x) - sx) < Math.abs(X(a.x) - sx) ? b : a));
    cross.setAttribute('x1', X(p.x)); cross.setAttribute('x2', X(p.x)); cross.setAttribute('visibility', 'visible');
    tip.textContent = p.label;
    tip.style.display = 'block';
    tip.style.left = `${Math.min(e.clientX + 12, window.innerWidth - tip.offsetWidth - 8)}px`;
    tip.style.top = `${e.clientY + 12}px`;
  });
  hit.addEventListener('pointerleave', () => { cross.setAttribute('visibility', 'hidden'); tip.style.display = 'none'; });
  host.append(root);
}

// ── 首頁 ──
async function renderIndex() {
  const tabs = document.getElementById('years');
  const body = document.getElementById('rows');
  const status = document.getElementById('status');
  let years;
  try { years = await getJson('data/years.json'); } catch (e) { status.textContent = '還沒有資料'; return; }
  years.sort().reverse();
  const show = async (year) => {
    for (const b of tabs.children) b.setAttribute('aria-pressed', String(b.dataset.year === year));
    status.textContent = '載入中…';
    let list = [];
    try { list = await getJson(`data/${year}/index.json`); } catch (e) { status.textContent = String(e.message); return; }
    list.sort((a, b) => (b.firstTriggerMs ?? 0) - (a.firstTriggerMs ?? 0));
    body.replaceChildren(...list.map((ev) => {
      const f = ev.final || {}; const t = ev.truth;
      const err = t && Number.isFinite(f.lat) ? km(f.lat, f.lng, t.lat, t.lng) : null;
      const link = el('a', { href: `event.html?y=${encodeURIComponent(year)}&id=${encodeURIComponent(ev.eventId)}`, text: fmtTime(f.originMs ?? ev.firstTriggerMs) });
      return el('tr', {},
        el('td', {}, link),
        el('td', { text: t ? t.location || '' : `${fix(f.lat, 2)}, ${fix(f.lng, 2)}` }),
        el('td', { class: 'r', text: Number.isFinite(f.magnitude) ? `M ${fix(f.magnitude)}` : '—' }),
        el('td', { class: 'r', text: Number.isFinite(f.depth) ? `${Math.round(f.depth)} km` : '—' }),
        el('td', { class: 'r', text: String(ev.reports ?? '—') }),
        el('td', { class: 'r', text: t ? `M ${fix(t.magnitude)}・${fix(t.depth, 0)} km` : '' }, t ? null : el('span', { class: 'tag', text: '無中央氣象署報告' })),
        el('td', { class: 'r', text: err === null ? '—' : `${fix(err)} km` }),
        el('td', {}, ev.cancelled ? el('span', { class: 'tag', text: '已取消' }) : null,
          ev.rebuilt ? el('span', { class: 'tag', title: '用目前版本的程式，拿當時存下的測站資料事後重算；不是當時即時發出的結果', text: '事後重算' }) : null)
      );
    }));
    status.textContent = list.length ? `${year} 年共 ${list.length} 場` : `${year} 年還沒有事件`;
  };
  tabs.replaceChildren(...years.map((y) => {
    const b = el('button', { type: 'button', text: y, 'aria-pressed': 'false' });
    b.dataset.year = y;
    b.addEventListener('click', () => show(y));
    return b;
  }));
  if (years.length) show(years[0]);
}

// ── 事件頁 ──
async function renderEvent() {
  const q = new URLSearchParams(location.search);
  const year = q.get('y'); const id = q.get('id');
  const title = document.getElementById('title');
  if (!year || !id || !/^[\w-]+$/.test(id) || !/^\d{4}$/.test(year)) { title.textContent = '找不到事件'; return; }
  let ev;
  try { ev = await getJson(`data/${year}/${id}.json`); } catch (e) { title.textContent = `找不到事件 ${id}`; return; }
  const reps = ev.reports || [];
  const fin = [...reps].reverse().find((r) => r.kind !== 'report') || reps[reps.length - 1] || {};
  const t = ev.truth;
  document.title = `${t?.location || id} · HOMO_eew 報告`;
  title.textContent = t?.location || `事件 ${id}`;
  document.getElementById('meta').textContent = `事件代號 ${id}・第一個觸發 ${fmtTime(ev.firstTriggerMs)}・共 ${reps.length} 報${ev.cancelled ? '・已取消' : ''}`
    + (ev.rebuilt ? '・事後重算（用目前版本的程式，拿當時存下的測站資料重算，不是當時即時發出的結果）' : '');

  // 摘要：最終報 vs 中央氣象署
  const stat = (label, value, sub) => el('div', { class: 'card stat' }, el('div', { class: 'label', text: label }), el('div', { class: 'value', text: value }), el('div', { class: 'sub', text: sub }));
  const first = reps[0] || {};
  const summary = document.getElementById('summary');
  summary.replaceChildren(
    stat('震央誤差（最終報）', t && Number.isFinite(fin.lat) ? `${fix(km(fin.lat, fin.lng, t.lat, t.lng))} km` : '—', `${fix(fin.lat, 2)}, ${fix(fin.lng, 2)}${t ? `｜CWA ${fix(t.lat, 2)}, ${fix(t.lng, 2)}` : ''}`),
    stat('規模（最終報）', Number.isFinite(fin.magnitude) ? `M ${fix(fin.magnitude)}` : '—', t ? `CWA M ${fix(t.magnitude)}（差 ${fix(fin.magnitude - t.magnitude)}）` : '無中央氣象署報告'),
    stat('深度（最終報）', Number.isFinite(fin.depth) ? `${Math.round(fin.depth)} km` : '—', t ? `CWA ${fix(t.depth)} km（差 ${fix(fin.depth - t.depth, 0)} km）` : ''),
    stat('第一報', t && Number.isFinite(first.dataMs) ? `發震後 ${fix((first.dataMs - t.originMs) / 1000, 0)} 秒` : `觸發後 ${fix(first.sinceFirstS, 0)} 秒`,
      t && Number.isFinite(first.lat) ? `震央差 ${fix(km(first.lat, first.lng, t.lat, t.lng))} km` : `${fix(first.lat, 2)}, ${fix(first.lng, 2)}`),
    stat('發震時間', fmtTime(fin.originMs), t ? `CWA ${fmtTime(t.originMs)}（差 ${fix((fin.originMs - t.originMs) / 1000)} 秒）` : '')
  );

  // 精度收斂圖：x = 第一個觸發後秒數
  const label = (r, extra) => `第 ${r.report} 報${r.kind === 'final' ? '（最終）' : r.kind === 'supplement' ? '（追加）' : ''}・觸發後 ${fix(r.sinceFirstS, 0)} 秒\n${extra}`;
  const pt = (r, y, extra, low = false) => ({ x: r.sinceFirstS, y, low, label: label(r, extra) });
  lineChart(document.getElementById('c-epi'), t
    ? { points: reps.map((r) => { const d = km(r.lat, r.lng, t.lat, t.lng); return pt(r, d, `震央誤差 ${fix(d)} km`); }), yUnit: 'km', yMin: 0, yFloorSpan: 5 }
    : { points: [] });
  if (!t) document.getElementById('c-epi').replaceChildren(el('div', { class: 'empty', text: '沒有中央氣象署報告，無法計算誤差' }));
  lineChart(document.getElementById('c-mag'), {
    points: reps.map((r) => pt(r, r.magnitude, `M ${fix(r.magnitude)}${r.magLow ? '（低精度）' : ''}・${r.magStations ?? '—'} 站`, !!r.magLow)),
    truth: t?.magnitude, truthLabel: t ? `CWA ${fix(t.magnitude)}` : '', yUnit: 'M', yFloorSpan: 1
  });
  lineChart(document.getElementById('c-depth'), {
    points: reps.map((r) => pt(r, r.depth, `深度 ${fix(r.depth, 0)} km`)),
    truth: t?.depth, truthLabel: t ? `CWA ${fix(t.depth, 0)}` : '', yUnit: 'km', yMin: 0, yFloorSpan: 10
  });
  lineChart(document.getElementById('c-st'), {
    points: reps.map((r) => pt(r, r.stations, `${r.stations} 站（P ${r.phaseP}・S ${r.phaseS}・O ${r.phaseO}）`)), yUnit: '站', yMin: 0, yFloorSpan: 5
  });

  // 逐報明細
  document.getElementById('rows').replaceChildren(...reps.map((r) => el('tr', {},
    el('td', { text: `${r.report}${r.kind === 'final' ? '（終）' : r.kind === 'supplement' ? `（追加 ${r.revision}）` : ''}` }),
    el('td', { class: 'r', text: fix(r.sinceFirstS, 0) }),
    el('td', { class: 'r', text: t ? fix((r.dataMs - t.originMs) / 1000, 0) : '—' }),
    el('td', { text: `${fix(r.lat, 2)}, ${fix(r.lng, 2)}` }),
    el('td', { class: 'r', text: t ? fix(km(r.lat, r.lng, t.lat, t.lng)) : '—' }),
    el('td', { class: 'r', text: fix(r.depth, 0) }),
    el('td', { class: 'r', text: Number.isFinite(r.magnitude) ? `${fix(r.magnitude)}${r.magLow ? '（低）' : ''}` : '—' }),
    el('td', { class: 'r', text: String(r.stations) }),
    el('td', { class: 'r', text: `${r.phaseP}/${r.phaseS}/${r.phaseO}` }),
    el('td', { text: r.quality ?? '—' }),
    el('td', { class: 'r', text: Number.isFinite(r.maxPga) ? fix(r.maxPga) : '—' })
  )));
}
