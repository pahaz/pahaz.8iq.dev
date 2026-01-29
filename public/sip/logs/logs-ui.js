/**
 * Intercom Analytics UI Core
 */
(function () {
    'use strict';

    // --- 1. DOM ELEMENTS (EL) ---
    // Кэшируем все элементы интерфейса
    const q = (id) => document.getElementById(id);
    const LOCAL_UI_STATE = 'ui_state_data'
    const DEFAULT_DETAILS_LIMIT = 100;

    const el = {
        // Nav
        navButtons: document.querySelectorAll('.nav-btn'),
        views: document.querySelectorAll('.view-section'),

        // Upload View
        dropZone: q('dropZone'),
        btnUpload: q('btnUpload'),
        fileInput: (() => {
            // Создаем скрытый input для выбора файлов, если его нет
            let input = q('hidden-file-input');
            if (!input) {
                input = document.createElement('input');
                input.type = 'file';
                input.multiple = true;
                input.id = 'hidden-file-input';
                input.style.display = 'none';
                document.body.appendChild(input);
            }
            return input;
        })(),
        progressWrapper: q('progressWrapper'),
        progressBar: q('progressBar'),
        statusText: q('statusText'),

        // Filters
        filterDateStart: q('filterDateStart'),
        filterDateEnd: q('filterDateEnd'),
        filterStatus: q('filterStatus'),
        filterApt: q('filterApt'),
        filterPanel: q('filterPanel'),
        filterId: q('filterId'),
        filterPush: q("filterPush"),
        btnApplyFilters: q('btnApplyFilters'),

        // Export
        btnExport: q('btnExport'),

        // Dashboard Metrics
        valTotal: q('val-total'),
        valTotalAll: q('val-total-all'),
        percTotal: q('perc-total'),
        percTotalAll: q('perc-total-all'),
        valAnswered: q('val-answered'),
        valAnsweredAll: q('val-answered-all'),
        percAnswered: q('perc-answered'),
        percAnsweredAll: q('perc-answered-all'),
        valOpened: q('val-opened'),
        valOpenedAll: q('val-opened-all'),
        percOpened: q('perc-opened'),
        percOpenedAll: q('perc-opened-all'),
        valMissed: q('val-missed'),
        valMissedAll: q('val-missed-all'),
        percMissed: q('perc-missed'),
        percMissedAll: q('perc-missed-all'),
        valFail: q('val-fail'),
        valFailAll: q('val-fail-all'),
        percFail: q('perc-fail'),
        percFailAll: q('perc-fail-all'),

        // Push Metrics
        valPushSent: q("val-push-sent"),
        valPushSentAll: q("val-push-sent-all"),
        percPushSent: q("perc-push-sent"),
        percPushSentAll: q("perc-push-sent-all"),
        valPushSuccess: q("val-push-success"),
        valPushSuccessAll: q("val-push-success-all"),
        percPushSuccess: q("perc-push-success"),
        percPushSuccessAll: q("perc-push-success-all"),
        valPushFail: q("val-push-fail"),
        valPushFailAll: q("val-push-fail-all"),
        percPushFail: q("perc-push-fail"),
        percPushFailAll: q("perc-push-fail-all"),

        valPushNo: q("val-push-no"),
        valPushNoAll: q("val-push-no-all"),
        percPushNo: q("perc-push-no"),
        percPushNoAll: q("perc-push-no-all"),

        // Doma Push Metrics
        valPushDomaSent: q("val-push-doma-sent"),
        valPushDomaSentAll: q("val-push-doma-sent-all"),
        percPushDomaSent: q("perc-push-doma-sent"),
        percPushDomaSentAll: q("perc-push-doma-sent-all"),
        valPushDomaSuccess: q("val-push-doma-success"),
        valPushDomaSuccessAll: q("val-push-doma-success-all"),
        percPushDomaSuccess: q("perc-push-doma-success"),
        percPushDomaSuccessAll: q("perc-push-doma-success-all"),
        valPushDomaFail: q("val-push-doma-fail"),
        valPushDomaFailAll: q("val-push-doma-fail-all"),
        percPushDomaFail: q("perc-push-doma-fail"),
        percPushDomaFailAll: q("perc-push-doma-fail-all"),

        valPushDomaNo: q("val-push-doma-no"),
        valPushDomaNoAll: q("val-push-doma-no-all"),
        percPushDomaNo: q("perc-push-doma-no"),
        percPushDomaNoAll: q("perc-push-doma-no-all"),

        // Charts
        canvasHistory: q('chartHistory'),
        historyGroup: q('historyGroup'),
        historyBreakdown: q('historyBreakdown'),
        togglePercentMode: q('togglePercentMode'),
        toggleWebhookLines: q('toggleWebhookLines'),
        togglePushDomaLines: q('togglePushDomaLines'),
        canvasStatus: q('chartStatus'),
        canvasTopPanels: q('chartTopPanels'),
        canvasPanelAnalysis: q('chartPanelAnalysis'),
        panelBreakdown: q('panelBreakdown'),
        canvasDuration: q('chartDuration'),
        durationBreakdown: q('durationBreakdown'),
        durationInterval: q('durationInterval'),

        // Details List
        callsTableBody: q('callsTableBody'),
        callsTableMore: q('callsTableMore'),

        // Details Panel
        detailPlaceholder: q('detailPlaceholder'),
        detailContent: q('detailContent'),
        dId: q('d-id'),
        dDate: q('d-date'),
        dDuration: q('d-duration'),
        dPanel: q('d-panel'),
        dApt: q('d-apt'),
        dMos: q('d-mos'),
        dStatusBadge: q('d-status-badge'),
        dTimeline: q('d-timeline'),
        dLogPanel: q('d-log-panel'),
        dLogClient: q('d-log-client'),
        timelineFilters: q('timeline-filters'),
        // Modal
        dataModal: q('dataModal'),
        modalDataContent: q('modalDataContent'),
        closeModalBtn: q('closeModalBtn'),
    };

    // --- 2. STATE ---
    const STATUS_COLORS = {
        opened: '#059669',   // Emerald 600
        answered: '#10b981', // Emerald 500
        missed: '#ef4444',   // Red 500
        fail: '#94a3b8'      // Slate 400
    };

    const state = {
        // Основное хранилище звонков (Map для быстрого поиска по ID или массив)
        // Используем массив для совместимости с фильтрами, но при мердже будем искать
        allCalls: [],

        // Отфильтрованные данные для отображения
        filteredData: [],

        // Зарегистрированные обработчики файлов
        // Структура: { check: (content) => bool, parse: (content) => CallObject[] }
        fileHandlers: [],

        // Скрытые источники событий для текущего просмотра
        hiddenTimelineSources: new Set(),

        // История ввода фильтров
        inputHistory: {
            apt: [],
            panel: [],
            id: []
        },

        // Инстансы графиков Chart.js
        charts: {},

        historyGrouping: 'day',
        historyBreakdown: 'none',
        historyPercentMode: false,
        showWebhookLines: false,
        showPushDomaLines: false,
        durationBreakdown: 'none',
        durationInterval: '2s',
        panelBreakdown: 'none',

        activeCallId: null,
        detailsLimit: DEFAULT_DETAILS_LIMIT,
    };

    // --- 3. UI LOGIC ---
    const ui = {
        init() {
            this.loadSettings(); // Загружаем и текущие значения, и историю
            this.bindEvents();
            this.renderDashboard(); // Инициализация графиков пустыми данными
        },

        // --- Управление режимами ---
        switchMode(modeName) {
            el.navButtons.forEach(btn => btn.classList.remove('active'));
            const map = { 'upload': 0, 'dashboard': 1, 'details': 2 };
            if (el.navButtons[map[modeName]]) {
                el.navButtons[map[modeName]].classList.add('active');
            }

            el.views.forEach(sec => sec.classList.remove('active'));
            const activeSection = document.getElementById(`view-${modeName}`);
            if (activeSection) activeSection.classList.add('active');

            // Показываем фильтры только для аналитики
            const sharedFilters = q('shared-filters');
            if (sharedFilters) {
                sharedFilters.style.display = (modeName === 'dashboard' || modeName === 'details') ? 'flex' : 'none';
            }

            if (modeName === 'dashboard') this.renderDashboard();
            if (modeName === 'details') this.renderDetailsList();
        },
        // --- Отрисовка прогресса ---
        showProgress(percent, text) {
            el.progressWrapper.style.display = 'block';
            el.progressBar.style.width = `${percent}%`;
            if (text) el.statusText.textContent = text;
        },

        hideProgress(finalText, isError = false) {
            if (finalText) {
                el.statusText.textContent = finalText;
                el.statusText.style.color = isError ? 'var(--danger)' : 'var(--success)';
            }
            setTimeout(() => {
                if (!isError) el.progressWrapper.style.display = 'none';
            }, 2000);
        },

        exportData() {
            if (!state.allCalls || state.allCalls.length === 0) {
                alert('Нет данных для экспорта');
                return;
            }

            try {
                const jsonStr = toSortedJsonString(state.allCalls);
                const blob = new Blob([jsonStr], { type: 'application/json' });
                const url = URL.createObjectURL(blob);

                const a = document.createElement('a');
                a.href = url;
                const dateStr = new Date().toISOString().split('T')[0];
                a.download = `intercom_logs_export_${dateStr}.json`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            } catch (e) {
                console.error('Export failed:', e);
                alert('Ошибка при экспорте данных');
            }
        },

        // --- Отрисовка Дашборда ---
        renderDashboard() {
            const data = state.filteredData;
            const total = data.length;
            const allData = state.allCalls;
            const totalAll = allData.length;

            // Определяем статусы согласно обновленной логике парсера
            const getStats = (dList) => ({
                answered: dList.filter(d => d.call_status === 'answered').length,
                opened: dList.filter(d => d.call_status === 'opened').length,
                missed: dList.filter(d => d.call_status === 'missed').length,
                fail: dList.filter(d => !['answered', 'opened', 'missed'].includes(d.call_status)).length
            });

            const stats = getStats(data);
            const statsAll = getStats(allData);

            const updateMetric = (elVal, elValAll, elPerc, elPercAll, val, valAll, totalVal, totalAllVal) => {
                if (elVal) elVal.innerText = val;
                if (elValAll) elValAll.innerText = `(${valAll})`;
                if (elPerc) elPerc.innerText = totalVal > 0 ? Math.round((val / totalVal) * 100) + '%' : '0%';
                if (elPercAll) elPercAll.innerText = totalAllVal > 0 ? `(${Math.round((val / totalAllVal) * 100)}% / ${Math.round((valAll / totalAllVal) * 100)}%)` : '(0%)';
            };

            if (el.valTotal) el.valTotal.innerText = total;
            if (el.valTotalAll) el.valTotalAll.innerText = `(${totalAll})`;

            updateMetric(el.valTotal, el.valTotalAll, el.percTotal, el.percTotalAll, total, totalAll, total, totalAll);
            updateMetric(el.valAnswered, el.valAnsweredAll, el.percAnswered, el.percAnsweredAll, stats.answered, statsAll.answered, total, totalAll);
            updateMetric(el.valOpened, el.valOpenedAll, el.percOpened, el.percOpenedAll, stats.opened, statsAll.opened, total, totalAll);
            updateMetric(el.valMissed, el.valMissedAll, el.percMissed, el.percMissedAll, stats.missed, statsAll.missed, total, totalAll);
            updateMetric(el.valFail, el.valFailAll, el.percFail, el.percFailAll, stats.fail, statsAll.fail, total, totalAll);

            // Подсчет статистики по пуш-уведомлениям
            const pushStats = this.calculatePushStats(data);
            const pushStatsAll = this.calculatePushStats(allData);

            updateMetric(el.valPushSent, el.valPushSentAll, el.percPushSent, el.percPushSentAll, pushStats.totalSent, pushStatsAll.totalSent, total, totalAll);
            updateMetric(el.valPushSuccess, el.valPushSuccessAll, el.percPushSuccess, el.percPushSuccessAll, pushStats.totalSentSuccess, pushStatsAll.totalSentSuccess, total, totalAll);
            updateMetric(el.valPushFail, el.valPushFailAll, el.percPushFail, el.percPushFailAll, pushStats.totalSentFail, pushStatsAll.totalSentFail, total, totalAll);
            updateMetric(el.valPushNo, el.valPushNoAll, el.percPushNo, el.percPushNoAll, pushStats.totalNo, pushStatsAll.totalNo, total, totalAll);

            // Подсчет статистики по пуш-уведомлениям Doma
            const pushStatsDoma = this.calculatePushStatsDoma(data);
            const pushStatsDomaAll = this.calculatePushStatsDoma(allData);

            updateMetric(el.valPushDomaSent, el.valPushDomaSentAll, el.percPushDomaSent, el.percPushDomaSentAll, pushStatsDoma.totalSent, pushStatsDomaAll.totalSent, total, totalAll);
            updateMetric(el.valPushDomaSuccess, el.valPushDomaSuccessAll, el.percPushDomaSuccess, el.percPushDomaSuccessAll, pushStatsDoma.totalSentSuccess, pushStatsDomaAll.totalSentSuccess, total, totalAll);
            updateMetric(el.valPushDomaFail, el.valPushDomaFailAll, el.percPushDomaFail, el.percPushDomaFailAll, pushStatsDoma.totalSentFail, pushStatsDomaAll.totalSentFail, total, totalAll);
            updateMetric(el.valPushDomaNo, el.valPushDomaNoAll, el.percPushDomaNo, el.percPushDomaNoAll, pushStatsDoma.totalNo, pushStatsDomaAll.totalNo, total, totalAll);

            this.updateCharts(data);
        },

        updateCharts(data) {
            if (typeof Chart === 'undefined') return;

            this.renderHistoryChart(data);
            this.renderDurationChart(data);
            this.renderPanelAnalysisChart(data);
        },

        renderHistoryChart(data) {
            // Группировка
            const groups = {};
            const breakdownKeys = new Set();
            const breakdownMode = state.historyBreakdown;

            const keyField = breakdownMode === 'panel' ? 'panel_id' : (breakdownMode === 'apt' ? 'apartment_id' : null);
            let topGroups = [];
            const groupToIdx = new Map();

            if (keyField) {
                const groupCounts = new Map();
                data.forEach(d => {
                    const val = d[keyField] || (breakdownMode === 'panel' ? 'Unknown Panel' : 'Unknown Apt');
                    groupCounts.set(val, (groupCounts.get(val) || 0) + 1);
                });
                topGroups = Array.from(groupCounts.entries())
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 20)
                    .map(g => g[0]);
                topGroups.forEach((g, i) => groupToIdx.set(g, i));
            }

            data.forEach(d => {
                let timeKey = 'Unknown';
                if (d.start_call_time) {
                    if (state.historyGrouping === 'hour') {
                        const date = d.start_call_time.toISOString().split('T')[0];
                        const hour = d.start_call_time.getHours().toString().padStart(2, '0');
                        timeKey = `${date} ${hour}:00`;
                    } else if (state.historyGrouping === '15min') {
                        const date = d.start_call_time.toISOString().split('T')[0];
                        const hour = d.start_call_time.getHours().toString().padStart(2, '0');
                        const min = (Math.floor(d.start_call_time.getMinutes() / 15) * 15).toString().padStart(2, '0');
                        timeKey = `${date} ${hour}:${min}`;
                    } else if (state.historyGrouping === '1min') {
                        const date = d.start_call_time.toISOString().split('T')[0];
                        const hour = d.start_call_time.getHours().toString().padStart(2, '0');
                        const min = d.start_call_time.getMinutes().toString().padStart(2, '0');
                        timeKey = `${date} ${hour}:${min}`;
                    } else {
                        timeKey = d.start_call_time.toISOString().split('T')[0];
                    }
                }

                let breakdownKey = 'Total';
                if (breakdownMode !== 'none') {
                    const val = d[keyField] || (breakdownMode === 'panel' ? 'Unknown Panel' : 'Unknown Apt');
                    breakdownKey = groupToIdx.has(val) ? val : 'others';
                }
                breakdownKeys.add(breakdownKey);

                if (!groups[timeKey]) groups[timeKey] = {};
                
                const status = d.call_status || 'fail';
                if (!groups[timeKey][status]) groups[timeKey][status] = { _total: 0 };
                if (!groups[timeKey][status][breakdownKey]) groups[timeKey][status][breakdownKey] = 0;

                groups[timeKey][status]._total++;
                groups[timeKey][status][breakdownKey]++;

                // Сбор статистики по вебхукам и пушам Дома для графика
                if (!groups[timeKey]._extra) {
                    groups[timeKey]._extra = {
                        webhookSuccess: 0,
                        webhookFail: 0,
                        webhookNo: 0,
                        pushDomaSuccess: 0,
                        pushDomaFail: 0,
                        pushDomaNo: 0,
                    };
                }
                
                const pushes = d.events.filter(x => x.event_type === 'push_call_sent' || x.event_type === 'push_call_send_start');
                if (pushes.length > 0) {
                    if (pushes.some(x => x?.meta?.success)) groups[timeKey]._extra.webhookSuccess++;
                    else groups[timeKey]._extra.webhookFail++;
                } else {
                    groups[timeKey]._extra.webhookNo++;
                }

                const pushesDoma = d.events.filter(x => x.event_type === 'push_sent_worker' && x?.meta?.type === 'VOIP_INCOMING_CALL_MESSAGE');
                if (pushesDoma.length > 0) {
                    if (pushesDoma.some(x => x?.meta?.success)) groups[timeKey]._extra.pushDomaSuccess++;
                    else groups[timeKey]._extra.pushDomaFail++;
                } else {
                    groups[timeKey]._extra.pushDomaNo++;
                }
            });

            const labels = Object.keys(groups).sort();
            const sortedBreakdownKeys = Array.from(breakdownKeys).sort();

            const statusConfigs = [
                { label: 'Дверь открыта', key: 'opened', color: STATUS_COLORS.opened },
                { label: 'Отвечено', key: 'answered', color: STATUS_COLORS.answered },
                { label: 'Пропущено', key: 'missed', color: STATUS_COLORS.missed },
                { label: 'Fail', key: 'fail', color: STATUS_COLORS.fail }
            ];

            const datasets = [];
            statusConfigs.forEach(statusCfg => {
                const statusKey = statusCfg.key;
                
                // Считаем суммарное количество для каждой breakdown-группы в рамках этого статуса
                const breakdownTotals = {};
                breakdownKeys.forEach(breakKey => {
                    let total = 0;
                    labels.forEach(l => {
                        total += (groups[l][statusKey] && groups[l][statusKey][breakKey]) || 0;
                    });
                    breakdownTotals[breakKey] = total;
                });

                // Сортируем ключи разбивки по убыванию общего количества
                const sortedKeysForStatus = Array.from(breakdownKeys).sort((a, b) => {
                    const diff = breakdownTotals[b] - breakdownTotals[a];
                    if (diff !== 0) return diff;
                    return a.localeCompare(b); // Стабильная сортировка при равных значениях
                });

                sortedKeysForStatus.forEach(breakKey => {
                    const data = labels.map(l => {
                        const val = (groups[l][statusKey] && groups[l][statusKey][breakKey]) || 0;
                        if (state.historyPercentMode) {
                            const totalInBucket = Object.values(groups[l])
                                .filter(v => typeof v === 'object' && v._total !== undefined)
                                .reduce((sum, v) => sum + v._total, 0);
                            return totalInBucket > 0 ? (val / totalInBucket * 100) : 0;
                        }
                        return val;
                    });

                    const dataset = {
                        label: breakdownMode === 'none' ? statusCfg.label : `${statusCfg.label} (${breakKey})`,
                        data: data,
                        backgroundColor: statusCfg.color,
                        stack: 'stack0',
                        stacked: true,
                        statusKey: statusKey,
                        breakdownKey: breakKey,
                        statusLabel: statusCfg.label,
                        groupLabel: breakdownMode === 'none' ? statusCfg.label : breakKey,
                        order: 2 // Рисуем столбцы под линиями
                    };
                    
                    const hasData = dataset.data.some(v => v > 0);
                    if (hasData) {
                        datasets.push(dataset);
                    }
                });
            });

            // Добавляем линии для вебхуков и пушей Дома
            const addExtraLineDatasets = (configs) => {
                configs.forEach(cfg => {
                    const data = labels.map(l => {
                        const val = (groups[l]._extra && groups[l]._extra[cfg.key]) || 0;
                        if (state.historyPercentMode) {
                            const totalInBucket = Object.values(groups[l])
                                .filter(v => typeof v === 'object' && v._total !== undefined)
                                .reduce((sum, v) => sum + v._total, 0);
                            return totalInBucket > 0 ? (val / totalInBucket * 100) : 0;
                        }
                        return val;
                    });

                    const dataset = {
                        type: 'line',
                        label: cfg.label,
                        data: data,
                        borderColor: cfg.color,
                        backgroundColor: cfg.color,
                        borderWidth: 2,
                        borderDash: cfg.dashed ? [5, 5] : [],
                        fill: false,
                        tension: 0.1,
                        pointRadius: 3,
                        stacked: false,
                        yAxisID: 'y',
                        order: 1 // Рисуем линии поверх столбцов
                    };
                    if (dataset.data.some(v => v > 0)) {
                        datasets.push(dataset);
                    }
                });
            };

            if (state.showWebhookLines) {
                const webhookConfigs = [
                    { label: 'Вебхуки успешно', key: 'webhookSuccess', color: STATUS_COLORS.opened, dashed: false },
                    { label: 'Вебхуки неуспешно', key: 'webhookFail', color: STATUS_COLORS.missed, dashed: true },
                    { label: 'Вебхуки пропущен', key: 'webhookNo', color: STATUS_COLORS.fail, dashed: true },
                ];
                addExtraLineDatasets(webhookConfigs);
            }

            if (state.showPushDomaLines) {
                const pushDomaConfigs = [
                    { label: 'Пуши Дома успешно', key: 'pushDomaSuccess', color: STATUS_COLORS.opened, dashed: false },
                    { label: 'Пуши Дома неуспешно', key: 'pushDomaFail', color: STATUS_COLORS.missed, dashed: true },
                    { label: 'Пуши Дома пропущен', key: 'pushDomaNo', color: STATUS_COLORS.fail, dashed: true },
                ];
                addExtraLineDatasets(pushDomaConfigs);
            }

            const chartData = {
                labels,
                datasets
            };

            const options = {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: { stacked: true },
                    y: { 
                        beginAtZero: true,
                        max: state.historyPercentMode ? 100 : undefined,
                        ticks: {
                            callback: function(value) {
                                if (state.historyPercentMode) return value + '%';
                                if (value % 1 === 0) return value;
                            }
                        }
                    }
                },
                plugins: {
                    legend: { 
                        display: breakdownMode === 'none' || datasets.some(ds => ds.type === 'line'),
                        position: 'bottom' 
                    },
                    tooltip: {
                        callbacks: {
                            label: function (context) {
                                let dataset = context.dataset;
                                const val = context.parsed.y;
                                if (val === null || val === 0) return null;

                                const bucketIdx = context.dataIndex;
                                const datasets = context.chart.data.datasets;

                                // Общее количество в этом бакете (столбце)
                                const totalInBucket = datasets
                                    .filter(ds => ds.type !== 'line')
                                    .reduce((sum, ds) => sum + (ds.data[bucketIdx] || 0), 0);

                                const currentStatusLabel = dataset.statusLabel;
                                const currentGroupLabel = dataset.groupLabel;

                                if (dataset.type === 'line') {
                                    // Если state.historyPercentMode = true, то val — это уже процент (0..100)
                                    // Если false, то val — абсолютное значение.
                                    let absoluteVal = state.historyPercentMode ? (val * totalInBucket / 100) : val;
                                    let percentVal = state.historyPercentMode ? val : (totalInBucket > 0 ? (val / totalInBucket * 100) : 0);

                                    // Округляем для красоты, если это не целое
                                    const absStr = Number.isInteger(absoluteVal) ? absoluteVal : absoluteVal.toFixed(1);
                                    const percStr = percentVal.toFixed(1);

                                    return [
                                        `${dataset.label}: ${absStr} (${percStr}% от столбика)`,
                                        `Всего: ${totalInBucket} в столбике`,
                                    ];
                                }

                                if (breakdownMode === 'none') {
                                    let absoluteVal = state.historyPercentMode ? (val * totalInBucket / 100) : val;
                                    let percentVal = state.historyPercentMode ? val : (totalInBucket > 0 ? (val / totalInBucket * 100) : 0);

                                    const absStr = Number.isInteger(absoluteVal) ? absoluteVal : absoluteVal.toFixed(1);
                                    const percStr = percentVal.toFixed(1);

                                    return [
                                        `${currentGroupLabel}: ${absStr} (${percStr}% от столбика)`,
                                        `Всего: ${totalInBucket} в столбике`,
                                    ];
                                } else {
                                    // Всего этого статуса (цвета) в бакете
                                    const totalStatusInBucket = datasets
                                        .filter(ds => ds.statusLabel === currentStatusLabel)
                                        .reduce((sum, ds) => sum + (ds.data[bucketIdx] || 0), 0);

                                    let absoluteVal = state.historyPercentMode ? (val * totalInBucket / 100) : val;
                                    let percentVal = state.historyPercentMode ? val : (totalInBucket > 0 ? (val / totalInBucket * 100) : 0);
                                    
                                    let absoluteStatusVal = state.historyPercentMode ? (totalStatusInBucket * totalInBucket / 100) : totalStatusInBucket;
                                    let percentStatusVal = state.historyPercentMode ? totalStatusInBucket : (totalInBucket > 0 ? (totalStatusInBucket / totalInBucket * 100) : 0);

                                    const absStr = Number.isInteger(absoluteVal) ? absoluteVal : absoluteVal.toFixed(1);
                                    const percStr = percentVal.toFixed(1);
                                    const absStatusStr = Number.isInteger(absoluteStatusVal) ? absoluteStatusVal : absoluteStatusVal.toFixed(1);
                                    const percStatusStr = percentStatusVal.toFixed(1);

                                    return [
                                        `${currentGroupLabel} [${currentStatusLabel}]: ${absStr} (${percStr}% от столбика)`,
                                        `${currentStatusLabel}: ${absStatusStr} (${percStatusStr}% от столбика)`,
                                        `Всего: ${totalInBucket} в столбике`,
                                    ];
                                }
                            }
                        }
                    }
                }
            };

            if (state.charts.history) {
                state.charts.history.data = chartData;
                state.charts.history.options = options;
                state.charts.history.update();
            } else {
                state.charts.history = new Chart(el.canvasHistory, {
                    type: 'bar',
                    data: chartData,
                    options: options
                });
            }
        },

        renderDurationChart(data) {
            if (!el.canvasDuration) return;

            const breakdownMode = state.durationBreakdown || 'none';
            const intervalMode = state.durationInterval || '2s';

            // Определяем интервалы (бакеты) длительности
            const buckets = [];
            const step = intervalMode === '1s' ? 1 : 2;
            for (let i = 0; i < 60; i += step) {
                buckets.push({ label: `${i}-${i + step} с`, max: i + step });
            }
            buckets.push({ label: '1-2 мин', max: 120 });
            buckets.push({ label: '> 2 мин', max: Infinity });

            const labels = buckets.map(b => b.label);
            let datasets = [];

            if (breakdownMode === 'none') {
                const distribution = buckets.map(b => ({
                    stats: { answered: 0, opened: 0, missed: 0, fail: 0 }
                }));

                data.forEach(d => {
                    const duration = parseFloat(d.duration_sec) || 0;
                    const bucketIdx = buckets.findIndex(b => duration < b.max);
                    if (bucketIdx !== -1) {
                        const s = d.call_status;
                        const stats = distribution[bucketIdx].stats;
                        if (stats.hasOwnProperty(s)) {
                            stats[s]++;
                        } else {
                            stats.fail++;
                        }
                    }
                });

                const createConfig = (label, key, color) => ({
                    label: label,
                    data: distribution.map(d => d.stats[key]),
                    backgroundColor: color,
                    stack: 'stackDuration',
                    statusLabel: label,
                    groupLabel: label
                });

                datasets = [
                    createConfig('Дверь открыта', 'opened', STATUS_COLORS.opened),
                    createConfig('Отвечено', 'answered', STATUS_COLORS.answered),
                    createConfig('Пропущено', 'missed', STATUS_COLORS.missed),
                    createConfig('Fail', 'fail', STATUS_COLORS.fail)
                ];
            } else {
                // Разбивка по панелям или квартирам
                const keyField = breakdownMode === 'panel' ? 'panel_id' : 'apartment_id';
                const groupCounts = new Map();

                data.forEach(d => {
                    const val = d[keyField] || 'Unknown';
                    groupCounts.set(val, (groupCounts.get(val) || 0) + 1);
                });

                // Берем топ-20, остальное в "Другие"
                const sortedGroups = Array.from(groupCounts.entries())
                    .sort((a, b) => b[1] - a[1]);

                const topGroups = sortedGroups.slice(0, 20).map(g => g[0]);
                const groupToIdx = new Map(topGroups.map((g, i) => [g, i]));

                // Группируем по [bucketIndex][status][groupIdx]
                // groupIdx = 0..19 для топ-20, 20 для "Другие"
                const distribution = buckets.map(() => ({
                    opened: new Array(topGroups.length + 1).fill(0),
                    answered: new Array(topGroups.length + 1).fill(0),
                    missed: new Array(topGroups.length + 1).fill(0),
                    fail: new Array(topGroups.length + 1).fill(0)
                }));

                // Для сортировки внутри каждого статуса нам нужны суммарные счетчики по группам для каждого статуса
                const statusGroupTotals = {
                    opened: new Array(topGroups.length + 1).fill(0),
                    answered: new Array(topGroups.length + 1).fill(0),
                    missed: new Array(topGroups.length + 1).fill(0),
                    fail: new Array(topGroups.length + 1).fill(0)
                };

                data.forEach(d => {
                    const duration = parseFloat(d.duration_sec) || 0;
                    const bucketIdx = buckets.findIndex(b => duration < b.max);
                    if (bucketIdx !== -1) {
                        const val = d[keyField] || 'Unknown';
                        const status = ['opened', 'answered', 'missed'].includes(d.call_status) ? d.call_status : 'fail';
                        let gIdx = groupToIdx.has(val) ? groupToIdx.get(val) : topGroups.length;
                        distribution[bucketIdx][status][gIdx]++;
                        statusGroupTotals[status][gIdx]++;
                    }
                });

                const statusConfigs = [
                    { label: 'Дверь открыта', key: 'opened', color: STATUS_COLORS.opened },
                    { label: 'Отвечено', key: 'answered', color: STATUS_COLORS.answered },
                    { label: 'Пропущено', key: 'missed', color: STATUS_COLORS.missed },
                    { label: 'Fail', key: 'fail', color: STATUS_COLORS.fail }
                ];

                statusConfigs.forEach(statusCfg => {
                    const statusKey = statusCfg.key;
                    
                    // Считаем количество активных групп для этого статуса
                    const activeGroupsCount = statusGroupTotals[statusKey].filter(count => count > 0).length;

                    // Создаем список индексов групп (0..14 + 15 для "Другие")
                    const indices = [];
                    for (let i = 0; i <= topGroups.length; i++) {
                        indices.push(i);
                    }

                    // Сортируем индексы по количеству элементов в данном статусе
                    indices.sort((a, b) => statusGroupTotals[statusKey][b] - statusGroupTotals[statusKey][a]);

                    indices.forEach(i => {
                        const count = statusGroupTotals[statusKey][i];
                        if (count === 0) return; // Пропускаем пустые группы для этого статуса

                        const isOther = i === topGroups.length;
                        const groupLabel = isOther ? 'Другие' : topGroups[i];

                        datasets.push({
                            label: `${statusCfg.label} [объектов: ${activeGroupsCount}] (${groupLabel})`,
                            data: distribution.map(d => d[statusKey][i]),
                            backgroundColor: statusCfg.color,
                            stack: 'stackDuration',
                            statusLabel: statusCfg.label,
                            groupLabel: groupLabel
                        });
                    });
                });
            }

            const chartData = {
                labels,
                datasets
            };

            const options = {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: { stacked: true },
                    y: { stacked: true, beginAtZero: true }
                },
                plugins: {
                    legend: { 
                        display: breakdownMode === 'none',
                        position: 'bottom' 
                    },
                    tooltip: {
                        callbacks: {
                            label: function (context) {
                                let dataset = context.dataset;
                                const val = context.parsed.y;
                                if (val === null || val === 0) return null;

                                const bucketIdx = context.dataIndex;
                                const datasets = context.chart.data.datasets;

                                // Общее количество в этом бакете (столбце)
                                const totalInBucket = datasets.reduce((sum, ds) => sum + (ds.data[bucketIdx] || 0), 0);

                                const currentStatusLabel = dataset.statusLabel;
                                const currentGroupLabel = dataset.groupLabel;

                                if (breakdownMode === 'none') {
                                    const percent = totalInBucket > 0 ? ((val / totalInBucket) * 100).toFixed(1) : 0;
                                    return [
                                        `${currentGroupLabel}: ${val} (${percent}% от столбика)`,
                                        `Всего: ${totalInBucket} в столбике`,
                                    ];
                                } else {
                                    // Всего этого статуса (цвета) в бакете
                                    const totalStatusInBucket = datasets
                                        .filter(ds => ds.statusLabel === currentStatusLabel)
                                        .reduce((sum, ds) => sum + (ds.data[bucketIdx] || 0), 0);

                                    // Всего этой группы в бакете
                                    const totalGroupInBucket = datasets
                                        .filter(ds => ds.groupLabel === currentGroupLabel)
                                        .reduce((sum, ds) => sum + (ds.data[bucketIdx] || 0), 0);

                                    const percOfTotal = totalInBucket > 0 ? ((val / totalInBucket) * 100).toFixed(1) : 0;
                                    const percStatusOfTotal = totalInBucket > 0 ? ((totalStatusInBucket / totalInBucket) * 100).toFixed(1) : 0;

                                    return [
                                        `${currentGroupLabel}: ${val} (${percOfTotal}% от столбика)`,
                                        `${currentStatusLabel}: ${totalStatusInBucket} (${percStatusOfTotal}% от столбика)`,
                                        `Всего: ${totalInBucket} в столбике`,
                                    ];
                                }
                            }
                        }
                    }
                }
            };

            if (state.charts.duration) {
                state.charts.duration.data = chartData;
                state.charts.duration.options = options;
                state.charts.duration.update();
            } else {
                state.charts.duration = new Chart(el.canvasDuration, {
                    type: 'bar',
                    data: chartData,
                    options: options
                });
            }
        },

        renderPanelAnalysisChart(data) {
            if (!el.canvasPanelAnalysis) return;

            const breakdownMode = state.panelBreakdown || 'none';

            // Группировка данных по панелям
            const panels = {};
            data.forEach(d => {
                const p = d.panel_id || 'Unknown';
                const apt = breakdownMode === 'none' ? 'ALL' : (d.apartment_id || 'N/A');
                if (!panels[p]) {
                    panels[p] = {
                        apts: {} // { aptId: { answered: 0, opened: 0, missed: 0, fail: 0, total: 0 } }
                    };
                }

                if (!panels[p].apts[apt]) {
                    panels[p].apts[apt] = { answered: 0, opened: 0, missed: 0, fail: 0, total: 0 };
                }

                const s = d.call_status;
                if (panels[p].apts[apt].hasOwnProperty(s)) {
                    panels[p].apts[apt][s]++;
                } else {
                    if (s === 'answered' || s === 'opened' || s === 'missed' || s === 'fail') {
                        panels[p].apts[apt][s]++;
                    }
                }
                panels[p].apts[apt].total++;
            });

            const statusConfigs = [
                { key: 'answered', label: 'Отвечено', color: STATUS_COLORS.answered, side: 'positive' },
                { key: 'opened', label: 'Открыто', color: STATUS_COLORS.opened, side: 'positive' },
                { key: 'missed', label: 'Пропущен', color: STATUS_COLORS.missed, side: 'negative' },
                { key: 'fail', label: 'Ошибка', color: STATUS_COLORS.fail, side: 'negative' }
            ];

            // Подсчет общих сумм для отображения в лейблах
            Object.values(panels).forEach(p => {
                p.totals = { answered: 0, opened: 0, missed: 0, fail: 0 };
                Object.values(p.apts).forEach(stats => {
                    statusConfigs.forEach(cfg => {
                        p.totals[cfg.key] += stats[cfg.key];
                    });
                });
            });

            // Сортировка панелей и генерация лейблов
            const panelKeys = Object.keys(panels).sort((a, b) => a.localeCompare(b));
            const panelLabels = panelKeys.map(k => {
                const p = panels[k];
                const pos = p.totals.answered + p.totals.opened;
                const neg = p.totals.missed + p.totals.fail;
                return `${k} (❌${neg} | ✅${pos})`;
            });

            const chartHeight = Math.max(400, panelKeys.length * 35 + 100);
            el.canvasPanelAnalysis.parentElement.style.height = `${chartHeight}px`;

            const datasets = [];
            // Находим максимальное кол-во групп на одной панели
            const maxGroupsCount = Math.max(...panelKeys.map(l => Object.keys(panels[l].apts).length));

            statusConfigs.forEach(statusCfg => {
                for (let i = 0; i < maxGroupsCount; i++) {
                    const isPositive = statusCfg.side === 'positive';
                    
                    datasets.push({
                        label: breakdownMode === 'none' ? statusCfg.label : `${statusCfg.label} (Группа #${i+1})`,
                        statusKey: statusCfg.key,
                        statusLabel: statusCfg.label,
                        groupIndex: i,
                        data: panelKeys.map(l => {
                            const sortedApts = Object.entries(panels[l].apts).sort((a, b) => b[1].total - a[1].total);
                            const aptData = sortedApts[i];
                            if (!aptData) return 0;
                            const val = aptData[1][statusCfg.key] || 0;
                            return isPositive ? val : -val;
                        }),
                        realValues: panelKeys.map(l => {
                            const sortedApts = Object.entries(panels[l].apts).sort((a, b) => b[1].total - a[1].total);
                            const aptData = sortedApts[i];
                            if (!aptData || aptData[1][statusCfg.key] <= 0) return null;
                            return breakdownMode === 'none' ? `${aptData[1][statusCfg.key]}` : `${aptData[0]}: ${aptData[1][statusCfg.key]}`;
                        }),
                        statusTotals: panelKeys.map(l => panels[l].totals[statusCfg.key]),
                        backgroundColor: statusCfg.color,
                        stack: 'main',
                        hiddenInLegend: i > 0
                    });
                }
            });

            if (state.charts.panelAnalysis) {
                state.charts.panelAnalysis.data.labels = panelLabels;
                state.charts.panelAnalysis.data.datasets = datasets;
                state.charts.panelAnalysis.options.plugins.tooltip.callbacks.label = (context) => {
                    const rv = context.dataset.realValues[context.dataIndex];
                    if (!rv) return null;
                    const statusLabel = context.dataset.statusLabel;
                    const totalStatusInRow = context.dataset.statusTotals[context.dataIndex];
                    
                    let icon = '❓';
                    if (context.dataset.statusKey === 'answered' || context.dataset.statusKey === 'opened') icon = '✅';
                    if (context.dataset.statusKey === 'missed' || context.dataset.statusKey === 'fail') icon = '❌';

                    if (breakdownMode === 'none') {
                        return `${icon} ${statusLabel}: ${totalStatusInRow}`;
                    } else {
                        // rv имеет формат "Apt: Count"
                        const [aptName, count] = rv.split(': ');
                        return [
                            `${icon} ${statusLabel}`,
                            `Группа: ${aptName}`,
                            `Объектов: ${count}`,
                            `(всего в сегменте: ${totalStatusInRow})`
                        ];
                    }
                };
                state.charts.panelAnalysis.update();
            } else {
                state.charts.panelAnalysis = new Chart(el.canvasPanelAnalysis, {
                    type: 'bar',
                    data: { labels: panelLabels, datasets },
                    options: {
                        indexAxis: 'y',
                        responsive: true,
                        maintainAspectRatio: false,
                        scales: {
                            x: {
                                stacked: true,
                                beginAtZero: false,
                                title: { display: true, text: '← Пропущенные/Ошибки | Отвечено/Открыто →' }
                            },
                            y: { stacked: true, beginAtZero: true }
                        },
                        plugins: {
                            tooltip: {
                                callbacks: {
                                    label: (context) => {
                                        const rv = context.dataset.realValues[context.dataIndex];
                                        if (!rv) return null;
                                        const statusLabel = context.dataset.statusLabel;
                                        const totalStatusInRow = context.dataset.statusTotals[context.dataIndex];
                                        
                                        let icon = '❓';
                                        if (context.dataset.statusKey === 'answered' || context.dataset.statusKey === 'opened') icon = '✅';
                                        if (context.dataset.statusKey === 'missed' || context.dataset.statusKey === 'fail') icon = '❌';

                                        if (breakdownMode === 'none') {
                                            return `${icon} ${statusLabel}: ${totalStatusInRow}`;
                                        } else {
                                            // rv имеет формат "Apt: Count"
                                            const [aptName, count] = rv.split(': ');
                                            return [
                                                `${icon} ${statusLabel}`,
                                                `Группа: ${aptName}`,
                                                `Объектов: ${count}`,
                                                `(всего в сегменте: ${totalStatusInRow})`
                                            ];
                                        }
                                    }
                                }
                            },
                            legend: {
                                position: 'bottom',
                                labels: {
                                    filter: (item, chartData) => {
                                        const ds = chartData.datasets[item.datasetIndex];
                                        if (ds && !ds.hiddenInLegend) {
                                            item.text = ds.statusLabel;
                                            return true;
                                        }
                                        return false;
                                    }
                                }
                            }
                        }
                    }
                });
            }
        },

        renderDetailsList() {
            el.callsTableBody.innerHTML = '';
            if (el.callsTableMore) el.callsTableMore.innerHTML = '';
            
            if (state.filteredData.length === 0) {
                el.callsTableBody.innerHTML = '<div class="empty-state">Нет данных</div>';
                return;
            }

            const dataToShow = state.filteredData.slice(0, state.detailsLimit);

            dataToShow.forEach(call => {
                const dateObj = call.start_call_time;
                const timeStr = !(dateObj instanceof Date) || isNaN(dateObj)
                    ? '-'
                    : dateObj.toLocaleString('ru-RU', { hour: '2-digit', minute:'2-digit', day:'numeric', month:'short' });

                const statusClassMap = { 'answered': 'status-answered', 'opened': 'status-opened', 'missed': 'status-missed', 'fail': 'status-fail' };
                const statusLabelMap = { 'answered': 'Принят', 'opened': 'Открыто', 'missed': 'Пропущен', 'fail': 'Ошибка' };

                // Определяем наличие пуш-уведомлений
                const hasSuccessPushCallNotifications = call.events.filter(x => x.event_type === 'push_call_sent' && x?.meta?.success).length > 0
                const hasSuccessCondoPushCallNotifications = call.events.filter(x => x.event_type === 'push_sent_worker' && x?.meta?.type === 'VOIP_INCOMING_CALL_MESSAGE' && x?.meta?.success).length > 0
                const hasSuccessBridge = call.events.filter(x => x.event_type === 'bridge' && x.source === 'Panel').length > 0
                const hasAnyAnswer = call.events.filter(x => x.event_type === 'answer' && x.source === 'Client').length > 0
                const hasAnyClient = call.events.filter(x => x.event_type === 'start' && x.source === 'Client').length > 0

                const row = document.createElement('div');
                row.className = `call-row ${state.activeCallId === call.id ? 'selected' : ''}`;
                row.onclick = () => this.selectCall(call);

                row.innerHTML = `
                            <div class="cr-top">
                                <span class="cr-time">${timeStr} ${hasSuccessPushCallNotifications ? '👌' : ''}${hasSuccessCondoPushCallNotifications ? '👌' : ''}${hasSuccessBridge ? '🤝' : (hasAnyAnswer ? '📞' : (hasAnyClient ? '📲' : ''))}</span>
                                <span class="cr-status ${statusClassMap[call.call_status] || ''}">
                                    ${statusLabelMap[call.call_status] || call.call_status}
                                </span>
                            </div>
                            <div class="cr-info">${call.panel_id || "-"} • ${call.apartment_id || "-"}</div>
                            <div class="cr-id">${call.id}</div>
                        `;
                el.callsTableBody.appendChild(row);
            });

            if (state.filteredData.length > state.detailsLimit) {
                const moreBtn = document.createElement('button');
                moreBtn.className = 'btn-secondary';
                moreBtn.style.width = '100%';
                moreBtn.style.margin = '10px 0';
                moreBtn.textContent = `Показать еще (${state.filteredData.length - state.detailsLimit})`;
                moreBtn.onclick = () => {
                    state.detailsLimit = Infinity;
                    this.renderDetailsList();
                };
                if (el.callsTableMore) {
                    el.callsTableMore.appendChild(moreBtn);
                } else {
                    el.callsTableBody.appendChild(moreBtn);
                }
            }
        },

        selectCall(call) {
            state.activeCallId = call.id;
            this.renderDetailsList();

            el.detailPlaceholder.style.display = 'none';
            el.detailContent.style.display = 'block';

            el.dId.textContent = call.id;

            const statusClassMap = { 'answered': 'status-answered', 'opened': 'status-opened', 'missed': 'status-missed', 'fail': 'status-fail' };
            el.dStatusBadge.className = `cr-status ${statusClassMap[call.call_status] || ''}`;
            el.dStatusBadge.textContent = call.call_status;

            // Заполнение сетки метаданных
            const grid = q('d-meta-grid');
            const cp = call.callPanel || {};
            const cc = call.callClient || {};

            const meta = [
                { label: 'Дата', value: call.start_call_time ? call.start_call_time.toLocaleDateString() : '-' },
                { label: 'Панель', value: call.panel_id || '-' },
                { label: 'Квартира', value: call.apartment_id || '-' },
                { label: 'Звонок / Разговор', value: (call.duration_sec || 0) + ' сек' + ' / ' + (call.speaking_time_sec || 0) + ' сек' },

                { type: 'title', label: 'Панель' },
                { label: 'Звонок / Разговор', value: (cp['variables.duration'] || 0) + ' сек' + ' / ' + (cp['variables.billsec'] || 0) + ' сек' },
                { label: 'Модель', value: cp['variables.sip_user_agent'] || '-' },
                { label: 'IP панели', value: cp['variables.sip_network_ip'] || '-' },
                { label: 'Звонок завершился', value: cp['variables.hangup_cause'] || '-' },
                { label: 'SIP завершился', value: cp['variables.sip_hangup_disposition'] || '-' },

                { type: 'title', label: 'Клиент' },
                { label: 'Звонок / Разговор', value: (cc['variables.duration'] || 0) + ' сек' + ' / ' + (cc['variables.billsec'] || 0) + ' сек' },
                { label: 'Модель', value: cc['variables.sip_user_agent'] || '-' },
                { label: 'IP панели', value: cc['variables.sip_network_ip'] || '-' },
                { label: 'Звонок завершился', value: cc['variables.hangup_cause'] || '-' },
                { label: 'SIP завершился', value: cc['variables.sip_hangup_disposition'] || '-' },

                { type: 'title', label: 'Audio (Панель | Клиент)' },
                { label: 'MOS', value: (cp['variables.rtp_audio_in_mos'] || '-') + '<br/>' + (cc['variables.rtp_audio_in_mos'] || '-') },
                { label: 'Кодек', value: (cp['variables.rtp_use_codec_name'] || '-') + '<br/>' + (cc['variables.rtp_use_codec_name'] || '-') },
                { label: 'Пакеты (In/Out)', value: (`${cp['variables.rtp_audio_in_media_packet_count'] || 0} / ${cp['variables.rtp_audio_out_media_packet_count'] || 0}`) + '<br/>' + (`${cc['variables.rtp_audio_in_media_packet_count'] || 0} / ${cc['variables.rtp_audio_out_media_packet_count'] || 0}`) },
                { label: 'DTMF (In/Out)', value: (`${cp['variables.rtp_audio_in_dtmf_packet_count'] || 0} / ${cp['variables.rtp_audio_out_dtmf_packet_count'] || 0}`) + '<br/>' + `${cc['variables.rtp_audio_in_dtmf_packet_count'] || 0} / ${cc['variables.rtp_audio_out_dtmf_packet_count'] || 0}` },

                { type: 'title', label: 'Video (Панель | Клиент)' },
                { label: 'MOS', value: (cp['variables.rtp_video_in_mos'] || '-') + '<br/>' + (cc['variables.rtp_video_in_mos'] || '-') },
                { label: 'Кодек', value: (cp['variables.rtp_use_video_codec_name'] || '-') + '<br/>' + (cc['variables.rtp_use_video_codec_name'] || '-') },
                { label: 'Пакеты (In/Out)', value: `${cp['variables.rtp_video_in_media_packet_count'] || 0} / ${cp['variables.rtp_video_out_media_packet_count'] || 0}` + '<br/>' + `${cc['variables.rtp_video_in_media_packet_count'] || 0} / ${cc['variables.rtp_video_out_media_packet_count'] || 0}` },
            ];

            grid.innerHTML = meta.map(m => m.type === 'title'
                ? `<div class="meta-section-title">${m.label}</div>`
                : `<div class="meta-item"><label>${m.label}</label><span>${m.value}</span></div>`
            ).join('');

            this.renderTimeline(call);

            // Обработка дополнительных "ног" (calls)
            const extraCont = q('d-extra-calls');
            const calls = call.calls || [];
            if (calls && calls.length >= 1) {
                const extraCalls = calls.filter((x) => x.id && x.id !== call.id && x.id !== call.callPanel?.id && x.id !== call.callClient?.id);

                const escapeHtml = (text) => {
                    const div = document.createElement('div')
                    div.textContent = text
                    return div.innerHTML
                }

                extraCont.innerHTML = `
                                ${extraCalls.map((c) => `
                        <details>
                            <summary>Плечо ID: ${c.id}</summary>
                            <div class="content">
                                    <div style="margin-bottom: 10px; padding: 8px; border: 1px solid #eee; border-radius: 4px;">
                                        <pre class="log-block" id="d-log-client">${escapeHtml(toSortedJsonString(c))}</pre>
                                    </div>
                            </div>
                        </details>
                                    
                                `).join('')}
                    `;
            } else {
                extraCont.innerHTML = '';
            }

            // Logs
            el.dLogPanel.textContent = toSortedJsonString(call.callPanel || {});
            el.dLogClient.textContent = toSortedJsonString(call.callClient || {});
        },

        bindEvents() {
            // Навигация по табам
            const modes = ['upload', 'dashboard', 'details'];
            el.navButtons.forEach((btn, index) => {
                btn.onclick = () => this.switchMode(modes[index]);
            });

            // Экспорт
            if (el.btnExport) {
                el.btnExport.onclick = () => this.exportData();
            }

            // Клик по кнопке загрузки открывает скрытый input
            el.btnUpload.onclick = () => el.fileInput.click();

            // Обработка выбора файла
            el.fileInput.onchange = (e) => {
                if (e.target.files.length) this.processFiles(e.target.files);
            };

            // Drag & Drop
            el.dropZone.ondragover = (e) => { e.preventDefault(); el.dropZone.style.background = '#eff6ff'; };
            el.dropZone.ondragleave = (e) => { e.preventDefault(); el.dropZone.style.background = 'transparent'; };
            el.dropZone.ondrop = (e) => {
                e.preventDefault();
                el.dropZone.style.background = 'transparent';
                if (e.dataTransfer.files.length) this.processFiles(e.dataTransfer.files);
            };

            // Ищем кнопку "Применить" внутри фильтров, если нет ID
            const applyBtn = document.querySelector('.filters-bar button');
            if(applyBtn) applyBtn.onclick = () => this.applyFilters();

            // Обработка Enter в фильтрах
            const filterInputs = document.querySelectorAll('.filters-bar input, .filters-bar select');
            filterInputs.forEach(input => {
                input.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        this.applyFilters();
                    }
                });
            });

            // Modal
            if (el.closeModalBtn) el.closeModalBtn.onclick = () => this.closeModal();

            // Переключение группировки графика
            if (el.historyGroup) {
                el.historyGroup.onchange = (e) => {
                    state.historyGrouping = e.target.value;
                    this.renderHistoryChart(state.filteredData);
                    this.saveSettings();
                };
            }
            if (el.historyBreakdown) {
                el.historyBreakdown.onchange = (e) => {
                    state.historyBreakdown = e.target.value;
                    this.renderHistoryChart(state.filteredData);
                    this.saveSettings();
                };
            }
            if (el.togglePercentMode) {
                el.togglePercentMode.onclick = () => {
                    state.historyPercentMode = !state.historyPercentMode;
                    el.togglePercentMode.classList.toggle('active', state.historyPercentMode);
                    this.renderHistoryChart(state.filteredData);
                    this.saveSettings();
                };
            }
            if (el.toggleWebhookLines) {
                el.toggleWebhookLines.onclick = () => {
                    state.showWebhookLines = !state.showWebhookLines;
                    el.toggleWebhookLines.classList.toggle('active', state.showWebhookLines);
                    this.renderHistoryChart(state.filteredData);
                    this.saveSettings();
                };
            }
            if (el.togglePushDomaLines) {
                el.togglePushDomaLines.onclick = () => {
                    state.showPushDomaLines = !state.showPushDomaLines;
                    el.togglePushDomaLines.classList.toggle('active', state.showPushDomaLines);
                    this.renderHistoryChart(state.filteredData);
                    this.saveSettings();
                };
            }
            if (el.durationBreakdown) {
                el.durationBreakdown.onchange = (e) => {
                    state.durationBreakdown = e.target.value;
                    this.renderDurationChart(state.filteredData);
                    this.saveSettings();
                };
            }

            if (el.durationInterval) {
                el.durationInterval.onchange = (e) => {
                    state.durationInterval = e.target.value;
                    this.renderDurationChart(state.filteredData);
                    this.saveSettings();
                };
            }
            if (el.panelBreakdown) {
                el.panelBreakdown.onchange = (e) => {
                    state.panelBreakdown = e.target.value;
                    this.renderDashboard();
                    this.saveSettings();
                };
            }

            window.addEventListener('click', (event) => {
                if (event.target == el.dataModal) {
                    this.closeModal();
                }
            });
        },

        // --- POPUP / MODAL ---
        showModal(data) {
            if (!el.dataModal || !el.modalDataContent) return;

            let content = '';
            if (typeof data === 'object') {
                try {
                    content = toSortedJsonString(data);
                } catch (e) {
                    content = String(data);
                }
            } else {
                content = String(data);
            }

            el.modalDataContent.textContent = content;
            el.dataModal.classList.add('active');
        },

        closeModal() {
            if (el.dataModal) el.dataModal.classList.remove('active');
        },

        // --- ЛОГИКА ОБРАБОТКИ ФАЙЛОВ ---

        async processFiles(fileList) {
            const files = Array.from(fileList);
            const total = files.length;
            if (total === 0) return;

            let successCount = 0;
            let errorCount = 0;

            this.showProgress(5, `В очереди файлов: ${total}...`);

            for (let i = 0; i < total; i++) {
                const file = files[i];
                const progress = Math.round(((i) / total) * 100);
                this.showProgress(progress, `Обработка [${i + 1}/${total}]: ${file.name}`);

                try {
                    let text = await this.readFileAsText(file);
                    if (text.startsWith('"') && text.endsWith('"')) {
                      try {
                        text = JSON.parse(text)
                      } catch (e) {
                        console.warn('trying to JSON.parse error', file.name, e)
                      }
                    }

                    // Поиск подходящего обработчика
                    const handler = state.fileHandlers.find(h => h.check(text));

                    if (!handler) {
                        console.warn(`Skipping ${file.name}: Unknown format`);
                        errorCount++;
                        continue;
                    }

                    const newCalls = handler.parse(text);

                    if (!Array.isArray(newCalls)) {
                        console.warn(`Skipping ${file.name}: Parser error`);
                        errorCount++;
                        continue;
                    }

                    this.mergeData(newCalls);
                    successCount++;

                } catch (err) {
                    console.error(`Error processing ${file.name}:`, err);
                    errorCount++;
                }
            }

            this.showProgress(100, 'Готово!');

            const resultMsg = errorCount > 0
                ? `Загружено: ${successCount}, Ошибок: ${errorCount}`
                : `Успешно загружено файлов: ${successCount}`;

            this.hideProgress(resultMsg, successCount === 0 && errorCount > 0);

            // Обновляем UI
            if (successCount > 0) {
                this.applyFilters();
                this.switchMode('dashboard');
            }

            el.fileInput.value = ''; // Сброс input
        },

        readFileAsText(file) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = (e) => resolve(e.target.result);
                reader.onerror = (e) => reject(e);
                reader.readAsText(file);
            });
        },

        // --- ГЛАВНАЯ ЛОГИКА МЕРДЖА ---
        mergeData(incomingCalls) {
            // Создаем Map текущих звонков для быстрого доступа по ID
            const callMap = new Map();
            state.allCalls.forEach(c => callMap.set(c.id, c));

            let newCount = 0;
            let updatedCount = 0;

            incomingCalls.forEach(inCall => {
                if (callMap.has(inCall.id)) {
                    // Звонок существует - ОБНОВЛЕНИЕ
                    const existing = callMap.get(inCall.id);
                    updatedCount++;

                    // 1. Перезаписываем поля верхнего уровня (стратегия: новые данные приоритетнее)
                    Object.keys(inCall).forEach(key => {
                        if (key !== 'events' && inCall[key] !== null && inCall[key] !== undefined) {
                            existing[key] = inCall[key];
                        }
                    });

                    // 2. Мердж событий (events)
                    if (inCall.events && Array.isArray(inCall.events)) {
                        const existingEventIds = new Set(existing.events.map(e => e.event_id));

                        inCall.events.forEach(newEvt => {
                            // Добавляем только если события с таким ID еще нет
                            if (!existingEventIds.has(newEvt.event_id)) {
                                existing.events.push(newEvt);
                            }
                        });
                    }

                } else {
                    // Звонок новый - ДОБАВЛЕНИЕ
                    state.allCalls.push(inCall);
                    newCount++;
                }
            });

            // Сортируем все звонки по времени начала (от новых к старым)
            // Звонки без start_call_time помещаются в конец списка
            state.allCalls.sort((a, b) => {
                const aTime = a.start_call_time
                const bTime = b.start_call_time
                // Если оба времени отсутствуют, сохраняем текущий порядок
                if (!aTime && !bTime) return 0
                // Если только у 'a' нет времени, помещаем 'a' в конец (после 'b')
                if (!aTime) return 1
                // Если только у 'b' нет времени, помещаем 'b' в конец (после 'a')
                if (!bTime) return -1
                // Оба времени присутствуют - сортируем от новых к старым
                return new Date(bTime) - new Date(aTime)
            })

            // Нормализация данных
            state.allCalls.forEach(c => {
                // call_status = fail | answered | opened | missed
                if (!['answered', 'opened', 'missed'].includes(c.call_status)) c.call_status = 'fail';

                // Сортировка событий по времени
                c.events.sort((a, b) => {
                    const t = a.timestamp - b.timestamp;
                    if (t !== 0) return t;

                    // Пересортируем по событию recv - получение
                    const aIsRecv = a?.meta?.sip_hangup_disposition?.startsWith('recv');
                    const bIsRecv = b?.meta?.sip_hangup_disposition?.startsWith('recv');
                    if (aIsRecv && !bIsRecv) return -1;
                    if (!aIsRecv && bIsRecv) return 1;
                    return 0;
                });
            })

            // --- НОРМАЛИЗАЦИЯ КЛЮЧЕЙ: Удаление полей с одинаковыми значениями ---
            // 1. Сбор всех уникальных путей к значениям (кроме events и id)
            const allPaths = new Set();
            const gatherKeys = (obj, prefix = '') => {
                if (!obj) return;
                Object.keys(obj).forEach(key => {
                    // Исключаем системные поля, которые нельзя удалять даже если они одинаковые
                    if ([
                        'events', 'id',
                        'variables.hangup_cause',
                        'variables.rtp_audio_in_media_packet_count',
                        'variables.rtp_audio_in_mos',
                        'variables.rtp_audio_out_dtmf_packet_count',
                        'variables.rtp_audio_out_media_packet_count',
                        'variables.rtp_use_codec_name',
                        'variables.rtp_use_video_codec_name',
                        'variables.rtp_video_in_media_packet_count',
                        'variables.rtp_video_in_mos',
                        'variables.rtp_video_out_media_packet_count',
                        'variables.sip_hangup_disposition',
                        'variables.sip_network_ip',
                    ].includes(key)) return;

                    const val = obj[key];
                    const path = prefix ? `${prefix}|${key}` : key;

                    // Для callPanel и callClient идем вглубь
                    if (['callPanel', 'callClient'].includes(key) && val && typeof val === 'object') {
                        gatherKeys(val, path);
                    } else {
                        allPaths.add(path);
                    }
                });
            };
            // Проходим по всем звонкам, чтобы найти все возможные ключи
            state.allCalls.forEach(c => gatherKeys(c));

            // 2. Поиск ключей, у которых нет разности значений (константы)
            const keysToRemove = new Set();
            allPaths.forEach(path => {
                const values = new Set();
                state.allCalls.forEach(call => {
                    // Безопасное получение значения по вложенному пути (например 'callPanel.audio_codec')
                    const val = path.split('|').reduce((acc, part) => acc && acc[part], call);
                    // Приводим к строке для сравнения (null и undefined будут считаться как "значение отсутствует")
                    values.add(String(val));
                });

                // Если размер Set <= 1, значит значение либо везде одинаковое, либо везде отсутствует
                if (values.size <= 1) {
                    keysToRemove.add(path);
                } else if (values.size === 2 && values.has('undefined')) {
                    keysToRemove.add(path);
                }
            });

            // 3. Удаление "мусорных" ключей
            if (keysToRemove.size > 0) {
                console.log(`Cleaning up ${keysToRemove.size} static keys`, [...keysToRemove]);
                state.allCalls.forEach(call => {
                    keysToRemove.forEach(path => {
                        const parts = path.split('|');
                        const lastKey = parts.pop();
                        // Получаем ссылку на объект-родитель
                        const target = parts.reduce((acc, part) => acc && acc[part], call);
                        
                        if (target && target[lastKey] !== undefined) {
                            delete target[lastKey];
                        }
                    });
                });
            }

            console.log(`Merge complete. New: ${newCount}, Updated: ${updatedCount}, Total: ${state.allCalls.length}`);
        },

        renderDatalists() {
            const updateList = (id, items) => {
                const listEl = document.getElementById(id);
                if (!listEl) return;
                listEl.innerHTML = items.map(val => `<option value="${val.replace(/"/g, '&quot;')}">`).join('');
            };

            updateList('list-apt', state.inputHistory.apt);
            updateList('list-panel', state.inputHistory.panel);
            updateList('list-id', state.inputHistory.id);
        },

        renderTimeline(call) {
            // 1. Собираем уникальные источники (sources)
            const sources = new Set();
            (call.events || []).forEach(evt => {
                sources.add(evt.source || 'Unknown');
            });
            const sortedSources = Array.from(sources).sort();

            // 2. Рисуем фильтры
            if (el.timelineFilters) {
                el.timelineFilters.innerHTML = '';
                sortedSources.forEach(src => {
                    const isHidden = state.hiddenTimelineSources.has(src);
                    const btn = document.createElement('div');
                    btn.className = isHidden ? 'source-chip disabled' : 'source-chip active';
                    btn.textContent = src;
                    btn.onclick = (e) => {
                        e.preventDefault();
                        if (isHidden) {
                            state.hiddenTimelineSources.delete(src);
                        } else {
                            state.hiddenTimelineSources.add(src);
                        }
                        this.renderTimeline(call); // Перерисовываем таймлайн
                    };
                    el.timelineFilters.appendChild(btn);
                });
            }

            // 3. Рисуем события
            el.dTimeline.innerHTML = '';
            let prevTime = null;

            (call.events || []).forEach(evt => {
                const src = evt.source || 'Unknown';
                // Пропускаем, если источник скрыт
                if (state.hiddenTimelineSources.has(src)) return;

                const div = document.createElement('div');
                div.className = 'tl-item';
                div.style.cursor = 'pointer';
                div.title = 'Нажмите, чтобы увидеть детали события';
                div.onclick = () => this.showModal(evt);

                const currTime = evt.timestamp.getTime();
                let diffHtml = '';

                // Считаем дельту только относительно предыдущего ОТОБРАЖЕННОГО события
                if (prevTime !== null) {
                    const diff = currTime - prevTime;
                    diffHtml = `<span class="tl-time-dt">+${diff.toLocaleString('en-US')}ms</span>`;
                }
                prevTime = currTime;

                div.innerHTML = `
                                    <div class="tl-time">
                                        ${(evt.timestamp).toLocaleTimeString()}
                                        ${diffHtml}
                                    </div>
                                    <div class="tl-content">${evt.details || evt.event_type}</div>
                                    <div class="tl-details" style="font-size: 0.7rem">${src}</div>
                                `;
                el.dTimeline.appendChild(div);
            });

            if (el.dTimeline.children.length === 0) {
                el.dTimeline.innerHTML = '<div style="color: #999; padding: 10px;">События скрыты фильтрами</div>';
            }
        },

        addToHistory(key, value) {
            if (!value || !value.trim()) return;
            const val = value.trim();

            // Добавляем в начало, удаляем дубликаты
            const list = state.inputHistory[key] || [];
            const newList = [val, ...list.filter(item => item !== val)].slice(0, 15); // Храним последние 15

            state.inputHistory[key] = newList;
            this.renderDatalists();
        },

        loadSettings() {
            try {
                const saved = localStorage.getItem(LOCAL_UI_STATE);
                if (saved) {
                    const data = JSON.parse(saved);

                    // Восстанавливаем последние значения полей
                    if (data.values) {
                        // if (data.values.dateStart) el.filterDateStart.value = data.values.dateStart;
                        // if (data.values.dateEnd) el.filterDateEnd.value = data.values.dateEnd;
                        // if (data.values.status) el.filterStatus.value = data.values.status;
                        // if (data.values.push) el.filterPush.value = data.values.push;
                        // if (data.values.apt) el.filterApt.value = data.values.apt;
                        // if (data.values.panel) el.filterPanel.value = data.values.panel;
                        // if (data.values.id) el.filterId.value = data.values.id;
                        // if (data.values.historyGrouping) {
                        //     state.historyGrouping = data.values.historyGrouping;
                        //     el.historyGroup.value = state.historyGrouping;
                        // }
                        // if (data.values.historyBreakdown) {
                        //     state.historyBreakdown = data.values.historyBreakdown;
                        //     el.historyBreakdown.value = state.historyBreakdown;
                        // }
                        // if (data.values.durationBreakdown) {
                        //     state.durationBreakdown = data.values.durationBreakdown;
                        //     el.durationBreakdown.value = state.durationBreakdown;
                        // }
                        // if (data.values.durationInterval) {
                        //     state.durationInterval = data.values.durationInterval;
                        //     el.durationInterval.value = state.durationInterval;
                        // }
                        // if (data.values.panelBreakdown) {
                        //     state.panelBreakdown = data.values.panelBreakdown;
                        //     el.panelBreakdown.value = state.panelBreakdown;
                        // }
                        // if (data.values.showWebhookLines !== undefined) {
                        //     state.showWebhookLines = data.values.showWebhookLines;
                        //     if (el.toggleWebhookLines) {
                        //         el.toggleWebhookLines.classList.toggle('active', state.showWebhookLines);
                        //     }
                        // }
                        // if (data.values.showPushDomaLines !== undefined) {
                        //     state.showPushDomaLines = data.values.showPushDomaLines;
                        //     if (el.togglePushDomaLines) {
                        //         el.togglePushDomaLines.classList.toggle('active', state.showPushDomaLines);
                        //     }
                        // }
                        // if (data.values.historyPercentMode !== undefined) {
                        //     state.historyPercentMode = data.values.historyPercentMode;
                        //     if (el.togglePercentMode) {
                        //         el.togglePercentMode.classList.toggle('active', state.historyPercentMode);
                        //     }
                        // }
                    }

                    // Восстанавливаем историю
                    if (data.history) {
                        state.inputHistory = data.history;
                        this.renderDatalists();
                    }
                }
            } catch (e) {
                console.error('Ошибка при загрузке настроек', e);
            }
        },

        saveSettings() {
            const data = {
                values: {
                    dateStart: el.filterDateStart.value,
                    dateEnd: el.filterDateEnd.value,
                    status: el.filterStatus.value,
                    push: el.filterPush.value,
                    apt: el.filterApt.value,
                    panel: el.filterPanel.value,
                    id: el.filterId.value,
                    historyGrouping: state.historyGrouping,
                    historyBreakdown: state.historyBreakdown,
                    historyPercentMode: state.historyPercentMode,
                    durationBreakdown: state.durationBreakdown,
                    durationInterval: state.durationInterval,
                    panelBreakdown: state.panelBreakdown,
                    showWebhookLines: state.showWebhookLines,
                    showPushDomaLines: state.showPushDomaLines
                },
                history: state.inputHistory
            };
            localStorage.setItem(LOCAL_UI_STATE, JSON.stringify(data));
        },

        applyFilters() {
            state.detailsLimit = DEFAULT_DETAILS_LIMIT;
            const start = el.filterDateStart.value;
            const end = el.filterDateEnd.value;
            const status = el.filterStatus.value;
            const apt = el.filterApt.value.trim();
            const panel = el.filterPanel.value.trim();
            const callIdRaw = el.filterId.value.trim();
            const pushFilter = el.filterPush.value;

            // Сохраняем успешные поисковые запросы в историю
            this.addToHistory('apt', apt);
            this.addToHistory('panel', panel);
            this.addToHistory('id', callIdRaw);
            this.saveSettings(); // Сохраняем обновленную историю в localStorage

            // Проверяем, ввел ли пользователь JS-функцию (например: call => call.duration > 10)
            let customIdFilter = null;
            if (callIdRaw.includes('=>') || callIdRaw.trim().startsWith('function')) {
                try {
                    const func = new Function('return ' + callIdRaw)();
                    if (typeof func === 'function') {
                        customIdFilter = func;
                    }
                } catch (e) {
                    // Если не удалось распарсить, используем как обычную строку поиска
                    console.warn('Не удалось создать фильтр-функцию', e);
                }
            }
            const callIdLower = callIdRaw.toLowerCase();

            const matchesSearch = (value, filter) => {
                if (!filter) return true;
                if (!value) return false;

                const isRegex = /[\^\$\*\?\(\)\|]/.test(filter);
                if (isRegex) {
                    try {
                        const regex = new RegExp(filter, 'i');
                        return regex.test(value);
                    } catch (e) {
                        // Если регулярка невалидна, откатываемся к обычному поиску
                        return value.toLowerCase().includes(filter.toLowerCase());
                    }
                }
                return value.toLowerCase().includes(filter.toLowerCase());
            };

            state.filteredData = state.allCalls.filter(item => {
                const itemDate = item.start_call_time ? item.start_call_time.toISOString().split('T')[0] : '0000-00-00';

                const matchesDate = (!start || itemDate >= start) && (!end || itemDate <= end);
                const matchesStatus = (status === 'all' || item.call_status === status);
                const matchesApt = matchesSearch(item.apartment_id, apt);
                const matchesPanel = matchesSearch(item.panel_id, panel);

                let matchesId = true;
                if (customIdFilter) {
                    try {
                        matchesId = customIdFilter(item);
                    } catch (e) {
                        matchesId = false; // Если функция упала с ошибкой, исключаем элемент
                    }
                } else {
                    matchesId = (!callIdLower || (item.id && item.id.toLowerCase().includes(callIdLower)));
                }

                // Фильтрация по пуш-уведомлениям
                let matchesPush = true
                if (pushFilter !== 'all') {
                    const pushes = item.events.filter(x => x.event_type === 'push_call_sent' || x.event_type === 'push_call_send_start')
                    const hasPushNotifications = pushes.length > 0
                    switch (pushFilter) {
                        case 'has_push':
                            matchesPush = hasPushNotifications
                            break
                        case 'no_push':
                            matchesPush = !hasPushNotifications
                            break
                        case 'success_push':
                            matchesPush = hasPushNotifications && pushes.some(x => x?.meta.success)
                            break
                        case 'unsuccess_push':
                            matchesPush = hasPushNotifications && !pushes.some(x => x?.meta.success)
                            break
                    }
                }

                return (
                    matchesDate &&
                    matchesStatus &&
                    matchesApt &&
                    matchesPanel &&
                    matchesId &&
                    matchesPush
                )
            });

            const isDashboard = document.getElementById('view-dashboard').classList.contains('active');
            const isDetails = document.getElementById('view-details').classList.contains('active');

            if (isDashboard) this.renderDashboard();
            if (isDetails) this.renderDetailsList();
        },

        // --- API для регистрации обработчиков ---
        registerFileHandler(handler) {
            if (typeof handler.check === 'function' && typeof handler.parse === 'function') {
                state.fileHandlers.push(handler);
            } else {
                console.error("Invalid file handler format");
            }
        },

        // --- РАСЧЕТ СТАТИСТИКИ ПО ПУШ-УВЕДОМЛЕНИЯМ ---
        calculatePushStats (data) {
            let totalSent = 0 // sentPush + cancel=false
            let totalSentSuccess = 0 // sentPush + cancel=false + в ответе есть данные о том что пуш был отправлен
            let totalSentFail = 0;
            let totalNo = 0;

            data.forEach(call => {
                const pushes = call.events.filter(x => x.event_type === 'push_call_sent' || x.event_type === 'push_call_send_start')
                const hasPushNotifications = pushes.length > 0
                const hasSuccessPushNotifications = pushes.filter(x => x?.meta?.success).length > 0
                if (hasPushNotifications) {
                    totalSent++;
                    if (hasSuccessPushNotifications) {
                        totalSentSuccess++;
                    } else {
                        totalSentFail++;
                    }
                } else {
                    totalNo++;
                }
            })

            return {
                totalSent,
                totalSentSuccess,
                totalSentFail,
                totalNo,
            }
        },

        // --- РАСЧЕТ СТАТИСТИКИ ПО ПУШ-УВЕДОМЛЕНИЯМ В ДОМА ---
        calculatePushStatsDoma (data) {
          let totalSent = 0 // sentPush + cancel=false
          let totalSentSuccess = 0 // sentPush + cancel=false + в ответе есть данные о том что пуш был отправлен
          let totalSentFail = 0;
          let totalNo = 0;

          data.forEach(call => {
            const pushes = call.events.filter(x => x.event_type === 'push_sent_worker' && x?.meta?.type === 'VOIP_INCOMING_CALL_MESSAGE')
            const hasPushNotifications = pushes.length > 0
            const hasSuccessPushNotifications = pushes.filter(x => x?.meta?.success).length > 0
            if (hasPushNotifications) {
              totalSent++;
              if (hasSuccessPushNotifications) {
                totalSentSuccess++;
              } else {
                totalSentFail++;
              }
            } else {
              totalNo++;
            }
          })

          return {
            totalSent,
            totalSentSuccess,
            totalSentFail,
            totalNo,
          }
        },
    };

    function sortObjectKeys (obj) {
        if (obj === null || typeof obj !== 'object') return obj
        if (Array.isArray(obj)) return obj.map(sortObjectKeys)
        if (obj instanceof Date) return obj

        return Object.keys(obj)
            .sort()
            .reduce((acc, key) => {
                acc[key] = sortObjectKeys(obj[key])
                return acc
            }, {})
    }

    function toSortedJsonString (obj) {
        return JSON.stringify(sortObjectKeys(obj), null, 2)
    }

    // Экспорт в глобальную область
    window.IntercomAnalytics = {
        init: () => ui.init(),
        registerFileHandler: (h) => ui.registerFileHandler(h),
        // Для отладки можно открыть доступ к state
        _state: state
    };

})();

// --- ИНИЦИАЛИЗАЦИЯ И ДОБАВЛЕНИЕ ДЕФОЛТНОГО ПАРСЕРА ---

document.addEventListener('DOMContentLoaded', () => {
    // 1. Регистрируем JSON парсер (согласно спецификации ТЗ)
    IntercomAnalytics.registerFileHandler({
        name: 'Standard JSON',
        check: (content) => {
            try {
                const json = JSON.parse(content);
                // Простая проверка: если массив, и у первого элемента есть id и panel_id
                return Array.isArray(json) && json.length > 0 && 'id' in json[0] && 'panel_id' in json[0];
            } catch (e) {
                return false;
            }
        },
        parse: (content) => {
            const data = JSON.parse(content);

            // Рекурсивная функция для восстановления дат в объекте звонка
            const restoreDates = (item) => {
                // 1. Основные поля времени звонка
                Object.keys(item).forEach(field => {
                    if (item[field] && field.endsWith('_time')) item[field] = new Date(item[field]);
                });

                // 2. Поля времени в событиях (events)
                if (Array.isArray(item.events)) {
                    item.events.forEach(evt => {
                        if (evt.timestamp) evt.timestamp = new Date(evt.timestamp);
                    });
                }
            };

            if (Array.isArray(data)) {
                data.forEach(item => restoreDates(item));
            }

            return data;
        }
    });

    // 2. Инициализируем UI
    IntercomAnalytics.init();

    // 3. (Опционально) Генерация тестовых данных через "файл" для демонстрации
    window.simulateUpload = () => {
        // Используем ту же логику генерации, но заворачиваем в JSON Blob и скармливаем парсеру
        const mockData = generateMockData(20); // функция из предыдущего примера (нужно убедиться, что она доступна или скопировать её)
        const blob = new Blob([JSON.stringify(mockData)], {type: 'application/json'});
        const file = new File([blob], "mock_data.json", {type: 'application/json'});

        // Вызываем скрытый метод обработки (в реальном коде можно через trigger input)
        // Но так как input скрыт, найдем instance и вызовем processFile
        // Для этого в IIFE можно было бы вернуть processFile, но сейчас имитируем через input
        const dt = new DataTransfer();
        dt.items.add(file);
        document.getElementById('hidden-file-input').files = dt.files;
        document.getElementById('hidden-file-input').dispatchEvent(new Event('change'));
    };
});

// --- Helper: Mock Data Generator (нужен для кнопки "Загрузить логи" в демо-режиме) ---
function generateMockData(count = 20) {
    const panels = ["Main Entrance", "Garage", "Block A"];
    const data = [];
    const now = new Date();
    for (let i = 0; i < count; i++) {
        const isAns = Math.random() > 0.3;
        const start = new Date(now.getTime() - Math.random() * 86400000 * 3);
        const end = new Date(start.getTime() + 60000);
        data.push({
            id: `call-${Date.now()}-${i}`,
            panel_id: `pnl-${i}`,
            start_call_time: start.toISOString(),
            end_call_time: end.toISOString(),
            call_status: isAns ? 'answered' : 'missed',
            bridge_panel_and_client_time: isAns ? start.toISOString() : null,
            duration_sec: 45,
            events: [
                { event_id: `evt-${i}-1`, event_type: 'call_initiated', timestamp: start.toISOString(), details: 'Button' }
            ],
            callPanel: { audio_quality_mos: 4.2 },
            callClient: { client_ip: '10.0.0.1' }
        });
    }
    return data;
}
