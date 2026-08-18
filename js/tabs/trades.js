import { settings, saveSettings } from '../store.js';
import { getQuoteForCode } from '../api/twstock.js';

let currentSortColumn = 'date';
let currentSortDirection = 'desc';

function showToast(msg) {
    const toast = document.createElement('div');
    toast.className = 'fixed bottom-5 left-1/2 -translate-x-1/2 bg-slate-800/90 text-white px-5 py-2.5 rounded-full shadow-lg z-[200] text-sm transition-opacity duration-300';
    toast.innerText = msg;
    document.body.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 2500);
}
let selectedTradeIds = new Set();

window.getHoldingsAtDate = (code, dateStr, stopId = null, allTrades = null) => {
    let shares = 0;
    const targetDate = new Date(dateStr);
    const trades = allTrades || (settings.transactions || []);
    // Ensure chronological order
    const sortedTrades = [...trades].sort((a, b) => new Date(a.date) - new Date(b.date));

    for (let t of sortedTrades) {
        if (t.id === stopId) break;
        if (t.code !== code) continue;
        if (new Date(t.date) >= targetDate) continue;

        if (t.category === 'trade') {
            if (t.type === 'buy') shares += (t.quantity || 0);
            if (t.type === 'sell') shares -= (t.quantity || 0);
        } else if (t.category === 'dividend') {
            if (t.type === 'stock') shares += (t.amount || 0);
            else if (t.type === 'both') shares += (t.stockAmount || 0);
        } else if (t.category === 'capital_change') {
            if (t.type === 'reduction') shares = Math.floor(shares * (t.ratio || 1));
            if (t.type === 'split') shares = Math.floor(shares * (t.splitRatio || 1));
        }
    }
    return Math.max(0, shares);
};

export function calculateStockMetrics(code, currentPrice = 0) {
    const trades = settings.transactions || [];
    const sortedTrades = [...trades].sort((a, b) => new Date(a.date) - new Date(b.date));

    // Standard Method
    let shares = 0;
    let totalCost = 0;
    let realized = 0;
    let stockDividendShares = 0;
    let soldStockDividendShares = 0;

    // FIFO Method
    let buyLots = []; // [{ shares, totalCost }]
    let fifoRealized = 0;

    for (let t of sortedTrades) {
        if (String(t.code).trim() !== String(code).trim()) continue;

        if (t.category === 'trade' || !t.category) {
            if (t.type === 'buy') {
                const q = t.quantity || 0;
                const cost = t.total || 0;
                shares += q;
                totalCost += cost;

                if (q > 0) {
                    buyLots.push({ shares: q, totalCost: cost });
                }
            } else if (t.type === 'sell') {
                const q = t.quantity || 0;
                const revenue = t.total || 0;

                if (q > 0) {
                    // Standard
                    if (shares > 0) {
                        if (stockDividendShares > 0) {
                            const soldDividend = q * (stockDividendShares / shares);
                            stockDividendShares -= soldDividend;
                            soldStockDividendShares += soldDividend;
                            if (stockDividendShares < 0) stockDividendShares = 0;
                        }

                        const avgCostPerShare = totalCost / shares;
                        const costOfSold = q * avgCostPerShare;
                        realized += (revenue - costOfSold);
                        shares -= q;
                        if (shares < 0) shares = 0;
                        totalCost = shares * avgCostPerShare;
                    }

                    // FIFO
                    let remainingToSell = q;
                    let costOfSoldFifo = 0;

                    while (remainingToSell > 0 && buyLots.length > 0) {
                        let lot = buyLots[0];
                        if (lot.shares <= remainingToSell) {
                            costOfSoldFifo += lot.totalCost;
                            remainingToSell -= lot.shares;
                            buyLots.shift();
                        } else {
                            const ratio = remainingToSell / lot.shares;
                            const costPortion = lot.totalCost * ratio;
                            costOfSoldFifo += costPortion;
                            lot.shares -= remainingToSell;
                            lot.totalCost -= costPortion;
                            remainingToSell = 0;
                        }
                    }
                    fifoRealized += (revenue - costOfSoldFifo);
                }
            }
        } else if (t.category === 'dividend') {
            if (t.type === 'cash') {
                realized += (t.total || 0);
                fifoRealized += (t.total || 0);
            } else if (t.type === 'stock') {
                const newShares = t.amount || 0;
                shares += newShares;
                stockDividendShares += newShares;

                const currentFifoShares = buyLots.reduce((sum, lot) => sum + lot.shares, 0);
                if (currentFifoShares > 0 && newShares > 0) {
                    const ratio = (currentFifoShares + newShares) / currentFifoShares;
                    buyLots.forEach(lot => {
                        lot.shares *= ratio;
                    });
                }
            } else if (t.type === 'both') {
                realized += (t.total || 0);
                fifoRealized += (t.total || 0);
                const newShares = t.stockAmount || 0;
                shares += newShares;
                stockDividendShares += newShares;

                const currentFifoShares = buyLots.reduce((sum, lot) => sum + lot.shares, 0);
                if (currentFifoShares > 0 && newShares > 0) {
                    const ratio = (currentFifoShares + newShares) / currentFifoShares;
                    buyLots.forEach(lot => {
                        lot.shares *= ratio;
                    });
                }
            }
        } else if (t.category === 'capital_change') {
            if (t.type === 'reduction') {
                const ratio = t.ratio || 1;
                const returnedCash = t.cash || t.total || 0;

                // Standard
                shares = Math.floor(shares * ratio);
                stockDividendShares = Math.floor(stockDividendShares * ratio);
                totalCost -= returnedCash;
                if (totalCost < 0) totalCost = 0;

                // FIFO
                const currentFifoTotalCost = buyLots.reduce((sum, lot) => sum + lot.totalCost, 0);
                buyLots.forEach(lot => {
                    lot.shares = Math.floor(lot.shares * ratio);
                    if (currentFifoTotalCost > 0) {
                        const costRatio = lot.totalCost / currentFifoTotalCost;
                        lot.totalCost = Math.max(0, lot.totalCost - (returnedCash * costRatio));
                    }
                });
            } else if (t.type === 'split') {
                const ratio = t.splitRatio || 1;
                shares = Math.floor(shares * ratio);
                buyLots.forEach(lot => {
                    lot.shares = Math.floor(lot.shares * ratio);
                });
            }
        }
    }

    if (shares === 0) totalCost = 0;
    const avgPrice = shares > 0 ? totalCost / shares : 0;
    const marketValue = shares * currentPrice;
    const unrealized = marketValue - totalCost;

    // FIFO Summaries
    let fifoShares = buyLots.reduce((sum, lot) => sum + lot.shares, 0);
    let fifoTotalCost = buyLots.reduce((sum, lot) => sum + lot.totalCost, 0);
    if (fifoShares === 0) fifoTotalCost = 0;
    const fifoAvgPrice = fifoShares > 0 ? fifoTotalCost / fifoShares : 0;
    const fifoMarketValue = fifoShares * currentPrice;
    const fifoUnrealized = fifoMarketValue - fifoTotalCost;

    // Calculate Break Even (Standard and FIFO)
    let breakEvenPrice = 0;
    let fifoBreakEvenPrice = 0;

    if (shares > 0 || fifoShares > 0) {
        const isEtf = code.startsWith('00') && code.length >= 4;
        const taxRate = isEtf ? 0.001 : 0.003;

        let feeRate = (settings.feeRate !== undefined ? settings.feeRate : 0.1425) / 100;
        let discountRate = 1.0;

        const lastTrade = [...sortedTrades].reverse().find(t => t.code === code && t.category === 'trade' && t.brokerId);
        let brokerId = lastTrade ? lastTrade.brokerId : null;
        if (!brokerId && settings.brokers && settings.brokers.length > 0) brokerId = settings.brokers[0].id;

        if (brokerId && settings.brokers) {
            const broker = settings.brokers.find(b => b.id === brokerId);
            if (broker) {
                discountRate = (broker.discount || 10) / 10;
            }
        }

        const netMultiplier = 1 - (feeRate * discountRate) - taxRate;
        if (shares > 0) breakEvenPrice = avgPrice / netMultiplier;
        if (fifoShares > 0) fifoBreakEvenPrice = fifoAvgPrice / netMultiplier;
    }

    return {
        shares,
        totalCost,
        avgPrice,
        marketValue,
        unrealized,
        breakEvenPrice,
        realized,
        stockDividendShares,
        soldStockDividendShares,
        fifo: {
            shares: fifoShares,
            totalCost: fifoTotalCost,
            avgPrice: fifoAvgPrice,
            unrealized: fifoUnrealized,
            breakEvenPrice: fifoBreakEvenPrice,
            realized: fifoRealized
        }
    };
}

export function initGlobalTradeModal() {
    const modalAdd = document.getElementById('modal-trade-add');
    if (!modalAdd) return;

    const modalTitle = document.getElementById('modal-trade-title');
    const btnClose = document.getElementById('btn-trade-close');
    const btnSave = document.getElementById('btn-trade-save');
    const btnAddAnother = document.getElementById('btn-trade-add-another');

    const inputCode = document.getElementById('trade-code');
    const labelCode = document.getElementById('label-trade-code');
    const formGroupCode = document.getElementById('form-group-code');
    const labelStockName = document.getElementById('trade-stock-name');
    const inputDate = document.getElementById('trade-date');
    const inputNote = document.getElementById('trade-note');
    const selectBroker = document.getElementById('trade-broker');

    const tradeTypeBtns = document.querySelectorAll('.trade-type-btn');
    const stockTypeBtns = document.querySelectorAll('.stock-type-btn');
    const marketTypeBtns = document.querySelectorAll('.market-type-btn');
    const dayTradingBtn = document.getElementById('trade-day-trading');
    const dayTradingThumb = document.getElementById('trade-day-trading-thumb');

    const formGroupStockType = document.getElementById('form-group-stock-type');
    const formGroupMarketType = document.getElementById('form-group-market-type');
    const formGroupDayTrading = document.getElementById('form-group-day-trading');
    const formGroupFeeTax = document.getElementById('form-group-fee-tax');

    // Dynamic fields
    const field1 = {
        group: document.getElementById('field-group-1'),
        label: document.getElementById('label-field-1'),
        input: document.getElementById('input-field-1')
    };
    const field2 = {
        group: document.getElementById('field-group-2'),
        label: document.getElementById('label-field-2'),
        input: document.getElementById('input-field-2')
    };
    const field3 = {
        group: document.getElementById('field-group-3'),
        label: document.getElementById('label-field-3'),
        input: document.getElementById('input-field-3')
    };
    const field4 = {
        group: document.getElementById('field-group-4'),
        label: document.getElementById('label-field-4'),
        input: document.getElementById('input-field-4')
    };
    const field5 = {
        group: document.getElementById('field-group-5'),
        label: document.getElementById('label-field-5'),
        input: document.getElementById('input-field-5')
    };
    const field6 = {
        group: document.getElementById('field-group-6'),
        label: document.getElementById('label-field-6'),
        input: document.getElementById('input-field-6')
    };

    const inputFee = document.getElementById('trade-fee');
    const inputTax = document.getElementById('trade-tax');
    const containerTax = document.getElementById('container-trade-tax');

    const feeHint = document.getElementById('trade-fee-hint');
    const taxHint = document.getElementById('trade-tax-hint');
    const labelTaxTop = document.getElementById('label-trade-tax-top');
    const formGroupTotal = document.getElementById('form-group-total');
    const labelTotalAmount = document.getElementById('trade-total-amount');
    const labelFeeTax = document.getElementById('label-fee-tax');

    let currentTradeType = 'buy';
    let currentStockType = 'regular';
    let currentMarketType = 'regular';
    let isDayTrading = false;
    let editModeId = null;
    let userManuallyOverrodeType = false;
    let userManuallyOverrodeMarket = false;

    // --- State Management ---
    const setTradeType = (val) => {
        currentTradeType = val;
        tradeTypeBtns.forEach(btn => {
            if (btn.dataset.value === val) {
                btn.className = "trade-type-btn px-4 py-1.5 rounded-lg border text-sm transition-colors bg-blue-600 text-white border-blue-600 font-medium";
            } else {
                btn.className = "trade-type-btn px-4 py-1.5 rounded-lg border text-sm transition-colors bg-white text-slate-700 border-slate-200 hover:border-slate-300 font-medium";
            }
        });
        updateFormUI();
    };

    const setStockType = (val) => {
        currentStockType = val;
        stockTypeBtns.forEach(btn => {
            if (btn.dataset.value === val) {
                btn.className = "stock-type-btn px-4 py-1.5 rounded-lg border text-sm transition-colors bg-blue-600 text-white border-blue-600 font-medium";
            } else {
                btn.className = "stock-type-btn px-4 py-1.5 rounded-lg border text-sm transition-colors bg-white text-slate-700 border-slate-200 hover:border-slate-300 font-medium";
            }
        });
        updateCalculations();
    };

    const setMarketType = (val) => {
        currentMarketType = val;
        marketTypeBtns.forEach(btn => {
            if (btn.dataset.value === val) {
                btn.className = "market-type-btn px-4 py-1.5 rounded-lg border text-sm transition-colors bg-blue-600 text-white border-blue-600 font-medium";
            } else {
                btn.className = "market-type-btn px-4 py-1.5 rounded-lg border text-sm transition-colors bg-white text-slate-700 border-slate-200 hover:border-slate-300 font-medium";
            }
        });
        updateCalculations();
    };

    const setDayTrading = (val) => {
        isDayTrading = val;
        if (isDayTrading) {
            dayTradingBtn.dataset.active = "true";
            dayTradingBtn.classList.replace('bg-slate-200', 'bg-blue-600');
            dayTradingThumb.classList.replace('translate-x-0.5', 'translate-x-5');
        } else {
            dayTradingBtn.dataset.active = "false";
            dayTradingBtn.classList.replace('bg-blue-600', 'bg-slate-200');
            dayTradingThumb.classList.replace('translate-x-5', 'translate-x-0.5');
        }
        updateCalculations();
    };

    tradeTypeBtns.forEach(btn => btn.addEventListener('click', () => setTradeType(btn.dataset.value)));
    stockTypeBtns.forEach(btn => btn.addEventListener('click', () => {
        userManuallyOverrodeType = true;
        setStockType(btn.dataset.value);
    }));
    marketTypeBtns.forEach(btn => btn.addEventListener('click', () => {
        userManuallyOverrodeMarket = true;
        setMarketType(btn.dataset.value);
    }));
    dayTradingBtn.addEventListener('click', () => setDayTrading(!isDayTrading));

    const hide = (el) => {
        if (!el) return;
        el.classList.add('hidden');
        if (el.id === 'btn-field-2-minus' && field2.input) {
            field2.input.classList.remove('pl-10');
        }
    };
    const show = (el) => {
        if (!el) return;
        el.classList.remove('hidden');
        if (el.id === 'btn-field-2-minus' && field2.input) {
            field2.input.classList.add('pl-10');
        }
    };

    const updateFormUI = () => {
        // Reset dynamic fields visibility
        hide(field1.group); hide(field2.group); hide(field3.group); hide(field4.group);
        if (field5 && field5.group) hide(field5.group);
        if (field6 && field6.group) hide(field6.group);
        hide(field2.minusBtn);
        hide(formGroupStockType);
        if (formGroupMarketType) hide(formGroupMarketType);
        hide(formGroupDayTrading);
        hide(formGroupFeeTax);
        if (formGroupTotal) hide(formGroupTotal);
        hide(containerTax);
        show(formGroupCode);

        labelCode.innerText = '股票';

        const dynamicContainer = document.getElementById('dynamic-fields-container');
        const brokerGroup = document.getElementById('form-group-broker');

        if (currentTradeType.startsWith('dividend')) {
            dynamicContainer.classList.remove('space-y-6', 'grid-cols-1');
            dynamicContainer.classList.add('grid', 'grid-cols-2', 'gap-x-4', 'gap-y-6');

            // Reorder for 2-column layout
            dynamicContainer.appendChild(brokerGroup);
            dynamicContainer.appendChild(field2.group);
            dynamicContainer.appendChild(field1.group);
            dynamicContainer.appendChild(field4.group);
            if (field5) dynamicContainer.appendChild(field5.group);
            if (field6) dynamicContainer.appendChild(field6.group);
        } else {
            dynamicContainer.classList.remove('space-y-6', 'grid-cols-1');
            dynamicContainer.classList.add('grid', 'grid-cols-2', 'gap-x-6', 'gap-y-6');

            // 將 brokerGroup 放回 row-broker-day-trading 中（如果之前被配息移到了 dynamicContainer）
            const brokerDayTradingRow = document.getElementById('row-broker-day-trading');
            const dayTradingGroup = document.getElementById('form-group-day-trading');
            if (brokerDayTradingRow && dayTradingGroup && brokerGroup.parentElement !== brokerDayTradingRow) {
                brokerDayTradingRow.insertBefore(brokerGroup, dayTradingGroup);
            }

            dynamicContainer.appendChild(field1.group);
            dynamicContainer.appendChild(field2.group);
            dynamicContainer.appendChild(field3.group);
            dynamicContainer.appendChild(field4.group);
            if (field5) dynamicContainer.appendChild(field5.group);
            if (field6) dynamicContainer.appendChild(field6.group);
        }

        if (currentTradeType === 'buy' || currentTradeType === 'sell') {
            show(formGroupStockType);
            if (formGroupMarketType) show(formGroupMarketType);
            show(formGroupFeeTax);
            if (labelFeeTax) labelFeeTax.innerText = '手續費／證交稅';
            const labelFeeTop = document.getElementById('label-trade-fee-top');
            if (labelFeeTop) labelFeeTop.innerText = '手續費';
            if (formGroupTotal) show(formGroupTotal);

            if (currentTradeType === 'sell') {
                show(formGroupDayTrading);
                show(containerTax);
                labelTaxTop.innerText = '證交稅';
                inputTax.disabled = false;
                inputTax.classList.remove('bg-slate-50', 'text-slate-400');
            } else {
                hide(containerTax);
            }

            show(field1.group);
            field1.label.innerText = '成交單價';
            field1.input.placeholder = '例如 2290';

            show(field2.group);
            field2.label.innerText = '成交股數';
            field2.input.placeholder = '例如 1000';

        } else if (currentTradeType === 'dividend_cash') {
            show(formGroupFeeTax);
            if (labelFeeTax) labelFeeTax.innerText = '匯費 / 健保補充保費';

            const labelFeeTop = document.getElementById('label-trade-fee-top');
            if (labelFeeTop) labelFeeTop.innerText = '匯費';
            if (feeHint) feeHint.innerText = '通常為 10 元';

            show(containerTax);
            labelTaxTop.innerText = '健保補充保費';
            inputTax.disabled = false;
            inputTax.classList.remove('bg-slate-50', 'text-slate-400');
            if (taxHint) taxHint.innerText = '單筆超兩萬會扣 2.11%';

            show(field1.group);
            field1.label.innerText = '每股股息（可略過）';
            field1.input.placeholder = '例如 4';

            show(field2.group);
            field2.label.innerText = '除息股數（可略過）';
            field2.input.placeholder = '留白將自動計算';

            show(field4.group);
            field4.label.innerText = '配發金額';
            field4.input.placeholder = '留白將自動計算';

        } else if (currentTradeType === 'dividend_stock') {
            // 配股通常沒有匯費，二代健保補充保費也會另外開單補繳，不直接從帳戶扣除，所以隱藏此欄位
            hide(formGroupFeeTax);
            hide(containerTax);

            show(field1.group);
            field1.label.innerText = '每股股利（可略過）';
            field1.input.placeholder = '例如 1';

            show(field2.group);
            field2.label.innerText = '除權股數（可略過）';
            field2.input.placeholder = '留白將自動計算';

            show(field4.group);
            field4.label.innerText = '配發股數';
            field4.input.placeholder = '留白將自動計算';

        } else if (currentTradeType === 'dividend_both') {
            show(formGroupFeeTax);
            if (labelFeeTax) labelFeeTax.innerText = '匯費 / 健保補充保費';

            const labelFeeTop = document.getElementById('label-trade-fee-top');
            if (labelFeeTop) labelFeeTop.innerText = '匯費';
            if (feeHint) feeHint.innerText = '通常為 10 元';

            show(containerTax);
            labelTaxTop.innerText = '健保補充保費';
            inputTax.disabled = false;
            inputTax.classList.remove('bg-slate-50', 'text-slate-400');
            let threshold = settings.nhiThreshold !== undefined ? settings.nhiThreshold : 20000;
            let rate = settings.nhiTaxRate !== undefined ? settings.nhiTaxRate : 2.11;
            if (taxHint) taxHint.innerText = `單筆超${threshold}會扣 ${rate}%`;

            show(field1.group);
            field1.label.innerText = '每股股息（可略過）';
            field1.input.placeholder = '例如 4';
            field1.label.innerText = '每股股息';
            field1.input.placeholder = '例如 4';

            show(field2.group);
            field2.label.innerText = '除權息股數';
            field2.input.placeholder = '留白將自動計算';

            show(field4.group);
            field4.label.innerText = '配發金額';
            field4.input.placeholder = '留白將自動計算';

            if (field5) {
                show(field5.group);
                field5.label.innerText = '每股股利';
                field5.input.placeholder = '例如 0.5';
            }
            if (field6) {
                show(field6.group);
                field6.label.innerText = '配發股數';
                field6.input.placeholder = '留白將自動計算';
            }

        } else if (currentTradeType === 'capital_reduction') {
            show(field1.group);
            field1.label.innerText = '減資後剩餘比例';
            field1.input.placeholder = '例如 0.6';

            show(field2.group);
            field2.label.innerText = '原持股數（自動帶入）';
            field2.input.placeholder = '例如 1000';

            show(field3.group);
            field3.label.innerText = '新持股數';
            field3.input.placeholder = '留白將自動計算';

            show(field4.group);
            field4.label.innerText = '退還股款';
            field4.input.placeholder = '留白將自動計算';

        } else if (currentTradeType === 'capital_split') {
            show(field1.group);
            field1.label.innerText = '每股分拆為';
            field1.input.placeholder = '例如 4';

            show(field2.group);
            field2.label.innerText = '原持股數（自動帶入）';
            field2.input.placeholder = '例如 1000';

            show(field3.group);
            field3.label.innerText = '新持股數';
            field3.input.placeholder = '留白將自動計算';

        } else if (currentTradeType === 'account_deposit' || currentTradeType === 'account_withdraw') {
            hide(formGroupCode);
            show(field1.group);
            field1.label.innerText = '金額（元）';
            field1.input.placeholder = '例如 50000';

        } else if (currentTradeType === 'fee_rebate') {
            labelCode.innerText = '股票（選填）';
            show(field1.group);
            field1.label.innerText = '折讓金額（元）';
            field1.input.placeholder = '例如 100';
        }

        updateCalculations();
    };

    // Auto calculate fee and tax only for buy/sell
    const updateCalculations = () => {
        const code = inputCode.value.trim().toUpperCase();

        if (currentTradeType === 'dividend_cash' || currentTradeType === 'dividend_stock' || currentTradeType === 'dividend_both') {
            if (code) {
                let calculatedShares = window.getHoldingsAtDate ? window.getHoldingsAtDate(code, inputDate.value, editModeId) : 0;
                if (calculatedShares > 0) {
                    field2.input.placeholder = `自動計算: ${calculatedShares}`;
                } else {
                    field2.input.placeholder = '留白將自動計算';
                }

                let userShares = parseInt(field2.input.value);
                let finalShares = isNaN(userShares) ? calculatedShares : userShares;

                let dps = parseFloat(field1.input.value) || 0;
                let sdps = field5 ? parseFloat(field5.input.value) || 0 : 0;
                let cashAmt = 0;
                let stockAmt = 0;

                if (finalShares > 0) {
                    if (currentTradeType === 'dividend_cash' || currentTradeType === 'dividend_both') {
                        if (dps > 0) {
                            cashAmt = Math.floor(finalShares * dps);
                            field4.input.placeholder = `自動計算: ${cashAmt}`;
                        } else {
                            field4.input.placeholder = '留白將自動計算';
                        }
                    }
                    if (currentTradeType === 'dividend_stock' || currentTradeType === 'dividend_both') {
                        let currentSdps = currentTradeType === 'dividend_stock' ? dps : sdps;
                        if (currentSdps > 0) {
                            let ratio = currentSdps < 10 ? (currentSdps / 10) : currentSdps;
                            stockAmt = Math.floor(finalShares * ratio);
                            if (currentTradeType === 'dividend_stock') {
                                field4.input.placeholder = `自動計算: ${stockAmt}`;
                            } else if (field6) {
                                field6.input.placeholder = `自動計算: ${stockAmt}`;
                            }
                        } else {
                            if (currentTradeType === 'dividend_stock') {
                                field4.input.placeholder = '留白將自動計算';
                            } else if (field6) {
                                field6.input.placeholder = '留白將自動計算';
                            }
                        }
                    }
                } else {
                    field4.input.placeholder = '留白將自動計算';
                    if (field6) field6.input.placeholder = '留白將自動計算';
                }

                // Calculate NHI tax
                let actualCash = parseFloat(field4.input.value);
                if (isNaN(actualCash)) actualCash = cashAmt;

                let actualStock = 0;
                if (currentTradeType === 'dividend_stock') {
                    actualStock = parseFloat(field4.input.value);
                } else if (currentTradeType === 'dividend_both' && field6) {
                    actualStock = parseFloat(field6.input.value);
                }
                if (isNaN(actualStock)) actualStock = stockAmt;

                let threshold = settings.nhiThreshold !== undefined ? settings.nhiThreshold : 20000;
                let rate = settings.nhiTaxRate !== undefined ? settings.nhiTaxRate : 2.11;

                // 健保股利計算基礎：現金股利 + (股票股利股數 * 10)
                let totalDividendForNHI = actualCash + (actualStock * 10);
                if (totalDividendForNHI >= threshold) {
                    inputTax.value = Math.round(totalDividendForNHI * (rate / 100));
                } else {
                    inputTax.value = '';
                }
            }
            return;
        }

        if (currentTradeType !== 'buy' && currentTradeType !== 'sell') return;

        let price = parseFloat(field1.input.value) || 0;
        let qty = parseInt(field2.input.value) || 0;
        const brokerId = parseInt(selectBroker.value) || 0;
        // 交割股款：避免小數點運算誤差 (例如 68.1 * 100 = 6809.999...)
        let amount = Math.round(price * qty);

        // Auto-detect ETF
        if (code.startsWith('00') && code.length >= 4 && !userManuallyOverrodeType && currentStockType === 'regular') {
            setStockType('etf');
        }
        // Auto-detect Odd Lot
        if (!userManuallyOverrodeMarket) {
            if (qty > 0 && qty % 1000 !== 0 && currentMarketType === 'regular') {
                setMarketType('oddLot');
            } else if (qty > 0 && qty % 1000 === 0 && currentMarketType === 'oddLot') {
                setMarketType('regular');
            }
        }

        let isEtf = currentStockType === 'etf';
        let isOddLot = currentMarketType === 'oddLot';

        let feeRate = 0.1425;
        let discount = 10;
        let minFee = isOddLot ? 1 : 20;

        let taxRate = settings.taxRate !== undefined ? settings.taxRate : 0.3;
        let etfTaxRate = settings.etfTaxRate !== undefined ? settings.etfTaxRate : 0.1;
        let dayTradeTaxRate = settings.dayTradeTaxRate !== undefined ? settings.dayTradeTaxRate : 0.15;
        let dayTradeEtfTaxRate = settings.dayTradeEtfTaxRate !== undefined ? settings.dayTradeEtfTaxRate : 0.05;

        if (settings.brokers) {
            const broker = settings.brokers.find(b => b.id === brokerId);
            if (broker) {
                feeRate = broker.feeRate || 0.1425;
                discount = broker.discount || 10;
                minFee = isOddLot ? (broker.minOddFee || 1) : (broker.minFee || 20);
            }
        }

        let rawFee = amount * (feeRate / 100);
        let discountedFee = rawFee * (discount / 10);
        // 券商手續費通常為無條件捨去
        let finalFee = amount > 0 ? Math.max(Math.floor(discountedFee), minFee) : 0;

        let feeHintText = `預設 ${feeRate}%`;
        if (discount < 10) feeHintText += ` (折讓${discount}折)`;
        feeHintText += ` 最低$${minFee}`;
        if (feeHint) feeHint.innerText = feeHintText;

        let actualTaxRate = taxRate;
        let taxHintText = `預設 ${taxRate}%`;

        if (isDayTrading && isEtf) {
            actualTaxRate = dayTradeEtfTaxRate;
            taxHintText = `當沖ETF ${actualTaxRate}%`;
        } else if (isDayTrading) {
            actualTaxRate = dayTradeTaxRate;
            taxHintText = `當沖 ${actualTaxRate}%`;
        } else if (isEtf) {
            actualTaxRate = etfTaxRate;
            taxHintText = `ETF ${actualTaxRate}%`;
        }

        if (taxHint) taxHint.innerText = taxHintText;

        // 證券交易稅：元以下無條件捨去，不足 1 元以 1 元計收
        let finalTax = Math.floor(amount * (actualTaxRate / 100));
        if (finalTax === 0 && amount > 0 && currentTradeType === 'sell') finalTax = 1;

        if (amount > 0) {
            inputFee.value = finalFee;
            if (currentTradeType === 'sell') {
                inputTax.value = finalTax;
            } else {
                inputTax.value = '';
                inputTax.placeholder = finalTax;
            }
        } else {
            inputFee.value = '';
            inputTax.value = '';
            inputTax.placeholder = '';
        }

        updateTotalAmount();
    };

    const updateTotalAmount = () => {
        let price = parseFloat(field1.input.value) || 0;
        let qty = parseInt(field2.input.value) || 0;
        let amount = Math.round(price * qty);

        let userFee = parseInt(inputFee.value) || 0;
        let userTax = parseInt(inputTax.value) || 0;
        let total = 0;
        let formulaHtml = '';

        if (currentTradeType === 'buy') {
            total = amount + userFee;
            if (qty > 0) formulaHtml = `${price} &times; ${qty.toLocaleString()} + ${userFee.toLocaleString()} = ${total.toLocaleString()}`;
        } else if (currentTradeType === 'sell') {
            total = amount - userFee - userTax;
            if (qty > 0) formulaHtml = `${price} &times; ${qty.toLocaleString()} - ${userFee.toLocaleString()} - ${userTax.toLocaleString()} = ${total.toLocaleString()}`;
        }

        if (labelTotalAmount) {
            let colorClass = 'text-blue-600';
            if (total > 0) {
                if (currentTradeType === 'buy') colorClass = 'text-red-600';
                else colorClass = 'text-green-600';
            }

            labelTotalAmount.innerText = amount > 0 ? total.toLocaleString() : '0';
            labelTotalAmount.className = `text-3xl font-bold ${colorClass}`;
        }

        const labelTotalMath = document.getElementById('trade-total-math');
        if (labelTotalMath) {
            labelTotalMath.innerHTML = formulaHtml;
        }
    };

    [field1.input, field2.input, selectBroker].forEach(el => {
        if (el) el.addEventListener('input', updateCalculations);
    });
    if (field4 && field4.input) field4.input.addEventListener('input', updateCalculations);
    if (field5 && field5.input) field5.input.addEventListener('input', updateCalculations);
    if (field6 && field6.input) field6.input.addEventListener('input', updateCalculations);

    [inputFee, inputTax].forEach(el => {
        if (el) el.addEventListener('input', updateTotalAmount);
    });

    // Auto detect stock type based on code or quantity
    const autoDetectStockType = () => {
        if (currentTradeType !== 'buy' && currentTradeType !== 'sell') return;
        if (userManuallyOverrodeType) {
            updateCalculations();
            return;
        }

        const code = inputCode.value.trim();

        if (code.startsWith('00') && code.length >= 4) {
            setStockType('etf');
        } else {
            setStockType('regular');
        }
    };

    if (inputCode) {
        inputCode.addEventListener('input', autoDetectStockType);
        inputCode.addEventListener('blur', async () => {
            const code = inputCode.value.trim().toUpperCase();
            if (!code || !labelStockName) {
                if (labelStockName) labelStockName.innerText = '—';
                return;
            }

            // Check cache first
            if (settings.stockNamesCache && settings.stockNamesCache[code]) {
                labelStockName.innerText = settings.stockNamesCache[code];
                return;
            }

            labelStockName.innerText = '查詢中...';
            try {
                const quote = await getQuoteForCode(code);
                if (quote && quote.name) {
                    labelStockName.innerText = quote.name;
                    if (!settings.stockNamesCache) settings.stockNamesCache = {};
                    settings.stockNamesCache[code] = quote.name;
                    saveSettings();
                } else {
                    labelStockName.innerText = '未知';
                }
            } catch (err) {
                labelStockName.innerText = '—';
            }
        });
    }
    if (field2.input) {
        field2.input.addEventListener('input', () => {
            autoDetectStockType();
            field1.input.dispatchEvent(new Event('input')); // trigger calculations for capital reduction/split
        });
    }

    // Auto calculate remaining shares / new shares
    field1.input.addEventListener('input', () => {
        if (currentTradeType === 'capital_reduction') {
            const ratio = parseFloat(field1.input.value) || 0;
            const original = parseInt(field2.input.value) || 0;
            if (field3.input) field3.input.placeholder = `自動計算: ${original > 0 ? Math.floor(original * ratio) : 0}`;
        } else if (currentTradeType === 'capital_split') {
            const split = parseFloat(field1.input.value) || 0;
            const original = parseInt(field2.input.value) || 0;
            if (field3.input) field3.input.placeholder = `自動計算: ${original > 0 ? Math.floor(original * split) : 0}`;
        }
    });

    field2.input.addEventListener('input', () => {
        field1.input.dispatchEvent(new Event('input')); // trigger the above calculation
    });

    window.openTradeModal = (defaultCode = '', txId = null) => {
        populateBrokers();
        userManuallyOverrodeType = false;
        userManuallyOverrodeMarket = false;

        if (txId) {
            editModeId = txId;
            modalTitle.innerText = '修改交易紀錄';
            hide(btnAddAnother);

            const tx = (settings.transactions || []).find(t => String(t.id) === String(txId));
            if (tx) {
                inputCode.value = tx.code || '';
                inputDate.value = (tx.date || '').replace(/\//g, '-');
                inputNote.value = tx.note || '';

                // Map legacy category/type to new trade type
                let mappedType = 'buy';
                if (tx.category === 'trade' || !tx.category) mappedType = tx.type; // 'buy' or 'sell'
                else if (tx.category === 'dividend') {
                    if (tx.type === 'both') mappedType = 'dividend_both';
                    else mappedType = tx.type === 'cash' ? 'dividend_cash' : 'dividend_stock';
                }
                else if (tx.category === 'capital_change') mappedType = tx.type === 'reduction' ? 'capital_reduction' : 'capital_split';
                else if (tx.category === 'account') mappedType = tx.type === 'deposit' ? 'account_deposit' : 'account_withdraw';
                else if (tx.category === 'fee_rebate') mappedType = 'fee_rebate';

                setTradeType(mappedType);
                setStockType(tx.stockType === 'etf' ? 'etf' : 'regular');

                let isTxOddLot = tx.isOddLot;
                if (isTxOddLot === undefined) {
                    isTxOddLot = tx.stockType === 'oddLot' || (tx.quantity > 0 && tx.quantity % 1000 !== 0);
                }
                setMarketType(isTxOddLot ? 'oddLot' : 'regular');
                setDayTrading(tx.dayTrading || false);

                if (mappedType === 'buy' || mappedType === 'sell') {
                    field1.input.value = tx.price || '';
                    field2.input.value = tx.quantity || '';
                    inputFee.value = tx.fee !== undefined ? tx.fee : '';
                    inputTax.value = tx.tax !== undefined ? tx.tax : '';
                    selectBroker.value = tx.brokerId || '0';
                } else if (mappedType === 'dividend_cash' || mappedType === 'dividend_stock' || mappedType === 'dividend_both') {
                    field1.input.value = tx.dps || '';
                    field2.input.value = tx.exShares || '';
                    field4.input.value = tx.amount || '';
                    if (mappedType === 'dividend_both') {
                        if (field5) field5.input.value = tx.sdps || '';
                        if (field6) field6.input.value = tx.stockAmount || '';
                    }
                    inputFee.value = tx.fee !== undefined ? tx.fee : '';
                    inputTax.value = tx.tax !== undefined ? tx.tax : '';
                    selectBroker.value = tx.brokerId || '0';
                } else if (mappedType === 'capital_reduction') {
                    field1.input.value = tx.ratio || '';
                    field2.input.value = tx.originalShares || '';
                    field4.input.value = tx.cash || '';
                    if (field3.input) field3.input.value = tx.newShares || '';
                    selectBroker.value = tx.brokerId || '0';
                } else if (mappedType === 'capital_split') {
                    field1.input.value = tx.splitRatio || '';
                    field2.input.value = tx.originalShares || '';
                    if (field3.input) field3.input.value = tx.newShares || '';
                    selectBroker.value = tx.brokerId || '0';
                } else if (mappedType === 'account_deposit' || mappedType === 'account_withdraw') {
                    field1.input.value = tx.amount || '';
                    selectBroker.value = tx.brokerId || '0';
                } else if (mappedType === 'fee_rebate') {
                    field1.input.value = tx.amount || '';
                    selectBroker.value = tx.brokerId || '0';
                }
            }
        } else {
            editModeId = null;
            modalTitle.innerText = '新增交易紀錄';
            show(btnAddAnother);

            inputDate.value = new Date().toISOString().split('T')[0];
            inputCode.value = defaultCode;
            inputNote.value = '';
            setTradeType('buy');
            setStockType('regular');
            setMarketType('regular');
            setDayTrading(false);
            field1.input.value = '';
            field2.input.value = '';
            field4.input.value = '';
            if (field3.input) {
                field3.input.value = '';
                field3.input.placeholder = '留白將自動計算';
            }
            inputFee.value = '';
            inputTax.value = '';

            const defaultBroker = settings.brokers && settings.brokers.find(b => b.isDefault);
            if (defaultBroker) {
                selectBroker.value = defaultBroker.id;
            } else if (settings.brokers && settings.brokers.length > 0) {
                selectBroker.value = settings.brokers[0].id;
            } else {
                selectBroker.value = '0';
            }
        }

        if (inputCode.value) {
            inputCode.dispatchEvent(new Event('blur'));
        } else {
            if (labelStockName) labelStockName.innerText = '—';
        }

        updateTotalAmount();

        modalAdd.classList.remove('hidden');
    };

    const closeModal = () => modalAdd.classList.add('hidden');
    btnClose.addEventListener('click', closeModal);

    const handleSave = (addAnother) => {
        const date = inputDate.value;
        const code = inputCode.value.trim().toUpperCase();
        const note = inputNote.value.trim();

        if (!date) { alert('請選擇交易日期'); return; }
        if (currentTradeType !== 'account_deposit' && currentTradeType !== 'account_withdraw' && currentTradeType !== 'fee_rebate') {
            if (!code) {
                alert('請輸入股票代號');
                return;
            }
            if (labelStockName && (labelStockName.innerText === '未知' || labelStockName.innerText === '—' || labelStockName.innerText === '查詢中...')) {
                alert('找不到該股票代號，請確認後再儲存');
                return;
            }
        }

        if (!settings.transactions) settings.transactions = [];

        let tx = {
            id: editModeId || Date.now().toString(),
            portfolioId: 'default',
            date: date.replace(/-/g, '/'),
            code: code,
            note: note,
            stockType: currentStockType,
            isOddLot: currentMarketType === 'oddLot',
            dayTrading: isDayTrading
        };

        // Map back to legacy categories for compatibility with renderTrades
        if (currentTradeType === 'buy' || currentTradeType === 'sell') {
            const price = parseFloat(field1.input.value);
            const qty = parseInt(field2.input.value);
            if (!price || !qty) { alert('請輸入單價與股數'); return; }

            tx.category = 'trade';
            tx.type = currentTradeType;
            tx.price = price;
            tx.quantity = qty;
            tx.brokerId = parseInt(selectBroker.value) || 0;
            tx.fee = parseInt(inputFee.value) || 0;
            tx.tax = parseInt(inputTax.value) || 0;

            let amount = Math.round(price * qty);
            tx.total = currentTradeType === 'buy' ? amount + tx.fee : amount - tx.fee - tx.tax;

        } else if (currentTradeType === 'dividend_cash' || currentTradeType === 'dividend_stock' || currentTradeType === 'dividend_both') {
            tx.category = 'dividend';
            tx.type = currentTradeType === 'dividend_cash' ? 'cash' : (currentTradeType === 'dividend_stock' ? 'stock' : 'both');
            tx.dps = parseFloat(field1.input.value) || 0;
            tx.sdps = field5 ? (parseFloat(field5.input.value) || 0) : 0;
            tx.fee = parseInt(inputFee.value) || 0;
            tx.tax = parseInt(inputTax.value) || 0;
            tx.brokerId = parseInt(selectBroker.value) || 0;

            let exShares = parseInt(field2.input.value);
            let calculatedShares = window.getHoldingsAtDate(tx.code, tx.date, editModeId);
            tx.exShares = isNaN(exShares) ? calculatedShares : exShares;

            let inputAmount = parseFloat(field4.input.value);
            let inputStockAmount = field6 ? parseFloat(field6.input.value) : NaN;

            // Auto calculate if user left it blank
            if (tx.type === 'cash') {
                tx.amount = isNaN(inputAmount) ? Math.floor(tx.exShares * tx.dps) : inputAmount;
                tx.total = tx.amount - tx.fee - tx.tax;
            } else if (tx.type === 'stock') {
                let ratio = tx.dps < 10 ? (tx.dps / 10) : tx.dps;
                tx.amount = isNaN(inputAmount) ? Math.floor(tx.exShares * ratio) : inputAmount;
                tx.total = 0;
            } else if (tx.type === 'both') {
                tx.amount = isNaN(inputAmount) ? Math.floor(tx.exShares * tx.dps) : inputAmount;
                let ratio = tx.sdps < 10 ? (tx.sdps / 10) : tx.sdps;
                tx.stockAmount = isNaN(inputStockAmount) ? Math.floor(tx.exShares * ratio) : inputStockAmount;
                tx.total = tx.amount - tx.fee - tx.tax;
            }
        } else if (currentTradeType === 'capital_reduction') {
            tx.category = 'capital_change';
            tx.type = 'reduction';
            tx.ratio = parseFloat(field1.input.value) || 0;
            tx.brokerId = parseInt(selectBroker.value) || 0;

            if (!tx.ratio) { alert('請輸入比例'); return; }

            let original = parseInt(field2.input.value);
            let cashRet = parseFloat(field4.input.value);
            let newShares = field3.input ? parseInt(field3.input.value) : NaN;

            if (isNaN(original)) {
                tx.originalShares = window.getHoldingsAtDate(tx.code, tx.date, editModeId);
            } else {
                tx.originalShares = original;
            }

            tx.newShares = isNaN(newShares) ? Math.floor(tx.originalShares * tx.ratio) : newShares;

            if (isNaN(cashRet)) {
                tx.cash = 0;
            } else {
                tx.cash = cashRet;
            }

            tx.total = tx.cash;

        } else if (currentTradeType === 'capital_split') {
            tx.category = 'capital_change';
            tx.type = 'split';
            tx.splitRatio = parseFloat(field1.input.value) || 0;
            tx.brokerId = parseInt(selectBroker.value) || 0;
            let original = parseInt(field2.input.value);
            let newShares = field3.input ? parseInt(field3.input.value) : NaN;

            tx.originalShares = isNaN(original) ? window.getHoldingsAtDate(tx.code, tx.date, editModeId) : original;
            tx.newShares = isNaN(newShares) ? Math.floor(tx.originalShares * tx.splitRatio) : newShares;
            tx.total = 0;

        } else if (currentTradeType === 'account_deposit' || currentTradeType === 'account_withdraw') {
            tx.category = 'account';
            tx.type = currentTradeType === 'account_deposit' ? 'deposit' : 'withdraw';
            tx.amount = parseFloat(field1.input.value) || 0;
            tx.brokerId = parseInt(selectBroker.value) || 0;
            if (!tx.amount) { alert('請輸入金額'); return; }
            tx.total = tx.amount;
            tx.code = '';

        } else if (currentTradeType === 'fee_rebate') {
            tx.category = 'fee_rebate';
            tx.type = 'rebate';
            tx.amount = parseFloat(field1.input.value);
            if (!tx.amount) { alert('請輸入折讓金額'); return; }
            tx.total = tx.amount;
            tx.brokerId = parseInt(selectBroker.value) || 0;
        }

        if (tx !== null) {
            if (editModeId) {
                const idx = settings.transactions.findIndex(t => t.id === editModeId);
                if (idx !== -1) settings.transactions[idx] = tx;
            } else {
                settings.transactions.push(tx);
            }

            // 自動將交易的股票加入底層的總自選清單，避免在「完整持股」看不到
            if (tx.code && (!settings.watchList || !settings.watchList.includes(tx.code))) {
                if (!settings.watchList) settings.watchList = [];
                settings.watchList.push(tx.code);

                // 透過 marketTab 注入預設的空報價，讓名稱馬上能顯示，不會出現「無資料」
                if (window.marketTab && window.marketTab.injectQuote) {
                    window.marketTab.injectQuote({
                        code: tx.code,
                        name: (settings.stockNamesCache && settings.stockNamesCache[tx.code]) || '載入中...',
                        price: 0, change: 0, changePercent: 0, volume: 0, status: 'empty'
                    });
                }
            }
        }

        saveSettings();

        // 顯示成功提示 (Toast)
        const actionText = editModeId ? '修改' : '新增';
        showToast(`✅ 交易紀錄已成功${actionText}！`);

        if (addAnother) {
            // Keep modal open, reset fields
            if (field1.input) field1.input.value = '';
            if (field2.input) field2.input.value = '';
            if (field3.input) {
                field3.input.value = '';
                field3.input.placeholder = '留白將自動計算';
            }
            if (field4.input) field4.input.value = '';
            inputFee.value = '';
            inputTax.value = '';
            inputNote.value = '';
        } else {
            closeModal();
        }

        renderTrades();
        if (window.marketTab && window.marketTab.renderList) window.marketTab.renderList();
    };

    btnSave.addEventListener('click', () => handleSave(false));
    if (btnAddAnother) btnAddAnother.addEventListener('click', () => handleSave(true));

    function populateBrokers() {
        if (!selectBroker) return;
        selectBroker.innerHTML = '';
        if (settings.brokers && settings.brokers.length > 0) {
            settings.brokers.forEach(b => {
                const opt = document.createElement('option');
                opt.value = b.id;
                opt.innerText = b.name;
                selectBroker.appendChild(opt);
            });
        } else {
            const opt = document.createElement('option');
            opt.value = '0';
            opt.innerText = '預設券商 (無折讓)';
            selectBroker.appendChild(opt);
        }
    }
}

window.tradesTab = {
    deleteTrade: (id) => {
        if (confirm('確定要刪除這筆紀錄嗎？')) {
            if (confirm('您真的確定要刪除嗎？刪除後將無法復原！')) {
                settings.transactions = settings.transactions.filter(t => String(t.id) !== String(id));
                selectedTradeIds.delete(String(id));
                saveSettings();
                showToast('✅ 交易紀錄已刪除！');
                renderTrades();
                if (window.marketTab && window.marketTab.renderList) window.marketTab.renderList();
            }
        }
    }
};

export function initTrades() {
    const btnAdd = document.getElementById('btn-trade-add');
    if (btnAdd) btnAdd.addEventListener('click', () => {
        if (window.openTradeModal) window.openTradeModal();
    });

    const btnImport = document.getElementById('btn-trade-import-csv');
    const inputCsv = document.getElementById('trade-csv-input');

    if (btnImport && inputCsv) {
        btnImport.addEventListener('click', () => {
            inputCsv.value = '';
            inputCsv.click();
        });
        inputCsv.addEventListener('change', handleCsvImport);
    }

    const filterBroker = document.getElementById('filter-broker');
    if (filterBroker) {
        filterBroker.innerHTML = '<option value="">全部</option>';
        if (settings.brokers && settings.brokers.length > 0) {
            settings.brokers.forEach(b => {
                const opt = document.createElement('option');
                opt.value = b.id;
                opt.innerText = b.name;
                filterBroker.appendChild(opt);
            });
        }
    }

    const btnFilterReset = document.getElementById('btn-trade-filter-reset');

    const filterInputs = [
        'filter-date-start', 'filter-date-end', 'filter-code',
        'filter-type', 'filter-stock-type', 'filter-market-type', 'filter-broker'
    ];

    filterInputs.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener(el.tagName === 'INPUT' ? 'input' : 'change', renderTrades);
        }
    });

    if (btnFilterReset) {
        btnFilterReset.addEventListener('click', () => {
            document.getElementById('filter-date-start').value = '';
            document.getElementById('filter-date-end').value = '';
            document.getElementById('filter-code').value = '';
            document.getElementById('filter-type').value = '';
            const filterStockType = document.getElementById('filter-stock-type');
            if (filterStockType) filterStockType.value = '';
            document.getElementById('filter-broker').value = '';
            renderTrades();
        });
    }

    // --- Table Sorting & Selection Events ---
    document.querySelectorAll('[data-sort]').forEach(th => {
        th.addEventListener('click', () => {
            const col = th.dataset.sort;
            if (currentSortColumn === col) {
                currentSortDirection = currentSortDirection === 'desc' ? 'asc' : 'desc';
            } else {
                currentSortColumn = col;
                currentSortDirection = 'desc'; // Default to desc for new column
            }
            renderTrades();
        });
    });

    const list = document.getElementById('trades-list');
    if (list) {
        list.addEventListener('change', (e) => {
            if (e.target.classList.contains('trade-checkbox')) {
                if (e.target.checked) {
                    selectedTradeIds.add(e.target.value);
                } else {
                    selectedTradeIds.delete(e.target.value);
                }
                updateSelectionUI();
            }
        });
    }

    const selectAllCheckbox = document.getElementById('trade-select-all');
    if (selectAllCheckbox) {
        selectAllCheckbox.addEventListener('change', (e) => {
            const checkboxes = document.querySelectorAll('.trade-checkbox');
            checkboxes.forEach(cb => {
                cb.checked = e.target.checked;
                if (e.target.checked) {
                    selectedTradeIds.add(cb.value);
                } else {
                    selectedTradeIds.delete(cb.value);
                }
            });
            updateSelectionUI();
        });
    }

    const batchDeleteBtn = document.getElementById('btn-trade-batch-delete');
    if (batchDeleteBtn) {
        batchDeleteBtn.addEventListener('click', () => {
            if (selectedTradeIds.size === 0) return;
            if (confirm(`確定要一次刪除這 ${selectedTradeIds.size} 筆紀錄嗎？`)) {
                if (confirm('此動作將無法復原，您真的確定要刪除所選紀錄嗎？')) {
                    settings.transactions = settings.transactions.filter(t => !selectedTradeIds.has(String(t.id)));
                    selectedTradeIds.clear();
                    saveSettings();
                    showToast('✅ 所選紀錄已全數刪除！');
                    renderTrades();
                    if (window.marketTab && window.marketTab.renderList) window.marketTab.renderList();
                }
            }
        });
    }
}

function handleCsvImport(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        const text = e.target.result;
        processCsvContent(text);
        // Reset input so the same file can be selected again
        event.target.value = '';
    };
    reader.readAsText(file);
}

export function processCsvContent(csvText) {
    try {
        // 移除 BOM 並按行分割
        const lines = csvText.replace(/^\uFEFF/, '').split(/[\r\n]+/).filter(line => line.trim() !== '');
        if (lines.length < 2) {
            alert('匯入失敗：檔案內無有效資料。');
            return;
        }

        let headerRowIdx = lines.findIndex(line => line.startsWith('日期,') || line.startsWith('交易日期,') || (line.includes('日期') && line.includes('交易別')));
        if (headerRowIdx === -1) {
            alert('CSV 標題缺少必要欄位 (日期 或 交易別)');
            return;
        }

        const headers = lines[headerRowIdx].split(',').map(h => h.trim());
        let dateIdx = headers.indexOf('日期');
        if (dateIdx === -1) dateIdx = headers.indexOf('交易日期');
        let brokerIdx = headers.indexOf('證券商');
        let codeIdx = headers.indexOf('代碼');
        if (codeIdx === -1) codeIdx = headers.indexOf('股票代號');
        let typeIdx = headers.indexOf('交易別');
        if (typeIdx === -1) typeIdx = headers.indexOf('交易類型');
        let qtyIdx = headers.indexOf('股數');
        let priceIdx = headers.indexOf('單價');
        let rebateIdx = headers.indexOf('折讓');
        let divCashIdx = headers.indexOf('配息');
        let divStockIdx = headers.indexOf('配股');
        if (divStockIdx === -1) divStockIdx = headers.indexOf('配股(元)');
        let noteIdx = headers.indexOf('備註');
        if (noteIdx === -1) noteIdx = headers.indexOf('筆記');
        let feeIdx = headers.indexOf('手續費/匯費');
        if (feeIdx === -1) feeIdx = headers.indexOf('手續費');
        if (feeIdx === -1) feeIdx = headers.indexOf('匯費');
        let taxIdx = headers.indexOf('交易稅');
        if (taxIdx === -1) taxIdx = headers.indexOf('證交稅');
        const nameIdx = headers.findIndex(h => h.includes('名稱') || h.includes('商品') || h.includes('股票名稱'));

        // Fallbacks for older 5-col template
        let genericQtyIdx = headers.indexOf('股數/金額/比例');
        if (priceIdx === -1) priceIdx = headers.indexOf('單價/退還款');

        // 先解析標題列之前的設定區塊
        let hasImportedBrokers = false;
        const parseNum = (str) => {
            if (!str) return 0;
            return parseFloat(String(str).replace(/[\$,]/g, '')) || 0;
        };

        // 如果首列是券商說明或設定，進行解析
        for (let i = 0; i < headerRowIdx; i++) {
            const rowCols = lines[i].split(',').map(c => c.trim());
            if (rowCols[0] === '#系統設定') {
                if (rowCols[1]) settings.gasUrl = rowCols[1];
                continue;
            }
            if (rowCols[0] === '#券商設定') {
                const bName = rowCols[1];
                if (!bName) continue;

                const bInitialCapital = parseNum(rowCols[2]);
                const bFeeRate = rowCols[3] ? parseNum(rowCols[3]) : 0.1425;
                const bDiscount = rowCols[4] ? parseNum(rowCols[4]) : 10;
                const bMinFee = rowCols[5] ? parseNum(rowCols[5]) : 20;
                const bMinOddFee = rowCols[6] ? parseNum(rowCols[6]) : 1;
                const bTaxRate = rowCols[7] ? parseNum(rowCols[7]) : 0.3;
                const bEtfTaxRate = rowCols[8] ? parseNum(rowCols[8]) : 0.1;
                const bDayTradeTaxRate = rowCols[9] ? parseNum(rowCols[9]) : 0.15;
                const bDayTradeEtfTaxRate = rowCols[10] ? parseNum(rowCols[10]) : 0.05;
                const bNhiThreshold = rowCols[11] ? parseNum(rowCols[11]) : 20000;
                const bNhiTaxRate = rowCols[12] ? parseNum(rowCols[12]) : 2.11;

                if (!settings.brokers) settings.brokers = [];
                const existingBroker = settings.brokers.find(b => b.name === bName);
                if (existingBroker) {
                    existingBroker.initialCapital = bInitialCapital;
                    existingBroker.feeRate = bFeeRate;
                    existingBroker.discount = bDiscount;
                    existingBroker.minFee = bMinFee;
                    existingBroker.minOddFee = bMinOddFee;
                    existingBroker.taxRate = bTaxRate;
                    existingBroker.etfTaxRate = bEtfTaxRate;
                    existingBroker.dayTradeTaxRate = bDayTradeTaxRate;
                    existingBroker.dayTradeEtfTaxRate = bDayTradeEtfTaxRate;
                    existingBroker.nhiThreshold = bNhiThreshold;
                    existingBroker.nhiTaxRate = bNhiTaxRate;
                } else {
                    settings.brokers.push({
                        id: Date.now() + Math.floor(Math.random() * 1000) + i,
                        name: bName,
                        isDefault: settings.brokers.length === 0,
                        initialCapital: bInitialCapital,
                        feeRate: bFeeRate,
                        discount: bDiscount,
                        minFee: bMinFee,
                        minOddFee: bMinOddFee,
                        taxRate: bTaxRate,
                        etfTaxRate: bEtfTaxRate,
                        dayTradeTaxRate: bDayTradeTaxRate,
                        dayTradeEtfTaxRate: bDayTradeEtfTaxRate,
                        nhiThreshold: bNhiThreshold,
                        nhiTaxRate: bNhiTaxRate
                    });
                }
                hasImportedBrokers = true;
            }
        }

        const typeMapping = {
            '買進': { category: 'trade', type: 'buy' },
            '現買': { category: 'trade', type: 'buy' },
            '融買': { category: 'trade', type: 'buy' },
            '賣出': { category: 'trade', type: 'sell' },
            '現賣': { category: 'trade', type: 'sell' },
            '融賣': { category: 'trade', type: 'sell' },
            '配息': { category: 'dividend', type: 'cash' },
            '配股': { category: 'dividend', type: 'stock' },
            '配息股': { category: 'dividend', type: 'both' },
            '配息+配股': { category: 'dividend', type: 'both' },
            '減資': { category: 'capital_change', type: 'reduction' },
            '分割': { category: 'capital_change', type: 'split' },
            '入金': { category: 'account', type: 'deposit' },
            '存入資金': { category: 'account', type: 'deposit' },
            '出金': { category: 'account', type: 'withdraw' },
            '取出資金': { category: 'account', type: 'withdraw' },
            '取出': { category: 'account', type: 'withdraw' },
            '存入': { category: 'account', type: 'deposit' },
            '當沖買': { category: 'trade', type: 'buy', dayTrading: true },
            '當沖賣': { category: 'trade', type: 'sell', dayTrading: true },
            '折讓': { category: 'fee_rebate', type: 'rebate' },
            '手續費折讓': { category: 'fee_rebate', type: 'rebate' }
        };

        let errorCount = 0;
        let duplicateCount = 0;

        // 建立交易特徵指紋 (用於辨識與略過重複交易)
        const getTxFingerprint = (t) => {
            let normDate = '';
            if (t.date) {
                const parts = String(t.date).trim().split(/[\/\-\.]/);
                if (parts.length === 3) {
                    normDate = `${parts[0].padStart(4, '0')}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
                } else {
                    normDate = String(t.date).trim();
                }
            }
            const normCode = (t.code || '').trim();
            const cat = t.category || '';
            const type = t.type || '';
            const dt = t.dayTrading ? '1' : '0';
            const brokerId = t.brokerId || 0;
            const price = Number(t.price || 0).toFixed(3);
            const qty = Number(t.quantity || t.amount || 0);
            const fee = Number(t.fee || 0);
            const tax = Number(t.tax || 0);
            const dps = Number(t.dps || 0).toFixed(3);
            const sdps = Number(t.sdps || 0).toFixed(3);
            const ratio = Number(t.ratio || t.splitRatio || 0).toFixed(3);
            const cash = Number(t.cash || 0).toFixed(3);
            const cleanNote = (t.note || '').replace(/[\[［]自動計算[\]］].*$/s, '').trim();

            return `${normDate}|${brokerId}|${normCode}|${cat}|${type}|${dt}|${price}|${qty}|${fee}|${tax}|${dps}|${sdps}|${ratio}|${cash}|${cleanNote}`;
        };

        // 統計現有交易的特徵次數 (多重集計數法，支援同日多筆相同委託)
        const existingCounts = new Map();
        (settings.transactions || []).forEach(t => {
            const fp = getTxFingerprint(t);
            existingCounts.set(fp, (existingCounts.get(fp) || 0) + 1);
        });

        let importedTrades = [];

        const checkAndAddTx = (txObj) => {
            const fp = getTxFingerprint(txObj);
            const count = existingCounts.get(fp) || 0;
            if (count > 0) {
                existingCounts.set(fp, count - 1);
                duplicateCount++;
            } else {
                importedTrades.push(txObj);
            }
        };

        const parseCsvRow = (text) => {
            let result = [];
            let cur = '';
            let inQuote = false;
            for (let i = 0; i < text.length; i++) {
                const char = text[i];
                if (char === '"') {
                    if (inQuote && text[i + 1] === '"') {
                        cur += '"';
                        i++;
                    } else {
                        inQuote = !inQuote;
                    }
                } else if (char === ',' && !inQuote) {
                    result.push(cur);
                    cur = '';
                } else {
                    cur += char;
                }
            }
            result.push(cur);
            return result.map(c => c.trim());
        };

        for (let i = headerRowIdx + 1; i < lines.length; i++) {
            if (!lines[i].trim()) continue;
            const cols = parseCsvRow(lines[i]);
            if (cols.length < 3) continue;

            const typeStr = cols[typeIdx];
            const typeInfo = typeMapping[typeStr];
            if (!typeInfo) {
                console.warn(`未知的交易類型: ${typeStr}，略過此列`);
                errorCount++;
                continue;
            }

            const date = cols[dateIdx];
            const code = codeIdx !== -1 ? cols[codeIdx] : '';
            const name = nameIdx !== -1 ? cols[nameIdx] : '';
            let noteText = noteIdx !== -1 ? cols[noteIdx] : '';
            if (noteText) {
                // 清理舊版匯出可能殘留在頭尾的多餘引號
                noteText = noteText.replace(/^"+|"+$/g, '').trim();
            }
            const price = priceIdx !== -1 ? parseNum(cols[priceIdx]) : 0;
            const qty = qtyIdx !== -1 ? parseNum(cols[qtyIdx]) : (genericQtyIdx !== -1 ? parseNum(cols[genericQtyIdx]) : 0);

            if (code && name && code !== '99999') {
                if (!settings.stockNamesCache) settings.stockNamesCache = {};
                settings.stockNamesCache[code] = name;
            }

            let tx = {
                id: Date.now().toString() + '_' + i,
                portfolioId: 'default',
                date: date,
                code: code,
                note: noteText,
                category: typeInfo.category,
                type: typeInfo.type,
                dayTrading: typeInfo.dayTrading || false
            };

            // Broker Matching
            let brokerId = 0;
            if (brokerIdx !== -1 && cols[brokerIdx]) {
                const bName = cols[brokerIdx];
                const foundBroker = (settings.brokers || []).find(b => b.name.includes(bName) || bName.includes(b.name));
                if (foundBroker) {
                    brokerId = foundBroker.id;
                } else {
                    let newBroker = {
                        id: Date.now() + Math.floor(Math.random() * 1000) + i,
                        name: bName,
                        isDefault: false,
                        feeRate: 0.1425,
                        discount: 10,
                        minFee: 20,
                        minOddFee: 1,
                        initialCapital: 0,
                        taxRate: 0.3,
                        etfTaxRate: 0.1,
                        dayTradeTaxRate: 0.15,
                        dayTradeEtfTaxRate: 0.05,
                        nhiThreshold: 20000,
                        nhiTaxRate: 2.11
                    };
                    if (!settings.brokers) settings.brokers = [];
                    settings.brokers.push(newBroker);
                    brokerId = newBroker.id;
                }
            } else if (settings.brokers && settings.brokers.length > 0) {
                brokerId = settings.brokers[0].id;
            }

            tx.brokerId = brokerId;

            if (tx.category === 'trade') {
                tx.price = price;
                tx.quantity = qty;

                if (code.startsWith('00') && code.length >= 4) {
                    tx.stockType = 'etf';
                } else if (qty > 0 && qty % 1000 !== 0) {
                    tx.stockType = 'oddLot';
                } else {
                    tx.stockType = 'regular';
                }

                // tx.dayTrading is already set from typeInfo

                let broker = (settings.brokers || []).find(b => b.id === brokerId);
                let feeRate = settings.feeRate !== undefined ? settings.feeRate : 0.1425;
                let discount = broker ? (broker.discount || 10) : 10;

                let isEtf = tx.stockType === 'etf';
                let isOddLot = tx.stockType === 'oddLot' || (qty > 0 && qty % 1000 !== 0);

                let minFee = isOddLot ? (broker ? (broker.minOddFee || 1) : 1) : (broker ? (broker.minFee || 20) : 20);

                let amount = Math.floor(price * qty);
                let rawFee = amount * (feeRate / 100);
                let discountedFee = rawFee * (discount / 10);
                let actualFee = amount > 0 ? Math.max(minFee, Math.floor(discountedFee)) : 0;

                let baseTaxRate = (settings.taxRate !== undefined ? settings.taxRate : 0.3) / 100;
                let etfTaxRate = (settings.etfTaxRate !== undefined ? settings.etfTaxRate : 0.1) / 100;
                let dayTradeTaxRate = (settings.dayTradeTaxRate !== undefined ? settings.dayTradeTaxRate : 0.15) / 100;
                let dayTradeEtfTaxRate = (settings.dayTradeEtfTaxRate !== undefined ? settings.dayTradeEtfTaxRate : 0.05) / 100;

                let actualTaxRate = baseTaxRate;
                if (tx.dayTrading && isEtf) actualTaxRate = dayTradeEtfTaxRate;
                else if (tx.dayTrading) actualTaxRate = dayTradeTaxRate;
                else if (isEtf) actualTaxRate = etfTaxRate;

                let importedFee = (feeIdx !== -1 && cols[feeIdx] !== undefined && cols[feeIdx].trim() !== '') ? parseNum(cols[feeIdx]) : null;
                let importedTax = (taxIdx !== -1 && cols[taxIdx] !== undefined && cols[taxIdx].trim() !== '') ? parseNum(cols[taxIdx]) : null;

                tx.fee = importedFee !== null ? importedFee : actualFee;
                let calcTax = tx.type === 'sell' ? Math.floor(amount * actualTaxRate) : 0;
                if (calcTax === 0 && amount > 0 && tx.type === 'sell') calcTax = 1;
                tx.tax = importedTax !== null ? importedTax : calcTax;
                tx.total = tx.type === 'buy' ? amount + tx.fee : amount - tx.fee - tx.tax;

                checkAndAddTx(tx);

            } else if (tx.category === 'dividend') {
                let importedFee = (feeIdx !== -1 && cols[feeIdx] !== undefined && cols[feeIdx].trim() !== '') ? parseNum(cols[feeIdx]) : 10;

                tx.fee = importedFee;
                tx.autoCalcHoldings = true;
                if (tx.type === 'cash') {
                    tx.dps = divCashIdx !== -1 ? parseNum(cols[divCashIdx]) : (price || qty);
                } else if (tx.type === 'stock') {
                    tx.dps = divStockIdx !== -1 ? parseNum(cols[divStockIdx]) : (price || qty);
                } else if (tx.type === 'both') {
                    tx.dps = divCashIdx !== -1 ? parseNum(cols[divCashIdx]) : (price || 0);
                    tx.sdps = divStockIdx !== -1 ? parseNum(cols[divStockIdx]) : (qty || 0);
                }
                checkAndAddTx(tx);
            } else if (tx.category === 'capital_change') {
                if (tx.type === 'reduction') {
                    tx.ratio = qty;
                    tx.cash = price;
                    tx.autoCalcHoldings = true;
                } else {
                    tx.splitRatio = qty;
                    tx.total = 0;
                }
                checkAndAddTx(tx);
            } else if (tx.category === 'account') {
                let accAmount = qty;
                if (accAmount === 0) accAmount = price;
                if (accAmount === 0 && rebateIdx !== -1) accAmount = parseNum(cols[rebateIdx]);
                if (accAmount === 0) accAmount = parseNum(cols[5]) || parseNum(cols[6]) || parseNum(cols[7]) || parseNum(cols[8]) || parseNum(cols[9]) || 0;

                tx.amount = accAmount;
                tx.total = accAmount;
                tx.code = '';
                checkAndAddTx(tx);
            } else if (tx.category === 'fee_rebate') {
                tx.amount = rebateIdx !== -1 ? parseNum(cols[rebateIdx]) : qty;
                tx.total = tx.amount;
                checkAndAddTx(tx);
            }
        }

        // 第二次遍歷：計算配息/減資的持股基準以得出總金額
        if (importedTrades.length > 0) {
            if (!settings.transactions) settings.transactions = [];
            const allTrades = [...settings.transactions, ...importedTrades].sort((a, b) => new Date(a.date) - new Date(b.date));

            const getHoldings = (targetCode, targetDateStr, stopId) => {
                return window.getHoldingsAtDate(targetCode, targetDateStr, stopId, allTrades);
            };

            for (let t of importedTrades) {
                if (t.autoCalcHoldings) {
                    const holdings = getHoldings(t.code, t.date, t.id);
                    t.exShares = holdings;
                    if (t.category === 'dividend') {
                        let actualCash = 0;
                        let actualStock = 0;
                        let calcNotes = [];

                        if (t.type === 'cash') {
                            actualCash = Math.floor(holdings * (t.dps || 0));
                            t.amount = actualCash;
                            calcNotes.push(`現股 ${holdings} * 配息 ${t.dps || 0} = ${actualCash}`);
                        } else if (t.type === 'stock') {
                            let ratio = (t.dps || 0) < 10 ? (t.dps / 10) : t.dps;
                            actualStock = Math.floor(holdings * ratio);
                            t.amount = actualStock;
                            calcNotes.push(`現股 ${holdings} * 配股 ${ratio.toFixed(2)} = ${actualStock} 股`);
                        } else if (t.type === 'both') {
                            actualCash = Math.floor(holdings * (t.dps || 0));
                            t.amount = actualCash;

                            let ratio = (t.sdps || 0) < 10 ? (t.sdps / 10) : t.sdps;
                            actualStock = Math.floor(holdings * ratio);
                            t.stockAmount = actualStock;

                            calcNotes.push(`配息: ${holdings} * ${t.dps || 0} = ${actualCash}`);
                            calcNotes.push(`配股: ${holdings} * ${ratio.toFixed(2)} = ${actualStock} 股`);
                        }

                        // NHI tax calculation
                        let threshold = settings.nhiThreshold !== undefined ? settings.nhiThreshold : 20000;
                        let rate = settings.nhiTaxRate !== undefined ? settings.nhiTaxRate : 2.11;

                        let totalDividendForNHI = actualCash + (actualStock * 10);
                        if (totalDividendForNHI >= threshold) {
                            t.tax = Math.round(totalDividendForNHI * (rate / 100));
                            calcNotes.push(`二代健保: (${actualCash} + ${actualStock}*10) * ${rate}% = ${t.tax}`);
                        } else {
                            t.tax = 0;
                        }

                        t.total = actualCash - (t.fee || 0) - (t.tax || 0); // subtract fees and taxes from total cash received

                        const calcStr = calcNotes.join('， ');
                        // 移除舊的 [自動計算] 或 ［自動計算］ 內容，避免重複
                        let cleanNote = (t.note || '').replace(/[\[［]自動計算[\]］].*$/s, '').trim();
                        t.note = cleanNote ? (cleanNote + '\n［自動計算］' + calcStr) : ('［自動計算］' + calcStr);

                    } else if (t.category === 'capital_change' && t.type === 'reduction') {
                        t.originalShares = holdings;
                        t.total = Math.floor(holdings * (t.cash || 0));
                        let cleanNote2 = (t.note || '').replace(/[\[［]自動計算[\]］].*$/s, '').trim();
                        const reduceStr = `［自動計算］減資退現: ${holdings} * ${t.cash || 0} = ${t.total}`;
                        t.note = cleanNote2 ? (cleanNote2 + '\n' + reduceStr) : reduceStr;
                    }
                    delete t.autoCalcHoldings;
                }
            }
        }

        if (importedTrades.length > 0) {
            if (!settings.transactions) settings.transactions = [];
            settings.transactions.push(...importedTrades);

            if (!settings.watchList) settings.watchList = [];
            let addedStocks = 0;
            const uniqueCodes = [...new Set(importedTrades.map(t => t.code).filter(c => c))];
            uniqueCodes.forEach(code => {
                if (!settings.watchList.includes(code)) {
                    settings.watchList.push(code);
                    addedStocks++;
                }
            });

            saveSettings();
            renderTrades();
            if (window.marketTab && window.marketTab.renderList) window.marketTab.renderList();

            let counts = {
                'buy': 0, 'sell': 0, 'cash': 0, 'stock': 0, 'both': 0,
                'deposit': 0, 'withdraw': 0, 'fee_rebate': 0, 'reduction': 0, 'split': 0
            };
            importedTrades.forEach(t => {
                if (t.category === 'fee_rebate') counts['fee_rebate']++;
                else if (t.category === 'account') {
                    if (t.type === 'deposit') counts['deposit']++;
                    else if (t.type === 'withdraw') counts['withdraw']++;
                }
                else if (counts[t.type] !== undefined) counts[t.type]++;
            });

            let details = [];
            if (counts.buy > 0) details.push(`買進: <b>${counts.buy}</b> 筆`);
            if (counts.sell > 0) details.push(`賣出: <b>${counts.sell}</b> 筆`);
            if (counts.cash > 0) details.push(`配息: <b>${counts.cash}</b> 筆`);
            if (counts.stock > 0) details.push(`配股: <b>${counts.stock}</b> 筆`);
            if (counts.both > 0) details.push(`配息+配股: <b>${counts.both}</b> 筆`);
            if (counts.deposit > 0) details.push(`存入資金: <b>${counts.deposit}</b> 筆`);
            if (counts.withdraw > 0) details.push(`取出資金: <b>${counts.withdraw}</b> 筆`);
            if (counts.fee_rebate > 0) details.push(`手續費折讓: <b>${counts.fee_rebate}</b> 筆`);
            if (counts.reduction > 0) details.push(`減資: <b>${counts.reduction}</b> 筆`);
            if (counts.split > 0) details.push(`分割: <b>${counts.split}</b> 筆`);

            let summaryHtml = `<div class="text-slate-700 space-y-3">
            <div class="text-lg">成功新增 <b>${importedTrades.length}</b> 筆交易紀錄！</div>
            <div class="bg-slate-50 border border-slate-100 p-4 rounded-xl text-sm text-left grid grid-cols-2 gap-y-2">
                ${details.map(d => `<div>${d}</div>`).join('')}
            </div>`;

            if (duplicateCount > 0) {
                summaryHtml += `<div class="text-sm text-amber-600 font-medium">(已自動略過 <b>${duplicateCount}</b> 筆重複紀錄)</div>`;
            }
            if (addedStocks > 0) {
                summaryHtml += `<div class="text-sm text-slate-500">(已自動將 ${addedStocks} 檔股票加入自選清單)</div>`;
            }
            if (hasImportedBrokers) {
                summaryHtml += `<div class="text-sm text-blue-600 font-medium">(同時已成功匯入與更新券商參數)</div>`;
                if (window.settingsTab && window.settingsTab.renderBrokers) window.settingsTab.renderBrokers();
            }
            if (errorCount > 0) {
                summaryHtml += `<div class="text-sm text-rose-500 font-medium">(有 ${errorCount} 筆資料格式錯誤或類型未知被略過)</div>`;
            }
            summaryHtml += `</div>`;

            if (window.Swal) {
                Swal.fire({
                    title: '匯入完成',
                    html: summaryHtml,
                    icon: 'success',
                    confirmButtonColor: '#4f46e5'
                });
            } else {
                let msg = `成功新增 ${importedTrades.length} 筆交易紀錄！`;
                if (duplicateCount > 0) msg += `\n(已自動略過 ${duplicateCount} 筆重複紀錄)`;
                if (addedStocks > 0) msg += `\n(已自動將 ${addedStocks} 檔股票加入自選清單)`;
                if (errorCount > 0) msg += `\n(有 ${errorCount} 筆資料格式錯誤或類型未知被略過)`;
                alert(msg);
            }
        } else if (hasImportedBrokers) {
            saveSettings();
            if (window.settingsTab && window.settingsTab.renderBrokers) window.settingsTab.renderBrokers();
            if (window.Swal) {
                Swal.fire({
                    title: '設定更新完成',
                    html: `<div class="text-slate-700 text-base">成功匯入並更新了券商設定參數。</div>`,
                    icon: 'success',
                    confirmButtonColor: '#4f46e5'
                });
            } else {
                alert('成功匯入並更新了券商設定參數。');
            }
        } else if (duplicateCount > 0) {
            let msg = `檔案內共 <b>${duplicateCount}</b> 筆交易紀錄皆已存在於帳本中，已自動略過，無重複新增。`;
            if (window.Swal) {
                Swal.fire({
                    title: '匯入完成（略過重複）',
                    html: `<div class="text-slate-700 text-base">${msg}</div>`,
                    icon: 'info',
                    confirmButtonColor: '#4f46e5'
                });
            } else {
                alert(`檔案內共 ${duplicateCount} 筆交易紀錄皆已存在於帳本中，已自動略過，無重複新增。`);
            }
        } else {
            if (window.Swal) Swal.fire('匯入失敗', '找不到可匯入的有效交易資料。', 'error');
            else alert('匯入失敗：找不到可匯入的有效交易資料。');
        }
    } catch (err) {
        if (window.Swal) Swal.fire('匯入失敗', '解析時發生錯誤，請確認檔案格式是否正確。<br>' + err.message, 'error');
        else alert('匯入解析時發生錯誤，請確認檔案格式是否正確。錯誤訊息：' + err.message);
        console.error('CSV 匯入錯誤:', err);
    }
}

export function renderTrades() {
    const list = document.getElementById('trades-list');
    if (!list) return;

    if (!settings.transactions || settings.transactions.length === 0) {
        list.innerHTML = `<tr><td colspan="10" class="px-4 py-10 text-center text-slate-400">尚無交易紀錄</td></tr>`;
        updateSelectionUI();
        return;
    }

    list.innerHTML = '';

    // Auto-migrate legacy oddLot data
    let needsSave = false;
    settings.transactions.forEach(t => {
        if (t.stockType === 'oddLot' || (t.isOddLot === undefined && t.quantity > 0 && t.quantity % 1000 !== 0)) {
            t.isOddLot = true;
            if (t.stockType === 'oddLot') t.stockType = 'regular';
            needsSave = true;
        } else if (t.isOddLot === undefined) {
            t.isOddLot = false;
            needsSave = true;
        }
    });
    if (needsSave) saveSettings();

    // Get filter values
    const filterDateStart = document.getElementById('filter-date-start')?.value;
    const filterDateEnd = document.getElementById('filter-date-end')?.value;
    const filterCode = document.getElementById('filter-code')?.value.trim();
    const filterType = document.getElementById('filter-type')?.value;
    const filterStockType = document.getElementById('filter-stock-type')?.value;
    const filterMarketType = document.getElementById('filter-market-type')?.value;
    const filterBroker = document.getElementById('filter-broker')?.value;

    let filteredTrades = [...settings.transactions];

    if (filterDateStart) {
        filteredTrades = filteredTrades.filter(t => t.date >= filterDateStart.replace(/-/g, '/'));
    }
    if (filterDateEnd) {
        filteredTrades = filteredTrades.filter(t => t.date <= filterDateEnd.replace(/-/g, '/'));
    }
    if (filterCode) {
        filteredTrades = filteredTrades.filter(t => t.code && t.code.includes(filterCode));
    }
    if (filterType) {
        filteredTrades = filteredTrades.filter(t => {
            const cat = t.category || 'trade';
            const compositeType = `${cat}_${t.type}`;
            if (filterType === 'account_deposit_withdraw') {
                return compositeType === 'account_deposit' || compositeType === 'account_withdraw';
            }
            return compositeType === filterType || (cat === 'fee_rebate' && filterType === 'fee_rebate_');
        });
    }
    if (filterStockType) {
        filteredTrades = filteredTrades.filter(t => {
            const isEtf = t.stockType === 'etf' || (t.code && t.code.startsWith('00') && t.code.length >= 4);
            if (filterStockType === 'etf') return isEtf;
            if (filterStockType === 'regular') return !isEtf;
            return true;
        });
    }
    if (filterMarketType) {
        filteredTrades = filteredTrades.filter(t => {
            const isOdd = t.isOddLot || t.stockType === 'oddLot' || (t.quantity > 0 && t.quantity % 1000 !== 0);
            if (filterMarketType === 'oddLot') return isOdd;
            if (filterMarketType === 'regular') return !isOdd;
            return true;
        });
    }
    if (filterBroker) {
        filteredTrades = filteredTrades.filter(t => String(t.brokerId) === String(filterBroker));
    }

    if (filteredTrades.length === 0) {
        list.innerHTML = `<tr><td colspan="12" class="px-4 py-10 text-center text-slate-400">找不到符合條件的交易紀錄</td></tr>`;
        updateSelectionUI();
        return;
    }

    // Apply Sorting
    filteredTrades.sort((a, b) => {
        let valA, valB;
        if (currentSortColumn === 'date') {
            valA = new Date(a.date).getTime();
            valB = new Date(b.date).getTime();
        } else if (currentSortColumn === 'brokerId') {
            const brokerA = (settings.brokers || []).find(br => br.id === a.brokerId);
            const brokerB = (settings.brokers || []).find(br => br.id === b.brokerId);
            valA = brokerA ? brokerA.name : '';
            valB = brokerB ? brokerB.name : '';
        } else if (currentSortColumn === 'code') {
            valA = a.code || '';
            valB = b.code || '';
        } else if (currentSortColumn === 'type') {
            valA = `${a.category || 'trade'}_${a.type || ''}`;
            valB = `${b.category || 'trade'}_${b.type || ''}`;
        }

        if (valA < valB) return currentSortDirection === 'asc' ? -1 : 1;
        if (valA > valB) return currentSortDirection === 'asc' ? 1 : -1;

        // Fallback to date if tie
        if (currentSortColumn !== 'date') {
            const dateA = new Date(a.date).getTime();
            const dateB = new Date(b.date).getTime();
            if (dateA !== dateB) return dateB - dateA; // fallback desc
        }

        // Final fallback: newer entries (higher ID) at the top
        const idA = parseInt(a.id) || 0;
        const idB = parseInt(b.id) || 0;
        return idB - idA;
    });

    const sortedTrades = filteredTrades;

    sortedTrades.forEach((t, index) => {
        let typeColor = 'text-slate-600 bg-slate-50';
        let typeText = '未知';
        let displayQty = '-';
        let displayPrice = '-';
        let displayFee = '-';
        let displayTax = '-';

        if (t.category === 'trade' || !t.category) {
            const isBuy = t.type === 'buy';
            const isOdd = t.isOddLot || t.stockType === 'oddLot' || (t.quantity > 0 && t.quantity % 1000 !== 0);
            typeColor = isBuy ? 'text-red-600 bg-red-50' : 'text-green-600 bg-green-50';
            typeText = isBuy ? '買進' : '賣出';
            if (isOdd) typeText += ' (零股)';
            displayQty = (t.quantity || 0).toLocaleString();
            displayPrice = (t.price || 0).toFixed(2);
            displayFee = (t.fee || 0).toLocaleString();
            displayTax = (t.tax || 0).toLocaleString();
        } else if (t.category === 'dividend') {
            typeColor = t.type === 'both' ? 'text-indigo-700 bg-indigo-100' : 'text-indigo-600 bg-indigo-50';
            if (t.type === 'cash') {
                typeText = '配息';
                displayQty = '-';
                displayPrice = t.dps ? t.dps.toString() : '-';
            } else if (t.type === 'stock') {
                typeText = '配股';
                displayQty = (t.amount || 0).toLocaleString();
                displayPrice = t.dps ? t.dps.toString() : '-';
            } else if (t.type === 'both') {
                typeText = '配息+配股';
                displayQty = (t.stockAmount || 0).toLocaleString();
                displayPrice = `息${t.dps || 0} 股${t.sdps || 0}`;
            }
            if (t.fee > 0) displayFee = t.fee.toLocaleString();
            if (t.tax > 0) displayTax = t.tax.toLocaleString();
        } else if (t.category === 'capital_change') {
            typeColor = 'text-orange-600 bg-orange-50';
            typeText = t.type === 'reduction' ? '減資' : '分割';
            displayQty = (t.ratio || t.splitRatio || 0).toString();
            displayPrice = t.type === 'reduction' ? (t.cash || 0).toString() : '-';
        } else if (t.category === 'account') {
            typeColor = 'text-teal-600 bg-teal-50';
            typeText = t.type === 'deposit' ? '存入' : '取出';
        } else if (t.category === 'fee_rebate') {
            typeColor = 'text-purple-600 bg-purple-50';
            typeText = '折讓';
        }

        const brokerObj = (settings.brokers || []).find(b => b.id === t.brokerId);
        const brokerName = brokerObj ? brokerObj.name : '—';

        let amountColor = 'text-slate-700 font-medium';
        if (t.total > 0) {
            const isPayment = ((!t.category || t.category === 'trade') && t.type === 'buy') || (t.category === 'account' && t.type === 'withdraw');
            const isIncome = ((!t.category || t.category === 'trade') && t.type === 'sell') || t.category === 'dividend' || t.category === 'fee_rebate' || (t.category === 'capital_change' && t.type === 'reduction') || (t.category === 'account' && t.type === 'deposit');
            if (isPayment) amountColor = 'text-red-600 font-medium';
            else if (isIncome) amountColor = 'text-green-600 font-medium';
        }

        const isChecked = selectedTradeIds.has(t.id);
        const stockName = (settings.stockNamesCache && t.code && settings.stockNamesCache[t.code]) ? ` ${settings.stockNamesCache[t.code]}` : '';
        const displayCodeName = t.code ? `${t.code}${stockName}` : '-';
        const row = document.createElement('tr');
        row.className = isChecked ? 'bg-blue-50 transition-colors group' : 'hover:bg-blue-50 transition-colors group';

        row.innerHTML = `
            <td class="px-3 py-3 text-center align-middle">
                <input type="checkbox" class="trade-checkbox cursor-pointer w-4 h-4 text-blue-600 bg-slate-100 border-slate-300 rounded focus:ring-blue-500" value="${t.id}" ${selectedTradeIds.has(t.id) ? 'checked' : ''}>
            </td>
            <td class="px-2 py-3 text-center text-slate-400 font-mono text-sm align-middle">${sortedTrades.length - index}</td>
            <td class="px-4 py-2 align-middle">
                <div class="text-slate-700">${t.date}</div>
                <div class="text-slate-700 mt-1">${displayCodeName}</div>
            </td>
            <td class="px-4 py-2 align-middle">
                <div class="text-slate-700">${brokerName}</div>
                <div class="mt-1"><span class="px-2 py-0.5 rounded text-sm ${typeColor}">${typeText}</span></div>
            </td>
            <td class="px-4 py-2 text-right align-middle">
                <div class="text-slate-700">${displayQty}</div>
                <div class="text-slate-700 mt-1">${displayPrice}</div>
            </td>
            <td class="px-4 py-2 text-right align-middle">
                <div class="text-slate-700">${displayFee}</div>
                <div class="text-slate-700 mt-1">${displayTax}</div>
            </td>
            <td class="px-4 py-2 text-right align-middle">
                <div class="${amountColor}">${(t.total || 0).toLocaleString()}</div>
                <div class="mt-1 flex justify-end gap-4">
                    <button class="text-blue-500 hover:text-blue-700 transition-colors opacity-0 group-hover:opacity-100" onclick="if(window.openTradeModal) window.openTradeModal('${t.code || ''}', '${t.id}')" title="編輯">
                        <svg class="w-4 h-4 inline-block" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/></svg>
                    </button>
                    <button class="text-slate-400 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100" onclick="window.tradesTab.deleteTrade('${t.id}')" title="刪除">
                        <svg class="w-4 h-4 inline-block" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                    </button>
                </div>
            </td>
        `;
        list.appendChild(row);
    });

    updateSelectionUI();
    updateSortIcons();

    // 渲染持股摘要 (若有指定特定股票)
    const summaryContainer = document.getElementById('trade-summary-container');
    if (summaryContainer) {
        if (filterCode && filteredTrades.length > 0) {
            summaryContainer.classList.remove('hidden');
            document.getElementById('summary-cost').innerText = '計算中...';

            // 抓取報價與計算
            getQuoteForCode(filterCode).then(quote => {
                const price = quote && quote.price ? quote.price : 0;
                const metrics = calculateStockMetrics(filterCode, price);

                document.getElementById('summary-cost').innerText = Math.round(metrics.totalCost).toLocaleString();
                document.getElementById('summary-breakeven').innerText = metrics.breakEvenPrice > 0 ? metrics.breakEvenPrice.toFixed(2) : '0.00';
                document.getElementById('summary-market-value').innerText = Math.round(metrics.marketValue).toLocaleString();
                document.getElementById('summary-shares').innerText = metrics.shares.toLocaleString();
                document.getElementById('summary-avg-price').innerText = metrics.avgPrice > 0 ? metrics.avgPrice.toFixed(2) : '0.00';

                const unrealizedEl = document.getElementById('summary-unrealized');
                if (metrics.unrealized > 0) {
                    unrealizedEl.innerHTML = `未實現 <span class="text-red-500">+${Math.round(metrics.unrealized).toLocaleString()}</span>`;
                } else if (metrics.unrealized < 0) {
                    unrealizedEl.innerHTML = `未實現 <span class="text-green-500">${Math.round(metrics.unrealized).toLocaleString()}</span>`;
                } else {
                    unrealizedEl.innerHTML = `未實現 0`;
                }
            }).catch(err => {
                console.error('取得總結報價失敗:', err);
            });
        } else {
            summaryContainer.classList.add('hidden');
        }
    }
}

function updateSelectionUI() {
    const checkboxes = document.querySelectorAll('.trade-checkbox');
    const selectAll = document.getElementById('trade-select-all');
    const batchDeleteBtn = document.getElementById('btn-trade-batch-delete');
    const batchDeleteText = document.getElementById('btn-trade-batch-delete-text');

    if (checkboxes.length > 0) {
        let allChecked = Array.from(checkboxes).every(cb => cb.checked);
        if (selectAll) selectAll.checked = allChecked;

        checkboxes.forEach(cb => {
            const tr = cb.closest('tr');
            if (tr) {
                if (cb.checked) {
                    tr.classList.remove('hover:bg-blue-50');
                    tr.classList.add('bg-blue-50');
                } else {
                    tr.classList.remove('bg-blue-50');
                    tr.classList.add('hover:bg-blue-50');
                }
            }
        });
    } else {
        if (selectAll) selectAll.checked = false;
    }

    if (batchDeleteBtn && batchDeleteText) {
        if (selectedTradeIds.size > 0) {
            batchDeleteText.innerText = `刪除所選 (${selectedTradeIds.size})`;
            batchDeleteBtn.classList.remove('hidden');
            batchDeleteBtn.classList.add('flex');
        } else {
            batchDeleteBtn.classList.add('hidden');
            batchDeleteBtn.classList.remove('flex');
        }
    }
}

function updateSortIcons() {
    ['date', 'brokerId', 'code', 'type'].forEach(col => {
        const icon = document.getElementById(`sort-icon-${col}`);
        if (icon) {
            if (currentSortColumn === col) {
                icon.innerText = currentSortDirection === 'asc' ? '▲' : '▼';
                icon.classList.remove('text-slate-300');
                icon.classList.add('text-blue-500');
            } else {
                icon.innerText = '';
                icon.classList.add('text-slate-300');
                icon.classList.remove('text-blue-500');
            }
        }
    });
}
