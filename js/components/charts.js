// --- Constants and Colors ---
const W = 640;
const H_INTRA = 200;
const H_KLINE = 360;
const PL = 50, PR = 15; // Padding Left, Right
const PT = 12; // Padding Top
const PB = 24; // Padding Bottom

const UP_COLOR = '#ef4444'; // Tailwind red-500
const DOWN_COLOR = '#22c55e'; // Tailwind green-500
const FLAT_COLOR = '#94a3b8'; // Tailwind slate-400
const GRID_COLOR = 'rgba(148, 163, 184, 0.2)'; // Slate-400 with opacity
const TEXT_COLOR = '#64748b'; // Slate-500

const MA_COLORS = ['#f59e0b', '#3b82f6', '#8b5cf6']; // orange-500, blue-500, purple-500
const MA_PERIODS = [5, 20, 60];

// --- Utilities ---
export function createSvgElement(tag, attrs = {}) {
    const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [key, val] of Object.entries(attrs)) {
        el.setAttribute(key, val);
    }
    return el;
}

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
    if (step === 0) step = 1;
    const s = Math.floor(lo / step) * step;
    const ticks = [];
    for (let v = s; v <= hi + step * 0.5; v += step) {
        if (v >= lo - step * 0.5) ticks.push(v);
    }
    return ticks;
}

function formatTime(timestamp) {
    const d = new Date(timestamp * 1000);
    return d.toLocaleTimeString('zh-TW', { hour12: false, hour: '2-digit', minute: '2-digit' });
}

// ==========================================
// renderIntradayChart
// ==========================================
export function renderIntradayChart(container, data, quote) {
    container.innerHTML = '';
    
    if (!data || data.length === 0) {
        container.innerHTML = '<div class="w-full h-full flex items-center justify-center text-slate-400 text-sm">無當日走勢資料</div>';
        return;
    }

    // Copy data to avoid mutating cache
    const chartData = [...data];
    const tStart = chartData[0].time;
    const sessionEnd = tStart + 4.5 * 3600; // 13:30

    // Yahoo API often misses the 13:25-13:30 closing tick for TWSE, or is delayed.
    // If we have a quote price, append it to the current time (or session end)
    if (quote.price != null) {
        const nowSec = Date.now() / 1000;
        const lastT = chartData[chartData.length - 1].time;
        
        if (nowSec > sessionEnd) {
            if (lastT < sessionEnd) chartData.push({ time: sessionEnd, value: quote.price });
        } else {
            // During market hours, draw a line to the *current* time using real-time MIS quote
            // Make sure the new time is at least strictly greater than the last point
            const currentT = Math.min(sessionEnd, Math.max(lastT + 60, nowSec));
            chartData.push({ time: currentT, value: quote.price });
        }
    }

    // 1. Calculate scales
    let minP = Infinity, maxP = -Infinity;
    chartData.forEach(d => {
        if (d.value < minP) minP = d.value;
        if (d.value > maxP) maxP = d.value;
    });

    // We need yesterday's close to determine red/green.
    const prevClose = (quote.price != null && quote.change != null) ? (quote.price - quote.change) : chartData[0].value;
    if (prevClose < minP) minP = prevClose;
    if (prevClose > maxP) maxP = prevClose;

    // Ensure symmetric padding around prevClose if possible, or just padding
    const r = Math.max(Math.abs(maxP - prevClose), Math.abs(minP - prevClose));
    let yHi = prevClose + r * 1.05;
    let yLo = prevClose - r * 1.05;
    if (yHi === yLo) { yHi += 1; yLo -= 1; }

    const tEnd = Math.max(chartData[chartData.length - 1].time, sessionEnd);

    const innerW = W - PL - PR;
    const innerH = H_INTRA - PT - PB;

    const getX = (t) => PL + ((t - tStart) / (tEnd - tStart)) * innerW;
    const getY = (v) => PT + (1 - (v - yLo) / (yHi - yLo)) * innerH;

    // 2. Create SVG
    const svg = createSvgElement('svg', {
        viewBox: `0 0 ${W} ${H_INTRA}`,
        class: 'w-full h-full block cursor-crosshair',
        preserveAspectRatio: 'none'
    });

    // 3. Grid & Ticks
    const yTicks = niceTicks(yLo, yHi, 5);
    yTicks.forEach(tick => {
        const y = getY(tick);
        svg.appendChild(createSvgElement('line', {
            x1: PL, x2: W - PR, y1: y, y2: y,
            stroke: GRID_COLOR, 'stroke-dasharray': '4 4'
        }));
        
        const text = createSvgElement('text', {
            x: PL - 5, y: y + 4,
            fill: tick > prevClose ? UP_COLOR : (tick < prevClose ? DOWN_COLOR : FLAT_COLOR),
            'font-size': '10', 'text-anchor': 'end'
        });
        text.textContent = tick.toFixed(2);
        svg.appendChild(text);
    });

    // Previous close line
    const py = getY(prevClose);
    svg.appendChild(createSvgElement('line', {
        x1: PL, x2: W - PR, y1: py, y2: py,
        stroke: FLAT_COLOR, 'stroke-dasharray': '2 2'
    }));

    // Time ticks
    const tTicks = [tStart, tStart + 3600, tStart + 2*3600, tStart + 3*3600, tStart + 4.5*3600];
    tTicks.forEach(t => {
        const x = getX(t);
        const text = createSvgElement('text', {
            x: x, y: H_INTRA - 5,
            fill: TEXT_COLOR, 'font-size': '10', 'text-anchor': 'middle'
        });
        text.textContent = formatTime(t);
        svg.appendChild(text);
    });

    // 4. Draw Area and Line
    let pathD = `M ${getX(chartData[0].time)} ${getY(chartData[0].value)}`;
    chartData.forEach(d => {
        pathD += ` L ${getX(d.time)} ${getY(d.value)}`;
    });

    const pyPercent = Math.max(0, Math.min(100, (py / H_INTRA) * 100));

    const defs = createSvgElement('defs', {});
    
    const lineGrad = createSvgElement('linearGradient', { id: 'lineGrad', x1: '0', y1: '0', x2: '0', y2: H_INTRA, gradientUnits: 'userSpaceOnUse' });
    lineGrad.appendChild(createSvgElement('stop', { offset: '0%', 'stop-color': UP_COLOR }));
    lineGrad.appendChild(createSvgElement('stop', { offset: `${pyPercent}%`, 'stop-color': UP_COLOR }));
    lineGrad.appendChild(createSvgElement('stop', { offset: `${pyPercent}%`, 'stop-color': DOWN_COLOR }));
    lineGrad.appendChild(createSvgElement('stop', { offset: '100%', 'stop-color': DOWN_COLOR }));

    const areaGrad = createSvgElement('linearGradient', { id: 'areaGrad', x1: '0', y1: '0', x2: '0', y2: H_INTRA, gradientUnits: 'userSpaceOnUse' });
    areaGrad.appendChild(createSvgElement('stop', { offset: '0%', 'stop-color': UP_COLOR, 'stop-opacity': '0.3' }));
    areaGrad.appendChild(createSvgElement('stop', { offset: `${pyPercent}%`, 'stop-color': UP_COLOR, 'stop-opacity': '0' }));
    areaGrad.appendChild(createSvgElement('stop', { offset: `${pyPercent}%`, 'stop-color': DOWN_COLOR, 'stop-opacity': '0' }));
    areaGrad.appendChild(createSvgElement('stop', { offset: '100%', 'stop-color': DOWN_COLOR, 'stop-opacity': '0.3' }));

    defs.appendChild(lineGrad);
    defs.appendChild(areaGrad);
    svg.appendChild(defs);

    const areaD = pathD + ` L ${getX(chartData[chartData.length-1].time)} ${H_INTRA - PB} L ${getX(chartData[0].time)} ${H_INTRA - PB} Z`;

    svg.appendChild(createSvgElement('path', {
        d: areaD, fill: 'url(#areaGrad)', stroke: 'none'
    }));

    svg.appendChild(createSvgElement('path', {
        d: pathD, fill: 'none', stroke: 'url(#lineGrad)', 'stroke-width': '1.5'
    }));

    // 5. Crosshair and Legend
    const crossH = createSvgElement('line', {
        stroke: '#cbd5e1', 'stroke-width': '1', 'stroke-dasharray': '3 3', visibility: 'hidden',
        x1: PL, x2: W - PR
    });
    const crossV = createSvgElement('line', {
        stroke: '#cbd5e1', 'stroke-width': '1', 'stroke-dasharray': '3 3', visibility: 'hidden',
        y1: PT, y2: H_INTRA - PB
    });
    const dot = createSvgElement('circle', {
        r: 3, fill: UP_COLOR, visibility: 'hidden'
    });
    const legendGroup = createSvgElement('g', { visibility: 'hidden' });
    const legendBg = createSvgElement('rect', { fill: 'rgba(255, 255, 255, 0.9)', stroke: '#e2e8f0', rx: 4, width: 90, height: 24 });
    const legendText = createSvgElement('text', { x: 6, y: 16, fill: TEXT_COLOR, 'font-size': '11', 'font-weight': '500' });
    legendGroup.appendChild(legendBg);
    legendGroup.appendChild(legendText);

    svg.appendChild(crossH);
    svg.appendChild(crossV);
    svg.appendChild(dot);
    svg.appendChild(legendGroup);

    svg.addEventListener('mousemove', (e) => {
        const rect = svg.getBoundingClientRect();
        // SVG coordinates
        const px = ((e.clientX - rect.left) / rect.width) * W;
        const targetT = tStart + ((px - PL) / innerW) * (tEnd - tStart);
        
        let closest = chartData[0];
        let minDiff = Math.abs(targetT - chartData[0].time);
        for(let i = 1; i < chartData.length; i++){
            const diff = Math.abs(targetT - chartData[i].time);
            if(diff < minDiff) {
                minDiff = diff;
                closest = chartData[i];
            }
        }

        const cx = getX(closest.time);
        const cy = getY(closest.value);

        crossV.setAttribute('x1', cx); crossV.setAttribute('x2', cx);
        crossV.setAttribute('visibility', 'visible');
        
        crossH.setAttribute('y1', cy); crossH.setAttribute('y2', cy);
        crossH.setAttribute('visibility', 'visible');

        dot.setAttribute('cx', cx); dot.setAttribute('cy', cy);
        dot.setAttribute('fill', closest.value >= prevClose ? UP_COLOR : DOWN_COLOR);
        dot.setAttribute('visibility', 'visible');

        let lx = px + 12;
        const pyMouse = ((e.clientY - rect.top) / rect.height) * H_INTRA;
        let ly = pyMouse + 12;
        if (lx + 90 > W - PR) lx = px - 90 - 12;
        if (ly + 24 > H_INTRA - PB) ly = pyMouse - 24 - 12;

        legendGroup.setAttribute('transform', `translate(${lx}, ${ly})`);
        legendText.textContent = `${formatTime(closest.time)} - ${closest.value.toFixed(2)}`;
        legendGroup.setAttribute('visibility', 'visible');
    });

    svg.addEventListener('mouseleave', () => {
        crossV.setAttribute('visibility', 'hidden');
        crossH.setAttribute('visibility', 'hidden');
        dot.setAttribute('visibility', 'hidden');
        legendGroup.setAttribute('visibility', 'hidden');
    });

    container.appendChild(svg);
}

// ==========================================
// renderKLineChart
// ==========================================
export function renderKLineChart(container, data) {
    container.innerHTML = '';
    
    if (!data || data.length === 0) {
        container.innerHTML = '<div class="w-full h-full flex items-center justify-center text-slate-400 text-sm">無歷史 K 線資料</div>';
        return;
    }

    // Limit to last 100 days for better view if too many
    const visibleData = data.slice(-100);
    const n = visibleData.length;

    // 1. Calculate scales
    const VOL_TOP = H_KLINE - PB - 60;
    const CANDLE_BOT = VOL_TOP - 10;
    
    let minP = Infinity, maxP = -Infinity, maxV = 0;
    visibleData.forEach(d => {
        if (d.high > maxP) maxP = d.high;
        if (d.low < minP) minP = d.low;
        if (d.volume > maxV) maxV = d.volume;
    });

    const pPad = (maxP - minP) * 0.05;
    const pHi = maxP + pPad;
    const pLo = minP - pPad;
    const vHi = maxV * 1.1;

    const innerW = W - PL - PR;
    const candleH = CANDLE_BOT - PT;
    const volH = H_KLINE - PB - VOL_TOP;

    const getX = (idx) => PL + (idx + 0.5) * (innerW / n);
    const getY = (p) => PT + (1 - (p - pLo) / (pHi - pLo)) * candleH;
    const getVy = (v) => H_KLINE - PB - (v / vHi) * volH;

    // 2. Create SVG
    const svg = createSvgElement('svg', {
        viewBox: `0 0 ${W} ${H_KLINE}`,
        class: 'w-full h-full block cursor-crosshair',
        preserveAspectRatio: 'none'
    });

    // 3. Grid & Ticks
    const pTicks = niceTicks(pLo, pHi, 5);
    pTicks.forEach(tick => {
        const y = getY(tick);
        svg.appendChild(createSvgElement('line', {
            x1: PL, x2: W - PR, y1: y, y2: y,
            stroke: GRID_COLOR, 'stroke-dasharray': '2 2'
        }));
        const text = createSvgElement('text', {
            x: PL - 5, y: y + 4, fill: TEXT_COLOR, 'font-size': '10', 'text-anchor': 'end'
        });
        text.textContent = tick.toFixed(2);
        svg.appendChild(text);
    });

    // Date Ticks
    const dStep = Math.max(1, Math.floor(n / 5));
    for (let i = 0; i < n; i += dStep) {
        const d = visibleData[i].time;
        const x = getX(i);
        const text = createSvgElement('text', {
            x: x, y: H_KLINE - 5, fill: TEXT_COLOR, 'font-size': '10', 'text-anchor': 'middle'
        });
        text.textContent = d ? d.substring(5) : ''; // MM-DD
        svg.appendChild(text);
    }

    // 4. Draw Candles and Volume
    const bodyW = Math.max(1.2, (innerW / n) * 0.65);
    
    visibleData.forEach((d, i) => {
        const x = getX(i);
        const isUp = d.close >= d.open;
        const color = isUp ? UP_COLOR : DOWN_COLOR;

        // Wick
        svg.appendChild(createSvgElement('line', {
            x1: x, x2: x, y1: getY(d.high), y2: getY(d.low), stroke: color, 'stroke-width': '1'
        }));

        // Body
        const yTop = getY(Math.max(d.open, d.close));
        const yBot = getY(Math.min(d.open, d.close));
        svg.appendChild(createSvgElement('rect', {
            x: x - bodyW/2, y: yTop, width: bodyW, height: Math.max(1, yBot - yTop), fill: color
        }));

        // Volume
        const vy = getVy(d.volume);
        svg.appendChild(createSvgElement('rect', {
            x: x - bodyW/2, y: vy, width: bodyW, height: H_KLINE - PB - vy, fill: color, opacity: '0.5'
        }));
    });

    // 5. Draw MAs
    MA_PERIODS.forEach((period, idx) => {
        const color = MA_COLORS[idx];
        let pathD = '';
        visibleData.forEach((d, i) => {
            // Find corresponding MA value in the full data array based on time
            // In a real app we'd calculate MA across full dataset, but for simplicity here 
            // we assume MA was pre-calculated or calculate here
            let sum = 0, count = 0;
            const fullIdx = data.findIndex(x => x.time === d.time);
            if (fullIdx >= period - 1) {
                for(let j=0; j<period; j++) sum += data[fullIdx - j].close;
                const maVal = sum / period;
                const cmd = pathD === '' ? 'M' : 'L';
                pathD += `${cmd} ${getX(i)} ${getY(maVal)} `;
            }
        });
        if (pathD) {
            svg.appendChild(createSvgElement('path', {
                d: pathD, fill: 'none', stroke: color, 'stroke-width': '1.2'
            }));
        }
    });

    // 6. Crosshair and Legend
    const crossH = createSvgElement('line', {
        stroke: '#cbd5e1', 'stroke-width': '1', 'stroke-dasharray': '3 3', visibility: 'hidden',
        x1: PL, x2: W - PR
    });
    const crossV = createSvgElement('line', {
        stroke: '#cbd5e1', 'stroke-width': '1', 'stroke-dasharray': '3 3', visibility: 'hidden',
        y1: PT, y2: H_KLINE - PB
    });
    
    // Legend group
    const legendGroup = createSvgElement('g', { visibility: 'hidden' });
    const legendBg = createSvgElement('rect', { fill: 'rgba(255, 255, 255, 0.95)', stroke: '#e2e8f0', rx: 4, width: 120, height: 110 });
    const legendDate = createSvgElement('text', { x: 8, y: 18, fill: '#334155', 'font-size': '11', 'font-weight': 'bold' });
    const legendOpen = createSvgElement('text', { x: 8, y: 36, fill: TEXT_COLOR, 'font-size': '11' });
    const legendHigh = createSvgElement('text', { x: 8, y: 52, fill: TEXT_COLOR, 'font-size': '11' });
    const legendLow = createSvgElement('text', { x: 8, y: 68, fill: TEXT_COLOR, 'font-size': '11' });
    const legendClose = createSvgElement('text', { x: 8, y: 84, fill: TEXT_COLOR, 'font-size': '11' });
    const legendVol = createSvgElement('text', { x: 8, y: 100, fill: TEXT_COLOR, 'font-size': '11' });
    
    legendGroup.appendChild(legendBg);
    legendGroup.appendChild(legendDate);
    legendGroup.appendChild(legendOpen);
    legendGroup.appendChild(legendHigh);
    legendGroup.appendChild(legendLow);
    legendGroup.appendChild(legendClose);
    legendGroup.appendChild(legendVol);
    
    // Static MA Legend
    const maLegendGroup = createSvgElement('g', { transform: `translate(${PL + 10}, ${PT + 25})` });
    MA_PERIODS.forEach((p, i) => {
        const text = createSvgElement('text', {
            x: i * 80, y: 0, fill: MA_COLORS[i], 'font-size': '10'
        });
        text.textContent = `MA${p}`;
        text.id = `ma-legend-${p}`;
        maLegendGroup.appendChild(text);
    });

    svg.appendChild(crossH);
    svg.appendChild(crossV);
    svg.appendChild(legendGroup);
    svg.appendChild(maLegendGroup);

    svg.addEventListener('mousemove', (e) => {
        const rect = svg.getBoundingClientRect();
        const px = ((e.clientX - rect.left) / rect.width) * W;
        const slotW = innerW / n;
        const rawIdx = Math.floor((px - PL) / slotW);
        
        if (rawIdx >= 0 && rawIdx < n) {
            const closest = visibleData[rawIdx];
            const cx = getX(rawIdx);
            const cy = getY(closest.close);

            crossV.setAttribute('x1', cx); crossV.setAttribute('x2', cx);
            crossV.setAttribute('visibility', 'visible');
            
            crossH.setAttribute('y1', cy); crossH.setAttribute('y2', cy);
            crossH.setAttribute('visibility', 'visible');

            const isUp = closest.close >= closest.open;
            const color = isUp ? UP_COLOR : DOWN_COLOR;
            let lx = px + 12;
            const pyMouse = ((e.clientY - rect.top) / rect.height) * H_KLINE;
            let ly = pyMouse + 12;
            if (lx + 120 > W - PR) lx = px - 120 - 12;
            if (ly + 110 > H_KLINE - PB) ly = pyMouse - 110 - 12;

            legendGroup.setAttribute('transform', `translate(${lx}, ${ly})`);
            legendOpen.setAttribute('fill', color);
            legendHigh.setAttribute('fill', color);
            legendLow.setAttribute('fill', color);
            legendClose.setAttribute('fill', color);
            legendVol.setAttribute('fill', color);
            
            legendDate.textContent = closest.time;
            legendOpen.textContent = `開盤價: ${Number(closest.open).toFixed(2)}`;
            legendHigh.textContent = `最高價: ${Number(closest.high).toFixed(2)}`;
            legendLow.textContent = `最低價: ${Number(closest.low).toFixed(2)}`;
            legendClose.textContent = `收盤價: ${Number(closest.close).toFixed(2)}`;
            legendVol.textContent = `成交量: ${Number(closest.volume).toLocaleString()}`;
            
            legendGroup.setAttribute('visibility', 'visible');
        }
    });

    svg.addEventListener('mouseleave', () => {
        crossV.setAttribute('visibility', 'hidden');
        crossH.setAttribute('visibility', 'hidden');
        legendGroup.setAttribute('visibility', 'hidden');
    });

    container.appendChild(svg);
}

