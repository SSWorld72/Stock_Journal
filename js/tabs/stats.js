import { settings } from '../store.js';
import { calculateStockMetrics } from './trades.js';
import { getQuoteForCode } from '../api/twstock.js';
import { drawPieChart, drawBarChart, drawLineChart } from '../../utils/js/charts.js';

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

let currentModalTab = 'all';
let currentModalSearch = '';

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

    // 綁定個股純價差賺賠分析視窗按鈕
    const btnViewPure = document.getElementById('btn-stats-view-pure-breakdown');
    if (btnViewPure) {
        btnViewPure.onclick = () => openPureCapitalGainModal();
    }

    // 綁定關閉按鈕
    const btnCloseModal = document.getElementById('btn-close-pure-capital-modal');
    if (btnCloseModal) {
        btnCloseModal.onclick = () => closePureCapitalGainModal();
    }
    const btnCloseModalBottom = document.getElementById('btn-close-pure-capital-modal-bottom');
    if (btnCloseModalBottom) {
        btnCloseModalBottom.onclick = () => closePureCapitalGainModal();
    }

    // 綁定背景點擊關閉
    const modal = document.getElementById('modal-pure-capital-breakdown');
    if (modal) {
        modal.onclick = (e) => {
            if (e.target === modal) closePureCapitalGainModal();
        };
    }

    // 綁定 Tab 切換
    const tabBtns = document.querySelectorAll('.pure-modal-tab');
    tabBtns.forEach(btn => {
        btn.onclick = () => {
            tabBtns.forEach(b => {
                b.className = 'pure-modal-tab px-3 py-1.5 rounded-md text-slate-600 hover:text-slate-900 transition-all';
            });
            btn.className = 'pure-modal-tab px-3 py-1.5 rounded-md bg-white text-slate-800 shadow-2xs font-semibold transition-all';
            currentModalTab = btn.dataset.tab || 'all';
            renderPureCapitalGainList();
        };
    });

    // 綁定搜尋輸入
    const searchInput = document.getElementById('pure-modal-search');
    if (searchInput) {
        searchInput.oninput = (e) => {
            currentModalSearch = e.target.value;
            renderPureCapitalGainList();
        };
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
    let totalPureCapitalGainRealized = 0;
    let totalSoldDividendRevenue = 0;
    
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
        totalPureCapitalGainRealized += isFifo ? (metrics.fifo?.capitalGainRealized || 0) : (metrics.capitalGainRealized || 0);
        totalSoldDividendRevenue += (metrics.soldStockDividendRevenue || 0);
        
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
        elNetInvested.className = netInvested < 0 ? 'text-lg sm:text-xl font-bold text-emerald-600 text-right' : 'text-lg sm:text-xl font-bold text-slate-800 text-right';
    }

    // Realized PnL
    const elRealized = document.getElementById('stats-realized-pnl');
    if (elRealized) {
        elRealized.innerText = totalRealized > 0 ? `+${formatNum(totalRealized)}` : formatNum(totalRealized);
        elRealized.className = totalRealized > 0 ? 'text-lg sm:text-xl font-bold text-profit text-right' : (totalRealized < 0 ? 'text-lg sm:text-xl font-bold text-loss text-right' : 'text-lg sm:text-xl font-bold text-slate-800 text-right');
    }

    // Realized Breakdown (純價差 vs 現金股息拆解)
    const elRealizedPureVal = document.getElementById('stats-realized-pure-val');
    if (elRealizedPureVal) {
        const sign = totalPureCapitalGainRealized > 0 ? '+' : (totalPureCapitalGainRealized < 0 ? '-' : '');
        elRealizedPureVal.innerText = `${sign}$${formatNum(Math.abs(Math.round(totalPureCapitalGainRealized)))}`;
        elRealizedPureVal.className = totalPureCapitalGainRealized > 0 ? 'font-semibold text-emerald-600' : (totalPureCapitalGainRealized < 0 ? 'font-semibold text-rose-600' : 'font-semibold text-slate-700');
    }
    const elRealizedDivVal = document.getElementById('stats-realized-div-val');
    if (elRealizedDivVal) {
        elRealizedDivVal.innerText = `+$${formatNum(Math.round(totalDividend))}`;
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
            div.className = 'bg-slate-50/70 py-3 rounded-xl border border-slate-200/80 shadow-2xs hover:shadow-xs flex flex-col gap-2.5 transition-all w-[98%] mx-auto';
            
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
                <div class="flex items-center justify-between border-b border-slate-200/80 pb-2.5 px-3">
                    <span class="inline-block px-1.5 py-0.5 ${badgeColor} rounded text-[10px] font-medium border shadow-xs">${bName}</span>
                    <span class="text-xs text-slate-400 flex items-center gap-1.5">折讓率 <span class="text-emerald-600 font-bold text-lg bg-emerald-50 px-2 py-0.5 rounded border border-emerald-100">${rebatePct.toFixed(1)}%</span></span>
                </div>
                <div class="grid grid-cols-2 gap-y-2.5 text-xs pt-0.5">
                    <div class="bg-white/90 py-2.5 px-3 rounded-lg border border-slate-100 shadow-2xs w-[97%] mx-auto flex flex-col justify-between">
                        <div class="text-slate-500 font-medium text-xs mb-0.5">手續費</div>
                        <div class="font-bold text-slate-700 text-lg font-mono text-right">${formatNum(b.fee)}</div>
                    </div>
                    <div class="bg-white/90 py-2.5 px-3 rounded-lg border border-slate-100 shadow-2xs w-[97%] mx-auto flex flex-col justify-between">
                        <div class="text-slate-500 font-medium text-xs mb-0.5">手續費折讓</div>
                        <div class="font-bold ${b.rebate > 0 ? 'text-emerald-600' : 'text-slate-600'} text-lg font-mono text-right">${formatNum(b.rebate)}</div>
                    </div>
                    <div class="bg-white/90 py-2.5 px-3 rounded-lg border border-slate-100 shadow-2xs w-[97%] mx-auto flex flex-col justify-between">
                        <div class="text-slate-500 font-medium text-xs mb-0.5">交易稅</div>
                        <div class="font-bold text-slate-700 text-lg font-mono text-right">${formatNum(b.tax)}</div>
                    </div>
                    <div class="bg-white/90 py-2.5 px-3 rounded-lg border border-slate-100 shadow-2xs w-[97%] mx-auto flex flex-col justify-between">
                        <div class="text-slate-500 font-medium text-xs mb-0.5">配息總計</div>
                        <div class="font-bold ${b.dividend > 0 ? 'text-blue-600' : 'text-slate-700'} text-lg font-mono text-right">${formatNum(b.dividend)}</div>
                    </div>
                    <div class="col-span-2 bg-white py-2.5 px-3 rounded-lg border border-slate-200/90 shadow-2xs flex items-center justify-between w-[97%] mx-auto mt-2.5">
                        <div class="flex flex-col">
                            <div class="text-slate-500 font-medium text-xs">可用資金</div>
                            <div class="text-slate-400 text-[9px] mt-0.5 whitespace-nowrap">（已含 T+2 未交割款）</div>
                        </div>
                        <div class="font-bold ${b.balance >= 0 ? 'text-slate-800' : 'text-rose-600'} text-lg font-mono">${formatNum(b.balance)}</div>
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

    // 將 quotes、unrealizedMarketValue、unrealizedPnL、totalAccountValue 提升到 if 區塊外，確保後續計算與圖表能存取
    const quotes = [];
    let unrealizedMarketValue = 0;
    let unrealizedPnL = 0;
    let totalAccountValue = 0;

    // 4. Fetch quotes for open positions & dividend stocks (if needed)
    if (codesToFetch.length > 0) {
        const loadingIndicator = document.getElementById('stats-quotes-loading');

        let unrealizedCost = 0;
        
        let latestQuoteTimeStr = '';
        let maxTimeVal = 0;

        // Check if user set update frequency to manual
        const manualOnly = settings.refreshFreq === 0 || settings.refreshFreq === '0';
        const shouldFetchApi = forceRefresh || !manualOnly;
        
        // 1. 先從快取讀取報價，讓圖表能立刻顯示
        for (let code of codesToFetch) {
            let quote = null;
            if (settings.marketQuotesCache && settings.marketQuotesCache[code]) {
                quote = settings.marketQuotesCache[code];
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

        // 2. 若需要更新，在背景非同步獲取，避免阻斷 UI 繪圖
        if (shouldFetchApi && !isFetchingQuotes) {
            isFetchingQuotes = true;
            if (loadingIndicator) loadingIndicator.classList.remove('hidden');

            setTimeout(async () => {
                let updated = false;
                for (let code of codesToFetch) {
                    try {
                        const q = await getQuoteForCode(code);
                        if (q && q.price != null && q.status !== 'error') {
                            if (!settings.marketQuotesCache) settings.marketQuotesCache = {};
                            settings.marketQuotesCache[code] = q;
                            updated = true;
                        }
                    } catch(e) {
                        console.error('[統計] 獲取報價失敗:', code, e);
                    }
                }
                isFetchingQuotes = false;
                if (loadingIndicator) loadingIndicator.classList.add('hidden');

                if (updated && window.renderStatsTabFunc) {
                    // 重新渲染畫面，但不要再觸發 API 更新
                    window.renderStatsTabFunc();
                }
            }, 50);
        } else if (!isFetchingQuotes) {
            if (loadingIndicator) loadingIndicator.classList.add('hidden');
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
                elUnrealizedPnL.className = unrealizedPnL > 0 ? 'text-lg font-bold bg-profit text-right' : (unrealizedPnL < 0 ? 'text-lg font-bold bg-loss text-right' : 'text-lg font-bold text-slate-700 text-right');
            } else {
                elUnrealizedPnL.innerText = '0';
                elUnrealizedPnL.className = 'text-lg font-bold text-slate-400 text-right';
            }
        }

        totalAccountValue = availableFunds + unrealizedMarketValue;
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
            elUnrealizedPnL.className = 'text-lg font-bold text-slate-700 text-right';
        }

        totalAccountValue = availableFunds;
        setText('stats-total-account-value', formatNum(totalAccountValue));
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

    // --- 4. 歷年累積總損益與配股配息扣除對照 (全新超級卡片渲染) ---
    const totalDividendsAndBonus = totalDividend + totalStockDividendValue + totalSoldDividendRevenue;
    const totalAccountPnL = totalAccountValue - netInvested;
    const totalAccountRoi = netInvested > 0 ? ((totalAccountPnL / netInvested) * 100) : 0;
    const pureCapitalGainTotalPnL = totalAccountPnL - totalDividendsAndBonus;
    const pureCapitalGainRoi = netInvested > 0 ? ((pureCapitalGainTotalPnL / netInvested) * 100) : 0;

    // 填入頂部金額
    setText('stats-hero-account-val', formatNum(Math.round(totalAccountValue)));
    setText('stats-hero-net-invested', formatNum(Math.round(netInvested)));

    const elTotalPnlVal = document.getElementById('stats-total-pnl-val');
    const elTotalRoiBadge = document.getElementById('stats-total-roi-badge');
    if (elTotalPnlVal) {
        const sign = totalAccountPnL > 0 ? '+' : (totalAccountPnL < 0 ? '-' : '');
        elTotalPnlVal.innerText = `${sign}$${formatNum(Math.abs(Math.round(totalAccountPnL)))}`;
        elTotalPnlVal.className = totalAccountPnL > 0 ? 'text-2xl sm:text-3xl font-extrabold tracking-tight text-emerald-400' : (totalAccountPnL < 0 ? 'text-2xl sm:text-3xl font-extrabold tracking-tight text-rose-400' : 'text-2xl sm:text-3xl font-extrabold tracking-tight text-white');
    }
    if (elTotalRoiBadge) {
        const sign = totalAccountRoi > 0 ? '+' : '';
        elTotalRoiBadge.innerText = `${sign}${totalAccountRoi.toFixed(2)}%`;
        elTotalRoiBadge.className = totalAccountRoi > 0 ? 'text-xs sm:text-sm font-semibold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : (totalAccountRoi < 0 ? 'text-xs sm:text-sm font-semibold px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30' : 'text-xs sm:text-sm font-semibold px-2 py-0.5 rounded-full bg-white/10 text-slate-300');
    }

    // 欄位 A：純買賣價差損益 (扣除配股配息後)
    const elPureCapitalPnl = document.getElementById('stats-pure-capital-pnl');
    if (elPureCapitalPnl) {
        const sign = pureCapitalGainTotalPnL > 0 ? '+' : (pureCapitalGainTotalPnL < 0 ? '-' : '');
        const signRoi = pureCapitalGainRoi > 0 ? '+' : '';
        elPureCapitalPnl.innerText = `${sign}$${formatNum(Math.abs(Math.round(pureCapitalGainTotalPnL)))} (${signRoi}${pureCapitalGainRoi.toFixed(2)}%)`;
        elPureCapitalPnl.className = pureCapitalGainTotalPnL > 0 ? 'text-lg sm:text-xl font-bold tracking-tight text-emerald-400' : (pureCapitalGainTotalPnL < 0 ? 'text-lg sm:text-xl font-bold tracking-tight text-rose-400' : 'text-lg sm:text-xl font-bold tracking-tight text-white');
    }

    // 填寫純買賣價差拆解算式明細 (已實現純價差 + 庫存未實現純價差 + 手續費折讓)
    const pureUnrealized = unrealizedPnL - totalStockDividendValue;
    const signRealized = totalPureCapitalGainRealized >= 0 ? '+' : '-';
    setText('stats-hero-pure-realized', `${signRealized}$${formatNum(Math.abs(Math.round(totalPureCapitalGainRealized)))}`);
    const signUnrealized = pureUnrealized >= 0 ? '+' : '-';
    setText('stats-hero-pure-unrealized', `${signUnrealized}$${formatNum(Math.abs(Math.round(pureUnrealized)))}`);
    setText('stats-hero-pure-rebate', `+$${formatNum(Math.round(totalRebate))}`);

    // 建構全體個股之純買賣價差明細資料 (供個股賺賠榜 Modal 渲染)
    const pureStockRecords = [];
    const isFifoAccounting = settings.accountingMethod === 'fifo';

    for (let code of uniqueCodes) {
        let quote = null;
        const fetchIdx = codesToFetch.indexOf(code);
        if (fetchIdx !== -1) {
            quote = quotes[fetchIdx];
        } else if (settings.marketQuotesCache && settings.marketQuotesCache[code]) {
            quote = settings.marketQuotesCache[code];
        }

        const price = quote?.price || 0;
        const metrics = calculateStockMetrics(code, price);
        if (!metrics) continue;

        let stockName = quote?.name || '';
        if (!stockName && settings.stockNamesCache && settings.stockNamesCache[code]) {
            stockName = settings.stockNamesCache[code];
        }
        if (!stockName) stockName = code;

        const shares = isFifoAccounting ? (metrics.fifo?.shares || 0) : (metrics.shares || 0);
        const realizedPure = isFifoAccounting ? (metrics.fifo?.capitalGainRealized || 0) : (metrics.capitalGainRealized || 0);

        let unrealizedPure = 0;
        if (shares > 0) {
            const rawUnrealized = isFifoAccounting ? (metrics.fifo?.unrealized || 0) : (metrics.unrealized || 0);
            const holdingStockDivVal = (metrics.stockDividendShares || 0) * price;
            unrealizedPure = rawUnrealized - holdingStockDivVal;
        }

        const totalPure = realizedPure + unrealizedPure;
        const cashDiv = metrics.totalCashDividends || 0;
        const soldDivRev = metrics.soldStockDividendRevenue || 0;
        const holdingDivVal = (metrics.stockDividendShares || 0) * price;
        const totalDiv = cashDiv + soldDivRev + holdingDivVal;
        const totalPnLWithDiv = totalPure + totalDiv;

        pureStockRecords.push({
            code,
            name: stockName,
            shares,
            isClosed: shares === 0,
            realizedPure: Math.round(realizedPure),
            unrealizedPure: Math.round(unrealizedPure),
            totalPure: Math.round(totalPure),
            cashDiv: Math.round(cashDiv),
            soldDivRev: Math.round(soldDivRev),
            holdingDivVal: Math.round(holdingDivVal),
            totalDiv: Math.round(totalDiv),
            totalPnLWithDiv: Math.round(totalPnLWithDiv)
        });
    }

    window._pureCapitalGainData = pureStockRecords;

    // 若 Modal 目前開啟，自動同步重繪最新數據
    const pureModalEl = document.getElementById('modal-pure-capital-breakdown');
    if (pureModalEl && !pureModalEl.classList.contains('hidden')) {
        renderPureCapitalGainList();
    }

    // 欄位 B：累計配股配息總額 (扣除項目合計)
    setText('stats-dividend-total-contrib', `+$${formatNum(Math.round(totalDividendsAndBonus))}`);
    setText('stats-sub-cash-dividend', `+$${formatNum(Math.round(totalDividend))}`);
    const stockDivTotalCombined = totalStockDividendValue + totalSoldDividendRevenue;
    let stockDivDesc = `+$${formatNum(Math.round(stockDivTotalCombined))}`;
    if (totalSoldDividendRevenue > 0 && totalStockDividendValue > 0) {
        stockDivDesc += ` (庫存$${formatNum(Math.round(totalStockDividendValue))} + 已實現$${formatNum(Math.round(totalSoldDividendRevenue))})`;
    } else if (totalStockDividendValue > 0) {
        stockDivDesc += ` (庫存估值)`;
    } else if (totalSoldDividendRevenue > 0) {
        stockDivDesc += ` (已實現賣出)`;
    }
    setText('stats-sub-stock-dividend', stockDivDesc);

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
        }

        // --- 獨立計算所有交易過的股票的每月已實現損益 (包含已全部賣出的股票) ---
        const allTradedCodes = [...new Set(settings.transactions.map(t => t.code))];
        const isFifoAccounting = settings.accountingMethod === 'fifo';
        
        allTradedCodes.forEach(code => {
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
                            if (isFifoAccounting) {
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
        });

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

// --- 個股純買賣價差賺賠分析 Modal 控制與渲染 ---

export function openPureCapitalGainModal() {
    const modal = document.getElementById('modal-pure-capital-breakdown');
    if (!modal) return;
    modal.classList.remove('hidden');
    renderPureCapitalGainList();
}

export function closePureCapitalGainModal() {
    const modal = document.getElementById('modal-pure-capital-breakdown');
    if (!modal) return;
    modal.classList.add('hidden');
}

export function renderPureCapitalGainList() {
    const data = window._pureCapitalGainData || [];
    const listContainer = document.getElementById('pure-modal-stock-list');
    if (!listContainer) return;

    // 計算統計數據
    const winners = data.filter(d => d.totalPure > 0);
    const losers = data.filter(d => d.totalPure < 0);
    const winSum = winners.reduce((sum, d) => sum + d.totalPure, 0);
    const lossSum = losers.reduce((sum, d) => sum + d.totalPure, 0);
    const netTotal = winSum + lossSum;
    const totalCount = data.length;
    const winRate = totalCount > 0 ? ((winners.length / totalCount) * 100).toFixed(1) : '0.0';

    setText('pure-modal-win-count', `${winners.length} 檔`);
    setText('pure-modal-win-amount', `合計 +$${formatNum(Math.round(winSum))}`);
    setText('pure-modal-loss-count', `${losers.length} 檔`);
    setText('pure-modal-loss-amount', `合計 -$${formatNum(Math.abs(Math.round(lossSum)))}`);
    setText('pure-modal-win-rate', `${winRate}%`);
    const netSign = netTotal > 0 ? '+' : (netTotal < 0 ? '-' : '');
    setText('pure-modal-net-total', `淨價差 ${netSign}$${formatNum(Math.abs(Math.round(netTotal)))}`);

    setText('pure-tab-count-all', totalCount);
    setText('pure-tab-count-winners', winners.length);
    setText('pure-tab-count-losers', losers.length);

    // 依 Tab 篩選與排序
    let filtered = [...data];
    if (currentModalTab === 'winners') {
        filtered = filtered.filter(d => d.totalPure > 0).sort((a, b) => b.totalPure - a.totalPure);
    } else if (currentModalTab === 'losers') {
        filtered = filtered.filter(d => d.totalPure < 0).sort((a, b) => a.totalPure - b.totalPure);
    } else {
        filtered.sort((a, b) => b.totalPure - a.totalPure);
    }

    // 依搜尋關鍵字篩選
    if (currentModalSearch) {
        const q = currentModalSearch.toLowerCase().trim();
        filtered = filtered.filter(d => d.code.toLowerCase().includes(q) || d.name.toLowerCase().includes(q));
    }

    if (filtered.length === 0) {
        listContainer.innerHTML = `
            <div class="py-12 text-center text-slate-400 text-sm">
                <svg class="w-10 h-10 mx-auto mb-2 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/></svg>
                沒有找到符合條件的股票資料
            </div>
        `;
        return;
    }

    listContainer.innerHTML = '';
    filtered.forEach((item, idx) => {
        const row = document.createElement('div');
        row.className = 'py-3 px-2 sm:px-3 hover:bg-slate-50/80 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-2.5';

        const isWin = item.totalPure > 0;
        const isLoss = item.totalPure < 0;
        const pureColor = isWin ? 'text-emerald-600' : (isLoss ? 'text-rose-600' : 'text-slate-600');
        const pureSign = isWin ? '+' : (isLoss ? '-' : '');

        let statusBadge = '';
        if (item.isClosed) {
            statusBadge = '<span class="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 border border-slate-200">已出清</span>';
        } else {
            statusBadge = `<span class="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 border border-blue-200">持有中 ${formatNum(item.shares)}股</span>`;
        }

        let dividendSavedBadge = '';
        if (item.totalPure < 0 && item.totalPnLWithDiv > 0) {
            dividendSavedBadge = `<span class="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 font-medium">✨ 股息反轉獲利</span>`;
        }

        const breakdownParts = [];
        if (item.realizedPure !== 0) {
            const rSign = item.realizedPure > 0 ? '+' : '-';
            breakdownParts.push(`已實現 ${rSign}$${formatNum(Math.abs(item.realizedPure))}`);
        }
        if (item.unrealizedPure !== 0) {
            const uSign = item.unrealizedPure > 0 ? '+' : '-';
            breakdownParts.push(`庫存未實現 ${uSign}$${formatNum(Math.abs(item.unrealizedPure))}`);
        }
        const breakdownText = breakdownParts.length > 0 ? breakdownParts.join(' ｜ ') : '無價差變動';

        let divDetailStr = `+$${formatNum(item.totalDiv)}`;
        if (item.cashDiv > 0 && (item.soldDivRev + item.holdingDivVal) > 0) {
            divDetailStr += ` <span class="text-[10px] text-slate-400 font-normal">(現金$${formatNum(item.cashDiv)} + 配股$${formatNum(item.soldDivRev + item.holdingDivVal)})</span>`;
        }

        const finalPnLSign = item.totalPnLWithDiv > 0 ? '+' : (item.totalPnLWithDiv < 0 ? '-' : '');
        const finalPnLColor = item.totalPnLWithDiv > 0 ? 'text-emerald-700 bg-emerald-50 border-emerald-200' : (item.totalPnLWithDiv < 0 ? 'text-rose-700 bg-rose-50 border-rose-200' : 'text-slate-600 bg-slate-50 border-slate-200');

        row.innerHTML = `
            <div class="flex items-center gap-2.5 min-w-[160px]">
                <div class="text-xs font-mono text-slate-400 w-5 text-right font-semibold">${idx + 1}.</div>
                <div>
                    <div class="flex items-center gap-1.5 flex-wrap">
                        <span class="font-bold text-slate-800 text-sm">${item.name}</span>
                        <span class="text-xs text-slate-400 font-mono">${item.code}</span>
                        ${statusBadge}
                        ${dividendSavedBadge}
                    </div>
                    <div class="text-[10px] text-slate-400 mt-0.5">
                        ${breakdownText}
                    </div>
                </div>
            </div>

            <div class="flex items-center justify-between sm:justify-end gap-4 sm:gap-6 ml-7 sm:ml-0">
                <div class="text-right">
                    <div class="text-[10px] text-slate-400">配股配息貢獻</div>
                    <div class="text-xs font-semibold text-indigo-600 font-mono">${item.totalDiv > 0 ? divDetailStr : '<span class="text-slate-300 font-normal">無</span>'}</div>
                </div>

                <div class="text-right min-w-[110px]">
                    <div class="text-[10px] text-slate-400">純買賣價差</div>
                    <div class="text-base font-extrabold font-mono ${pureColor}">
                        ${pureSign}$${formatNum(Math.abs(item.totalPure))}
                    </div>
                    <div class="text-[10px] mt-0.5">
                        <span class="inline-block px-1.5 py-0.2 rounded border text-[9px] font-semibold ${finalPnLColor}">
                            含息結算: ${finalPnLSign}$${formatNum(Math.abs(item.totalPnLWithDiv))}
                        </span>
                    </div>
                </div>
            </div>
        `;

        listContainer.appendChild(row);
    });
}
