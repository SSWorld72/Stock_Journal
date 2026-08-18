// ===========================================================================
// statsCharts.js — 模組化通用圖表庫
// 提供：drawPieChart / drawBarChart / drawLineChart / exportChart
// 每個圖表自動包含 Tooltip、Legend、格線、響應式
// ===========================================================================

// ─── SVG 工具 ───────────────────────────────────────────────────────────────

export function createSvgElement(tag, attrs = {}) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, val] of Object.entries(attrs)) {
        el.setAttribute(key, val);
    }
    return el;
}

// ─── 統一顏色盤 ─────────────────────────────────────────────────────────────

const COLORS = [
    '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
    '#06b6d4', '#6366f1', '#f43f5e', '#84cc16', '#14b8a6',
    '#e879f9', '#fb923c', '#38bdf8', '#a3e635', '#f472b6'
];

const getColor = (index, custom) => custom || COLORS[index % COLORS.length];

// ─── 數值格式化 ─────────────────────────────────────────────────────────────

function formatValue(val) {
    if (val == null || isNaN(val)) return '0';
    const abs = Math.abs(val);
    if (abs >= 1e8) return (val / 1e8).toFixed(1) + '億';
    if (abs >= 1e4) return (val / 1e4).toFixed(1) + '萬';
    return Math.round(val).toLocaleString('en-US');
}

function formatAxisValue(val) {
    const abs = Math.abs(val);
    if (abs >= 1e8) return (val / 1e8).toFixed(1) + '億';
    if (abs >= 1e4) return (val / 1e4).toFixed(1) + 'W';
    return Math.round(val).toLocaleString('en-US');
}

// ─── 共用：Tooltip ──────────────────────────────────────────────────────────

function createTooltip(container) {
    const el = document.createElement('div');
    el.className = [
        'absolute hidden bg-slate-800/95 text-white text-xs',
        'px-2.5 py-1.5 rounded-lg pointer-events-none z-50',
        'shadow-lg whitespace-nowrap backdrop-blur-sm',
        'border border-white/10'
    ].join(' ');
    container.appendChild(el);
    return el;
}

function moveTooltip(tooltip, container, e, offsetX = 12, offsetY = -20) {
    const rect = container.getBoundingClientRect();
    let left = e.clientX - rect.left + offsetX;
    let top = e.clientY - rect.top + offsetY;

    // 防止超出容器
    const tw = tooltip.offsetWidth || 120;
    const th = tooltip.offsetHeight || 30;
    if (left + tw > rect.width) left = e.clientX - rect.left - tw - offsetX;
    if (top < 0) top = e.clientY - rect.top + 12;
    if (top + th > rect.height) top = rect.height - th - 4;

    tooltip.style.left = left + 'px';
    tooltip.style.top = top + 'px';
}

function showTooltip(tooltip, html) {
    tooltip.innerHTML = html;
    tooltip.classList.remove('hidden');
}

function hideTooltip(tooltip) {
    tooltip.classList.add('hidden');
}

// ─── 共用：Legend ───────────────────────────────────────────────────────────

function createLegend(container, items, maxItems = 12) {
    const legendEl = document.createElement('div');
    legendEl.className = [
        'flex flex-wrap justify-center gap-x-3 gap-y-1',
        'mt-2 px-1 pb-1 overflow-y-auto max-h-[64px]',
        'custom-scrollbar shrink-0'
    ].join(' ');

    items.slice(0, maxItems).forEach(item => {
        legendEl.innerHTML += `
            <div class="flex items-center text-xs text-slate-600 cursor-default" title="${item.label}: ${item.detail || ''}">
                <span class="w-2.5 h-2.5 rounded-full mr-1 shrink-0" style="background:${item.color}"></span>
                <span class="truncate max-w-[90px]">${item.label}</span>
                ${item.suffix ? `<span class="ml-1 text-slate-400">${item.suffix}</span>` : ''}
            </div>
        `;
    });

    if (items.length > maxItems) {
        legendEl.innerHTML += `<div class="text-xs text-slate-400">…其他 ${items.length - maxItems} 項</div>`;
    }

    container.appendChild(legendEl);
    return legendEl;
}

// ─── 共用：匯出按鈕 ─────────────────────────────────────────────────────────

function addExportButton(container, svgEl, title = '圖表') {
    const btnGroup = document.createElement('div');
    btnGroup.className = 'absolute top-1 right-1 flex gap-1 opacity-0 group-hover/chart:opacity-100 transition-opacity z-10';

    // PNG 匯出
    const btnPng = document.createElement('button');
    btnPng.className = 'p-1 rounded bg-white/80 hover:bg-white shadow-sm border border-slate-200 text-slate-500 hover:text-slate-700 transition-colors';
    btnPng.title = '匯出 PNG';
    btnPng.innerHTML = `<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>`;
    btnPng.addEventListener('click', () => exportChartAsPng(svgEl, container, title));

    // SVG 匯出
    const btnSvg = document.createElement('button');
    btnSvg.className = 'p-1 rounded bg-white/80 hover:bg-white shadow-sm border border-slate-200 text-slate-500 hover:text-slate-700 transition-colors';
    btnSvg.title = '匯出 SVG';
    btnSvg.innerHTML = `<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"/></svg>`;
    btnSvg.addEventListener('click', () => exportChartAsSvg(svgEl, title));

    btnGroup.appendChild(btnPng);
    btnGroup.appendChild(btnSvg);
    container.appendChild(btnGroup);
}

function exportChartAsPng(svgEl, container, title) {
    const svgClone = svgEl.cloneNode(true);
    const viewBox = svgEl.getAttribute('viewBox');
    const [, , vbW, vbH] = (viewBox || '0 0 600 300').split(' ').map(Number);

    // 設定明確尺寸以供 canvas 使用
    svgClone.setAttribute('width', vbW * 2);
    svgClone.setAttribute('height', vbH * 2);
    svgClone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

    // 加入白色背景
    const bg = createSvgElement('rect', { x: 0, y: 0, width: vbW, height: vbH, fill: '#ffffff' });
    svgClone.insertBefore(bg, svgClone.firstChild);

    const svgData = new XMLSerializer().serializeToString(svgClone);
    const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);

    const img = new Image();
    img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = vbW * 2;
        canvas.height = vbH * 2;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
        URL.revokeObjectURL(url);

        canvas.toBlob(blob => {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `${title}_${new Date().toISOString().slice(0, 10)}.png`;
            a.click();
            URL.revokeObjectURL(a.href);
        }, 'image/png');
    };
    img.src = url;
}

function exportChartAsSvg(svgEl, title) {
    const svgClone = svgEl.cloneNode(true);
    svgClone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

    // 加入白色背景
    const viewBox = svgEl.getAttribute('viewBox');
    const [, , vbW, vbH] = (viewBox || '0 0 600 300').split(' ').map(Number);
    const bg = createSvgElement('rect', { x: 0, y: 0, width: vbW, height: vbH, fill: '#ffffff' });
    svgClone.insertBefore(bg, svgClone.firstChild);

    const svgData = new XMLSerializer().serializeToString(svgClone);
    const blob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${title}_${new Date().toISOString().slice(0, 10)}.svg`;
    a.click();
    URL.revokeObjectURL(a.href);
}

// 公開匯出函式（給外部手動呼叫）
export function exportChart(containerId, format = 'png', title = '圖表') {
    const container = document.getElementById(containerId);
    if (!container) return;
    const svgEl = container.querySelector('svg');
    if (!svgEl) return;
    if (format === 'svg') exportChartAsSvg(svgEl, title);
    else exportChartAsPng(svgEl, container, title);
}

// ─── 共用：初始化容器 ───────────────────────────────────────────────────────

function initContainer(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return null;
    container.innerHTML = '';
    container.classList.add('flex', 'flex-col', 'relative', 'group/chart');
    return container;
}

function showEmpty(container, msg = '尚無資料') {
    container.innerHTML = `<div class="flex items-center justify-center h-full text-sm text-slate-400">${msg}</div>`;
}

// ─── 共用：Y 軸格線與刻度 ───────────────────────────────────────────────────

function drawGrid(svg, padLeft, padTop, chartW, chartH, minVal, maxVal, tickCount = 5) {
    const yRange = maxVal - minVal;
    if (yRange === 0) return;

    const gGrid = createSvgElement('g');

    for (let i = 0; i <= tickCount; i++) {
        const val = minVal + (yRange * i / tickCount);
        const y = padTop + chartH - ((val - minVal) / yRange) * chartH;

        // 格線
        gGrid.appendChild(createSvgElement('line', {
            x1: padLeft, y1: y, x2: padLeft + chartW, y2: y,
            stroke: '#e2e8f0',
            'stroke-dasharray': '4,4'
        }));

        // Y 軸標籤
        const text = createSvgElement('text', {
            x: padLeft - 8, y: y + 4,
            'text-anchor': 'end',
            fill: '#94a3b8',
            'font-size': '10px'
        });
        text.textContent = formatAxisValue(val);
        gGrid.appendChild(text);
    }

    svg.appendChild(gGrid);
}

// ─── 共用：計算 Y 軸範圍 ────────────────────────────────────────────────────

function calcYRange(values) {
    let minVal = 0, maxVal = 0;
    values.forEach(v => {
        if (v > maxVal) maxVal = v;
        if (v < minVal) minVal = v;
    });
    if (maxVal === 0 && minVal === 0) maxVal = 100;
    if (maxVal > 0) maxVal *= 1.1;
    if (minVal < 0) minVal *= 1.1;
    return { minVal, maxVal, yRange: maxVal - minVal };
}


// ===========================================================================
// 🥧 drawPieChart — 圓餅圖 / 甜甜圈圖
// ===========================================================================
// data: [{ label, value, color? }]
// options: { donut?, centerText?, title? }

export function drawPieChart(containerId, rawData, options = {}) {
    // 相容舊 API: drawPieChart(id, data, isDonut)
    if (typeof options === 'boolean') {
        options = { donut: options };
    }

    const container = initContainer(containerId);
    if (!container) return;

    // 過濾有效正數值並排序（大到小）
    const data = (rawData || [])
        .map(item => ({ ...item, value: Number(item.value) || 0 }))
        .filter(item => item.value > 0);
    data.sort((a, b) => b.value - a.value);

    const total = data.reduce((sum, item) => sum + item.value, 0);
    if (total <= 0 || data.length === 0) { showEmpty(container); return; }

    const width = container.clientWidth || 300;
    const height = Math.max(160, (container.clientHeight || 250) - 50);

    const svg = createSvgElement('svg', {
        width: '100%', height: '100%',
        class: 'flex-1 min-h-0',
        viewBox: `0 0 ${width} ${height}`,
        preserveAspectRatio: 'xMidYMid meet'
    });

    const radius = Math.min(width, height) / 2 * 0.75;
    const cx = width / 2;
    const cy = height / 2;

    const g = createSvgElement('g', { transform: `translate(${cx}, ${cy})` });
    const tooltip = createTooltip(container);

    if (data.length === 1) {
        // 單一項目 100% 滿圓直接使用 circle 元素，完美避免 SVG Arc 截斷
        const item = data[0];
        const color = getColor(0, item.color);
        const circle = createSvgElement('circle', {
            cx: 0, cy: 0, r: radius,
            fill: color, stroke: '#fff', 'stroke-width': '2',
            class: 'transition-all duration-200 hover:opacity-85 cursor-pointer'
        });

        circle.addEventListener('mouseenter', () => {
            circle.setAttribute('transform', 'scale(1.03)');
            showTooltip(tooltip,
                `<strong>${item.label}</strong><br>` +
                `<span class="text-slate-300">${formatValue(item.value)}</span>` +
                `<span class="ml-1.5 text-blue-300">100.0%</span>`
            );
        });
        circle.addEventListener('mousemove', e => moveTooltip(tooltip, container, e));
        circle.addEventListener('mouseleave', () => {
            circle.setAttribute('transform', 'scale(1)');
            hideTooltip(tooltip);
        });

        g.appendChild(circle);
    } else {
        let startAngle = -Math.PI / 2; // 從 12 點鐘方向開始

        data.forEach((item, i) => {
            const sliceAngle = (item.value / total) * 2 * Math.PI;
            const endAngle = startAngle + sliceAngle; // 順時針累加角度
            const color = getColor(i, item.color);

            const x1 = Math.cos(startAngle) * radius;
            const y1 = Math.sin(startAngle) * radius;
            const x2 = Math.cos(endAngle) * radius;
            const y2 = Math.sin(endAngle) * radius;
            const largeArc = sliceAngle > Math.PI ? 1 : 0;

            // 標準 SVG 順時針扇形路徑 (sweep-flag = 1)
            const d = `M 0 0 L ${x1.toFixed(3)} ${y1.toFixed(3)} A ${radius.toFixed(3)} ${radius.toFixed(3)} 0 ${largeArc} 1 ${x2.toFixed(3)} ${y2.toFixed(3)} Z`;

            const path = createSvgElement('path', {
                d, fill: color, stroke: '#fff', 'stroke-width': '2',
                class: 'transition-all duration-200 hover:opacity-80 cursor-pointer'
            });

            const pct = ((item.value / total) * 100).toFixed(1);

            path.addEventListener('mouseenter', () => {
                path.setAttribute('transform', 'scale(1.04)');
                showTooltip(tooltip,
                    `<strong>${item.label}</strong><br>` +
                    `<span class="text-slate-300">${formatValue(item.value)}</span>` +
                    `<span class="ml-1.5 text-blue-300">${pct}%</span>`
                );
            });
            path.addEventListener('mousemove', e => moveTooltip(tooltip, container, e));
            path.addEventListener('mouseleave', () => {
                path.setAttribute('transform', 'scale(1)');
                hideTooltip(tooltip);
            });

            g.appendChild(path);
            startAngle = endAngle;
        });
    }

    // 甜甜圈中心
    if (options.donut) {
        g.appendChild(createSvgElement('circle', {
            cx: 0, cy: 0, r: radius * 0.6, fill: '#ffffff'
        }));

        const centerLabel = createSvgElement('text', {
            x: 0, y: -2, 'text-anchor': 'middle', 'dominant-baseline': 'middle',
            fill: '#475569', 'font-weight': 'bold', 'font-size': '11px'
        });
        centerLabel.textContent = options.centerText || '總計';

        const centerVal = createSvgElement('text', {
            x: 0, y: 14, 'text-anchor': 'middle', 'dominant-baseline': 'middle',
            fill: '#1e293b', 'font-weight': 'bold', 'font-size': '13px'
        });
        centerVal.textContent = formatValue(total);

        g.appendChild(centerLabel);
        g.appendChild(centerVal);
    }

    svg.appendChild(g);
    container.appendChild(svg);

    // 圖例
    const legendItems = data.map((item, i) => ({
        label: item.label,
        color: getColor(i, item.color),
        suffix: `(${((item.value / total) * 100).toFixed(1)}%)`,
        detail: `${formatValue(item.value)} (${((item.value / total) * 100).toFixed(1)}%)`
    }));
    createLegend(container, legendItems);

    // 匯出按鈕
    addExportButton(container, svg, options.title || '圓餅圖');
}


// ===========================================================================
// 📊 drawBarChart — 長條圖
// ===========================================================================
// 簡易模式: drawBarChart(containerId, labels, data1, data2?, config?)  ← 向後相容
// 物件模式: drawBarChart(containerId, data, options?)
//   data: [{ label, value, color? }]  或  [{ label, value1, value2 }]

export function drawBarChart(containerId, labelsOrData, data1OrOptions, data2, config) {
    // 偵測呼叫模式
    let labels, values1, values2, options, colors1;

    if (Array.isArray(labelsOrData) && labelsOrData.length > 0 && typeof labelsOrData[0] === 'string') {
        // 舊 API: drawBarChart(id, labels[], data1[], data2?, config?)
        labels = labelsOrData;
        values1 = data1OrOptions || [];
        values2 = data2 || null;
        options = config || {};
    } else if (Array.isArray(labelsOrData) && labelsOrData.length > 0 && typeof labelsOrData[0] === 'object') {
        // 新 API: drawBarChart(id, [{label, value, color, ...}], options?)
        labels = labelsOrData.map(d => d.label);
        values1 = labelsOrData.map(d => d.value ?? d.value1 ?? 0);
        colors1 = labelsOrData.map(d => d.color);
        values2 = labelsOrData.some(d => d.value2 != null) ? labelsOrData.map(d => d.value2 ?? 0) : null;
        options = data1OrOptions || {};
    } else {
        labels = labelsOrData || [];
        values1 = data1OrOptions || [];
        values2 = data2 || null;
        options = config || {};
    }

    const container = initContainer(containerId);
    if (!container) return;

    if (!labels || labels.length === 0) {
        showEmpty(container);
        return;
    }

    const width = container.clientWidth || 600;
    const height = (container.clientHeight || 300) - 30; // 留空給 legend

    const padTop = 20, padBottom = 40, padLeft = 60, padRight = 20;
    const chartW = width - padLeft - padRight;
    const chartH = height - padTop - padBottom;

    const svg = createSvgElement('svg', {
        width: '100%', height: '100%',
        class: 'flex-1 min-h-0',
        viewBox: `0 0 ${width} ${height}`,
        preserveAspectRatio: 'none'
    });

    // 計算 Y 軸範圍
    const allVals = [];
    for (let i = 0; i < labels.length; i++) {
        allVals.push(values1[i] || 0);
        if (values2) allVals.push(values2[i] || 0);
    }
    const { minVal, maxVal, yRange } = calcYRange(allVals);

    const getY = (val) => padTop + chartH - ((val - minVal) / yRange) * chartH;
    const zeroY = getY(0);

    // 格線
    drawGrid(svg, padLeft, padTop, chartW, chartH, minVal, maxVal);

    // Tooltip
    const tooltip = createTooltip(container);

    // 長條
    const gBars = createSvgElement('g');
    const barSpacing = chartW / labels.length;
    const barWidth = Math.min(barSpacing * 0.6, 40);
    const isDual = values2 !== null;

    for (let i = 0; i < labels.length; i++) {
        const xCenter = padLeft + (i + 0.5) * barSpacing;

        // X 軸標籤
        if (labels.length <= 12 || i % Math.ceil(labels.length / 12) === 0) {
            const xText = createSvgElement('text', {
                x: xCenter, y: height - 15,
                'text-anchor': 'middle', fill: '#64748b', 'font-size': '11px'
            });
            xText.textContent = labels[i];
            gBars.appendChild(xText);
        }

        const v1 = values1[i] || 0;
        // 優先使用單項指定顏色，其次為選項設定，預設正值紅、負值綠
        const color1 = (colors1 && colors1[i]) || options.color1 || (v1 >= 0 ? '#ef4444' : '#22c55e');

        if (isDual) {
            const v2 = values2[i] || 0;
            const color2 = options.color2 || '#3b82f6';
            const w = barWidth / 2.2;

            const y1 = Math.min(zeroY, getY(v1));
            const h1 = Math.abs(getY(v1) - zeroY);
            const rect1 = createSvgElement('rect', {
                x: xCenter - w - 1, y: y1, width: w, height: Math.max(h1, 1),
                fill: color1, rx: 2
            });

            const y2 = Math.min(zeroY, getY(v2));
            const h2 = Math.abs(getY(v2) - zeroY);
            const rect2 = createSvgElement('rect', {
                x: xCenter + 1, y: y2, width: w, height: Math.max(h2, 1),
                fill: color2, rx: 2
            });

            // 透明碰觸區域
            const hitArea = createSvgElement('rect', {
                x: xCenter - barSpacing / 2, y: padTop, width: barSpacing, height: chartH,
                fill: 'transparent', class: 'cursor-pointer'
            });

            hitArea.addEventListener('mouseenter', () => {
                rect1.setAttribute('opacity', '0.8');
                rect2.setAttribute('opacity', '0.8');
                showTooltip(tooltip,
                    `<strong>${labels[i]}</strong><br>` +
                    `<span style="color:${color1}">●</span> ${options.label1 || '數值1'}: ${formatValue(v1)}<br>` +
                    `<span style="color:${color2}">●</span> ${options.label2 || '數值2'}: ${formatValue(v2)}`
                );
            });
            hitArea.addEventListener('mousemove', e => moveTooltip(tooltip, container, e, 12, -30));
            hitArea.addEventListener('mouseleave', () => {
                rect1.setAttribute('opacity', '1');
                rect2.setAttribute('opacity', '1');
                hideTooltip(tooltip);
            });

            gBars.appendChild(rect1);
            gBars.appendChild(rect2);
            gBars.appendChild(hitArea);
        } else {
            // 單系列長條
            const y = Math.min(zeroY, getY(v1));
            const h = Math.abs(getY(v1) - zeroY);

            const rect = createSvgElement('rect', {
                x: xCenter - barWidth / 2, y, width: barWidth, height: Math.max(h, 1),
                fill: color1, rx: 2,
                class: 'transition-opacity hover:opacity-80 cursor-pointer'
            });

            rect.addEventListener('mouseenter', () => {
                showTooltip(tooltip,
                    `<strong>${labels[i]}</strong><br>${formatValue(v1)}`
                );
            });
            rect.addEventListener('mousemove', e => moveTooltip(tooltip, container, e));
            rect.addEventListener('mouseleave', () => hideTooltip(tooltip));

            gBars.appendChild(rect);
        }
    }

    // 零線
    if (minVal < 0 && maxVal > 0) {
        gBars.appendChild(createSvgElement('line', {
            x1: padLeft, y1: zeroY, x2: padLeft + chartW, y2: zeroY,
            stroke: '#94a3b8', 'stroke-width': '1.5'
        }));
    }

    svg.appendChild(gBars);
    container.appendChild(svg);

    // 圖例（雙系列時顯示）
    if (isDual && (options.label1 || options.label2)) {
        createLegend(container, [
            { label: options.label1 || '數值1', color: options.color1 || '#ef4444' },
            { label: options.label2 || '數值2', color: options.color2 || '#3b82f6' }
        ]);
    }

    // 匯出按鈕
    addExportButton(container, svg, options.title || '長條圖');
}


// ===========================================================================
// 📈 drawLineChart — 折線圖 / 面積圖
// ===========================================================================
// data: [{ label, value }]  (單系列)
//   或  [{ label, values: [v1, v2, ...] }]  (多系列)
// options: {
//   series?: [{ name, color }],   // 多系列的名稱與顏色
//   fill?: boolean,               // 是否填充為面積圖
//   smooth?: boolean,             // 是否使用平滑曲線
//   title?: string                // 匯出時的標題
// }

export function drawLineChart(containerId, data, options = {}) {
    const container = initContainer(containerId);
    if (!container) return;

    if (!data || data.length === 0) {
        showEmpty(container);
        return;
    }

    const width = container.clientWidth || 600;
    const height = (container.clientHeight || 300) - 30;

    const padTop = 20, padBottom = 40, padLeft = 60, padRight = 20;
    const chartW = width - padLeft - padRight;
    const chartH = height - padTop - padBottom;

    // 判斷是單系列還是多系列
    const isMulti = data[0].values != null;
    const seriesCount = isMulti ? data[0].values.length : 1;
    const seriesConfig = options.series || [];

    // 取出所有值以計算 Y 軸範圍
    const allVals = [];
    data.forEach(d => {
        if (isMulti) d.values.forEach(v => allVals.push(v || 0));
        else allVals.push(d.value || 0);
    });
    const { minVal, maxVal, yRange } = calcYRange(allVals);

    const svg = createSvgElement('svg', {
        width: '100%', height: '100%',
        class: 'flex-1 min-h-0',
        viewBox: `0 0 ${width} ${height}`,
        preserveAspectRatio: 'none'
    });

    const getX = (idx) => padLeft + (idx / Math.max(data.length - 1, 1)) * chartW;
    const getY = (val) => padTop + chartH - ((val - minVal) / yRange) * chartH;

    // 格線
    drawGrid(svg, padLeft, padTop, chartW, chartH, minVal, maxVal);

    // X 軸標籤
    const gLabels = createSvgElement('g');
    const maxLabels = 12;
    const step = Math.max(1, Math.ceil(data.length / maxLabels));
    data.forEach((d, i) => {
        if (i % step === 0 || i === data.length - 1) {
            const text = createSvgElement('text', {
                x: getX(i), y: height - 15,
                'text-anchor': 'middle', fill: '#64748b', 'font-size': '11px'
            });
            text.textContent = d.label;
            gLabels.appendChild(text);
        }
    });
    svg.appendChild(gLabels);

    // Defs 用於面積漸層
    const defs = createSvgElement('defs');
    svg.appendChild(defs);

    // 繪製每個系列
    for (let s = 0; s < seriesCount; s++) {
        const color = seriesConfig[s]?.color || getColor(s);
        const values = isMulti ? data.map(d => d.values[s] || 0) : data.map(d => d.value || 0);

        // 建構路徑
        let pathD = '';
        const points = [];
        values.forEach((v, i) => {
            const x = getX(i);
            const y = getY(v);
            points.push({ x, y });
            pathD += (i === 0 ? 'M' : 'L') + ` ${x} ${y} `;
        });

        // 面積填充
        if (options.fill) {
            const gradId = `area-grad-${s}-${containerId}`;
            const grad = createSvgElement('linearGradient', {
                id: gradId, x1: '0', y1: '0', x2: '0', y2: '1'
            });
            grad.appendChild(createSvgElement('stop', {
                offset: '0%', 'stop-color': color, 'stop-opacity': '0.3'
            }));
            grad.appendChild(createSvgElement('stop', {
                offset: '100%', 'stop-color': color, 'stop-opacity': '0.02'
            }));
            defs.appendChild(grad);

            const areaD = pathD +
                `L ${getX(data.length - 1)} ${padTop + chartH} ` +
                `L ${getX(0)} ${padTop + chartH} Z`;
            svg.appendChild(createSvgElement('path', {
                d: areaD, fill: `url(#${gradId})`, stroke: 'none'
            }));
        }

        // 折線
        svg.appendChild(createSvgElement('path', {
            d: pathD, fill: 'none', stroke: color,
            'stroke-width': '2', 'stroke-linejoin': 'round', 'stroke-linecap': 'round'
        }));

        // 資料點
        points.forEach((pt, i) => {
            svg.appendChild(createSvgElement('circle', {
                cx: pt.x, cy: pt.y, r: data.length <= 20 ? 3 : 2,
                fill: '#fff', stroke: color, 'stroke-width': '1.5'
            }));
        });
    }

    // Tooltip 互動層
    const tooltip = createTooltip(container);
    const hoverLayer = createSvgElement('g');

    // 垂直十字線
    const crossV = createSvgElement('line', {
        stroke: '#cbd5e1', 'stroke-width': '1', 'stroke-dasharray': '3,3',
        y1: padTop, y2: padTop + chartH, visibility: 'hidden'
    });
    svg.appendChild(crossV);

    // 透明碰觸區域
    data.forEach((d, i) => {
        const x = getX(i);
        const slotW = chartW / Math.max(data.length - 1, 1);
        const hitX = i === 0 ? padLeft : x - slotW / 2;
        const hitW = i === 0 || i === data.length - 1 ? slotW / 2 + (i === 0 ? 0 : 0) : slotW;

        const hit = createSvgElement('rect', {
            x: hitX, y: padTop, width: Math.max(hitW, 4), height: chartH,
            fill: 'transparent', class: 'cursor-crosshair'
        });

        hit.addEventListener('mouseenter', () => {
            crossV.setAttribute('x1', x);
            crossV.setAttribute('x2', x);
            crossV.setAttribute('visibility', 'visible');

            let html = `<strong>${d.label}</strong>`;
            if (isMulti) {
                d.values.forEach((v, s) => {
                    const c = seriesConfig[s]?.color || getColor(s);
                    const n = seriesConfig[s]?.name || `系列${s + 1}`;
                    html += `<br><span style="color:${c}">●</span> ${n}: ${formatValue(v)}`;
                });
            } else {
                html += `<br>${formatValue(d.value)}`;
            }
            showTooltip(tooltip, html);
        });
        hit.addEventListener('mousemove', e => moveTooltip(tooltip, container, e, 12, -30));
        hit.addEventListener('mouseleave', () => {
            crossV.setAttribute('visibility', 'hidden');
            hideTooltip(tooltip);
        });

        hoverLayer.appendChild(hit);
    });

    svg.appendChild(hoverLayer);
    container.appendChild(svg);

    // 圖例（多系列時顯示）
    if (seriesCount > 1) {
        const legendItems = [];
        for (let s = 0; s < seriesCount; s++) {
            legendItems.push({
                label: seriesConfig[s]?.name || `系列${s + 1}`,
                color: seriesConfig[s]?.color || getColor(s)
            });
        }
        createLegend(container, legendItems);
    }

    // 匯出按鈕
    addExportButton(container, svg, options.title || '折線圖');
}
