/**
 * Intercom Analytics UI Core
 */
(function () {
    'use strict';

    // --- 1. DOM ELEMENTS (EL) ---
    // Кэшируем все элементы интерфейса
    const q = (id) => document.getElementById(id);

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
        btnApplyFilters: q('btnApplyFilters'),

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

        // Charts
        canvasHistory: q('chartHistory'),
        canvasStatus: q('chartStatus'),
        canvasTopPanels: q('chartTopPanels'),
        canvasPanelAnalysis: q('chartPanelAnalysis'),

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

        // Инстансы графиков Chart.js
        charts: {},

        activeCallId: null,
    };

    // --- 3. UI LOGIC ---
    const ui = {
        init() {
            this.bindEvents();
            // Инициализация графиков пустыми данными
            this.renderDashboard();
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

        // --- Отрисовка Дашборда ---
        renderDashboard() {
            const data = state.filteredData;
            const total = data.length;

            // Определяем статусы согласно обновленной логике парсера
            const stats = {
                answered: data.filter(d => d.call_status === 'answered' || d.call_status === 'opened').length,
                opened: data.filter(d => d.has_dtmf || d.call_status === 'opened').length,
                missed: data.filter(d => d.call_status === 'missed').length,
                fail: data.filter(d => d.call_status === 'fail').length
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

            this.updateCharts(data);
        },

        updateCharts(data) {
            if (typeof Chart === 'undefined') return;

            this.renderHistoryChart(data);
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

                const row = document.createElement('div');
                row.className = `call-row ${state.activeCallId === call.id ? 'selected' : ''}`;
                row.onclick = () => this.selectCall(call);

                row.innerHTML = `
                            <div class="cr-top">
                                <span class="cr-time">${timeStr}</span>
                                <span class="cr-status ${statusClassMap[call.call_status] || ''}">
                                    ${statusLabelMap[call.call_status] || call.call_status}
                                </span>
                            </div>
                            <div class="cr-info">${call.panel_id || 'Unknown'} • ${call.apartment_id || '-'}</div>
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

            const meta = [
                { label: 'Дата', value: call.start_call_time ? call.start_call_time.toLocaleDateString() : '-' },
                { label: 'Длительность звонка', value: (call.duration_sec || 0) + ' сек' },
                { label: 'Длительность разговора', value: (call.speaking_time_sec || 0) + ' сек' },
                { label: 'DTMF пакеты (out)', value: cp['variables.rtp_audio_out_dtmf_packet_count'] || 0 },
                { label: 'Модель', value: call.panel_details || '-' },
                { label: 'Панель', value: call.panel_id || '-' },
                { label: 'Квартира', value: call.apartment_id || '-' },
                { label: 'IP панели', value: cp['ip'] || '-' },
                { label: 'Причина завершения', value: cp['variables.hangup_cause'] || '-' },

                { type: 'title', label: 'Метрики Audio' },
                { label: 'MOS', value: cp['variables.rtp_audio_in_mos'] || '-' },
                { label: 'Кодек', value: cp['audio_codec'] || '-' },
                { label: 'Пакеты (In/Out)', value: `${cp['variables.rtp_audio_in_media_packet_count'] || 0} / ${cp['variables.rtp_audio_out_media_packet_count'] || 0}` },

                { type: 'title', label: 'Метрики Video' },
                { label: 'MOS', value: cp['variables.rtp_video_in_mos'] || '-' },
                { label: 'Кодек', value: cp['video_codec'] || '-' },
                { label: 'Пакеты (In/Out)', value: `${cp['variables.rtp_video_in_media_packet_count'] || 0} / ${cp['variables.rtp_video_out_media_packet_count'] || 0}` },
            ];

            grid.innerHTML = meta.map(m => m.type === 'title'
                ? `<div class="meta-section-title">${m.label}</div>`
                : `<div class="meta-item"><label>${m.label}</label><span>${m.value}</span></div>`
            ).join('');

            // Timeline (Horizontal)
            el.dTimeline.innerHTML = (call.events || []).map(evt => `
                    <div class="tl-item">
                        <div class="tl-time">${new Date(evt.timestamp).toLocaleTimeString()}</div>
                        <div class="tl-content">${evt.details || evt.event_type}</div>
                        <div class="tl-details" style="font-size: 0.7rem">${evt.source || 'sys'}</div>
                    </div>
                `).join('');

            // Обработка дополнительных "ног" (calls)
            const extraCont = q('d-extra-calls');
            const calls = call.calls || [];
            if (calls && calls.length > 1) {
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
                                        <pre class="log-block" id="d-log-client">${escapeHtml(JSON.stringify(c, null, 2))}</pre>
                                    </div>
                            </div>
                        </details>
                                    
                                `).join('')}
                    `;
            } else {
                extraCont.innerHTML = '';
            }

            // Logs
            el.dLogPanel.textContent = JSON.stringify(call.callPanel || {}, null, 2);
            el.dLogClient.textContent = JSON.stringify(call.callClient || {}, null, 2);
        },

        bindEvents() {
            // Навигация по табам
            const modes = ['upload', 'dashboard', 'details'];
            el.navButtons.forEach((btn, index) => {
                btn.onclick = () => this.switchMode(modes[index]);
            });

            // Клик по кнопке загрузки открывает скрытый input
            el.btnUpload.onclick = () => el.fileInput.click();

            // Обработка выбора файла
            el.fileInput.onchange = (e) => {
                if (e.target.files.length) this.processFile(e.target.files[0]);
            };

            // Drag & Drop
            el.dropZone.ondragover = (e) => { e.preventDefault(); el.dropZone.style.background = '#eff6ff'; };
            el.dropZone.ondragleave = (e) => { e.preventDefault(); el.dropZone.style.background = 'transparent'; };
            el.dropZone.ondrop = (e) => {
                e.preventDefault();
                el.dropZone.style.background = 'transparent';
                if (e.dataTransfer.files.length) this.processFile(e.dataTransfer.files[0]);
            };

            // Фильтры
            // Ищем кнопку "Применить" внутри фильтров, если нет ID
            const applyBtn = document.querySelector('.filters-bar button');
            if(applyBtn) applyBtn.onclick = () => this.applyFilters();
        },

        // --- ЛОГИКА ОБРАБОТКИ ФАЙЛОВ ---

        async processFile(file) {
            this.showProgress(10, 'Чтение файла...');

            try {
                const text = await this.readFileAsText(file);
                this.showProgress(40, 'Анализ формата...');

                // Поиск подходящего обработчика
                const handler = state.fileHandlers.find(h => h.check(text));

                if (!handler) {
                    throw new Error("Неизвестный формат файла. Нет подходящего парсера.");
                }

                this.showProgress(60, 'Парсинг данных...');
                const newCalls = handler.parse(text);

                if (!Array.isArray(newCalls)) {
                    throw new Error("Парсер вернул некорректные данные (ожидался массив).");
                }

                this.showProgress(80, 'Объединение данных...');
                this.mergeData(newCalls);

                this.showProgress(100, 'Готово!');
                this.hideProgress('Загрузка завершена');

                // Обновляем UI
                this.applyFilters(); // Это обновит filteredData и графики
                this.switchMode('dashboard');

            } catch (err) {
                console.error(err);
                this.showProgress(100, 'Ошибка');
                this.hideProgress(`Ошибка: ${err.message}`, true);
            } finally {
                el.fileInput.value = ''; // Сброс input
            }
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

                        // 3. Сортировка событий по времени
                        existing.events.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
                    }

                } else {
                    // Звонок новый - ДОБАВЛЕНИЕ
                    state.allCalls.push(inCall);
                    newCount++;
                }
            });

            // Сортируем все звонки по времени начала (от новых к старым)
            state.allCalls.sort((a, b) => new Date(b.start_call_time) - new Date(a.start_call_time));

            console.log(`Merge complete. New: ${newCount}, Updated: ${updatedCount}, Total: ${state.allCalls.length}`);
        },

        applyFilters() {
            const start = el.filterDateStart.value;
            const end = el.filterDateEnd.value;
            const status = el.filterStatus.value;
            const apt = el.filterApt.value.trim();
            const panel = el.filterPanel.value.trim();
            const callId = el.filterId.value.toLowerCase().trim();

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
                const matchesId = (!callId || (item.id && item.id.toLowerCase().includes(callId)));

                return matchesDate && matchesStatus && matchesApt && matchesPanel && matchesId;
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
        }
    };

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
            return JSON.parse(content);
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
            sip_bridge_time: isAns ? start.toISOString() : null,
            call_duration_sec: 45,
            events: [
                { event_id: `evt-${i}-1`, event_type: 'call_initiated', timestamp: start.toISOString(), details: 'Button' }
            ],
            callPanel: { audio_quality_mos: 4.2 },
            callClient: { client_ip: '10.0.0.1' }
        });
    }
    return data;
}
