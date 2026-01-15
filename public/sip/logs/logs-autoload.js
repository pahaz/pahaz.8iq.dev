(function() {
    let EXTENSION_ID = null;
    const EXTENSION_URL = 'https://chromewebstore.google.com/detail/bridge/kjngblbbgmcjapdolbonbgmpccpdlpko';
    
    function calculateReportTimes(timeFrom, timeTo) {
        const msTo = timeTo ? new Date(timeTo).getTime() : Date.now();
        // 60 часов = 60 * 60 * 1000 * 60 = 216000000 ms
        const msFrom = timeFrom ? new Date(timeFrom).getTime() : (msTo - 216000000);
        return {
            msFrom,
            msTo,
            isoFrom: new Date(msFrom).toISOString(),
            isoTo: new Date(msTo).toISOString()
        };
    }

    function updateQueryUrlTime(url, isoFrom, isoTo) {
        // Заменяем time:(from:'...',to:'...') на новые значения
        return url.replace(/time:\(from:'[^']+',to:'[^']+'\)/, `time:(from:'${isoFrom}',to:'${isoTo}')`);
    }

    async function getReportData(name, generateFn) {
        try {
            const response = await generateFn();
            if (response && response.ok && response.json && response.json.data && response.json.filename) {
                const csvData = response.json.data;
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                const filename = `${name}_${timestamp}.csv`;
                return {
                    name: filename,
                    content: csvData
                };
            } else {
                console.error(`Failed to generate ${name} report:`, response);
                return null;
            }
        } catch (error) {
            console.error(`Error generating ${name} report:`, error);
            return null;
        }
    }

    // 1. Отчет по SIP CDR (fields.log_type: "sip-prod-cdr" ...)
    async function generateSipReport(timeFrom, timeTo) {
        if (!EXTENSION_ID) { console.warn('generateSipReport without EXTENSION_ID!'); return; }

        const { msFrom, msTo, isoFrom, isoTo } = calculateReportTimes(timeFrom, timeTo);

        const queryParams = new URLSearchParams({
            timezone: "Europe/Istanbul",
            dateFormat: "MMM D, YYYY @ HH:mm:ss.SSS",
            csvSeparator: ",",
            allowLeadingWildcards: "true"
        });

        const originalQueryUrl = "/app/discoverLegacy#/view/d9fb71d0-daac-11f0-848f-3b313048592e?_g=(filters:!(),refreshInterval:(pause:!t,value:0),time:(from:'2026-01-13T03:13:28.738Z',to:'2026-01-15T15:13:28.738Z'))&_a=(columns:!(_source),filters:!(),index:'7e8fa130-a362-11f0-848f-3b313048592e',interval:auto,query:(language:kuery,query:'fields.log_type:%20%22sip-prod-cdr%22%20OR%20fields.log_type:%20%22sip-cdr%22'),sort:!())";
        const queryUrl = updateQueryUrlTime(originalQueryUrl, isoFrom, isoTo);

        const payload = {
            path: `/api/reporting/generateReport?${queryParams.toString()}`,
            method: "POST",
            headers: { "osd-xsrf": "reporting" },
            body: {
                "query_url": queryUrl,
                "time_from": msFrom,
                "time_to": msTo,
                "report_definition": {
                    "report_params": {
                        "report_name": "On_demand_report",
                        "report_source": "Saved search",
                        "description": "In-context report download",
                        "core_params": {
                            "base_url": "/app/discoverLegacy#/view/d9fb71d0-daac-11f0-848f-3b313048592e",
                            "report_format": "csv",
                            "time_duration": "PT60H0.001S",
                            "saved_search_id": "d9fb71d0-daac-11f0-848f-3b313048592e"
                        }
                    },
                    "delivery": { "configIds": [""], "title": "", "textDescription": "", "htmlDescription": "" },
                    "trigger": { "trigger_type": "On demand" }
                }
            }
        };

        return await chrome.runtime.sendMessage(EXTENSION_ID, {
            type: "RUN_SERVICE_QUERY",
            serviceId: "kibana",
            payload
        });
    }

    // 2. Отчет по Push-уведомлениям (esl.args: "sendPush" ...)
    async function generatePushReport(timeFrom, timeTo) {
        if (!EXTENSION_ID) { console.warn('generatePushReport without EXTENSION_ID!'); return; }

        const { msFrom, msTo, isoFrom, isoTo } = calculateReportTimes(timeFrom, timeTo);

        const queryParams = new URLSearchParams({
            timezone: "Europe/Istanbul",
            dateFormat: "MMM D, YYYY @ HH:mm:ss.SSS",
            csvSeparator: ",",
            allowLeadingWildcards: "true"
        });

        const originalQueryUrl = "/app/discoverLegacy#/view/eb284230-dcb9-11f0-848f-3b313048592e?_g=(filters:!(),refreshInterval:(pause:!t,value:0),time:(from:'2026-01-13T03:14:32.522Z',to:'2026-01-15T15:14:32.522Z'))&_a=(columns:!(_source),filters:!(),index:'7e8fa130-a362-11f0-848f-3b313048592e',interval:auto,query:(language:kuery,query:'esl.args:%20(%22sendPush%22)%20and%20not%20esl.args:%20%22push%20sending%20end%22%20and%20not%20esl.args:%20%22push%20cancel%20end%22'),sort:!())";
        const queryUrl = updateQueryUrlTime(originalQueryUrl, isoFrom, isoTo);

        const payload = {
            path: `/api/reporting/generateReport?${queryParams.toString()}`,
            method: "POST",
            headers: { "osd-xsrf": "reporting" },
            body: {
                "query_url": queryUrl,
                "time_from": msFrom,
                "time_to": msTo,
                "report_definition": {
                    "report_params": {
                        "report_name": "On_demand_report",
                        "report_source": "Saved search",
                        "description": "In-context report download",
                        "core_params": {
                            "base_url": "/app/discoverLegacy#/view/eb284230-dcb9-11f0-848f-3b313048592e",
                            "report_format": "csv",
                            "time_duration": "PT60H",
                            "saved_search_id": "eb284230-dcb9-11f0-848f-3b313048592e"
                        }
                    },
                    "delivery": { "configIds": [""], "title": "", "textDescription": "", "htmlDescription": "" },
                    "trigger": { "trigger_type": "On demand" }
                }
            }
        };

        return await chrome.runtime.sendMessage(EXTENSION_ID, {
            type: "RUN_SERVICE_QUERY",
            serviceId: "kibana",
            payload
        });
    }

    // 3. Отчет по уведомлениям задач (Notification tasks)
    async function generateNotificationReport(timeFrom, timeTo) {
        if (!EXTENSION_ID) { console.warn('generateNotificationReport without EXTENSION_ID!'); return; }

        const { msFrom, msTo, isoFrom, isoTo } = calculateReportTimes(timeFrom, timeTo);

        const queryParams = new URLSearchParams({
            timezone: "Europe/Istanbul",
            dateFormat: "MMM D, YYYY @ HH:mm:ss.SSS",
            csvSeparator: ",",
            allowLeadingWildcards: "true"
        });

        const originalQueryUrl = "/app/discoverLegacy#/view/418bf7a0-e4b9-11f0-848f-3b313048592e?_g=(filters:!(),refreshInterval:(pause:!t,value:0),time:(from:'2026-01-13T03:15:01.173Z',to:'2026-01-15T15:15:01.173Z'))&_a=(columns:!(_source),filters:!(('$state':(store:appState),meta:(alias:!n,disabled:!f,index:d2944a70-a42e-11f0-848f-3b313048592e,key:msg,negate:!f,params:(query:sendMessageByAdapter),type:phrase),query:(match_phrase:(msg:sendMessageByAdapter))),('$state':(store:appState),meta:(alias:!n,disabled:!f,index:d2944a70-a42e-11f0-848f-3b313048592e,key:name,negate:!f,params:(query:apps%2Fcondo%2Fdomains%2Fnotification%2Ftasks%2FdeliverMessage.js),type:phrase),query:(match_phrase:(name:apps%2Fcondo%2Fdomains%2Fnotification%2Ftasks%2FdeliverMessage.js)))),index:d2944a70-a42e-11f0-848f-3b313048592e,interval:auto,query:(language:kuery,query:'event.original:%22sipCallId%22'),sort:!())";
        const queryUrl = updateQueryUrlTime(originalQueryUrl, isoFrom, isoTo);

        const payload = {
            path: `/api/reporting/generateReport?${queryParams.toString()}`,
            method: "POST",
            headers: { "osd-xsrf": "reporting" },
            body: {
                "query_url": queryUrl,
                "time_from": msFrom,
                "time_to": msTo,
                "report_definition": {
                    "report_params": {
                        "report_name": "On_demand_report",
                        "report_source": "Saved search",
                        "description": "In-context report download",
                        "core_params": {
                            "base_url": "/app/discoverLegacy#/view/418bf7a0-e4b9-11f0-848f-3b313048592e",
                            "report_format": "csv",
                            "time_duration": "PT60H0.001S",
                            "saved_search_id": "418bf7a0-e4b9-11f0-848f-3b313048592e"
                        }
                    },
                    "delivery": { "configIds": [""], "title": "", "textDescription": "", "htmlDescription": "" },
                    "trigger": { "trigger_type": "On demand" }
                }
            }
        };

        return await chrome.runtime.sendMessage(EXTENSION_ID, {
            type: "RUN_SERVICE_QUERY",
            serviceId: "kibana",
            payload
        });
    }

    function injectUI(isInstalled) {
        const uploadBtn = document.getElementById('btnUpload');
        if (!uploadBtn) return;

        // Удаляем старые инъекции если они были (на случай повторного вызова)
        const existing = document.getElementById('extension-autoload-container');
        if (existing) existing.remove();

        const container = document.createElement('div');
        container.id = 'extension-autoload-container';
        container.style.marginTop = '1rem';
        container.style.textAlign = 'center';

        if (isInstalled) {
            const autoBtn = document.createElement('button');
            autoBtn.className = 'btn-primary';
            autoBtn.innerText = 'Загрузить через расширение';
            autoBtn.style.marginTop = '0.5rem';
            autoBtn.onclick = async () => {
                autoBtn.disabled = true;
                const originalText = autoBtn.innerText;
                const reports = [
                    { name: 'sip_cdr', fn: () => generateSipReport(null, new Date().toISOString()) },
                    { name: 'push_notifications', fn: () => generatePushReport(null, new Date().toISOString()) },
                    { name: 'notification_tasks', fn: () => generateNotificationReport(null, new Date().toISOString()) }
                ];

                const collectedFiles = [];
                for (let i = 0; i < reports.length; i++) {
                    autoBtn.innerText = `Загрузка... (${i + 1}/${reports.length})`;
                    const report = await getReportData(reports[i].name, reports[i].fn);
                    if (report) {
                        const file = new File([report.content], report.name, { type: 'text/csv' });
                        collectedFiles.push(file);
                    }
                }

                if (collectedFiles.length > 0) {
                    const fileInput = document.getElementById('hidden-file-input');
                    if (fileInput) {
                        const dataTransfer = new DataTransfer();
                        collectedFiles.forEach(file => dataTransfer.items.add(file));
                        fileInput.files = dataTransfer.files;
                        fileInput.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                }

                if (collectedFiles.length === reports.length) {
                    autoBtn.innerText = '✅ Все отчеты загружены';
                } else if (collectedFiles.length > 0) {
                    autoBtn.innerText = `⚠️ Загружено ${collectedFiles.length} из ${reports.length}`;
                } else {
                    autoBtn.innerText = '❌ Ошибка загрузки';
                }

                setTimeout(() => {
                    autoBtn.innerText = originalText;
                    autoBtn.disabled = false;
                }, 5000);
            };
            container.appendChild(autoBtn);
        } else {
            const link = document.createElement('a');
            link.href = EXTENSION_URL;
            link.target = '_blank';
            link.innerText = 'Установите расширение Bridge для автозагрузки';
            link.style.color = 'var(--text-sub)';
            link.style.fontSize = '0.8rem';
            link.style.textDecoration = 'underline';
            container.appendChild(link);
        }

        uploadBtn.parentNode.insertBefore(container, uploadBtn.nextSibling);
    }

    // По умолчанию показываем ссылку, если BRIDGE_READY не пришел сразу
    // Но подождем немного, так как событие может прийти чуть позже инициализации скрипта
    let readyCalled = false;
    
    document.addEventListener('BRIDGE_READY', (event) => {
        const extensionId = event.detail.extensionId;
        if (!extensionId) { console.warn('BRIDGE_READY without extensionId!'); return; }
        if (EXTENSION_ID && extensionId !== EXTENSION_ID) { console.warn('BRIDGE_READY with different extensionId!', extensionId, EXTENSION_ID); return; }
        if (EXTENSION_ID && extensionId === EXTENSION_ID) return;

        EXTENSION_ID = extensionId;
        console.log("BRIDGE_READY extensionId:", extensionId);

        readyCalled = true;
        injectUI(true);
    });

    // Если через 1 секунду событие не пришло, считаем что расширения нет
    setTimeout(() => {
        if (!readyCalled) {
            injectUI(false);
        }
    }, 1000);
})();
