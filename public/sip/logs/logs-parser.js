(function () {
    'use strict';

    /**
     * Парсер для логов "On_demand_report" (CSV)
     * Агрегирует inbound (домофон) и outbound (клиент/приложение) ноги звонка.
     */
    const SIPSercerLogHandler = {
        name: 'SIP Server CDR (CSV)',

        /**
         * Проверка: Файл должен содержать уникальные для этого лога поля.
         */
        check: (content) => {
            const firstLine = content.slice(0, 30000).split('\n')[0];
            return firstLine.includes('_source.variables.sip_call_id') &&
                firstLine.includes('_source.variables.sip_h_X-Other-Call-ID');
        },

        parse: (content) => {
            const rows = parseCSV(content);
            if (rows.length < 2) return [];

            // 1. Динамический маппинг заголовков в индексы
            const headers = rows[0].map((x) => x.trim()||'_');
            const col = (name) => headers.indexOf(name);

            const IDX = {
                callId: col('_source.variables.sip_call_id'),
                otherCallId: col('_source.variables.sip_h_X-Other-Call-ID'),
                uid: col('_source.variables.uuid'),
                direction: col('_source.variables.direction'),
                userAgent: col('_source.variables.sip_user_agent'),
                fullVia: col('_source.variables.sip_full_via'),

                // Временные метки
                start: col('_source.variables.start_uepoch'),
                progressMedia: col('_source.variables.progress_media_uepoch'),
                answer: col('_source.variables.answer_uepoch'),
                end: col('_source.variables.end_uepoch'),
                bridge: col('_source.variables.bridge_uepoch'),

                // Участники
                fromUser: col('_source.variables.sip_from_user'),
                toUser: col('_source.variables.sip_to_user'),
                ip: col('_source.variables.sip_network_ip'),

                // Статусы и причины завершения
                hangupCause: col('_source.variables.hangup_cause'),
                hangupCauseQ850: col('_source.variables.hangup_cause_q850'),
                sipHangupDisp: col('_source.variables.sip_hangup_disposition'),
                inviteFailPhrase: col('_source.variables.sip_invite_failure_phrase'),
                inviteFailStatus: col('_source.variables.sip_invite_failure_status'),
                protoSpecificHangup: col('_source.variables.proto_specific_hangup_cause'),
                lastBridgeProtoSpecificHangup: col('_source.variables.last_bridge_proto_specific_hangup_cause'),

                // Инструментарий
                dtmf: col('_source.variables.digits_dialed'),

                // Метрики (Audio)
                audioMos: col('_source.variables.rtp_audio_in_mos'),
                audioCodec: col('_source.variables.rtp_use_codec_name'),
                audioPktIn: col('_source.variables.rtp_audio_in_media_packet_count'),
                audioPktOut: col('_source.variables.rtp_audio_out_media_packet_count'),
                audioDtmfIn: col('_source.variables.rtp_audio_in_dtmf_packet_count'),
                audioDtmfOut: col('_source.variables.rtp_audio_out_dtmf_packet_count'), // send to intercome dtmf

                // Метрики (Video)
                videoMos: col('_source.variables.rtp_video_in_mos'),
                videoCodec: col('_source.variables.rtp_use_video_codec_name'),
                videoPktIn: col('_source.variables.rtp_video_in_media_packet_count'),
                videoPktOut: col('_source.variables.rtp_video_out_media_packet_count'),
                videoDtmfIn: col('_source.variables.rtp_video_in_dtmf_packet_count'),
                videoDtmfOut: col('_source.variables.rtp_video_out_dtmf_packet_count'),

                // Длительность
                billSec: col('_source.variables.billsec'),
                duration: col('_source.variables.duration'),
            };

            // Карта для агрегации звонков по ID домофонной сессии
            const callsMap = new Map();

            // 2. Проход по данным
            for (let i = 1; i < rows.length; i++) {
                const row = rows[i];
                if (row.length < headers.length) {
                    console.warn(`Row ${i} has less columns than headers (${headers.length})`, row);
                    continue;
                }

                const direction = row[IDX.direction].trim();
                const sipCallId = row[IDX.callId].trim();
                const otherCallId = row[IDX.otherCallId].trim();
                const uid = sipCallId || row[IDX.uid].trim();

                // Определяем основной ID звонка (всегда ID inbound ноги)
                let masterId = null;

                if (direction === 'inbound') {
                    masterId = sipCallId;
                } else if (direction === 'outbound') {
                    // Для исходящих ссылаемся на родительский inbound ID
                    masterId = otherCallId;
                }

                if (!masterId) {
                    console.warn(`Row ${i} has invalid direction (${direction}) or missing call IDs (${IDX.callId}, ${IDX.otherCallId})`, row);
                    continue;
                }

                // Инициализация объекта звонка, если еще нет
                if (!callsMap.has(masterId)) {
                    callsMap.set(masterId, createEmptyCall(masterId));
                }

                const call = callsMap.get(masterId);
                const metaCall = createMetaCallFromRow(uid, headers, row)
                call.calls.push(metaCall)

                // 3. Заполнение данных в зависимости от направления
                if (direction === 'inbound') {
                    // --- ДАННЫЕ ПАНЕЛИ (Intercom) ---
                    call.panel_id = row[IDX.fromUser]; // Обычно имя юзера SIP панели
                    call.panel_details = row[IDX.userAgent];
                    call.apartment_id = row[IDX.toUser]; // Обычно outbound идет на user=квартира

                    call.start_call_time = parseDate(row[IDX.start]);
                    call.end_call_time = parseDate(row[IDX.end]);
                    call.start_panel_media_time = parseDate(row[IDX.progressMedia]);
                    call.answer_by_panel_time = parseDate(row[IDX.answer]);
                    call.bridge_panel_and_client_time = parseDate(row[IDX.bridge]);
                    
                    call.speaking_time_sec = parseInt(row[IDX.billSec].trim() || 0, 10);
                    call.duration_sec = parseInt(row[IDX.duration].trim() || 0, 10);
                    call.has_dtmf = parseInt(row[IDX.audioDtmfOut] || 0, 10) > 0;

                    // answered - has answer and billsec > 0
                    // opened - rtp_audio_out_dtmf_packet_count > 0
                    // missed - no answer
                    // fail - billsec = 0, rtp <= 0 ?
                    
                    if (call.answer_by_panel_time) {
                        call.call_status = 'answered';
                        if (call.has_dtmf) {
                            call.call_status = 'opened';
                        }
                        if (call.speaking_time_sec <= 0) {
                            call.call_status = 'fail';
                        }
                    } else {
                        call.call_status = 'missed';
                    }

                    call.callPanel = {
                        ip: row[IDX.ip],
                        user_agent: row[IDX.userAgent],
                        audio_codec: row[IDX.audioCodec],
                        video_codec: row[IDX.videoCodec],
                        ...metaCall,
                    };

                    addEvent(call, 'start', call.start_call_time, 'Panel', 'Звонок ☎️');
                    addEvent(call, 'answer', call.answer_by_panel_time, 'Panel', '📞🗣☎️️панель');
                    addEvent(call, 'bridge', call.bridge_panel_and_client_time, 'Panel', '🤝бридж');
                    const endInfo = buildEndInfo(metaCall)
                    addEvent(call, 'end', call.end_call_time, 'Panel', `🔚🔚панель${endInfo}`);
                }
            }

            // 4. Финальная постобработка
            return Array.from(callsMap.values()).map(call => {
                // Если статус не определен, смотрим на наличие ошибок
                if (call.call_status === 'initiated' && call.end_call_time) {
                    call.call_status = 'missed';
                }
                
                const clients = call.calls.filter(x => x.id !== call.id).toSorted((a, b) => {
                    const timeA = a['variables.start_uepoch']
                    const timeB = b['variables.start_uepoch']
                    return timeA.localeCompare(timeB)
                })
                
                if (clients.length === 1) {
                    call.callClient = clients[0]
                } else if (clients.length > 1) {
                    const bridged = clients.filter(x => parseDate(x['variables.bridge_uepoch']));
                    if (bridged.length === 1) {
                        call.callClient = bridged[0]
                    } else {
                        const answered = clients.filter(x => parseDate(x['variables.answer_uepoch'])).toSorted((a, b) => {
                            const timeA = a['variables.answer_uepoch']
                            const timeB = b['variables.answer_uepoch']
                            return timeA.localeCompare(timeB)
                        })
                        call.callClient = answered[0] || clients[0]
                    }
                } else {
                    call.callClient = {}
                }

                let index = 0
                for (const client of clients) {
                    index++;
                    addEvent(call, 'start', parseDate(client['variables.start_uepoch']), 'Client', `📲#${index}`);
                    addEvent(call, 'answer', parseDate(client['variables.answer_uepoch']), 'Client', `📞🤙🗣️#${index}`);
                    const endInfo = buildEndInfo(client)
                    addEvent(call, 'end', parseDate(client['variables.end_uepoch']), 'Client', `🔚#${index}${endInfo}`)
                }
                
                call.events.sort((a, b) => a.timestamp - b.timestamp);
                return call;
            });
        }
    };

    // --- Helpers ---
    function createMetaCallFromRow (id, headers, row) {
        const meta = {}
        for (let j = 0; j < headers.length; j++) {
            let key = headers[j]
            const value = row[j].trim()
            if (key && key !== '_' && value !== '') {
                if (key.startsWith('_source.')) {
                    key = key.substring('_source.'.length)
                }
                meta[key] = value
            }
        }
        meta['id'] = id
        return meta
    }

    function createEmptyCall(id) {
        return {
            id: id,
            call_status: 'initiated',
            events: [],
            calls: [],
            callPanel: {},
            callClient: {},
            panel_id: 'Unknown',
            panel_details: 'Unknown',
            apartment_id: 'Unknown',
        };
    }

    function buildEndInfo (client) {
        let endInfo = ''
        if (client['variables.sip_hangup_disposition']) {
            endInfo += '/' + client['variables.sip_hangup_disposition']
        }
        if (client['variables.hangup_cause_q850']) {
            endInfo += '/' + client['variables.hangup_cause_q850']
        }
        if (client['variables.sip_invite_failure_status']) {
            endInfo += '/' + client['variables.sip_invite_failure_status']
        }
        if (client['variables.sip_invite_failure_phrase']) {
            endInfo += '/' + client['variables.sip_invite_failure_phrase']
        }
        return endInfo
    }

    function addEvent(call, event_type, timestamp, source, details) {
        if (!timestamp) {
            // console.warn(`Invalid event time: ${timeStr}`, call, event_type, timeStr, source, details);
            return;
        }
        // Избегаем дублей событий с одинаковым временем и типом
        const exists = call.events.find(e => e.event_type === event_type && e.timestamp === timestamp);
        if (!exists) {
            const event_id = `${call.id}_${event_type}_${timestamp.getTime()}`
            call.events.push({
                event_id,
                event_type,
                source,
                details,
                timestamp,
            })
        }
    }

    function parseDate (str) {
        if (!str) return null
        // Формат в логе: 2025-12-16 16:30:38
        // Добавляем 'T' и 'Z' для ISO, считая что лог в UTC (или локальное, тут упрощенно)
        const cleaned = str.trim().replace(' ', 'T')
        if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?/.test(cleaned)) {
            return new Date(cleaned + 'Z')
        } else if (/^\d+$/.test(cleaned)) {
            let asNumber = Number(cleaned);
            if (isNaN(asNumber) || asNumber === 0) return null;
            // 1. Если это микросекунды (16 знаков), переводим в миллисекунды
            if (cleaned.length >= 15) {
                asNumber = Math.floor(asNumber / 1000);
            }
            // 2. Если это секунды (10 знаков), переводим в миллисекунды
            else if (asNumber < 10000000000) {
                asNumber = asNumber * 1000;
            }
            return new Date(asNumber);
        }
        return null
    }

    // Robust CSV Parser (handles quotes)
    function parseCSV(text) {
        const result = [];
        let row = [];
        let inQuote = false;
        let token = '';

        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            const next = text[i+1];

            if (char === '"') {
                if (inQuote && next === '"') {
                    token += '"'; // Escaped quote
                    i++;
                } else {
                    inQuote = !inQuote;
                }
            } else if (char === ',' && !inQuote) {
                row.push(token);
                token = '';
            } else if ((char === '\r' || char === '\n') && !inQuote) {
                if (token || row.length > 0) row.push(token);
                if (row.length > 0) result.push(row);
                row = [];
                token = '';
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

    // Регистрация
    if (window.IntercomAnalytics) {
        window.IntercomAnalytics.registerFileHandler(SIPSercerLogHandler);
    }
})();
