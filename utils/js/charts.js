/**
 * ============================================================================
 * Chart Generation Module (charts.js)
 * ============================================================================
 * Responsible for converting data into SVG or using external charting libraries (e.g., Chart.js).
 * Each chart automatically includes Tooltip, Legend, Grid lines, and responsiveness.
 * 
 * @example
 * import { drawPieChart, drawBarChart } from '../../utils/js/charts.js';
 * drawPieChart(containerElement, dataArray, { width: 300, height: 300 });
 */

// --- SVG Utilities -----------------------------------------------------------

export function createSvgElement(tag, attrs = {}) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, val] of Object.entries(attrs)) {
        el.setAttribute(key, val);
    }
    return el;
}

// --- Unified Color Palette ---------------------------------------------------

const COLORS = [
    '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
    '#06b6d4', '#6366f1', '#f43f5e', '#84cc16', '#14b8a6',
    '#e879f9', '#fb923c', '#38bdf8', '#a3e635', '#f472b6'
];

const getColor = (index, custom) => custom || COLORS[index % COLORS.length];

// --- Value Formatting --------------------------------------------------------

function formatValue(val) {
    if (val == null || isNaN(val)) return '0';
    const abs = Math.abs(val);
    const lang = document.documentElement.lang || 'zh-TW';
    if (lang === 'en-US') {
        if (abs >= 1e9) return (val / 1e9).toFixed(1) + (window.t ? window.t('utils.charts.format.billions') : 'B');
        if (abs >= 1e6) return (val / 1e6).toFixed(1) + (window.t ? window.t('utils.charts.format.millions') : 'M');
        if (abs >= 1e3) return (val / 1e3).toFixed(1) + (window.t ? window.t('utils.charts.format.thousands') : 'K');
        return Math.round(val).toLocaleString('en-US');
    } else {
        if (abs >= 1e8) return (val / 1e8).toFixed(1) + (window.t ? window.t('utils.charts.format.hundredMillions') : '');
        if (abs >= 1e4) return (val / 1e4).toFixed(1) + (window.t ? window.t('utils.charts.format.tenThousands') : '');
        return Math.round(val).toLocaleString('en-US');
    }
}

function formatAxisValue(val) {
    const abs = Math.abs(val);
    const lang = document.documentElement.lang || 'zh-TW';
    if (lang === 'en-US') {
        if (abs >= 1e9) return (val / 1e9).toFixed(1) + (window.t ? window.t('utils.charts.format.billions') : 'B');
        if (abs >= 1e6) return (val / 1e6).toFixed(1) + (window.t ? window.t('utils.charts.format.millions') : 'M');
        if (abs >= 1e3) return (val / 1e3).toFixed(1) + (window.t ? window.t('utils.charts.format.thousands') : 'K');
        return Math.round(val).toLocaleString('en-US');
    } else {
        if (abs >= 1e8) return (val / 1e8).toFixed(1) + (window.t ? window.t('utils.charts.format.hundredMillions') : '');
        if (abs >= 1e4) return (val / 1e4).toFixed(1) + (window.t ? window.t('utils.charts.format.tenThousands') : '');
        return Math.round(val).toLocaleString('en-US');
    }
}

// --- Shared: Tooltip ---------------------------------------------------------

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

    // Prevent tooltip from overflowing the container
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

// --- Shared: Legend ----------------------------------------------------------

function createLegend(container, items, maxItems = 12) {
    const legendEl = document.createElement('div');
    legendEl.className = [
        'flex flex-wrap justify-center gap-x-3 gap-y-1',
        'mt-2 px-1 pb-1 overflow-y-auto max-h-[64px]',
        'custom-scrollbar shrink-0'
    ].join(' ');

    items.slice(0, maxItems).forEach(item => {
        legendEl.innerHTML += `
            <div class="flex items-center text-sm cursor-default" style="color: var(--text-main);" title="${item.label}: ${item.detail || ''}">
                <span class="w-3 h-3 rounded-full mr-1.5 shrink-0" style="background:${item.color}"></span>
                <span class="truncate max-w-[110px]">${item.label}</span>
                ${item.suffix ? `<span class="ml-1" style="color: var(--text-muted);">${item.suffix}</span>` : ''}
            </div>
        `;
    });

    if (items.length > maxItems) {
        const count = items.length - maxItems;
        legendEl.innerHTML += `<div class="text-xs text-slate-400">${window.t ? window.t('systemLogs.charts.otherItems', { count }) : `…Other ${count} items`}</div>`;
    }

    container.appendChild(legendEl);
    return legendEl;
}

// --- Shared: Container Initialization ----------------------------------------

function initContainer(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return null;
    container.innerHTML = '';
    container.classList.add('flex', 'flex-col', 'relative', 'group/chart');
    return container;
}

function showEmpty(container, msg = null) {
    const displayMsg = msg || (window.t ? window.t('systemLogs.charts.noData') : 'No data');
    container.innerHTML = `<div class="flex items-center justify-center h-full text-sm text-slate-400">${displayMsg}</div>`;
}

// --- Shared: Y-Axis Grid and Ticks -------------------------------------------

function drawGrid(svg, padLeft, padTop, chartW, chartH, minVal, maxVal, tickCount = 5) {
    const yRange = maxVal - minVal;
    if (yRange === 0) return;

    const gGrid = createSvgElement('g');

    for (let i = 0; i <= tickCount; i++) {
        const val = minVal + (yRange * i / tickCount);
        const y = padTop + chartH - ((val - minVal) / yRange) * chartH;

        // Grid line
        gGrid.appendChild(createSvgElement('line', {
            x1: padLeft, y1: y, x2: padLeft + chartW, y2: y,
            stroke: '#e2e8f0',
            'stroke-dasharray': '4,4'
        }));

        // Y-axis label
        const text = createSvgElement('text', {
            x: padLeft - 8, y: y + 4,
            'text-anchor': 'end',
            fill: '#94a3b8',
            'font-size': '12px'
        });
        text.textContent = formatAxisValue(val);
        gGrid.appendChild(text);
    }

    svg.appendChild(gGrid);
}

// --- Shared: Calculate Y-Axis Range ------------------------------------------

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
// 🥧 drawPieChart — Pie / Donut Chart
// ===========================================================================
// data: [{ label, value, color? }]
// options: { donut?, centerText?, title? }

export function drawPieChart(containerId, rawData, options = {}) {
    // Compatible with legacy API: drawPieChart(id, data, isDonut)
    if (typeof options === 'boolean') {
        options = { donut: options };
    }

    const container = initContainer(containerId);
    if (!container) return;

    // Filter positive values and sort descending
    const data = (rawData || [])
        .map(item => ({ ...item, value: Number(item.value) || 0 }))
        .filter(item => item.value > 0);
    data.sort((a, b) => b.value - a.value);

    const total = data.reduce((sum, item) => sum + item.value, 0);
    if (total <= 0 || data.length === 0) { showEmpty(container); return; }

    let width = container.clientWidth || 300;
    
    // Estimate height required for legend (mobile wrap, allocate extra space)
    const legendHeightOffset = 60; 
    let height;

    if (container.clientHeight > 50) {
        // Deduct legend space if container has fixed height to prevent SVG distortion
        height = Math.max(100, container.clientHeight - legendHeightOffset);
    } else {
        // Default to 1:1 square if no fixed height (e.g. height: auto)
        height = width;
    }

    const svg = createSvgElement('svg', {
        width: '100%',
        class: 'flex-1 min-h-0', // Ensure flexibility within flex container
        style: 'height: auto; max-height: 100%;', 
        viewBox: `0 0 ${width} ${height}`,
        preserveAspectRatio: 'xMidYMid meet'
    });

    const radius = Math.min(width, height) / 2 * 0.95;
    const cx = width / 2;
    const cy = height / 2;

    const g = createSvgElement('g', { transform: `translate(${cx}, ${cy})` });
    const tooltip = createTooltip(container);

    if (data.length === 1) {
        // Use simple circle for 100% single item to prevent SVG arc truncation
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
        
        if (typeof options.onClick === 'function') {
            circle.addEventListener('click', () => options.onClick(item));
        }

        g.appendChild(circle);
    } else {
        let startAngle = -Math.PI / 2; // Start from 12 o'clock

        data.forEach((item, i) => {
            const sliceAngle = (item.value / total) * 2 * Math.PI;
            const endAngle = startAngle + sliceAngle; // Accumulate clockwise
            const color = getColor(i, item.color);

            const x1 = Math.cos(startAngle) * radius;
            const y1 = Math.sin(startAngle) * radius;
            const x2 = Math.cos(endAngle) * radius;
            const y2 = Math.sin(endAngle) * radius;
            const largeArc = sliceAngle > Math.PI ? 1 : 0;

            // Standard SVG clockwise arc path (sweep-flag = 1)
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
            
            if (typeof options.onClick === 'function') {
                path.addEventListener('click', () => options.onClick(item));
            }

            g.appendChild(path);
            startAngle = endAngle;
        });
    }

    // Donut center
    if (options.donut) {
        g.appendChild(createSvgElement('circle', {
            cx: 0, cy: 0, r: radius * 0.6, fill: 'var(--surface-color, #ffffff)'
        }));

        const centerLabel = createSvgElement('text', {
            x: 0, y: -4, 'text-anchor': 'middle', 'dominant-baseline': 'middle',
            fill: 'var(--text-muted)', 'font-weight': 'bold', 'font-size': '13px'
        });
        centerLabel.textContent = options.centerText || (window.t ? window.t('systemLogs.charts.total') : 'Total');

        const centerVal = createSvgElement('text', {
            x: 0, y: 16, 'text-anchor': 'middle', 'dominant-baseline': 'middle',
            fill: 'var(--text-main)', 'font-weight': 'bold', 'font-size': '16px'
        });
        centerVal.textContent = formatValue(total);

        g.appendChild(centerLabel);
        g.appendChild(centerVal);
    }

    svg.appendChild(g);
    container.appendChild(svg);

    // Legend
    const legendItems = data.map((item, i) => ({
        label: item.label,
        color: getColor(i, item.color),
        suffix: `(${((item.value / total) * 100).toFixed(1)}%)`,
        detail: `${formatValue(item.value)} (${((item.value / total) * 100).toFixed(1)}%)`
    }));
    createLegend(container, legendItems);
}


// ===========================================================================
// 📊 drawBarChart — Bar Chart
// ===========================================================================
// Legacy mode: drawBarChart(containerId, labels, data1, data2?, config?)
// Object mode: drawBarChart(containerId, data, options?)
//   data: [{ label, value, color? }] or [{ label, value1, value2 }]

export function drawBarChart(containerId, labelsOrData, data1OrOptions, data2, config) {
    // Detect call mode
    let labels, values1, values2, options, colors1;

    if (Array.isArray(labelsOrData) && labelsOrData.length > 0 && typeof labelsOrData[0] === 'string') {
        // Legacy API: drawBarChart(id, labels[], data1[], data2?, config?)
        labels = labelsOrData;
        values1 = data1OrOptions || [];
        values2 = data2 || null;
        options = config || {};
    } else if (Array.isArray(labelsOrData) && labelsOrData.length > 0 && typeof labelsOrData[0] === 'object') {
        // New API: drawBarChart(id, [{label, value, color, ...}], options?)
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
    const height = (container.clientHeight || 300) - 30; // Leave space for legend

    const padTop = 20, padBottom = 40, padLeft = 60, padRight = 20;
    const chartW = width - padLeft - padRight;
    const chartH = height - padTop - padBottom;

    const svg = createSvgElement('svg', {
        width: '100%', height: '100%',
        class: 'flex-1 min-h-0',
        viewBox: `0 0 ${width} ${height}`,
        preserveAspectRatio: 'none'
    });

    // Calculate Y-axis range
    const allVals = [];
    for (let i = 0; i < labels.length; i++) {
        allVals.push(values1[i] || 0);
        if (values2) allVals.push(values2[i] || 0);
    }
    const { minVal, maxVal, yRange } = calcYRange(allVals);

    const getY = (val) => padTop + chartH - ((val - minVal) / yRange) * chartH;
    const zeroY = getY(0);

    // Grid
    drawGrid(svg, padLeft, padTop, chartW, chartH, minVal, maxVal);

    // Tooltip
    const tooltip = createTooltip(container);

    // Bars
    const gBars = createSvgElement('g');
    const barSpacing = chartW / labels.length;
    const barWidth = Math.min(barSpacing * 0.6, 40);
    const isDual = values2 !== null;
    let labelDrawnCount = 0;

    for (let i = 0; i < labels.length; i++) {
        const xCenter = padLeft + (i + 0.5) * barSpacing;

        // X-axis label
        const maxLabels = Math.max(3, Math.floor(chartW / 40));
        const step = Math.max(1, Math.ceil(labels.length / maxLabels));
        if (i % step === 0 || i === labels.length - 1) {
            const fillColor = labelDrawnCount % 2 === 0 ? 'var(--text-main)' : 'var(--text-muted)';
            const text = createSvgElement('text', {
                x: xCenter, y: height - 15,
                'text-anchor': 'middle', fill: fillColor, 'font-size': '14px'
            });
            labelDrawnCount++;
            let labelText = labels[i];
            const parts = labelText.split('/');
            if (parts.length === 3 && parts[0].length === 4) labelText = `${parts[1]}/${parts[2]}`;
            else if (parts.length === 2 && parts[0].length === 4) labelText = parts[1];

            text.textContent = labelText;
            svg.appendChild(text);
        }

        const v1 = values1[i] || 0;
        // Prefer item-specific color, then options, default red for positive, green for negative
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

            // Transparent hit area
            const hitArea = createSvgElement('rect', {
                x: xCenter - barSpacing / 2, y: padTop, width: barSpacing, height: chartH,
                fill: 'transparent', class: 'cursor-pointer'
            });

            const showDualTT = () => {
                rect1.setAttribute('opacity', '0.8');
                rect2.setAttribute('opacity', '0.8');
                const l1 = options.label1 || (window.t ? window.t('systemLogs.charts.value1') : 'Value 1');
                const l2 = options.label2 || (window.t ? window.t('systemLogs.charts.value2') : 'Value 2');
                showTooltip(tooltip,
                    `<strong>${labels[i]}</strong><br>` +
                    `<span style="color:${color1}">●</span> ${l1}: ${formatValue(v1)}<br>` +
                    `<span style="color:${color2}">●</span> ${l2}: ${formatValue(v2)}`
                );
            };
            const hideDualTT = () => {
                rect1.setAttribute('opacity', '1');
                rect2.setAttribute('opacity', '1');
                hideTooltip(tooltip);
            };
            hitArea.addEventListener('mouseenter', showDualTT);
            hitArea.addEventListener('mousemove', e => moveTooltip(tooltip, container, e, 12, -30));
            hitArea.addEventListener('mouseleave', hideDualTT);
            hitArea.addEventListener('touchstart', (e) => { showDualTT(); if (e.touches[0]) moveTooltip(tooltip, container, e.touches[0], 12, -30); }, { passive: true });
            hitArea.addEventListener('touchmove', (e) => { if (e.touches[0]) moveTooltip(tooltip, container, e.touches[0], 12, -30); }, { passive: true });
            hitArea.addEventListener('touchend', hideDualTT);

            gBars.appendChild(rect1);
            gBars.appendChild(rect2);
            gBars.appendChild(hitArea);
        } else {
            // Single series bar
            const y = Math.min(zeroY, getY(v1));
            const h = Math.abs(getY(v1) - zeroY);

            const rect = createSvgElement('rect', {
                x: xCenter - barWidth / 2, y, width: barWidth, height: Math.max(h, 1),
                fill: color1, rx: 2,
                class: 'transition-opacity hover:opacity-80 cursor-pointer'
            });

            const showSingleTT = () => {
                showTooltip(tooltip, `<strong>${labels[i]}</strong><br>${formatValue(v1)}`);
            };
            rect.addEventListener('mouseenter', showSingleTT);
            rect.addEventListener('mousemove', e => moveTooltip(tooltip, container, e));
            rect.addEventListener('mouseleave', () => hideTooltip(tooltip));
            rect.addEventListener('touchstart', (e) => { showSingleTT(); if (e.touches[0]) moveTooltip(tooltip, container, e.touches[0]); }, { passive: true });
            rect.addEventListener('touchmove', (e) => { if (e.touches[0]) moveTooltip(tooltip, container, e.touches[0]); }, { passive: true });
            rect.addEventListener('touchend', () => hideTooltip(tooltip));

            gBars.appendChild(rect);
        }
    }

    // Zero line
    if (minVal < 0 && maxVal > 0) {
        gBars.appendChild(createSvgElement('line', {
            x1: padLeft, y1: zeroY, x2: padLeft + chartW, y2: zeroY,
            stroke: '#94a3b8', 'stroke-width': '1.5'
        }));
    }

    svg.appendChild(gBars);
    container.appendChild(svg);

    // Legend (for dual series)
    if (isDual && (options.label1 || options.label2)) {
        createLegend(container, [
            { label: options.label1 || (window.t ? window.t('systemLogs.charts.value1') : 'Value 1'), color: options.color1 || '#ef4444' },
            { label: options.label2 || (window.t ? window.t('systemLogs.charts.value2') : 'Value 2'), color: options.color2 || '#3b82f6' }
        ]);
    }
}


// ===========================================================================
// 📈 drawLineChart — Line / Area Chart
// ===========================================================================
// data: [{ label, value }]  (Single series)
//   or  [{ label, values: [v1, v2, ...] }]  (Multi series)
// options: {
//   series?: [{ name, color }],   // Names and colors for multi series
//   fill?: boolean,               // Fill as area chart
//   smooth?: boolean,             // Use smooth curves (currently unimplemented)
//   title?: string                // Title for export
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

    // Determine if it's single or multi series
    const isMulti = data[0].values != null;
    const seriesCount = isMulti ? data[0].values.length : 1;
    const seriesConfig = options.series || [];

    // Extract all values to calculate Y-axis range
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

    const isBar = options.type === 'bar';
    const barGroupW = isBar ? chartW / Math.max(data.length, 1) : 0;
    const getX = isBar
        ? (idx) => padLeft + (idx + 0.5) * barGroupW
        : (idx) => padLeft + (idx / Math.max(data.length - 1, 1)) * chartW;
    const getY = (val) => padTop + chartH - ((val - minVal) / yRange) * chartH;

    // Grid
    drawGrid(svg, padLeft, padTop, chartW, chartH, minVal, maxVal);

    // X-axis label
    const gLabels = createSvgElement('g');
    const maxLabels = Math.max(3, Math.floor(chartW / 40));
    const step = Math.max(1, Math.ceil(data.length / maxLabels));
    let labelDrawnCount = 0;
    data.forEach((d, i) => {
        if (i % step === 0 || i === data.length - 1) {
            const fillColor = labelDrawnCount % 2 === 0 ? 'var(--text-main)' : 'var(--text-muted)';
            const text = createSvgElement('text', {
                x: getX(i), y: height - 15,
                'text-anchor': 'middle', fill: fillColor, 'font-size': '14px'
            });
            labelDrawnCount++;
            let labelText = d.label;
            const parts = labelText.split('/');
            if (parts.length === 3 && parts[0].length === 4) labelText = `${parts[1]}/${parts[2]}`;
            else if (parts.length === 2 && parts[0].length === 4) labelText = parts[1];

            text.textContent = labelText;
            gLabels.appendChild(text);
        }
    });
    svg.appendChild(gLabels);

    if (isBar) {
        // -- Bar chart drawing --
        const barGap = 2;
        const barW = Math.max(1, (barGroupW - barGap * (seriesCount + 1)) / seriesCount);
        const zeroY = getY(0);

        for (let i = 0; i < data.length; i++) {
            for (let s = 0; s < seriesCount; s++) {
                const v = isMulti ? (data[i].values[s] || 0) : (data[i].value || 0);
                if (v === 0) continue;
                const color = seriesConfig[s]?.color || getColor(s);
                const barX = padLeft + i * barGroupW + barGap + s * (barW + barGap);
                const barH = Math.abs(getY(v) - zeroY);
                const barY = Math.min(zeroY, getY(v));

                svg.appendChild(createSvgElement('rect', {
                    x: barX, y: barY, width: barW, height: Math.max(barH, 0.5),
                    fill: color, rx: 1
                }));
            }
        }
    } else {
        // -- Line chart drawing --
        const defs = createSvgElement('defs');
        svg.appendChild(defs);

        for (let s = 0; s < seriesCount; s++) {
            const color = seriesConfig[s]?.color || getColor(s);
            const values = isMulti ? data.map(d => d.values[s] || 0) : data.map(d => d.value || 0);

            let pathD = '';
            const points = [];
            values.forEach((v, i) => {
                const x = getX(i);
                const y = getY(v);
                points.push({ x, y });
                pathD += (i === 0 ? 'M' : 'L') + ` ${x} ${y} `;
            });

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

            svg.appendChild(createSvgElement('path', {
                d: pathD, fill: 'none', stroke: color,
                'stroke-width': '2', 'stroke-linejoin': 'round', 'stroke-linecap': 'round'
            }));

            points.forEach((pt, i) => {
                svg.appendChild(createSvgElement('circle', {
                    cx: pt.x, cy: pt.y, r: data.length <= 20 ? 3 : 2,
                    fill: '#fff', stroke: color, 'stroke-width': '1.5'
                }));
            });
        }
    }

    // Tooltip interaction layer
    const tooltip = createTooltip(container);
    const hoverLayer = createSvgElement('g');

    // Vertical crosshair
    const crossV = createSvgElement('line', {
        stroke: '#cbd5e1', 'stroke-width': '1', 'stroke-dasharray': '3,3',
        y1: padTop, y2: padTop + chartH, visibility: 'hidden'
    });
    svg.appendChild(crossV);

    // Transparent hit area
    data.forEach((d, i) => {
        const x = getX(i);
        let hitX, hitW;
        if (isBar) {
            hitX = padLeft + i * barGroupW;
            hitW = barGroupW;
        } else {
            const slotW = chartW / Math.max(data.length - 1, 1);
            hitX = i === 0 ? padLeft : x - slotW / 2;
            hitW = i === 0 || i === data.length - 1 ? slotW / 2 : slotW;
        }

        const hit = createSvgElement('rect', {
            x: hitX, y: padTop, width: Math.max(hitW, 4), height: chartH,
            fill: 'transparent', class: 'cursor-crosshair'
        });

        const showLineTT = () => {
            crossV.setAttribute('x1', x);
            crossV.setAttribute('x2', x);
            crossV.setAttribute('visibility', 'visible');

            let html = `<strong>${d.label}</strong>`;
            if (isMulti) {
                d.values.forEach((v, s) => {
                    const c = seriesConfig[s]?.color || getColor(s);
                    const defaultName = window.t ? window.t('systemLogs.charts.series', { num: s + 1 }) : `Series ${s + 1}`;
                    const n = seriesConfig[s]?.name || defaultName;
                    html += `<br><span style="color:${c}">●</span> ${n}: ${formatValue(v)}`;
                });
            } else {
                html += `<br>${formatValue(d.value)}`;
            }
            showTooltip(tooltip, html);
        };
        const hideLineTT = () => {
            crossV.setAttribute('visibility', 'hidden');
            hideTooltip(tooltip);
        };
        hit.addEventListener('mouseenter', showLineTT);
        hit.addEventListener('mousemove', e => moveTooltip(tooltip, container, e, 12, -30));
        hit.addEventListener('mouseleave', hideLineTT);
        hit.addEventListener('touchstart', (e) => { showLineTT(); if (e.touches[0]) moveTooltip(tooltip, container, e.touches[0], 12, -30); }, { passive: true });
        hit.addEventListener('touchmove', (e) => { if (e.touches[0]) moveTooltip(tooltip, container, e.touches[0], 12, -30); }, { passive: true });
        hit.addEventListener('touchend', hideLineTT);

        hoverLayer.appendChild(hit);
    });

    svg.appendChild(hoverLayer);
    container.appendChild(svg);

    // Legend (for multi series)
    if (seriesCount > 1) {
        const legendItems = [];
        for (let s = 0; s < seriesCount; s++) {
            const defaultName = window.t ? window.t('systemLogs.charts.series', { num: s + 1 }) : `Series ${s + 1}`;
            legendItems.push({
                label: seriesConfig[s]?.name || defaultName,
                color: seriesConfig[s]?.color || getColor(s)
            });
        }
        createLegend(container, legendItems);
    }
}

