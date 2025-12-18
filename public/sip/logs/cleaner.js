const fs = require('fs');

/**
 * Простой, но надёжный парсер CSV с поддержкой:
 * - полей в двойных кавычках
 * - многострочных полей
 * - удвоенных кавычек внутри поля ("")
 * - пустых полей
 */
function parseCSVLine(line) {
    const result = [];
    let field = '';
    let inQuotes = false;
    let i = 0;

    while (i < line.length) {
        const char = line[i];
        const nextChar = i + 1 < line.length ? line[i + 1] : null;

        if (char === '"') {
            if (inQuotes && nextChar === '"') {
                // Экранированная кавычка внутри поля
                field += '"';
                i += 2;
            } else {
                // Вход/выход из quoted поля
                inQuotes = !inQuotes;
                i++;
            }
        } else if (char === ',' && !inQuotes) {
            // Разделитель вне кавычек
            result.push(field);
            field = '';
            i++;
        } else {
            field += char;
            i++;
        }
    }
    result.push(field); // Последнее поле
    return result;
}

function reorderCSVColumns(inputPath, outputPath, columnsToFront) {
    const data = fs.readFileSync(inputPath, 'utf-8');

    // Вместо split по строкам, используем парсер на весь текст
    const allRows = parseFullCSV(data);

    if (allRows.length === 0) {
        console.error('Файл пустой или повреждён');
        return;
    }

    // Парсим заголовок (первая строка из массива строк)
    const headerFields = allRows[0];
    const colIndexMap = {};
    headerFields.forEach((col, idx) => {
        colIndexMap[col.trim()] = idx;
    });

    // Определяем индексы для перемещения
    const moveIndices = [];
    const seen = new Set();
    columnsToFront.forEach(col => {
        const trimmed = col.trim();
        if (colIndexMap.hasOwnProperty(trimmed)) {
            if (!seen.has(trimmed)) {
                moveIndices.push(colIndexMap[trimmed]);
                seen.add(trimmed);
            }
        } else {
            console.warn(`Колонка "${trimmed}" не найдена и будет пропущена`);
        }
    });

    // Остальные индексы (сохраняют относительный порядок)
    const stayIndices = headerFields
        .map((_, idx) => idx)
        .filter(idx => !moveIndices.includes(idx));

    const newOrder = moveIndices.concat(stayIndices);

    // Обрабатываем все строки данных
    const newLines = allRows.map((fields, lineIdx) => {
        // Проверка на несоответствие количества полей
        if (fields.length !== headerFields.length && lineIdx > 0) {
            console.warn(`Строка ${lineIdx + 1} имеет другое количество полей (${fields.length} вместо ${headerFields.length}).`);
        }

        const reordered = newOrder.map(idx => fields[idx]);

        // Собираем обратно в CSV-строку с правильным экранированием
        return reordered.map(field => {
            if (field === undefined || field === null) return '';
            const fieldStr = String(field);
            if (/[",\n\r]/.test(fieldStr)) {
                return '"' + fieldStr.replace(/"/g, '""') + '"';
            }
            return fieldStr;
        }).join(',');
    });

    fs.writeFileSync(outputPath, newLines.join('\n'), 'utf-8');
    console.log(`Готово! Обработано записей: ${allRows.length}. Файл сохранён: ${outputPath}`);
}

function parseFullCSV(text) {
    const result = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    let i = 0;

    while (i < text.length) {
        const char = text[i];
        const nextChar = text[i + 1];

        if (char === '"') {
            if (inQuotes && nextChar === '"') {
                field += '"';
                i += 2;
            } else {
                inQuotes = !inQuotes;
                i++;
            }
        } else if (char === ',' && !inQuotes) {
            row.push(field);
            field = '';
            i++;
        } else if ((char === '\r' || char === '\n') && !inQuotes) {
            row.push(field);
            result.push(row);
            row = [];
            field = '';
            if (char === '\r' && nextChar === '\n') i++;
            i++;
        } else {
            field += char;
            i++;
        }
    }
    if (row.length > 0 || field !== '') {
        row.push(field);
        result.push(row);
    }
    return result;
}

// --------------------- Использование из командной строки ---------------------

const args = process.argv.slice(2);
if (args.length < 3) {
    console.log('Использование: node reorder-csv.js <input.csv> <output.csv> <колонка1> [колонка2] ...');
    console.log('Пример: node reorder-csv.js big.log.csv sorted.csv "_source.call_uuid" "_source.@timestamp" "hangup_cause"');
    process.exit(1);
}

const inputPath = args[0];
const outputPath = args[1];
const columnsToFront = args.slice(2);

if (!fs.existsSync(inputPath)) {
    console.error(`Файл не найден: ${inputPath}`);
    process.exit(1);
}

reorderCSVColumns(inputPath, outputPath, columnsToFront);