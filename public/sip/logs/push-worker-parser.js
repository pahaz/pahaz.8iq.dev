(function () {
    'use strict';

    /**
     * Парсер для логов воркера "deliverMessage.js" (CSV)
     * Извлекает события отправки пушей, привязанные к SIP звонку.
     */
    const PushWorkerLogHandler = {
        name: 'Push Worker Log (deliverMessage.js)',

        /**
         * Проверка файла:
         * 1. Наличие заголовка _source.data (где лежит JSON)
         * 2. Наличие подстроки deliverMessage.js в первых строках файла
         */
        check: (content) => {
            const slice = content.slice(0, 10000);
            const firstLine = slice.split('\n')[0];
            const hasHeader = firstLine.includes('data');
            const hasNameHeader = firstLine.includes('fileName');
            const hasTime = firstLine.includes('time');
            const hasWorkerSign = slice.includes('deliverMessage.js');
            return hasHeader && hasNameHeader && hasTime && hasWorkerSign;
        },

        parse: (content) => {
            const rows = parseCSV(content);
            if (rows.length < 2) return [];

            const headers = rows[0].map((x) => x.trim() || '_');
            const col = (name) => {
              const candidates = [
                name,
                name.replace('.', '\\.'),
                `_source.${name}`,
              ];
              for (const c of candidates) {
                const i = headers.indexOf(c);
                if (i !== -1) return i;
              }
              return -1;
            };

            const colData = col('data');
            const colFileName = col('fileName'); // или _source.name
            const colTime = col('time'); // Unix timestamp
            
            // Если критических колонок нет — пробуем альтернативные имена или выходим
            if (colData === -1) {
                console.warn('Required column "_source.data" not found');
                return [];
            }

            const callsMap = new Map();

            for (let i = 1; i < rows.length; i++) {
                const row = rows[i];
                
                // 1. Проверяем, что это лог от deliverMessage.js
                // Если колонки fileName нет, ищем просто в тексте строки (fallback) или пропускаем
                if (colFileName !== -1) {
                    const fileName = row[colFileName] || '';
                    if (!fileName.includes('deliverMessage.js')) {
                        console.warn(`Row ${i} has invalid fileName "${fileName}", skipping...`, row);
                        continue;
                    }
                }

                // 2. Достаем JSON с данными
                const rawJson = row[colData];
                if (!rawJson) {
                    console.warn(`Row ${i} has empty data, skipping...`, row);
                    continue;
                }

                let data = null;
                try {
                    // Очистка от лишних кавычек, если CSV экранирование сломало JSON (иногда бывает)
                    // Но обычно parseCSV справляется. Попробуем распарсить напрямую.
                    data = JSON.parse(rawJson);
                } catch (e) {
                    // Иногда логи обрезаются или содержат мусор
                    console.warn(`Row ${i} has invalid JSON, skipping...`, rawJson, row);
                    continue;
                }

                // 3. Извлекаем sipCallId из недр JSON
                // Путь: deliveryMeta -> pushContext -> default -> data -> sipCallId
                const pushContext = data?.deliveryMeta?.pushContext
                const key = Object.keys(pushContext)[0];
                if (!key) {
                    console.warn(`Row ${i} has invalid pushContext, skipping...`, pushContext, row);
                    continue;
                }
                let pushData = pushContext?.[key]?.data
                if (!pushData) {
                    console.warn(`Row ${i} has invalid pushData, skipping...`, pushData, row);
                    continue;
                }
                if (typeof pushData === 'string' && pushData.startsWith('{') && pushData.endsWith('}')) {
                    try {
                        pushData = JSON.parse(pushData);
                    } catch (e) {
                        console.warn(`Row ${i} has invalid pushData JSON, skipping...`, pushData, row);
                        continue;
                    }
                }

                if (typeof pushData !== 'object') {
                    console.warn(`Row ${i} has invalid pushData type, skipping...`, pushData, row);
                    continue;
                }

                const context = pushData?.B2CAppContext;

                let contextData = null;
                try {
                    contextData = JSON.parse(context);
                    if (contextData.password) contextData.password = '<hidden>';
                } catch (e) {
                    console.warn(`Row ${i} has invalid B2CAppContext JSON, skipping... `, pushData, context, e);
                    continue;
                }

                const sipCallId = contextData?.sipCallId
                if (!sipCallId) {
                    // Если нет ID звонка, мы не можем привязать событие
                    console.warn(`Row ${i} has invalid B2CAppContext.sipCallId, skipping...`, sipCallId, row);
                    continue;
                }

                pushData['B2CAppContext'] = contextData;
                if (pushData['token']) pushData['token'] = '<hidden>';
                if (pushData['voipPassword']) pushData['voipPassword'] = '<hidden>';

                // 4. Подготовка объекта звонка
                if (!callsMap.has(sipCallId)) {
                    callsMap.set(sipCallId, {
                        id: sipCallId,
                        events: [],
                        // Остальные поля (panel_id, apartment_id) заполнятся при мердже с основным CDR логом
                    });
                }
                const call = callsMap.get(sipCallId);

                // 5. Время события
                // В примере время: 1766858325355 (ms)
                let timestamp = (row[colTime]) ? new Date(parseInt(row[colTime], 10)) : null;
                if (!timestamp) {
                    console.warn(`Row ${i} has invalid timestamp, skipping...`, timestamp, row);
                    continue;
                }

                const objectFromRow = createObjectFromRow(headers, row, ['data', 'message', 'event.original'])

                // 6. Формирование события
                const successCount = data?.deliveryMeta?.successCount;
                const failureCount = data?.deliveryMeta?.failureCount;
                const responses = (data?.deliveryMeta?.responses || []);
                responses.forEach((item) => {
                    if (item?.['pushToken']) item['pushToken'] = '<hidden>';
                })
                const typeIcon = (pushData?.type === 'VOIP_INCOMING_CALL_MESSAGE') ? '📞' : (pushData?.type === 'CANCELED_CALL_MESSAGE_PUSH') ? '🛑' : '';
                const details = `📤sent${typeIcon}: ${successCount}👌${failureCount > 0 ? '/ ' + failureCount + '❌' : '' }`;

                // Добавляем событие
                call.events.push({
                    event_id: `${sipCallId}_worker_${timestamp.getTime()}`,
                    event_type: 'push_sent_worker',
                    event_kind: 'worker',
                    source: 'doma:worker',
                    details,
                    timestamp,
                    meta: {
                        entity: objectFromRow['entity'],
                        entityId: objectFromRow['entityId'],
                        taskId: objectFromRow['taskId'],
                        responses,
                        successCount,
                        failureCount,
                        success: successCount > 0,
                        data: pushData,
                        type: pushData?.type,
                    }
                });
            }

            // Сортируем события внутри звонков
            return Array.from(callsMap.values()).map(call => {
                call.events.sort((a, b) => a.timestamp - b.timestamp);
                return call;
            });
        }
    };

    /**
     * Стандартный парсер CSV (копия для автономности файла)
     */
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

    function createObjectFromRow (headers, row, ignoreKeys = undefined) {
        const meta = {}
        for (let j = 0; j < headers.length; j++) {
            let key = headers[j]
            const value = row[j].trim()
            if (key && key !== '_' && value !== '') {
                if (key.startsWith('_source.')) {
                    key = key.substring('_source.'.length)
                }
                if (key.startsWith('_') || key.startsWith('@')) continue;
                if (ignoreKeys && ignoreKeys.includes(key)) continue;
                meta[key] = value
            }
        }
        return meta
    }

    if (window.IntercomAnalytics) {
        window.IntercomAnalytics.registerFileHandler(PushWorkerLogHandler);
    }
})();
