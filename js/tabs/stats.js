import { settings } from '../store.js';
import { calculateStockMetrics } from './trades.js';
import { getQuoteForCode } from '../api/twstock.js';
import { drawPieChart, drawBarChart, drawLineChart, exportChart } from '../../utils/js/charts.js';

let isFetchingQuotes = false;
let currentStats = null;

// Format numbers with commas
const formatNum = (num) => {
    if (num == null) return '0';
    return Math.round(num).toLocaleString('en-US');
};

// Format currency with color classes
const renderCurrency = (elementId, amount, isPositiveGood = true) => {
    const el = document.getElementById(elementId);
    if (!el) return;
    
    let text = formatNum(Math.abs(amount));
    if (amount > 0) {
        text = `+${text}`;
        el.className = isPositiveGood ? 'text-lg bg-profit' : 'text-lg bg-loss';
    } else if (amount < 0) {
        text = `-${text}`;
        el.className = isPositiveGood ? 'text-lg bg-loss' : 'text-lg bg-profit';
    } else {
        el.className = 'text-lg font-bold text-slate-700';
    }
    el.innerText = text;
};

// Simple text update
const setText = (elementId, text) => {
    const el = document.getElementById(elementId);
    if (el) el.innerText = text;
};

export function initStats() {
    const btnRefresh = document.getElementById('btn-stats-refresh');
    if (btnRefresh) {
        btnRefresh.addEventListener('click', () => {
            const icon = btnRefresh.querySelector('svg');
            if (icon) icon.classList.add('animate-spin');
            
            renderStats(true).then(() => {
                if (icon) icon.classList.remove('animate-spin');
            });
        });
    }
    
    // Expose for dynamic tab switching
    window.renderStatsTabFunc = () => renderStats(false);
}

export async function renderStats(forceRefresh = false) {
    const transactions = settings.transactions || [];
    
    let totalBuy = 0;
    let totalSell = 0;
    let totalFee = 0;
    let totalTax = 0;
    let totalRebate = 0;
    let totalDividend = 0;
    let totalDeposits = 0;
    let totalWithdrawals = 0;
    let availableFunds = 0;
    let buyCount = 0;
    let sellCount = 0;
    let totalRealized = 0;
    
    let brokerBalances = {};
    (settings.brokers || []).forEach(b => {
        brokerBalances[b.id] = {
            name: b.name,
            balance: b.initialCapital || 0,
            fee: 0,
            tax: 0,
            rebate: 0,
            dividend: 0
        };
        availableFunds += (b.initialCapital || 0);
    });

    // 1. Calculate basic cashflows
    for (let t of transactions) {
        let bId = t.brokerId;
        if (!bId && settings.brokers && settings.brokers.length > 0) bId = settings.brokers[0].id;
        
        if (bId && !brokerBalances[bId]) {
            let b = (settings.brokers || []).find(br => br.id == bId);
            let initCap = b ? (b.initialCapital || 0) : 0;
            brokerBalances[bId] = { 
                name: b ? b.name : '未知券商', 
                balance: initCap,
                fee: 0,
                tax: 0,
                rebate: 0,
                dividend: 0
            };
            availableFunds += initCap;
        }

        let change = 0;
        
        if (t.category === 'account') {
            if (t.type === 'deposit') {
                totalDeposits += (t.total || 0);
                change = (t.total || 0);
            } else if (t.type === 'withdraw') {
                totalWithdrawals += (t.total || 0);
                change = -(t.total || 0);
            }
        } else if (t.category === 'trade' || !t.category) {
            if (t.type === 'buy') {
                totalBuy += (t.total || 0); // t.total typically includes fee
                change = -(t.total || 0);
                buyCount++;
            } else if (t.type === 'sell') {
                totalSell += (t.total || 0);
                change = (t.total || 0);
                sellCount++;
            }
            totalFee += (t.fee || 0);
            totalTax += (t.tax || 0);
            if (bId && brokerBalances[bId]) {
                brokerBalances[bId].fee += (t.fee || 0);
                brokerBalances[bId].tax += (t.tax || 0);
            }
        } else if (t.category === 'dividend') {
            if (t.type === 'cash' || t.type === 'both') {
                totalDividend += (t.total || 0);
                change = (t.total || 0);
                if (bId && brokerBalances[bId]) brokerBalances[bId].dividend += (t.total || 0);
            }
            totalFee += (t.fee || 0);
            totalTax += (t.tax || 0);
            if (bId && brokerBalances[bId]) {
                brokerBalances[bId].fee += (t.fee || 0);
                brokerBalances[bId].tax += (t.tax || 0);
            }
        } else if (t.category === 'fee_rebate') {
            totalRebate += (t.total || 0);
            change = (t.total || 0);
            if (bId && brokerBalances[bId]) brokerBalances[bId].rebate += (t.total || 0);
        } else if (t.category === 'capital_change') {
            if (t.type === 'reduction') {
                change = (t.cash || t.total || 0);
            }
        }
        
        availableFunds += change;
        if (bId && brokerBalances[bId]) brokerBalances[bId].balance += change;
    }

    let initialCapSum = Object.values(brokerBalances).reduce((sum, b) => sum + (b.balance - (b.balance /* this doesn't help get initialCap, wait, just calc it */)), 0);
    // Actually, calculate total initial capital explicitly:
    let totalInitial = (settings.brokers || []).reduce((sum, b) => sum + (b.initialCapital || 0), 0);
    const netInvested = totalInitial + totalDeposits - totalWithdrawals;

    // 2. Find unique stocks to calculate realized PnL and open positions
    const uniqueCodes = [...new Set(transactions.map(t => t.code).filter(c => c))];
    const openPositions = [];
    const dividendStocks = {};
    const soldDividendStocks = {};
    let totalStockDividendShares = 0;
    
    for (let code of uniqueCodes) {
        const metrics = calculateStockMetrics(code, 0); // Price 0 is fine for realized
        
        // Use FIFO realized if accounting method is FIFO, otherwise standard
        const isFifo = settings.accountingMethod === 'fifo';
        totalRealized += isFifo ? (metrics.fifo?.realized || 0) : (metrics.realized || 0);
        
        if (metrics.stockDividendShares > 0) {
            totalStockDividendShares += metrics.stockDividendShares;
            dividendStocks[code] = metrics.stockDividendShares;
        }

        if (metrics.soldStockDividendShares > 0) {
            soldDividendStocks[code] = metrics.soldStockDividendShares;
        }

        if (metrics.shares > 0) {
            openPositions.push(code);
        }
    }

    // 3. Render static values immediately
    setText('stats-total-buy', formatNum(totalBuy));
    setText('stats-total-sell', formatNum(totalSell));
    
    // Net Invested: typically we don't color it red/green unless we want to.
    const elNetInvested = document.getElementById('stats-net-invested');
    if (elNetInvested) {
        elNetInvested.innerText = formatNum(netInvested);
        elNetInvested.className = netInvested < 0 ? 'text-2xl font-bold text-emerald-600' : 'text-2xl font-bold text-slate-800';
    }

    // Realized PnL
    const elRealized = document.getElementById('stats-realized-pnl');
    if (elRealized) {
        elRealized.innerText = totalRealized > 0 ? `+${formatNum(totalRealized)}` : formatNum(totalRealized);
        elRealized.className = totalRealized > 0 ? 'text-2xl font-bold bg-profit' : (totalRealized < 0 ? 'text-2xl font-bold bg-loss' : 'text-2xl font-bold text-slate-800');
    }

    setText('stats-available-funds', formatNum(availableFunds));
    setText('stats-total-fee', formatNum(totalFee));
    setText('stats-total-tax', formatNum(totalTax));
    
    setText('stats-buy-count', `買${buyCount}筆`);
    setText('stats-sell-count', `賣${sellCount}筆`);
    
    const elDividend = document.getElementById('stats-dividend');
    if (elDividend) {
        elDividend.innerText = totalDividend > 0 ? `+${formatNum(totalDividend)}` : '0';
        elDividend.className = totalDividend > 0 ? 'font-medium text-blue-600' : 'font-medium text-slate-400';
    }

    const elRebate = document.getElementById('stats-rebate');
    if (elRebate) {
        elRebate.innerText = totalRebate > 0 ? `+${formatNum(totalRebate)}` : '0';
        elRebate.className = totalRebate > 0 ? 'font-medium text-emerald-600' : 'font-medium text-slate-400';
    }

    // Render broker balances
    const brokerBalancesContainer = document.getElementById('stats-broker-balances');
    if (brokerBalancesContainer) {
        brokerBalancesContainer.innerHTML = '';
        
        const brokerColors = [
            'bg-blue-50 text-blue-600 border-blue-200',
            'bg-emerald-50 text-emerald-600 border-emerald-200',
            'bg-amber-50 text-amber-600 border-amber-200',
            'bg-purple-50 text-purple-600 border-purple-200',
            'bg-rose-50 text-rose-600 border-rose-200',
            'bg-indigo-50 text-indigo-600 border-indigo-200',
            'bg-cyan-50 text-cyan-600 border-cyan-200',
            'bg-fuchsia-50 text-fuchsia-600 border-fuchsia-200'
        ];

        const allBrokers = settings.brokers || [];

        Object.values(brokerBalances).forEach(b => {
            const div = document.createElement('div');
            div.className = 'bg-slate-50/70 p-4 rounded-xl border border-slate-200/80 shadow-2xs hover:shadow-xs flex flex-col gap-2.5 transition-all';
            
            const bName = b.name || '未知券商';
            const brokerIndex = allBrokers.findIndex(br => (b.id && br.id === b.id) || br.name === bName);
            let badgeColor;
            if (brokerIndex !== -1) {
                badgeColor = brokerColors[brokerIndex % brokerColors.length];
            } else {
                let hash = 0;
                for (let i = 0; i < bName.length; i++) hash = bName.charCodeAt(i) + ((hash << 5) - hash);
                badgeColor = brokerColors[Math.abs(hash) % brokerColors.length];
            }

            let rebatePct = 0;
            if (b.fee > 0) rebatePct = (b.rebate / b.fee) * 100;
            
            div.innerHTML = `
                <div class="flex items-center justify-between border-b border-slate-200/80 pb-2.5">
                    <span class="inline-block px-2.5 py-0.5 ${badgeColor} rounded text-[13px] font-medium border shadow-xs">${bName}</span>
                    <span class="text-xs text-slate-400">折讓率 <span class="text-emerald-600 font-semibold bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-100">${rebatePct.toFixed(1)}%</span></span>
                </div>
                <div class="grid grid-cols-2 gap-2.5 text-xs pt-0.5">
                    <div class="bg-white/90 p-2.5 rounded-lg border border-slate-100 shadow-2xs">
                        <div class="text-slate-400 mb-0.5 text-[11px]">手續費</div>
                        <div class="font-semibold text-slate-700 text-sm font-mono">${formatNum(b.fee)}</div>
                    </div>
                    <div class="bg-white/90 p-2.5 rounded-lg border border-slate-100 shadow-2xs">
                        <div class="text-slate-400 mb-0.5 text-[11px]">手續費折讓</div>
                        <div class="font-semibold ${b.rebate > 0 ? 'text-emerald-600' : 'text-slate-600'} text-sm font-mono">${formatNum(b.rebate)}</div>
                    </div>
                    <div class="bg-white/90 p-2.5 rounded-lg border border-slate-100 shadow-2xs">
                        <div class="text-slate-400 mb-0.5 text-[11px]">交易稅</div>
                        <div class="font-semibold text-slate-700 text-sm font-mono">${formatNum(b.tax)}</div>
                    </div>
                    <div class="bg-white/90 p-2.5 rounded-lg border border-slate-100 shadow-2xs">
                        <div class="text-slate-400 mb-0.5 text-[11px]">配息總計</div>
                        <div class="font-semibold ${b.dividend > 0 ? 'text-blue-600' : 'text-slate-700'} text-sm font-mono">${formatNum(b.dividend)}</div>
                    </div>
                    <div class="col-span-2 bg-white p-2.5 rounded-lg border border-slate-200/90 shadow-2xs flex items-center justify-between">
                        <div class="text-slate-500 font-medium text-xs">可用資金</div>
                        <div class="font-bold ${b.balance >= 0 ? 'text-slate-800' : 'text-rose-600'} text-base font-mono">${formatNum(b.balance)}</div>
                    </div>
                </div>
            `;
            brokerBalancesContainer.appendChild(div);
        });
        
        if (Object.keys(brokerBalances).length === 0) {
            brokerBalancesContainer.innerHTML = '<div class="text-sm text-slate-400 col-span-full">尚未建立任何券商</div>';
        }
    }

    setText('stats-unrealized-count', `(${openPositions.length}檔)`);

    const codesToFetch = [...new Set([...openPositions, ...Object.keys(dividendStocks), ...Object.keys(soldDividendStocks)])];
    let totalStockDividendValue = 0;
    const dividendStockDetails = [];
    const soldDividendStockDetails = [];

    // 將 quotes 和 unrealizedMarketValue 提升到 if 區塊外，確保 setTimeout 圖表繪製能存取
    const quotes = [];
    let unrealizedMarketValue = 0;

    // 4. Fetch quotes for open positions & dividend stocks (if needed)
    if (codesToFetch.length > 0) {
        const loadingIndicator = document.getElementById('stats-quotes-loading');

        let unrealizedCost = 0;
        let unrealizedPnL = 0;
        
        let latestQuoteTimeStr = '';
        let maxTimeVal = 0;

        // Check if user set update frequency to manual
        const manualOnly = settings.refreshFreq === 0 || settings.refreshFreq === '0';
        const shouldFetchApi = forceRefresh || !manualOnly;
        
        if (shouldFetchApi && loadingIndicator) {
            loadingIndicator.classList.remove('hidden');
        }

        // Fetch quotes sequentially in chunks or use fallback to avoid overwhelming the server
        for (let code of codesToFetch) {
            let quote = null;
            if (shouldFetchApi) {
                quote = await getQuoteForCode(code);
            }
            
            // Fallback to cache if price is missing or if we didn't fetch API
            if (!quote || quote.price == null) {
                if (settings.marketQuotesCache && settings.marketQuotesCache[code]) {
                    quote = settings.marketQuotesCache[code];
                }
            } else {
                // Update cache
                if (!settings.marketQuotesCache) settings.marketQuotesCache = {};
                settings.marketQuotesCache[code] = quote;
            }
            quotes.push(quote);
            
            // Track the most recent quote time
            if (quote && quote.quoteDate && quote.tradeTime) {
                const dateStr = quote.quoteDate.trim();
                const timeStr = quote.tradeTime.trim();
                if (dateStr.length === 8) {
                    const y = dateStr.substring(0, 4);
                    const m = dateStr.substring(4, 6);
                    const d = dateStr.substring(6, 8);
                    const timestamp = new Date(`${y}-${m}-${d}T${timeStr}`).getTime();
                    if (timestamp > maxTimeVal) {
                        maxTimeVal = timestamp;
                        latestQuoteTimeStr = `(${m}/${d} ${timeStr})`;
                    }
                }
            }
        }

        let hasAnyValidQuote = false;

        for (let i = 0; i < codesToFetch.length; i++) {
            const code = codesToFetch[i];
            const quote = quotes[i];
            const price = quote?.price || 0;
            const metrics = calculateStockMetrics(code, price);
            if (!metrics) continue;
            
            if (openPositions.includes(code)) {
                const isFifo = settings.accountingMethod === 'fifo';
                const shares = isFifo ? (metrics.fifo?.shares || 0) : (metrics.shares || 0);
                const cost = isFifo ? (metrics.fifo?.totalCost || 0) : (metrics.totalCost || 0);
                unrealizedCost += cost;

                if (price > 0) {
                    hasAnyValidQuote = true;
                    const mVal = isFifo ? (shares * price) : (metrics.marketValue || 0);
                    const pnl = isFifo ? (metrics.fifo?.unrealized || 0) : (metrics.unrealized || 0);
                    unrealizedMarketValue += mVal;
                    unrealizedPnL += pnl;
                } else {
                    // 尚未獲取即時報價時，以持股成本暫估市值，避免損益被誤計為 -100%
                    unrealizedMarketValue += cost;
                }
            }

            if (metrics.stockDividendShares >= 1) {
                const shares = Math.floor(metrics.stockDividendShares);
                const value = shares * price;
                totalStockDividendValue += value;
                
                let stockName = quote?.name || '';
                if (!stockName && settings.stockNamesCache && settings.stockNamesCache[code]) {
                    stockName = settings.stockNamesCache[code];
                }
                
                dividendStockDetails.push({
                    code: code,
                    name: stockName,
                    shares: shares,
                    value: value
                });
            }

            if (metrics.soldStockDividendShares >= 1) {
                let stockName = quote?.name || '';
                if (!stockName && settings.stockNamesCache && settings.stockNamesCache[code]) {
                    stockName = settings.stockNamesCache[code];
                }
                const shares = Math.floor(metrics.soldStockDividendShares);
                soldDividendStockDetails.push(`${stockName} (${shares}股)`);
            }
        }

        if (loadingIndicator) loadingIndicator.classList.add('hidden');

        const elRealizedNotes = document.getElementById('stats-realized-notes');
        if (elRealizedNotes) {
            if (soldDividendStockDetails.length > 0) {
                elRealizedNotes.innerHTML = `包含已實現配股：${soldDividendStockDetails.join('、')}`;
                elRealizedNotes.classList.remove('hidden');
            } else {
                elRealizedNotes.classList.add('hidden');
            }
        }

        setText('stats-unrealized-cost', formatNum(unrealizedCost));
        setText('stats-unrealized-market-value', formatNum(unrealizedMarketValue));
        setText('stats-quote-time', latestQuoteTimeStr || (hasAnyValidQuote ? '' : '(未更新報價，以成本暫估)'));
        
        const elUnrealizedPnL = document.getElementById('stats-unrealized-pnl');
        if (elUnrealizedPnL) {
            if (hasAnyValidQuote) {
                elUnrealizedPnL.innerText = unrealizedPnL > 0 ? `+${formatNum(unrealizedPnL)}` : formatNum(unrealizedPnL);
                elUnrealizedPnL.className = unrealizedPnL > 0 ? 'text-lg font-bold bg-profit' : (unrealizedPnL < 0 ? 'text-lg font-bold bg-loss' : 'text-lg font-bold text-slate-700');
            } else {
                elUnrealizedPnL.innerText = '0';
                elUnrealizedPnL.className = 'text-lg font-bold text-slate-400';
            }
        }

        const totalAccountValue = availableFunds + unrealizedMarketValue;
        setText('stats-total-account-value', formatNum(totalAccountValue));
        
        // Cache stats to prevent unnecessary re-fetches
        currentStats = {
            unrealizedCost,
            unrealizedMarketValue,
            unrealizedPnL,
            totalAccountValue
        };
    } else {
        // No open positions
        setText('stats-unrealized-cost', '0');
        setText('stats-unrealized-market-value', '0');
        setText('stats-quote-time', '');
        
        const elUnrealizedPnL = document.getElementById('stats-unrealized-pnl');
        if (elUnrealizedPnL) {
            elUnrealizedPnL.innerText = '0';
            elUnrealizedPnL.className = 'text-lg font-bold text-slate-700';
        }

        setText('stats-total-account-value', formatNum(availableFunds));
    }

    // Update Stock Dividend Info UI
    const elStockDivCard = document.getElementById('stats-stock-dividend-card');
    const elStockDivTotalValue = document.getElementById('stats-stock-dividend-total-value');
    const elStockDivList = document.getElementById('stats-stock-dividend-list');
    const elRow2Container = document.getElementById('stats-row-2-container');
    
    if (totalStockDividendShares > 0) {
        if (elStockDivCard) elStockDivCard.classList.remove('hidden');
        if (elStockDivTotalValue) elStockDivTotalValue.innerText = formatNum(totalStockDividendValue);
        
        if (elStockDivList) {
            elStockDivList.innerHTML = '';
            dividendStockDetails.sort((a, b) => b.value - a.value).forEach(d => {
                const row = document.createElement('div');
                row.className = 'flex justify-between items-center text-xs';
                row.innerHTML = `
                    <span class="text-slate-500">${d.code} ${d.name} <span class="text-slate-400">(${formatNum(d.shares)}股)</span></span>
                    <span class="text-slate-600 font-medium">${formatNum(d.value)}</span>
                `;
                elStockDivList.appendChild(row);
            });
        }
    } else {
        if (elStockDivCard) elStockDivCard.classList.add('hidden');
    }

    // --- Chart Data Preparation & Rendering ---
    setTimeout(() => {
        const assetData = [];
        let totalInvested = 0;
        const monthlyPnL = {};
        const brokerMap = {};
        let hasBrokerData = false;

        if (settings.brokers && settings.brokers.length > 0) {
            hasBrokerData = true;
            settings.brokers.forEach(b => { brokerMap[b.id] = { name: b.name, value: 0 }; });
        }

        if (availableFunds > 0) {
            assetData.push({ label: '閒置資金', value: availableFunds, color: '#94a3b8' });
        }

        for (let i = 0; i < codesToFetch.length; i++) {
            const code = codesToFetch[i];
            const quote = quotes[i];
            const price = quote?.price || 0;
            let stockName = quote?.name || (settings.stockNamesCache ? settings.stockNamesCache[code] : code);

            const metrics = calculateStockMetrics(code, price);
            if (!metrics) continue;
            
            const isFifo = settings.accountingMethod === 'fifo';
            const currentShares = isFifo ? (metrics.fifo?.shares || 0) : (metrics.shares || 0);
            const currentCost = isFifo ? (metrics.fifo?.totalCost || 0) : (metrics.totalCost || 0);
            const marketVal = isFifo ? (currentShares * price) : (metrics.marketValue || 0);
            
            // 若即時股價大於 0 採用市值，否則以持股成本估算
            const effectiveVal = (price > 0 && marketVal > 0) ? marketVal : (currentShares > 0 ? currentCost : 0);

            if (effectiveVal > 0) {
                assetData.push({ label: stockName, value: effectiveVal });
            }
            
            if (hasBrokerData && (currentShares > 0 || effectiveVal > 0)) {
                const bShares = {};
                let tShares = 0;
                settings.transactions.filter(t => String(t.code) === String(code)).forEach(t => {
                    const bId = t.brokerId || (settings.brokers[0]?.id) || 0;
                    if (!bShares[bId]) bShares[bId] = 0;
                    if (t.category === 'trade' || !t.category) {
                        if (t.type === 'buy') { bShares[bId] += (t.quantity || 0); tShares += (t.quantity || 0); }
                        else if (t.type === 'sell') { bShares[bId] -= (t.quantity || 0); tShares -= (t.quantity || 0); }
                    }
                });
                
                if (tShares > 0) {
                    Object.entries(bShares).forEach(([bId, shares]) => {
                        if (shares > 0 && brokerMap[bId]) {
                            brokerMap[bId].value += (shares / tShares) * effectiveVal;
                        }
                    });
                }
            }
            
            totalInvested += currentCost;
            
            let shares = 0, totalCost = 0;
            let buyLots = [];
            
            const txs = settings.transactions.filter(t => String(t.code) === String(code));
            txs.sort((a, b) => new Date(a.date) - new Date(b.date));
            
            txs.forEach(t => {
                const m = t.date.substring(0, 7);
                if (!monthlyPnL[m]) monthlyPnL[m] = 0;
                
                if (t.category === 'trade' || !t.category) {
                    if (t.type === 'buy') {
                        const q = t.quantity || 0, cost = t.total || 0;
                        shares += q; totalCost += cost;
                        if (q > 0) buyLots.push({ shares: q, totalCost: cost });
                    } else if (t.type === 'sell') {
                        const q = t.quantity || 0, rev = t.total || 0;
                        if (q > 0) {
                            if (isFifo) {
                                let remain = q, costFifo = 0;
                                while (remain > 0 && buyLots.length > 0) {
                                    let lot = buyLots[0];
                                    if (lot.shares <= remain) {
                                        costFifo += lot.totalCost; remain -= lot.shares; buyLots.shift();
                                    } else {
                                        const c = lot.totalCost * (remain / lot.shares);
                                        costFifo += c; lot.shares -= remain; lot.totalCost -= c; remain = 0;
                                    }
                                }
                                monthlyPnL[m] += (rev - costFifo);
                            } else {
                                if (shares > 0) {
                                    const avg = totalCost / shares;
                                    const costSold = q * avg;
                                    monthlyPnL[m] += (rev - costSold);
                                    shares -= q; if (shares < 0) shares = 0;
                                    totalCost = shares * avg;
                                }
                            }
                        }
                    }
                } else if (t.category === 'dividend') {
                    if (t.type === 'cash' || t.type === 'both') {
                        monthlyPnL[m] += (t.total || 0);
                    }
                    if (t.type === 'stock' || t.type === 'both') {
                        const ns = (t.type === 'both' ? t.stockAmount : t.amount) || 0;
                        shares += ns;
                        const cfs = buyLots.reduce((s, l) => s + l.shares, 0);
                        if (cfs > 0 && ns > 0) {
                            buyLots.forEach(l => l.shares *= (cfs + ns) / cfs);
                        }
                    }
                } else if (t.category === 'capital_change' && t.type === 'reduction') {
                    const ratio = t.ratio || 1, cash = t.cash || t.total || 0;
                    shares = Math.floor(shares * ratio);
                    totalCost = Math.max(0, totalCost - cash);
                    const cfs = buyLots.reduce((s, l) => s + l.totalCost, 0);
                    buyLots.forEach(l => {
                        l.shares = Math.floor(l.shares * ratio);
                        if (cfs > 0) l.totalCost = Math.max(0, l.totalCost - cash * (l.totalCost / cfs));
                    });
                }
            });
        }

        drawPieChart('chart-asset-allocation', assetData);
        
        if (hasBrokerData) {
            const brokerData = Object.values(brokerMap).filter(b => b.value > 0).map(b => ({ label: b.name, value: b.value }));
            if (brokerData.length > 0) {
                drawPieChart('chart-broker-distribution', brokerData, true);
            } else {
                document.getElementById('chart-broker-distribution').innerHTML = '<div class="flex items-center justify-center h-full text-sm text-slate-400">尚無庫存資料</div>';
            }
        }
        
        const pnlMonths = Object.keys(monthlyPnL).sort();
        const last12 = pnlMonths.slice(-12);
        const pnlLabels = last12.map(m => m.substring(5) + '月');
        const pnlValues = last12.map(m => monthlyPnL[m]);
        
        if (pnlLabels.length > 0) {
            drawBarChart('chart-realized-pnl', pnlLabels, pnlValues, null, {
                title: '每月已實現損益'
            });
        } else {
            document.getElementById('chart-realized-pnl').innerHTML = '<div class="flex items-center justify-center h-full text-sm text-slate-400">尚無已實現損益</div>';
        }
        
        // 總投入成本 vs 帳戶總值比較（以長條圖並列比較，獲利綠色、虧損紅色）
        const totalAccountValue = availableFunds + unrealizedMarketValue;
        const baselineCost = netInvested > 0 ? netInvested : totalInvested;
        
        drawBarChart('chart-total-value-history', [
            { label: '淨投入本金', value: Math.max(0, baselineCost), color: '#64748b' },
            { 
                label: '目前帳戶總值', 
                value: Math.max(0, totalAccountValue), 
                color: totalAccountValue >= baselineCost ? '#10b981' : '#f43f5e' 
            }
        ], {
            title: '總投入成本 vs 帳戶總值'
        });

    }, 0);
}
