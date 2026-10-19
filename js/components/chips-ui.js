import { createSvgElement } from './charts.js';

export function renderChipsAdvanced(container, chipsData, code, priceData) {
    container.innerHTML = '';
    
    if (!chipsData || chipsData.length === 0) {
        container.innerHTML = `
            <div class="w-full h-full flex flex-col items-center justify-center text-slate-400 text-sm gap-3 py-6">
                <div>無籌碼資料</div>
                <button onclick="if(window.marketTab) window.marketTab.fetchChipsForMarket('${code}')" class="bg-blue-50 text-blue-600 hover:bg-blue-100 px-4 py-1.5 rounded-lg transition-colors flex items-center gap-1 font-medium">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
                    依設定區間抓取全市場最新籌碼
                </button>
            </div>
        `;
        return;
    }

    const range = (window.settings && window.settings.chipsTimeRange) ? window.settings.chipsTimeRange : '1W';
    
    let filteredChipsData = chipsData;
    let filteredPriceData = priceData;

    if (range !== 'ALL' && chipsData.length > 0) {
        const latestDateStr = chipsData.reduce((max, d) => d.date > max ? d.date : max, chipsData[0].date);
        const latestDate = new Date(latestDateStr);
        let cutoffDate = new Date(latestDate);
        
        if (range === '1W') cutoffDate.setDate(latestDate.getDate() - 7);
        else if (range === '1M') cutoffDate.setMonth(latestDate.getMonth() - 1);
        else if (range === '3M') cutoffDate.setMonth(latestDate.getMonth() - 3);
        else if (range === '6M') cutoffDate.setMonth(latestDate.getMonth() - 6);
        else if (range === '1Y') cutoffDate.setFullYear(latestDate.getFullYear() - 1);

        const cutoffStr = cutoffDate.getFullYear() + '-' + String(cutoffDate.getMonth() + 1).padStart(2, '0') + '-' + String(cutoffDate.getDate()).padStart(2, '0');
        
        filteredChipsData = chipsData.filter(d => d.date >= cutoffStr);
        if (priceData) {
            filteredPriceData = priceData.filter(d => d.date >= cutoffStr);
        }
    }

    const data = [...filteredChipsData].sort((a, b) => a.date.localeCompare(b.date));
    const n = data.length;
    const priceMap = new Map();
    
    if (filteredPriceData && filteredPriceData.length > 0) {
        const sortedPrices = [...filteredPriceData].sort((a, b) => a.date.localeCompare(b.date));
        for (let i = 0; i < sortedPrices.length; i++) {
            const current = sortedPrices[i];
            const prev = i > 0 ? sortedPrices[i - 1].close : current.close;
            let changePercent = 0;
            if (prev > 0) {
                changePercent = ((current.close - prev) / prev) * 100;
            }
            priceMap.set(current.date, { close: current.close, changePercent });
        }
    }

    const fmtNum = (v, showSign = true) => {
        if (v == null) return '-';
        const val = Math.round(v);
        const sign = (showSign && val > 0) ? '+' : '';
        return `${sign}${val.toLocaleString()}`;
    };

    const fmtPct = (v) => {
        if (v == null) return '-';
        const sign = v > 0 ? '+' : '';
        return `${sign}${v.toFixed(2)}%`;
    };

    const fmtPrice = (v) => {
        if (v == null) return '-';
        return Number(v.toFixed(2));
    };

    const DAY_NAMES = ['日', '一', '二', '三', '四', '五', '六'];
    const formatDate = (dateStr) => {
        const day = new Date(dateStr).getDay();
        return dateStr.substring(5).replace('-', '/') + `（${DAY_NAMES[day]}）`;
    };

    const flowData = [];
    let cumTotal = 0, cumForeign = 0, cumTrust = 0, cumDealer = 0;
    
    data.forEach((d, i) => {
        const rawF = d.inst?.foreign || 0;
        const rawT = d.inst?.trust || 0;
        const rawD = d.inst?.dealer || 0;

        const foreign = Math.round(rawF / 1000);
        const trust = Math.round(rawT / 1000);
        const dealer = Math.round(rawD / 1000);
        
        const totalNet = Math.round((rawF + rawT + rawD) / 1000);
        
        cumTotal += totalNet;
        cumForeign += foreign;
        cumTrust += trust;
        cumDealer += dealer;

        let rawCum10 = 0;
        const start = Math.max(0, i - 9);
        for(let j = start; j <= i; j++) {
            const jF = data[j].inst?.foreign || 0;
            const jT = data[j].inst?.trust || 0;
            const jD = data[j].inst?.dealer || 0;
            rawCum10 += (jF + jT + jD);
        }
        const cum10 = Math.round(rawCum10 / 1000);

        const priceInfo = priceMap.get(d.date) || { close: null, changePercent: null };

        const marginBuy = d.margin ? Math.round(d.margin.marginBuy) : 0;
        const marginSell = d.margin ? Math.round(d.margin.marginSell) : 0;
        const shortBuy = d.margin ? Math.round(d.margin.shortBuy) : 0;
        const shortSell = d.margin ? Math.round(d.margin.shortSell) : 0;

        flowData.push({
            date: d.date,
            foreign, trust, dealer, totalNet,
            cumTotal, cumForeign, cumTrust, cumDealer,
            cum10,
            close: priceInfo.close,
            changePercent: priceInfo.changePercent,
            marginBuy, marginSell, shortBuy, shortSell,
            marginNet: marginBuy - marginSell,
            shortNet: shortSell - shortBuy, // Short selling increases balance
            marginBal: d.margin ? Math.round(d.margin.marginBal) : 0,
            shortBal: d.margin ? Math.round(d.margin.shortBal) : 0,
            volume: d.volume ? Math.round(d.volume / 1000) : 0
        });
    });

    const W = 720, H = 260;
    const PL = 60, PR = 60, PT = 20, PB = 30;
    const innerW = W - PL - PR;
    const innerH = H - PT - PB;
    const getX = (idx) => PL + (idx + 0.5) * (innerW / n);

    function niceTicks(lo, hi, count) {
        if (lo === hi) return [lo];
        const r = hi - lo;
        const raw = r / count;
        const mag = Math.pow(10, Math.floor(Math.log10(raw)));
        let step = mag;
        if (raw / mag < 1.5) step = mag;
        else if (raw / mag < 3) step = mag * 2;
        else if (raw / mag < 7) step = mag * 5;
        else step = mag * 10;
        const s = Math.floor(lo / step) * step;
        const ticks = [];
        for (let v = s; v <= hi + step * 0.5; v += step) {
            if (v >= lo - step * 0.5) ticks.push(v);
        }
        return ticks;
    }

    const drawSvg = (config) => {
        const svg = createSvgElement('svg', {
            viewBox: `0 0 ${W} ${H}`,
            class: 'w-full h-auto block cursor-crosshair bg-white rounded-lg border border-slate-100',
        });

        const { bars, lines, yAxisLeft, yAxisRight } = config;
        
        const drawAxis = (axisCfg, isRight) => {
            if (!axisCfg) return null;
            let minVal = Infinity, maxVal = -Infinity;
            axisCfg.dataFn.forEach(ext => {
                flowData.forEach(d => {
                    const v = ext(d);
                    if (v != null) {
                        if (v < minVal) minVal = v;
                        if (v > maxVal) maxVal = v;
                    }
                });
            });
            if (minVal === Infinity) { minVal = 0; maxVal = 100; }
            if (axisCfg.zeroCentered) {
                const maxAbs = Math.max(Math.abs(minVal), Math.abs(maxVal));
                minVal = -maxAbs; maxVal = maxAbs;
            }
            const pad = (maxVal - minVal) * (axisCfg.pad || 0.1) || 10;
            const yHi = maxVal + pad;
            const yLo = minVal - pad;
            const getY = (v) => PT + (1 - (v - yLo) / (yHi - yLo)) * innerH;

            const ticks = niceTicks(yLo, yHi, 4);
            ticks.forEach(tick => {
                const y = getY(tick);
                if (axisCfg.drawGrid) {
                    svg.appendChild(createSvgElement('line', {
                        x1: PL, x2: W - PR, y1: y, y2: y,
                        stroke: tick === 0 ? '#cbd5e1' : '#f1f5f9', 'stroke-width': tick === 0 ? '1' : '0.5'
                    }));
                }
                const text = createSvgElement('text', {
                    x: isRight ? W - PR + 10 : PL - 10, y: y + 4, fill: isRight ? '#f59e0b' : '#94a3b8', 'font-size': '10', 'text-anchor': isRight ? 'start' : 'end'
                });
                text.textContent = tick >= 10000 || tick <= -10000 ? (tick/10000).toFixed(1) + 'W' : (tick >= 1000 || tick <= -1000 ? (tick/1000).toFixed(1) + 'K' : Math.round(tick));
                svg.appendChild(text);
            });
            
            return { getY, minVal, maxVal };
        };

        const leftAxis = drawAxis(yAxisLeft, false);
        const rightAxis = drawAxis(yAxisRight, true);

        const dateStep = Math.max(1, Math.floor(n / 8));
        for (let i = 0; i < n; i += dateStep) {
            const text = createSvgElement('text', {
                x: getX(i), y: H - 10, fill: '#94a3b8', 'font-size': '10', 'text-anchor': 'middle'
            });
            text.textContent = formatDate(flowData[i].date);
            svg.appendChild(text);
        }

        if (bars && bars.length > 0) {
            const numSeries = bars.length;
            const groupW = innerW / n;
            const totalBarW = groupW * 0.8; 
            const effectiveNumSeries = Math.max(numSeries, 3);
            const singleBarW = Math.max(2, totalBarW / effectiveNumSeries);
            
            flowData.forEach((d, i) => {
                const cx = getX(i);
                const startX = cx - (singleBarW * numSeries) / 2;
                
                bars.forEach((series, sIdx) => {
                    const val = series.dataFn(d);
                    if (val == null) return;
                    const getY = (series.axis === 'right' && rightAxis) ? rightAxis.getY : leftAxis.getY;
                    const yZero = getY(0);
                    const fy = getY(val);
                    
                    const color = typeof series.color === 'function' ? series.color(val, d) : series.color;
                    
                    svg.appendChild(createSvgElement('rect', {
                        x: startX + sIdx * singleBarW + (singleBarW * 0.1),
                        y: Math.min(fy, yZero),
                        width: Math.max(1, singleBarW * 0.8),
                        height: Math.max(0.5, Math.abs(fy - yZero)),
                        fill: color,
                        opacity: '0.9'
                    }));
                });
            });
        }

        if (lines) {
            lines.forEach(lineCfg => {
                const getY = (lineCfg.axis === 'right' && rightAxis) ? rightAxis.getY : leftAxis.getY;
                let pathD = '';
                flowData.forEach((d, i) => {
                    const val = lineCfg.dataFn(d);
                    if (val == null) return;
                    const cmd = pathD === '' ? 'M' : 'L';
                    pathD += `${cmd} ${getX(i)} ${getY(val)} `;
                });
                if (pathD) {
                    svg.appendChild(createSvgElement('path', {
                        d: pathD, fill: 'none', stroke: lineCfg.color, 'stroke-width': lineCfg.width || '1.5',
                        'stroke-dasharray': lineCfg.dash || 'none'
                    }));
                }
            });
        }

        const crossV = createSvgElement('line', { stroke: '#94a3b8', 'stroke-width': '1', 'stroke-dasharray': '3 3', visibility: 'hidden', y1: PT, y2: H - PB });
        const tooltipGrp = createSvgElement('g', { visibility: 'hidden' });
        const tooltipBg = createSvgElement('rect', { fill: 'rgba(255,255,255,0.95)', stroke: '#e2e8f0', rx: 4, width: 140, height: 20 + config.tooltip.length * 16 });
        const tooltipDate = createSvgElement('text', { x: 8, y: 16, fill: '#334155', 'font-size': '11', 'font-weight': 'bold' });
        
        tooltipGrp.appendChild(tooltipBg);
        tooltipGrp.appendChild(tooltipDate);
        
        const tooltipTexts = config.tooltip.map((t, i) => {
            const el = createSvgElement('text', { x: 8, y: 16 + 16 * (i + 1), fill: t.color, 'font-size': '10', 'font-weight': '600' });
            tooltipGrp.appendChild(el);
            return el;
        });

        svg.appendChild(crossV);
        svg.appendChild(tooltipGrp);

        svg.addEventListener('mousemove', (e) => {
            const rect = svg.getBoundingClientRect();
            const px = ((e.clientX - rect.left) / rect.width) * W;
            const slotW = innerW / n;
            const rawIdx = Math.floor((px - PL) / slotW);
            
            if (rawIdx >= 0 && rawIdx < n) {
                const closest = flowData[rawIdx];
                const cx = getX(rawIdx);
                crossV.setAttribute('x1', cx); crossV.setAttribute('x2', cx);
                crossV.setAttribute('visibility', 'visible');
                
                let lx = px + 12;
                if (lx + 140 > W - PR) lx = px - 140 - 12;
                tooltipGrp.setAttribute('transform', `translate(${lx}, ${PT})`);
                tooltipDate.textContent = closest.date;
                
                config.tooltip.forEach((t, i) => {
                    const v = t.dataFn(closest);
                    let valStr = '-';
                    if (v != null) {
                        if (t.label === '收盤價') {
                            valStr = fmtPrice(v);
                        } else {
                            valStr = fmtNum(v, t.showSign !== false);
                        }
                    }
                    tooltipTexts[i].textContent = `${t.label}: ${valStr}`;
                });
                tooltipGrp.setAttribute('visibility', 'visible');
            }
        });
        svg.addEventListener('mouseleave', () => {
            crossV.setAttribute('visibility', 'hidden');
            tooltipGrp.setAttribute('visibility', 'hidden');
        });

        return svg;
    };

    const wrapper = document.createElement('div');
    wrapper.className = 'w-full';

    const headerRow = document.createElement('div');
    headerRow.className = 'flex justify-between items-end border-b border-slate-200 mb-6 px-2';

    const tabContainer = document.createElement('div');
    tabContainer.className = 'flex text-sm font-medium';
    
    const tabs = ['三大法人', '累積買賣超', '融資融券'];
    let activeTab = '三大法人';
    let subTab = '綜合'; // For Inst
    let marginSubTab = '綜合'; // For Margin

    const contentDiv = document.createElement('div');
    
    const renderContent = () => {
        contentDiv.innerHTML = '';
        
        const startDate = data.length > 0 ? data[0].date : '';
        const endDate = data.length > 0 ? data[data.length - 1].date : '';
        const dateRangeStr = startDate && endDate ? `<span class="text-xs text-slate-400 font-normal ml-2 tracking-wide font-mono">(${startDate} ~ ${endDate})</span>` : '';
        
        if (activeTab === '累積買賣超') {
            const headerWrap = document.createElement('div');
            headerWrap.className = 'flex justify-between items-end mb-4 px-2';
            headerWrap.innerHTML = `<h3 class="text-base font-bold text-slate-800 flex items-baseline">三大法人累積買賣超 ${dateRangeStr}</h3>`;
            contentDiv.appendChild(headerWrap);

            const legend = document.createElement('div');
            legend.className = 'flex items-center justify-center gap-4 text-xs font-medium text-slate-600 mt-3 mb-1 px-2';
            legend.innerHTML = `
                <div class="flex items-center gap-1.5"><span class="w-4 h-0.5 bg-blue-500"></span>外資累積</div>
                <div class="flex items-center gap-1.5"><span class="w-4 h-0.5 bg-red-500"></span>投信累積</div>
                <div class="flex items-center gap-1.5"><span class="w-4 h-0.5 bg-purple-500"></span>自營累積</div>
                <div class="flex items-center gap-1.5"><span class="w-4 h-0.5 border-t-2 border-dashed border-pink-500"></span>合計累積</div>
            `;

            const svg = drawSvg({
                yAxisLeft: { dataFn: [d => d.cumTotal, d => d.cumForeign, d => d.cumTrust, d => d.cumDealer], drawGrid: true },
                lines: [
                    { dataFn: d => d.cumForeign, color: '#3b82f6', width: '1.5', axis: 'left' },
                    { dataFn: d => d.cumTrust, color: '#ef4444', width: '1.5', axis: 'left' },
                    { dataFn: d => d.cumDealer, color: '#a855f7', width: '1.5', axis: 'left' },
                    { dataFn: d => d.cumTotal, color: '#ec4899', width: '1.5', dash: '4 2', axis: 'left' }
                ],
                tooltip: [
                    { label: '外資累積', dataFn: d => d.cumForeign, color: '#3b82f6' },
                    { label: '投信累積', dataFn: d => d.cumTrust, color: '#ef4444' },
                    { label: '自營累積', dataFn: d => d.cumDealer, color: '#a855f7' },
                    { label: '合計累積', dataFn: d => d.cumTotal, color: '#ec4899' }
                ]
            });
            contentDiv.appendChild(svg);
            contentDiv.appendChild(legend);
            
            const last = flowData[flowData.length-1];
            const statBox = document.createElement('div');
            statBox.className = 'grid grid-cols-4 gap-3 mt-6 text-center';
            const renderStat = (title, val, colorClass) => `
                <div class="bg-white p-3 rounded-xl border border-slate-100 shadow-sm">
                    <div class="text-xs text-slate-400 mb-1.5">${title}</div>
                    <div class="font-bold text-sm ${colorClass}">${fmtNum(val)}</div>
                </div>
            `;
            statBox.innerHTML = 
                renderStat('區間外資', last.cumForeign, last.cumForeign > 0 ? 'text-red-500' : 'text-emerald-500') +
                renderStat('區間投信', last.cumTrust, last.cumTrust > 0 ? 'text-red-500' : 'text-emerald-500') +
                renderStat('區間自營', last.cumDealer, last.cumDealer > 0 ? 'text-red-500' : 'text-emerald-500') +
                renderStat('區間合計', last.cumTotal, last.cumTotal > 0 ? 'text-red-500' : 'text-emerald-500');
            contentDiv.appendChild(statBox);

        } else if (activeTab === '三大法人') {
            const headerWrap = document.createElement('div');
            headerWrap.className = 'flex justify-between items-end mb-4 px-2';
            headerWrap.innerHTML = `<h3 class="text-base font-bold text-slate-800 flex items-baseline">三大法人進出 ${dateRangeStr}</h3>`;
            contentDiv.appendChild(headerWrap);

            const subTabBar = document.createElement('div');
            subTabBar.className = 'flex gap-2 mb-4 px-2';
            ['綜合', '外資', '投信', '自營商'].forEach(t => {
                const b = document.createElement('button');
                b.className = `px-3.5 py-1.5 rounded-full text-xs font-medium transition-colors ${subTab === t ? 'bg-blue-50 text-blue-600 ring-1 ring-blue-500' : 'bg-slate-50 text-slate-500 hover:bg-slate-100 border border-slate-100'}`;
                b.innerText = t;
                b.onclick = () => { subTab = t; renderContent(); };
                subTabBar.appendChild(b);
            });
            contentDiv.appendChild(subTabBar);

            if (subTab === '綜合') {
                const legend = document.createElement('div');
                legend.className = 'flex items-center justify-center gap-4 text-xs font-medium text-slate-600 mt-3 mb-1 px-2';
                legend.innerHTML = `
                    <div class="flex items-center gap-1.5"><span class="w-3 h-3 rounded-full bg-blue-500"></span>外資</div>
                    <div class="flex items-center gap-1.5"><span class="w-3 h-3 rounded-full bg-red-500"></span>投信</div>
                    <div class="flex items-center gap-1.5"><span class="w-3 h-3 rounded-full bg-purple-500"></span>自營商</div>
                    <div class="flex items-center gap-1.5"><span class="w-4 h-0.5 bg-sky-400"></span>10日累計</div>
                    <div class="flex items-center gap-1.5"><span class="w-4 h-0.5 bg-amber-500"></span>收盤價</div>
                `;

                const svg = drawSvg({
                    yAxisLeft: { dataFn: [d => d.foreign, d => d.trust, d => d.dealer, d => d.cum10], drawGrid: true, zeroCentered: true, pad: 0.15 },
                    yAxisRight: { dataFn: [d => d.close], drawGrid: false, pad: 0.1 },
                    bars: [
                        { dataFn: d => d.foreign, color: '#3b82f6', axis: 'left' },
                        { dataFn: d => d.trust, color: '#ef4444', axis: 'left' },
                        { dataFn: d => d.dealer, color: '#a855f7', axis: 'left' }
                    ],
                    lines: [
                        { dataFn: d => d.cum10, color: '#38bdf8', width: '2', dash: 'none', axis: 'left' },
                        { dataFn: d => d.close, color: '#f59e0b', width: '1.5', dash: 'none', axis: 'right' }
                    ],
                    tooltip: [
                        { label: '收盤價', dataFn: d => d.close, color: '#f59e0b', showSign: false },
                        { label: '外資', dataFn: d => d.foreign, color: '#3b82f6' },
                        { label: '投信', dataFn: d => d.trust, color: '#ef4444' },
                        { label: '自營商', dataFn: d => d.dealer, color: '#a855f7' },
                        { label: '合計', dataFn: d => d.totalNet, color: '#64748b' },
                        { label: '10日累計', dataFn: d => d.cum10, color: '#38bdf8' }
                    ]
                });
                contentDiv.appendChild(svg);
                contentDiv.appendChild(legend);

            } else {
                let dataFn, color, tooltipLabel;
                if (subTab === '外資') { dataFn = d => d.foreign; color = '#3b82f6'; tooltipLabel = '外資買賣'; }
                if (subTab === '投信') { dataFn = d => d.trust; color = '#ef4444'; tooltipLabel = '投信買賣'; }
                if (subTab === '自營商') { dataFn = d => d.dealer; color = '#a855f7'; tooltipLabel = '自營買賣'; }

                const svg = drawSvg({
                    yAxisLeft: { dataFn: [dataFn], drawGrid: true, zeroCentered: true, pad: 0.15 },
                    yAxisRight: { dataFn: [d => d.close], drawGrid: false, pad: 0.1 },
                    bars: [{ dataFn: dataFn, color: color, axis: 'left' }],
                    lines: [
                        { dataFn: d => d.close, color: '#f59e0b', width: '2', dash: 'none', axis: 'right' }
                    ],
                    tooltip: [
                        { label: '收盤價', dataFn: d => d.close, color: '#f59e0b', showSign: false },
                        { label: tooltipLabel, dataFn: dataFn, color: color }
                    ]
                });
                contentDiv.appendChild(svg);
            }
                const tableWrap = document.createElement('div');
                tableWrap.className = 'mt-6 overflow-x-auto border border-slate-100 rounded-lg';
                let tbody = '';
                [...flowData].reverse().slice(0, 20).forEach(d => {
                    const cF = d.foreign > 0 ? 'text-red-500' : (d.foreign < 0 ? 'text-emerald-500' : 'text-slate-500');
                    const cT = d.trust > 0 ? 'text-red-500' : (d.trust < 0 ? 'text-emerald-500' : 'text-slate-500');
                    const cD = d.dealer > 0 ? 'text-red-500' : (d.dealer < 0 ? 'text-emerald-500' : 'text-slate-500');
                    const cTotal = d.totalNet > 0 ? 'text-red-500' : (d.totalNet < 0 ? 'text-emerald-500' : 'text-slate-500');
                    const cCum10 = d.cum10 > 0 ? 'text-red-500' : (d.cum10 < 0 ? 'text-emerald-500' : 'text-slate-500');
                    const cChange = d.changePercent > 0 ? 'text-red-500' : (d.changePercent < 0 ? 'text-emerald-500' : 'text-slate-500');
                    
                    tbody += `<tr class="border-b border-slate-100 hover:bg-slate-50 text-xs transition-colors">
                        <td class="py-2.5 px-3 text-slate-500 text-center whitespace-nowrap">${formatDate(d.date)}</td>
                        <td class="py-2.5 px-3 text-center ${cF}">${fmtNum(d.foreign)}</td>
                        <td class="py-2.5 px-3 text-center ${cT}">${fmtNum(d.trust)}</td>
                        <td class="py-2.5 px-3 text-center ${cD}">${fmtNum(d.dealer)}</td>
                        <td class="py-2.5 px-3 text-center font-bold ${cTotal}">${fmtNum(d.totalNet)}</td>
                        <td class="py-2.5 px-3 text-center ${cCum10}">${fmtNum(d.cum10)}</td>
                        <td class="py-2.5 px-3 text-center text-slate-700 font-medium">${fmtPrice(d.close)}</td>
                        <td class="py-2.5 px-3 text-center ${cChange}">${fmtPct(d.changePercent)}</td>
                    </tr>`;
                });
                tableWrap.innerHTML = `
                    <div class="px-3 py-2 border-b border-slate-100 bg-white font-bold text-sm text-slate-700">三大法人與股價明細</div>
                    <table class="w-full text-slate-600">
                        <thead class="bg-white text-slate-400 text-xs border-b border-slate-100">
                            <tr>
                                <th class="py-2.5 px-3 text-center font-normal whitespace-nowrap">日期</th>
                                <th class="py-2.5 px-3 text-center font-normal whitespace-nowrap">外資</th>
                                <th class="py-2.5 px-3 text-center font-normal whitespace-nowrap">投信</th>
                                <th class="py-2.5 px-3 text-center font-normal whitespace-nowrap">自營商</th>
                                <th class="py-2.5 px-3 text-center font-normal whitespace-nowrap">合計</th>
                                <th class="py-2.5 px-3 text-center font-normal whitespace-nowrap">10日累計</th>
                                <th class="py-2.5 px-3 text-center font-normal whitespace-nowrap">股價</th>
                                <th class="py-2.5 px-3 text-center font-normal whitespace-nowrap">漲跌幅</th>
                            </tr>
                        </thead>
                        <tbody>${tbody}</tbody>
                    </table>
                `;
                contentDiv.appendChild(tableWrap);

        } else if (activeTab === '融資融券') {
            const headerWrap = document.createElement('div');
            headerWrap.className = 'flex justify-between items-end mb-4 px-2';
            headerWrap.innerHTML = `<h3 class="text-base font-bold text-slate-800 flex items-baseline">信用交易餘額 ${dateRangeStr}</h3>`;
            contentDiv.appendChild(headerWrap);

            const subTabBar = document.createElement('div');
            subTabBar.className = 'flex gap-2 mb-4 px-2';
            ['綜合', '融資', '融券'].forEach(t => {
                const b = document.createElement('button');
                b.className = `px-3.5 py-1.5 rounded-full text-xs font-medium transition-colors ${marginSubTab === t ? 'bg-blue-50 text-blue-600 ring-1 ring-blue-500' : 'bg-slate-50 text-slate-500 hover:bg-slate-100 border border-slate-100'}`;
                b.innerText = t;
                b.onclick = () => { marginSubTab = t; renderContent(); };
                subTabBar.appendChild(b);
            });
            contentDiv.appendChild(subTabBar);

            const renderMarginTable = () => {
                const tableWrap = document.createElement('div');
                tableWrap.className = 'mt-6 overflow-x-auto border border-slate-100 rounded-lg';
                let tbody = '';
                [...flowData].reverse().slice(0, 20).forEach(d => {
                    tbody += `<tr class="border-b border-slate-100 hover:bg-slate-50 text-xs transition-colors">
                        <td class="py-2.5 px-3 text-slate-500 text-center">${formatDate(d.date)}</td>
                        <td class="py-2.5 px-3 text-center text-red-500">${fmtNum(d.marginBuy, false)}</td>
                        <td class="py-2.5 px-3 text-center text-emerald-500">${fmtNum(d.marginSell, false)}</td>
                        <td class="py-2.5 px-3 text-center font-medium text-slate-700">${fmtNum(d.marginBal, false)}</td>
                        <td class="py-2.5 px-3 text-center text-emerald-500">${fmtNum(d.shortSell, false)}</td>
                        <td class="py-2.5 px-3 text-center text-red-500">${fmtNum(d.shortBuy, false)}</td>
                        <td class="py-2.5 px-3 text-center font-medium text-slate-700">${fmtNum(d.shortBal, false)}</td>
                    </tr>`;
                });
                tableWrap.innerHTML = `
                    <table class="w-full text-slate-600">
                        <thead class="bg-white text-slate-400 text-xs border-b border-slate-100">
                            <tr>
                                <th class="py-2.5 px-3 text-center font-normal">日期</th>
                                <th class="py-2.5 px-3 text-center font-normal">買進(資)</th>
                                <th class="py-2.5 px-3 text-center font-normal">賣出(資)</th>
                                <th class="py-2.5 px-3 text-center font-normal">融資餘額</th>
                                <th class="py-2.5 px-3 text-center font-normal">賣出(券)</th>
                                <th class="py-2.5 px-3 text-center font-normal">買進(券)</th>
                                <th class="py-2.5 px-3 text-center font-normal">融券餘額</th>
                            </tr>
                        </thead>
                        <tbody>${tbody}</tbody>
                    </table>
                `;
                return tableWrap;
            };

            if (marginSubTab === '綜合') {
                const last = flowData[flowData.length-1];
                const statBox = document.createElement('div');
                statBox.className = 'grid grid-cols-2 gap-3 mb-6 text-center';
                statBox.innerHTML = `
                    <div class="bg-slate-50 p-4 rounded-xl border border-slate-100">
                        <div class="text-xs text-slate-400 mb-1.5">融資餘額</div>
                        <div class="font-bold text-lg text-red-500">${fmtNum(last.marginBal, false)} <span class="text-sm font-normal">張</span></div>
                    </div>
                    <div class="bg-slate-50 p-4 rounded-xl border border-slate-100">
                        <div class="text-xs text-slate-400 mb-1.5">融券餘額</div>
                        <div class="font-bold text-lg text-emerald-600">${fmtNum(last.shortBal, false)} <span class="text-sm font-normal">張</span></div>
                    </div>
                `;
                contentDiv.appendChild(statBox);

                const legend = document.createElement('div');
                legend.className = 'flex items-center justify-center gap-4 text-xs font-medium text-slate-600 mt-3 mb-1 px-2';
                legend.innerHTML = `
                    <div class="flex items-center gap-1.5"><span class="w-4 h-0.5 bg-red-500"></span>融資餘額</div>
                    <div class="flex items-center gap-1.5"><span class="w-4 h-0.5 bg-emerald-500"></span>融券餘額</div>
                    <div class="flex items-center gap-1.5"><span class="w-4 h-0.5 bg-amber-500"></span>收盤價</div>
                `;

                const svg = drawSvg({
                    yAxisLeft: { dataFn: [d => d.marginBal], drawGrid: true, pad: 0.15 },
                    yAxisRight: { dataFn: [d => d.shortBal, d => d.close], drawGrid: false, pad: 0.1 },
                    lines: [
                        { dataFn: d => d.marginBal, color: '#ef4444', width: '2', axis: 'left' },
                        { dataFn: d => d.shortBal, color: '#10b981', width: '2', axis: 'right' },
                        { dataFn: d => d.close, color: '#f59e0b', width: '2', dash: '4 2', axis: 'right' }
                    ],
                    tooltip: [
                        { label: '收盤價', dataFn: d => d.close, color: '#f59e0b', showSign: false },
                        { label: '融資餘額', dataFn: d => d.marginBal, color: '#ef4444', showSign: false },
                        { label: '融券餘額', dataFn: d => d.shortBal, color: '#10b981', showSign: false }
                    ]
                });
                contentDiv.appendChild(svg);
                contentDiv.appendChild(legend);
                contentDiv.appendChild(renderMarginTable());
            } else {
                let netFn, balFn, color, tooltipLabelNet, tooltipLabelBal, labelNet, labelBal;
                if (marginSubTab === '融資') { 
                    netFn = d => d.marginNet; balFn = d => d.marginBal; color = '#ef4444'; tooltipLabelNet = '融資增減'; tooltipLabelBal = '融資餘額'; labelNet = '融資買賣'; labelBal = '融資餘額';
                } else { 
                    netFn = d => d.shortNet; balFn = d => d.shortBal; color = '#10b981'; tooltipLabelNet = '融券增減'; tooltipLabelBal = '融券餘額'; labelNet = '融券買賣'; labelBal = '融券餘額';
                }

                const legend = document.createElement('div');
                legend.className = 'flex items-center justify-center gap-4 text-xs font-medium text-slate-600 mt-3 mb-1 px-2';
                legend.innerHTML = `
                    <div class="flex items-center gap-1.5"><span class="w-3 h-3 rounded-full" style="background-color: ${color}"></span>${labelNet}</div>
                    <div class="flex items-center gap-1.5"><span class="w-4 h-0.5" style="background-color: ${color}"></span>${labelBal}</div>
                    <div class="flex items-center gap-1.5"><span class="w-4 h-0.5 bg-amber-500"></span>收盤價</div>
                `;

                const svg = drawSvg({
                    yAxisLeft: { dataFn: [netFn], drawGrid: true, zeroCentered: true, pad: 0.15 },
                    yAxisRight: { dataFn: [balFn, d => d.close], drawGrid: false, pad: 0.1 },
                    bars: [{ dataFn: netFn, color: val => val >= 0 ? color : '#9ca3af', axis: 'left' }],
                    lines: [
                        { dataFn: balFn, color: color, width: '2', axis: 'right' },
                        { dataFn: d => d.close, color: '#f59e0b', width: '2', dash: '4 2', axis: 'right' }
                    ],
                    tooltip: [
                        { label: '收盤價', dataFn: d => d.close, color: '#f59e0b', showSign: false },
                        { label: tooltipLabelBal, dataFn: balFn, color: color, showSign: false },
                        { label: tooltipLabelNet, dataFn: netFn, color: '#64748b' }
                    ]
                });
                contentDiv.appendChild(svg);
                contentDiv.appendChild(legend);
                contentDiv.appendChild(renderMarginTable());
            }
        }
    };

    const renderTabs = () => {
        tabContainer.innerHTML = '';
        tabs.forEach(t => {
            const btn = document.createElement('button');
            const isActive = activeTab === t;
            btn.className = `px-5 py-2.5 border-b-2 transition-colors ${isActive ? 'border-blue-600 text-blue-600 font-bold' : 'border-transparent text-slate-500 hover:text-slate-800'}`;
            btn.innerText = t;
            btn.onclick = () => {
                activeTab = t;
                renderTabs();
                renderContent();
            };
            tabContainer.appendChild(btn);
        });
    };

    const rangeSelect = document.createElement('select');
    rangeSelect.className = 'text-xs border border-slate-200 rounded px-2 py-1 bg-white text-slate-600 outline-none cursor-pointer mb-1 hover:border-blue-400 transition-colors shadow-sm';
    const ranges = [
        { val: '1W', label: '1 週' },
        { val: '1M', label: '1 個月' },
        { val: '3M', label: '3 個月' },
        { val: '6M', label: '半年' },
        { val: '1Y', label: '1 年' },
        { val: 'ALL', label: '全部' }
    ];
    ranges.forEach(r => {
        const opt = document.createElement('option');
        opt.value = r.val;
        opt.textContent = r.label;
        if (range === r.val) opt.selected = true;
        rangeSelect.appendChild(opt);
    });
    
    rangeSelect.onchange = (e) => {
        if (!window.settings) window.settings = {};
        window.settings.chipsTimeRange = e.target.value;
        if (window.saveSettings) window.saveSettings();
        // 重新渲染當前股票的籌碼圖表 (使用完整的原始資料)
        renderChipsAdvanced(container, chipsData, code, priceData);
    };

    const rightControls = document.createElement('div');
    rightControls.className = 'flex items-center';
    rightControls.appendChild(rangeSelect);

    headerRow.appendChild(tabContainer);
    headerRow.appendChild(rightControls);
    
    wrapper.appendChild(headerRow);
    wrapper.appendChild(contentDiv);
    container.appendChild(wrapper);

    renderTabs();
    renderContent();
}
