// Splits bar chart (pace change per split) + table. Hovering a bar or row highlights that stretch
// elsewhere; clicking selects it (zooms the map).
import { esc, observeWidth } from './util.js';

export class SplitChart {
  constructor(el, { onHover, onLeave, onSelect }) {
    this.el = el;
    Object.assign(this, { onHover, onLeave, onSelect });
    this.data = null;
    observeWidth(el, w => { this.width = w; this.render(); });
    el.addEventListener('pointermove', e => {
      const i = this.indexAt(e);
      if (i !== null) this.onHover?.(i, e); else this.onLeave?.();
    });
    el.addEventListener('pointerleave', () => this.onLeave?.());
    el.addEventListener('click', e => { const i = this.indexAt(e); if (i !== null) this.onSelect?.(i); });
  }

  // data: { values: seconds per split (time change), labels: x labels, active: index|null }
  set(data) { this.data = data; this.render(); }

  indexAt(e) {
    const t = e.target.closest?.('[data-i]');
    return t ? Number(t.dataset.i) : null;
  }

  render() {
    const d = this.data;
    if (!d || !this.width) return;
    const W = this.width, H = W < 520 ? 150 : 180, padL = 40, padR = 8, top = 10, bottom = 22;
    const n = d.values.length;
    const maxAbs = Math.max(5, ...d.values.map(Math.abs));
    const mid = top + (H - top - bottom) / 2, half = (H - top - bottom) / 2;
    const bw = (W - padL - padR) / n;
    const gapPx = Math.min(4, bw * 0.25);
    const stride = Math.max(1, Math.ceil(n / Math.floor((W - padL) / 34)));
    const bars = d.values.map((v, i) => {
      const h = Math.max(1, half * Math.abs(v) / maxAbs);
      const y0 = v > 0 ? mid - h : mid;
      const x0 = padL + i * bw + gapPx / 2, w = Math.max(1, bw - gapPx);
      const r = Math.min(4, w / 2, h);
      // rounded data end, square at the baseline
      const path = v > 0
        ? `M${x0},${mid}V${y0 + r}Q${x0},${y0} ${x0 + r},${y0}H${x0 + w - r}Q${x0 + w},${y0} ${x0 + w},${y0 + r}V${mid}Z`
        : `M${x0},${mid}V${mid + h - r}Q${x0},${mid + h} ${x0 + r},${mid + h}H${x0 + w - r}Q${x0 + w},${mid + h} ${x0 + w},${mid + h - r}V${mid}Z`;
      const dim = d.active !== null && d.active !== undefined && d.active !== i ? ' bar-dim' : '';
      return `<path d="${path}" class="${v > 0 ? 'bar-slow' : 'bar-fast'}${dim}"/>
        <rect class="bar-hit" data-i="${i}" x="${padL + i * bw}" y="${top}" width="${bw}" height="${H - top - bottom}"/>`;
    }).join('');
    // Label every `stride`-th split plus the last one, skipping any that would crowd the last label
    const lastX = padL + (n - 0.5) * bw;
    const labels = d.labels.map((l, i) => {
      const cx = padL + (i + 0.5) * bw;
      const show = i === n - 1 || (i % stride === stride - 1 && lastX - cx >= 30);
      return show ? `<text x="${cx.toFixed(1)}" y="${H - 6}" class="tick" text-anchor="middle">${esc(l)}</text>` : '';
    }).join('');
    this.el.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Time gained or lost per split">
      <line x1="${padL}" x2="${W - padR}" y1="${mid - half}" y2="${mid - half}" class="grid"/>
      <line x1="${padL}" x2="${W - padR}" y1="${mid + half}" y2="${mid + half}" class="grid"/>
      <text x="${padL - 6}" y="${mid - half + 4}" class="tick" text-anchor="end">+${Math.round(maxAbs)}s</text>
      <text x="${padL - 6}" y="${mid + 4}" class="tick" text-anchor="end">0</text>
      <text x="${padL - 6}" y="${mid + half + 4}" class="tick" text-anchor="end">−${Math.round(maxAbs)}s</text>
      ${bars}
      <line x1="${padL}" x2="${W - padR}" y1="${mid}" y2="${mid}" class="axis"/>
      ${labels}
    </svg>`;
  }
}

// rows: [{ label, sub, kind, time, pace, paceDelta, cum, cumDelta, summary }]
export function renderSplitTable(table, rows, { firstHeader, unit }) {
  const d = (sec, txt) => `<span class="d ${sec > 0.5 ? 'slow' : sec < -0.5 ? 'fast' : ''}">${esc(txt)}</span>`;
  table.innerHTML = `<thead><tr><th scope="col">${esc(firstHeader)}</th><th scope="col">Split</th><th scope="col">Pace /${esc(unit)}</th><th scope="col">Elapsed</th></tr></thead>
    <tbody>${rows.map((r, i) => `<tr ${r.summary ? 'class="summary-row"' : `data-i="${r.index}" tabindex="0"`}>
      <td>${r.kind ? `<span class="kind-dot ${r.kind}"></span>` : ''}${esc(r.label)}${r.sub ? `<span class="kind">${esc(r.sub)}</span>` : ''}</td>
      <td>${esc(r.time)}</td>
      <td>${esc(r.pace)}${d(r.paceDeltaSec, r.paceDelta)}</td>
      <td>${esc(r.cum)}${d(r.cumDeltaSec, r.cumDelta)}</td>
    </tr>`).join('')}</tbody>`;
}

export function downloadCsv(filename, header, rows) {
  const q = v => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [header, ...rows].map(r => r.map(q).join(',')).join('\r\n');
  // Leading BOM so Excel reads the file as UTF-8
  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
