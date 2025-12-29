/**
 * Intercom Analytics UI Core
 */
(function () {
    'use strict';

    // --- 1. DOM ELEMENTS (EL) ---
    // Кэшируем все элементы интерфейса
    const q = (id) => document.getElementById(id);
    const LOCAL_UI_STATE = 'ui_state_data'

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
        valAnswered: q('val-answered'),
        percAnswered: q('perc-answered'),
        valOpened: q('val-opened'),
        percOpened: q('perc-opened'),
        valMissed: q('val-missed'),
        percMissed: q('perc-missed'),
        valFail: q('val-fail'),
        percFail: q('perc-fail'),

        // Push Metrics
        valPushSent: q("val-push-sent"),
        percPushSent: q("perc-push-sent"),
        valPushSuccess: q("val-push-success"),
        percPushSuccess: q("perc-push-success"),
        valPushFail: q("val-push-fail"),
        percPushFail: q("perc-push-fail"),

        // Charts
        canvasHistory: q('chartHistory'),
        canvasStatus: q('chartStatus'),
        canvasTopPanels: q('chartTopPanels'),
        canvasPanelAnalysis: q('chartPanelAnalysis'),
        canvasDuration: q('chartDuration'),

        // Details List
        callsTableBody: q('callsTableBody'),

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

        activeCallId: null,
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

            // Определяем статусы согласно обновленной логике парсера
            const stats = {
                answered: data.filter(d => d.call_status === 'answered' || d.call_status === 'opened').length,
                opened: data.filter(d => d.call_status === 'opened').length,
                missed: data.filter(d => d.call_status === 'missed').length,
                fail: data.filter(d => !['answered', 'opened', 'missed'].includes(d.call_status)).length
            };

            const updateMetric = (elVal, elPerc, val) => {
                if (elVal) elVal.innerText = val;
                if (elPerc) elPerc.innerText = total > 0 ? Math.round((val / total) * 100) + '%' : '0%';
            };

            if (el.valTotal) el.valTotal.innerText = total;
            updateMetric(el.valAnswered, el.percAnswered, stats.answered);
            updateMetric(el.valOpened, el.percOpened, stats.opened);
            updateMetric(el.valMissed, el.percMissed, stats.missed);
            updateMetric(el.valFail, el.percFail, stats.fail);

            // Подсчет статистики по пуш-уведомлениям
            const pushStats = this.calculatePushStats(data);
            if (el.valPushSent) el.valPushSent.innerText = pushStats.totalSent;
            if (el.percPushSent) {
            el.percPushSent.innerText = total > 0
                ? Math.round((pushStats.totalSent / total) * 100) + "%"
                : "0%";
            }
            if (el.valPushSuccess)
            el.valPushSuccess.innerText = pushStats.totalSentSuccess;
            if (el.percPushSuccess) {
                el.percPushSuccess.innerText = total > 0
                    ? Math.round((pushStats.totalSentSuccess / total) * 100) + "%"
                    : "0%";
            }

            if (el.valPushFail) el.valPushFail.innerText = pushStats.totalSentFail;
            if (el.percPushFail) {
                el.percPushFail.innerText = total > 0
                    ? Math.round((pushStats.totalSentFail / total) * 100) + "%"
                    : "0%";
            }

            this.updateCharts(data);
        },

        updateCharts(data) {
            if (typeof Chart === 'undefined') return;

            this.renderHistoryChart(data);
            this.renderDurationChart(data);
            this.renderPanelAnalysisChart(data);
        },

        renderHistoryChart(data) {
            // Группировка по дням
            const days = {};
            data.forEach(d => {
                const date = d.start_call_time ? d.start_call_time.toISOString().split('T')[0] : 'Unknown';
                if (!days[date]) days[date] = { answered: 0, opened: 0, missed: 0, fail: 0 };

                if (d.call_status === 'opened') {
                    days[date].opened++;
                } else if (d.call_status === 'answered') {
                    days[date].answered++;
                } else if (d.call_status === 'missed') {
                    days[date].missed++;
                } else {
                    days[date].fail++;
                }
            });

            const labels = Object.keys(days).sort();

            const createConfig = (label, key, color) => ({
                label: label,
                data: labels.map(l => days[l][key]),
                backgroundColor: color,
                stack: 'stack0'
            });

            const chartData = {
                labels,
                datasets: [
                    createConfig('Дверь открыта', 'opened', '#059669'),
                    createConfig('Отвечено', 'answered', '#10b981'),
                    createConfig('Пропущено', 'missed', '#ef4444'),
                    createConfig('Fail', 'fail', '#94a3b8')
                ]
            };

            if (state.charts.history) {
                state.charts.history.data = chartData;
                state.charts.history.update();
            } else {
                state.charts.history = new Chart(el.canvasHistory, {
                    type: 'bar',
                    data: chartData,
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        scales: {
                            x: { stacked: true },
                            y: { stacked: true, beginAtZero: true }
                        },
                        plugins: {
                            legend: { position: 'bottom' }
                        }
                    }
                });
            }
        },

        renderDurationChart(data) {
            if (!el.canvasDuration) return;

            // Определяем интервалы (бакеты) длительности
            const buckets = [
                { label: '0-2 с', max: 2 },
                { label: '2-4 с', max: 4 },
                { label: '5-6 с', max: 6 },
                { label: '6-8 с', max: 8 },
                { label: '8-10 с', max: 10 },
                { label: '10-12 с', max: 12 },
                { label: '12-14 с', max: 14 },
                { label: '14-16 с', max: 16 },
                { label: '16-18 с', max: 18 },
                { label: '18-20 с', max: 20 },
                { label: '20-22 с', max: 22 },
                { label: '22-24 с', max: 24 },
                { label: '26-28 с', max: 28 },
                { label: '28-30 с', max: 30 },
                { label: '30-32 с', max: 32 },
                { label: '32-34 с', max: 34 },
                { label: '34-36 с', max: 36 },
                { label: '36-38 с', max: 38 },
                { label: '38-40 с', max: 40 },
                { label: '40-42 с', max: 42 },
                { label: '42-44 с', max: 44 },
                { label: '44-46 с', max: 46 },
                { label: '46-48 с', max: 48 },
                { label: '48-50 с', max: 50 },
                { label: '50-52 с', max: 52 },
                { label: '52-54 с', max: 54 },
                { label: '54-56 с', max: 56 },
                { label: '56-58 с', max: 58 },
                { label: '58-60 с', max: 60 },
                { label: '1-2 мин', max: 120 },
                { label: '> 2 мин', max: Infinity },
            ];

            // Инициализация структуры для подсчета
            const distribution = buckets.map(b => ({
                label: b.label,
                max: b.max,
                stats: { answered: 0, opened: 0, missed: 0, fail: 0 }
            }));

            data.forEach(d => {
                const duration = parseFloat(d.duration_sec) || 0;

                // Находим подходящий интервал
                const targetBucket = distribution.find(b => duration < b.max);

                if (targetBucket) {
                    const s = d.call_status;
                    if (targetBucket.stats.hasOwnProperty(s)) {
                        targetBucket.stats[s]++;
                    } else {
                        targetBucket.stats.fail++;
                    }
                }
            });

            const labels = distribution.map(d => d.label);

            const createConfig = (label, key, color) => ({
                label: label,
                data: distribution.map(d => d.stats[key]),
                backgroundColor: color,
                stack: 'stackDuration'
            });

            const chartData = {
                labels,
                datasets: [
                    createConfig('Дверь открыта', 'opened', '#059669'),
                    createConfig('Отвечено', 'answered', '#10b981'),
                    createConfig('Пропущено', 'missed', '#ef4444'),
                    createConfig('Fail', 'fail', '#94a3b8')
                ]
            };

            if (state.charts.duration) {
                state.charts.duration.data = chartData;
                state.charts.duration.update();
            } else {
                state.charts.duration = new Chart(el.canvasDuration, {
                    type: 'bar',
                    data: chartData,
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        scales: {
                            x: { stacked: true },
                            y: { stacked: true, beginAtZero: true }
                        },
                        plugins: {
                            legend: { position: 'bottom' },
                            title: {
                                display: true,
                                text: 'Распределение статусов по длительности'
                            }
                        }
                    }
                });
            }
        },

        renderPanelAnalysisChart(data) {
            if (!el.canvasPanelAnalysis) return;

            // Группировка данных по панелям
            const panels = {};
            data.forEach(d => {
                const p = d.panel_id || 'Unknown';
                const apt = d.apartment_id || 'N/A';
                if (!panels[p]) {
                    panels[p] = {
                        opened: 0, answered: 0, missed: 0, fail: 0,
                        apts: {} // { aptId: count }
                    };
                }
                const s = d.call_status;
                if (panels[p].hasOwnProperty(s)) panels[p][s]++;

                panels[p].apts[apt] = (panels[p].apts[apt] || 0) + 1;
            });

            // const panelLabels = Object.keys(panels).sort((a, b) => {
            //     const sum = (p) => panels[p].opened + panels[p].answered + panels[p].missed + panels[p].fail;
            //     return sum(b) - sum(a);
            // });
            const panelLabels = Object.keys(panels).sort((a, b) => a.localeCompare(b));

            const chartHeight = Math.max(400, panelLabels.length * 35 + 100);
            el.canvasPanelAnalysis.parentElement.style.height = `${chartHeight}px`;

            const logify = (val) => val > 0 ? Math.log10(val + 1) : 0;

            // Подготовка датасетов для статусов (слева)
            const datasets = [
                { label: 'Открыто', key: 'opened', color: '#059669' },
                { label: 'Принято', key: 'answered', color: '#10b981' },
                { label: 'Пропущено', key: 'missed', color: '#ef4444' },
                { label: 'Ошибка', key: 'fail', color: '#94a3b8' }
            ].map(conf => ({
                label: conf.label,
                data: panelLabels.map(l => -logify(panels[l][conf.key])),
                realValues: panelLabels.map(l => panels[l][conf.key]),
                backgroundColor: conf.color,
                stack: 'main'
            }));

            // Подготовка датасетов для квартир (справа, градации серого)
            // Находим максимальное кол-во квартир на одной панели для создания слоев
            const maxAptCount = Math.max(...panelLabels.map(l => Object.keys(panels[l].apts).length));

            for (let i = 0; i < maxAptCount; i++) {
                // Генерируем оттенок серого (чем дальше квартира в списке, тем светлее)
                const grayVal = Math.min(200, 50 + (i * 15));
                const color = `rgb(${grayVal}, ${grayVal}, ${grayVal})`;

                datasets.push({
                    label: i === 0 ? 'Квартиры (распред.)' : `Квартира №${i+1}`,
                    data: panelLabels.map(l => {
                        const sortedApts = Object.entries(panels[l].apts).sort((a, b) => b[1] - a[1]);
                        return sortedApts[i] ? logify(sortedApts[i][1]) : 0;
                    }),
                    realValues: panelLabels.map(l => {
                        const sortedApts = Object.entries(panels[l].apts).sort((a, b) => b[1] - a[1]);
                        return sortedApts[i] ? `${sortedApts[i][0]}: ${sortedApts[i][1]}` : null;
                    }),
                    backgroundColor: color,
                    stack: 'main',
                    borderWidth: 0.5,
                    borderColor: '#fff',
                    hiddenInLegend: i > 0 // Скроем лишние легенды для квартир
                });
            }

            if (state.charts.panelAnalysis) {
                state.charts.panelAnalysis.data.labels = panelLabels;
                state.charts.panelAnalysis.data.datasets = datasets;
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
                                grid: { display: false },
                                ticks: { display: false },
                                title: { display: true, text: '← Статусы | Квартиры (группировка по кол-ву звонков) →' }
                            },
                            y: { stacked: true, beginAtZero: true }
                        },
                        plugins: {
                            tooltip: {
                                callbacks: {
                                    label: (context) => {
                                        const rv = context.dataset.realValues[context.dataIndex];
                                        if (!rv) return null;
                                        return `${context.dataset.label}: ${rv}`;
                                    }
                                }
                            },
                            legend: {
                                position: 'bottom',
                                labels: {
                                    filter: (item, chartData) => {
                                        const ds = chartData.datasets[item.datasetIndex];
                                        return ds && !ds.hiddenInLegend;
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
            if (state.filteredData.length === 0) {
                el.callsTableBody.innerHTML = '<div class="empty-state">Нет данных</div>';
                return;
            }

            state.filteredData.forEach(call => {
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

            // Modal
            if (el.closeModalBtn) el.closeModalBtn.onclick = () => this.closeModal();
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
                    const text = await this.readFileAsText(file);

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
                    id: el.filterId.value
                },
                history: state.inputHistory
            };
            localStorage.setItem(LOCAL_UI_STATE, JSON.stringify(data));
        },

        applyFilters() {
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
                    const pushes = item.events.filter(x => x.event_type === 'push_call_sent')
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

            data.forEach(call => {
                const pushes = call.events.filter(x => x.event_type === 'push_call_sent')
                const hasPushNotifications = pushes.length > 0
                const hasSuccessPushNotifications = pushes.filter(x => x?.meta?.success).length > 0
                if (hasPushNotifications) {
                    totalSent++;
                    if (hasSuccessPushNotifications) {
                        totalSentSuccess++;
                    } else {
                        totalSentFail++;
                    }
                }
            })

            return {
                totalSent,
                totalSentSuccess,
                totalSentFail,
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
