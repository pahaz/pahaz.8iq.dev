(function() {
    let EXTENSION_ID = null;
    const EXTENSION_URL = 'https://chromewebstore.google.com/detail/bridge/kjngblbbgmcjapdolbonbgmpccpdlpko';
    let lastEarliestMsFrom = null;
    let lastLatestMsTo = null;
    
    function formatDateTime(ms) {
        if (!ms) return '';
        const d = new Date(ms);
        const day = String(d.getDate()).padStart(2, '0');
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const hours = String(d.getHours()).padStart(2, '0');
        const minutes = String(d.getMinutes()).padStart(2, '0');
        return `${day}.${month} ${hours}:${minutes}`;
    }

    function flattenObject(obj, prefix = '', result = {}) {
      if (obj === null || obj === undefined) return result;

      for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
          const newKey = prefix ? `${prefix}.${key}` : key;
          const value = obj[key];

          if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
            flattenObject(value, newKey, result);
          } else {
            result[newKey] = value;
          }
        }
      }
      return result;
    }

    function convertToCSV(jsonData) {
      // Поддержка структуры ответа OpenSearch Dashboards (rawResponse) или чистого OpenSearch
      const hits = jsonData?.rawResponse?.hits?.hits || jsonData?.hits?.hits;
      if (!hits || hits.length === 0) return "";

      const flattenedHits = hits.map(hit => {
        const flatHit = {};
        // Разворачиваем _source
        if (hit._source) {
          const flatSource = flattenObject(hit._source, '_source');
          Object.assign(flatHit, flatSource);
        }
        // Разворачиваем fields (обычно там массивы значений, но для CSV берем как есть)
        if (hit.fields) {
          // fields в OpenSearch обычно плоские, но значения массивы.
          // Если нужно тоже развернуть структуру имен, делаем flattenObject.
          // Но fields обычно уже выбраны конкретными полями.
          // Оставим как есть или тоже flatten, если там объекты.
          Object.keys(hit.fields).forEach(k => {
            flatHit[k] = hit.fields[k];
          });
        }
        return flatHit;
      });

      // Собираем все уникальные ключи
      const allKeys = new Set();
      flattenedHits.forEach(row => {
        Object.keys(row).forEach(k => allKeys.add(k));
      });
      const headers = Array.from(allKeys).sort();

      const csvRows = [headers.join(",")];

      flattenedHits.forEach(row => {
        const csvRow = headers.map(header => {
          let val = row[header];

          if (val === undefined || val === null) return "";

          if (Array.isArray(val)) val = JSON.stringify(val);
          else if (typeof val === 'object') val = JSON.stringify(val);

          const strVal = String(val);
          // Экранирование для CSV: если есть кавычки, запятые или переводы строк
          if (/[",\n\r]/.test(strVal)) {
            return `"${strVal.replace(/"/g, '""')}"`;
          }
          return strVal;
        });
        csvRows.push(csvRow.join(","));
      });

      return csvRows.join("\n");
    }

    function calculateReportTimes(timeFrom, timeTo) {
        let msTo, msFrom;
        if (timeFrom !== null && timeTo !== null) {
            msFrom = new Date(timeFrom).getTime();
            msTo = new Date(timeTo).getTime();
        } else if (timeTo !== null) {
            msTo = new Date(timeTo).getTime();
            msFrom = msTo - 86400000;
        } else if (timeFrom !== null) {
            msFrom = new Date(timeFrom).getTime();
            msTo = msFrom + 86400000;
        } else {
            msTo = Date.now();
            msFrom = msTo - 86400000;
        }
        
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

    async function getReportData(name, generateFn, isoFrom, isoTo, index) {
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
            } else if (response && response.ok && response.json.rawResponse) {
                const data = convertToCSV(response.json);
                return {
                    name: `report_${index}_${isoFrom}_${isoTo}.csv`,
                    content: data,
                }
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

      const { isoFrom, isoTo } = calculateReportTimes(timeFrom, timeTo);

      const payload = {
        path: "/internal/search/opensearch-with-long-numerals",
        method: "POST",
        headers: { "osd-version": "3.2.0" },
        body: {
          params: {
            index: "doma-production-intercom-sip-production-*",
            body: {
              sort: [{ "@timestamp": { order: "desc", unmapped_type: "boolean" } }],
              size: 10000,
              version: true,
              stored_fields: ["*"],
              script_fields: {},
              docvalue_fields: [
                { field: "@timestamp", format: "date_time" },
                { field: "container.labels.org_opencontainers_image_created", format: "date_time" },
                { field: "esl.time", format: "date_time" },
                { field: "json.time", format: "date_time" }
              ],
              _source: { excludes: [] },
              query: {
                bool: {
                  must: [],
                  filter: [
                    {
                      bool: {
                        should: [
                          { bool: { should: [{ match_phrase: { "fields.log_type": "sip-prod-cdr" } }], minimum_should_match: 1 } },
                          { bool: { should: [{ match_phrase: { "fields.log_type": "sip-cdr" } }], minimum_should_match: 1 } }
                        ],
                        minimum_should_match: 1
                      }
                    },
                    {
                      range: {
                        "@timestamp": {
                          gte: isoFrom,
                          lte: isoTo,
                          format: "strict_date_optional_time"
                        }
                      }
                    }
                  ],
                  should: [],
                  must_not: []
                }
              },
              highlight: {
                pre_tags: ["@opensearch-dashboards-highlighted-field@"],
                post_tags: ["@/opensearch-dashboards-highlighted-field@"],
                fields: { "*": {} },
                fragment_size: 2147483647,
              },
            },
            preference: Date.now(),
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

      const { isoFrom, isoTo } = calculateReportTimes(timeFrom, timeTo);

      const payload = {
        path: "/internal/search/opensearch-with-long-numerals",
        method: "POST",
        headers: { "osd-version": "3.2.0" },
        body: {
          params: {
            index: "doma-production-intercom-sip-production-*",
            body: {
              sort: [{ "@timestamp": { order: "desc", unmapped_type: "boolean" } }],
              size: 10000,
              version: true,
              stored_fields: ["*"],
              script_fields: {},
              docvalue_fields: [
                { field: "@timestamp", format: "date_time" },
                { field: "container.labels.org_opencontainers_image_created", format: "date_time" },
                { field: "esl.time", format: "date_time" },
                { field: "json.time", format: "date_time" }
              ],
              _source: { excludes: [] },
              query: {
                bool: {
                  must: [],
                  filter: [
                    {
                      bool: {
                        filter: [
                          { bool: { should: [{ match_phrase: { "esl.args": "sendPush" } }], minimum_should_match: 1 } },
                          {
                            bool: {
                              filter: [
                                { bool: { must_not: { bool: { should: [{ match_phrase: { "esl.args": "push sending end" } }], minimum_should_match: 1 } } } },
                                { bool: { must_not: { bool: { should: [{ match_phrase: { "esl.args": "push cancel end" } }], minimum_should_match: 1 } } } }
                              ]
                            }
                          }
                        ]
                      }
                    },
                    {
                      range: {
                        "@timestamp": {
                          gte: isoFrom,
                          lte: isoTo,
                          format: "strict_date_optional_time"
                        }
                      }
                    }
                  ],
                  should: [],
                  must_not: []
                }
              },
              highlight: {
                pre_tags: ["@opensearch-dashboards-highlighted-field@"],
                post_tags: ["@/opensearch-dashboards-highlighted-field@"],
                fields: { "*": {} },
                fragment_size: 2147483647,
              },
            },
            preference: Date.now(),
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

      const { isoFrom, isoTo } = calculateReportTimes(timeFrom, timeTo);

      const payload = {
        path: "/internal/search/opensearch-with-long-numerals",
        method: "POST",
        headers: { "osd-version": "3.2.0" },
        body: {
          params: {
            index: "production-*",
            body: {
              sort: [{ "@timestamp": { order: "desc", unmapped_type: "boolean" } }],
              size: 10000,
              version: true,
              stored_fields: ["*"],
              script_fields: {},
              docvalue_fields: [
                { field: "@timestamp", format: "date_time" },
                { field: "error.extensions.messageInterpolation.givenDate", format: "date_time" },
                { field: "error.originalError.errors.errors.time_thrown", format: "date_time" },
                { field: "error.originalError.errors.extensions.messageInterpolation.givenDate", format: "date_time" },
                { field: "error.originalError.errors.originalError.errors.extensions.messageInterpolation.givenDate", format: "date_time" },
                { field: "error.originalError.errors.originalError.time_thrown", format: "date_time" },
                { field: "req.query.advancedAt_gte", format: "date_time" },
                { field: "req.query.advancedAt_lte", format: "date_time" },
                { field: "req.query.createdAt_gte", format: "date_time" },
                { field: "req.query.createdAt_lte", format: "date_time" },
                { field: "req.query.lastPeriod", format: "date_time" },
                { field: "req.query.period", format: "date_time" },
                { field: "req.query.tm", format: "date_time" }
              ],
              _source: { excludes: [] },
              query: {
                bool: {
                  must: [],
                  filter: [
                    {
                      bool: {
                        filter: [
                          { bool: { should: [{ match_phrase: { "msg": "sendMessageByAdapter" } }], minimum_should_match: 1 } },
                          { bool: { should: [{ match_phrase: { "event.original": "sipCallId" } }], minimum_should_match: 1 } }
                        ]
                      }
                    },
                    {
                      range: {
                        "@timestamp": {
                          gte: isoFrom,
                          lte: isoTo,
                          format: "strict_date_optional_time"
                        }
                      }
                    }
                  ],
                  should: [],
                  must_not: []
                }
              },
              highlight: {
                pre_tags: ["@opensearch-dashboards-highlighted-field@"],
                post_tags: ["@/opensearch-dashboards-highlighted-field@"],
                fields: { "*": {} },
                fragment_size: 2147483647,
              },
            },
            preference: Date.now(),
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
            autoBtn.id = 'btnLoadFromExtension';
            autoBtn.className = 'btn-primary';
            autoBtn.innerText = 'Загрузить через расширение';
            autoBtn.style.marginTop = '0.5rem';

            const prevBtn = document.createElement('button');
            prevBtn.id = 'btnLoadPrevFromExtension';
            prevBtn.className = 'btn-primary';
            prevBtn.innerText = 'Загрузить предыдущие 24ч';
            prevBtn.style.marginTop = '0.5rem';
            prevBtn.style.display = 'none';

            const runLoad = async (btn, startTime, endTime) => {
                btn.disabled = true;
                autoBtn.disabled = true;
                prevBtn.disabled = true;
                
                const originalText = btn.innerText;

                const { msFrom, msTo, isoFrom, isoTo } = calculateReportTimes(startTime, endTime);
                const reports = [
                    { name: 'sip_cdr', fn: () => generateSipReport(isoFrom, isoTo) },
                    { name: 'push_notifications', fn: () => generatePushReport(isoFrom, isoTo) },
                    { name: 'notification_tasks', fn: () => generateNotificationReport(isoFrom, isoTo) }
                ];

                const collectedFiles = [];
                for (let i = 0; i < reports.length; i++) {
                    btn.innerText = `Загрузка... (${i + 1}/${reports.length})`;
                    const report = await getReportData(reports[i].name, reports[i].fn, isoFrom, isoTo, i + 1);
                    if (report) {
                        const file = new File([report.content], report.name, { type: 'text/csv' });
                        collectedFiles.push(file);
                        if (window.DOWLOAD_CSV_MODE === true) {
                          const url = URL.createObjectURL(file);
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = report.name;
                          document.body.appendChild(a);
                          a.click();
                          document.body.removeChild(a);
                          URL.revokeObjectURL(url);
                        }
                    }
                }

                if (collectedFiles.length === reports.length) {
                    const fileInput = document.getElementById('hidden-file-input');
                    if (fileInput) {
                        const dataTransfer = new DataTransfer();
                        collectedFiles.forEach(file => dataTransfer.items.add(file));
                        fileInput.files = dataTransfer.files;
                        fileInput.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                }

                if (collectedFiles.length === reports.length) {
                    if (lastEarliestMsFrom === null || msFrom < lastEarliestMsFrom) {
                        lastEarliestMsFrom = msFrom;
                    }
                    if (lastLatestMsTo === null || msTo > lastLatestMsTo) {
                        lastLatestMsTo = msTo;
                    }

                    const nextFrom = lastLatestMsTo;
                    const nextTo = lastLatestMsTo + 86400000;
                    autoBtn.innerText = `Загрузить следующие 24ч (${formatDateTime(nextFrom)} - ${formatDateTime(nextTo)})`;
                    
                    const prevTo = lastEarliestMsFrom;
                    const prevFrom = lastEarliestMsFrom - 86400000;
                    prevBtn.style.display = 'block';
                    prevBtn.innerText = `Загрузить предыдущие 24ч (${formatDateTime(prevFrom)} - ${formatDateTime(prevTo)})`;
                    
                    btn.innerText = '✅ Все отчеты загружены';
                } else if (collectedFiles.length > 0) {
                    btn.innerText = `⚠️ Загружено ${collectedFiles.length} из ${reports.length}`;
                } else {
                    btn.innerText = '❌ Ошибка загрузки. Открывается ли kibana?';
                }

                setTimeout(() => {
                    if (btn === autoBtn && lastLatestMsTo !== null) {
                        const nextFrom = lastLatestMsTo;
                        const nextTo = lastLatestMsTo + 86400000;
                        btn.innerText = `Загрузить следующие 24ч (${formatDateTime(nextFrom)} - ${formatDateTime(nextTo)})`;
                    } else if (btn === prevBtn && lastEarliestMsFrom !== null) {
                        const prevTo = lastEarliestMsFrom;
                        const prevFrom = lastEarliestMsFrom - 86400000;
                        btn.innerText = `Загрузить предыдущие 24ч (${formatDateTime(prevFrom)} - ${formatDateTime(prevTo)})`;
                    } else {
                        btn.innerText = originalText;
                    }
                    btn.disabled = false;
                    autoBtn.disabled = false;
                    prevBtn.disabled = false;
                }, 5000);
            };

            autoBtn.onclick = () => {
                if (lastLatestMsTo === null) {
                    runLoad(autoBtn, null, null);
                } else {
                    const nextFrom = lastLatestMsTo;
                    const nextTo = lastLatestMsTo + 86400000;
                    runLoad(autoBtn, nextFrom, nextTo);
                }
            };
            prevBtn.onclick = () => {
                if (lastEarliestMsFrom === null) {
                    runLoad(prevBtn, null, null);
                } else {
                    const prevTo = lastEarliestMsFrom;
                    const prevFrom = lastEarliestMsFrom - 86400000;
                    runLoad(prevBtn, prevFrom, prevTo);
                }
            };

            container.appendChild(autoBtn);
            container.appendChild(prevBtn);
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
