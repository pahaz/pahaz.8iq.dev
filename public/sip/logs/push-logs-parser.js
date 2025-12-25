(function () {
    'use strict';

    /**
     * Парсер для логов "Push Notifications" (CSV)
     * Анализирует жизненный цикл пуш-уведомления на основе вызовов функции sendPush.
     */
    const PushLogsHandler = {
        name: 'Push Notifications Log',

        check: (content) => {
            const firstLine = content.slice(0, 5000).split('\n')[0];
            return firstLine.includes('_source.esl.args');
        },

        parse: (content) => {
            const rows = parseCSV(content);
            if (rows.length < 2) return [];

            const headers = rows[0].map((x) => x.trim() || '_');
            const colIdx = headers.indexOf('_source.esl.args');

            if (colIdx === -1) {
                throw new Error('Required column "_source.esl.args" not found');
            }

            const callsMap = new Map();

            for (let i = 1; i < rows.length; i++) {
                const row = rows[i];
                let rawData = row[colIdx]?.trim();
                if (!rawData) continue;

                // Извлекаем контент из формата ["..."]
                if (rawData.startsWith('["') && rawData.endsWith('"]')) {
                    rawData = rawData.substring(2, rawData.length - 2);
                }

                // Регулярное выражение для извлечения атрибутов из скобок и остального сообщения
                const match = rawData.match(/^\[sendPush\s+(.*?)\]\s+(.*)$/);
                if (!match) {
                    console.warn(`Row ${i} has invalid format`, rawData);
                    continue;
                }

                const attrsStr = match[1];
                const message = match[2];

                // Парсинг атрибутов: from, to, cancel, callId
                const attrs = {};
                attrsStr.split(/\s+/).forEach(pair => {
                    const [key, val] = pair.split('=');
                    if (key && val) attrs[key] = val;
                });

                const callId = attrs.callId;
                const panel = attrs.from;
                const client = attrs.to;
                if (!callId || !panel || !client) {
                    console.warn(`Row ${i} has invalid attrs`, attrs, row);
                    continue;
                }

                if (!callsMap.has(callId)) {
                    callsMap.set(callId, {
                        id: callId,
                        panel_id: attrs.from || 'Unknown',
                        apartment_id: attrs.to || 'Unknown',
                        events: [],
                    });
                }

                const call = callsMap.get(callId);

                // Извлечение метрик
                const tsMatch = message.match(/timestamp=(\d+)/);
                const timestamp = tsMatch ? new Date(parseInt(tsMatch[1], 10)) : null;
                if (!timestamp) {
                    console.warn(`Row ${i} has invalid timestamp`, message, row);
                    continue;
                }

                const elapsedMatch = message.match(/elapsed=(\d+)/);
                const elapsed = elapsedMatch ? parseInt(elapsedMatch[1], 10) : null;

                // Определение типа события согласно логике sendPush
                let type = 'unknown';
                let icon = '🔔';

                if (message.includes('request to push sending start')) {
                    type = 'push_call_send_start';
                    icon = '🛫';
                } else if (message.includes('request to push sending end')) {
                    type = 'push_call_send_end';
                    icon = '📩';
                } else if (message.includes('request to push cancel start')) {
                    type = 'push_cancel_send_start';
                    icon = '🛑';
                } else if (message.includes('request to push cancel end')) {
                    type = 'push_cancel_send_end';
                    icon = '🏁';
                } else if (message.includes('push sent')) {
                    type = 'push_call_sent';
                    icon = '✅';
                } else if (message.includes('push canceled')) {
                    type = 'push_cancel_sent';
                    icon = '🔕';
                } else if (message.includes('error')) {
                    type = 'push_error';
                    icon = '❌';
                }

                // Парсинг JSON ответа (если есть)
                let response = null;
                const respMatch = message.match(/response=\\"(.*)\\" /);
                if (respMatch) {
                    try {
                        const jsonStr = respMatch[1].replace(/\\"/g, '"');
                        response = JSON.parse(jsonStr);
                    } catch (e) {
                        console.warn(`Received response to ${e}`);
                    }
                }

                const details = message.split(',')[0]?.replace("request to push", '')
                const cancel = attrs.cancel === 'true'

                // Добавляем в общий список событий для UI
                call.events.push({
                    event_id: `${callId}_${type}_${timestamp.getTime()}`,
                    event_type: type,
                    source: 'Webhook',
                    details: `${icon} ${details}${elapsed ? ` (${elapsed}ms)` : ''}`,
                    timestamp,
                    kind: 'push',
                    meta: {
                        from: panel,
                        to: client,
                        cancel,
                        elapsed,
                        response,
                        success: (response) ? response?.data?.some(x => x.success) : false,
                    },
                });
            }

            return Array.from(callsMap.values()).map(call => {
                call.events.sort((a, b) => a.timestamp - b.timestamp);
                return call;
            });
        }
    };

    function parseCSV(text) {
        const result = [];
        let row = [];
        let inQuote = false;
        let token = '';

        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            const next = text[i + 1];

            if (char === '"') {
                if (inQuote && next === '"') {
                    token += '"'; i++;
                } else {
                    inQuote = !inQuote;
                }
            } else if (char === ',' && !inQuote) {
                row.push(token);
                token = '';
            } else if ((char === '\r' || char === '\n') && !inQuote) {
                if (token || row.length > 0) row.push(token);
                if (row.length > 0) result.push(row);
                row = []; token = '';
                if (char === '\r' && next === '\n') i++;
            } else {
                token += char;
            }
        }
        if (token || row.length > 0) {
            row.push(token);
            result.push(row);
        }
        return result;
    }

    if (window.IntercomAnalytics) {
        window.IntercomAnalytics.registerFileHandler(PushLogsHandler);
    }
})();