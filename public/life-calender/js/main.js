import { RESOLUTION_PRESETS, DEFAULT_CONFIG, TOTAL_WEEKS, TEMPLATES } from './config.js';
import { calculateWeekIndex, calculateProgressPercent } from './engine.js';
import defectTemplate from './templates/defect.js';
import coloredTemplate from './templates/colored.js';

// DOM Elements
const templatePicker = document.getElementById('template-picker');
const resSearchInput = document.getElementById('res-search');
const resPresetSelect = document.getElementById('res-preset');
const resWidthInput = document.getElementById('res-width');
const resHeightInput = document.getElementById('res-height');
const birthDateInput = document.getElementById('birth-date');
const timeTravelInput = document.getElementById('time-travel');
const previewWeekLabel = document.getElementById('preview-week-label');
const previewCanvas = document.getElementById('preview-canvas');
const previewContainer = document.getElementById('preview-container');
const btnGenerate = document.getElementById('btn-generate');
const btnCancel = document.getElementById('btn-cancel');
const progressContainer = document.getElementById('progress-container');
const progressBar = document.getElementById('progress-bar');
const progressText = document.getElementById('progress-text');
const progressPercent = document.getElementById('progress-percent');

let worker = null;
let currentConfig = { ...DEFAULT_CONFIG };
const templates = {
    defect: defectTemplate,
    colored: coloredTemplate
};

// Initialize
function init() {
    // Populate templates
    populateTemplates();

    // Populate presets
    populatePresets();

    // Set default values
    resPresetSelect.value = currentConfig.resolutionId;
    resWidthInput.value = currentConfig.customWidth;
    resHeightInput.value = currentConfig.customHeight;
    birthDateInput.value = currentConfig.birthDate;
    
    // Update week index based on birth date
    const initialWeek = calculateWeekIndex(currentConfig.birthDate);
    timeTravelInput.value = initialWeek;
    updateWeekLabel(initialWeek);

    updateResolution();
    renderPreview();

    // Event Listeners
    resSearchInput.addEventListener('input', () => {
        populatePresets(resSearchInput.value);
    });

    resPresetSelect.addEventListener('change', (e) => {
        currentConfig.resolutionId = e.target.value;
        updateResolution();
        renderPreview();
        updateEstimatedSize();
    });

    [resWidthInput, resHeightInput, birthDateInput].forEach(el => {
        el.addEventListener('input', () => {
            if (el === resWidthInput && resPresetSelect.value === 'custom') {
                currentConfig.customWidth = parseInt(resWidthInput.value) || 320;
            } else if (el === resHeightInput && resPresetSelect.value === 'custom') {
                currentConfig.customHeight = parseInt(resHeightInput.value) || 320;
            } else if (el === birthDateInput) {
                currentConfig.birthDate = birthDateInput.value;
                const weekIndex = calculateWeekIndex(currentConfig.birthDate);
                timeTravelInput.value = weekIndex;
                updateWeekLabel(weekIndex);
            }
            updateResolution();
            renderPreview();
            updateEstimatedSize();
        });
    });

    timeTravelInput.addEventListener('input', (e) => {
        updateWeekLabel(parseInt(e.target.value));
        renderPreview();
    });

    btnGenerate.addEventListener('click', startGeneration);
    btnCancel.addEventListener('click', cancelGeneration);
    updateEstimatedSize();
}

function updateEstimatedSize() {
    const currentWeekIndex = calculateWeekIndex(currentConfig.birthDate);
    const totalToGenerate = TOTAL_WEEKS - currentWeekIndex;
    
    // Получаем текущие размеры из канваса или конфига
    const w = previewCanvas.width;
    const h = previewCanvas.height;
    
    // Базовая оценка: ~0.15 байт на пиксель для PNG (эмпирически для данного шаблона при высокой детализации)
    // Минимум 20KB на файл (метаданные + простая сетка)
    const bytesPerFile = Math.max(20480, (w * h) * 0.15);
    const estSizeMb = Math.max(1, Math.round((totalToGenerate * bytesPerFile) / (1024 * 1024)));
    
    const estSizeText = document.getElementById('est-size');
    const genInfo = document.getElementById('gen-info');
    
    if (estSizeText) estSizeText.textContent = `Оценка размера: ~${estSizeMb} MB (ZIP)`;
    if (genInfo) {
        if (totalToGenerate < TOTAL_WEEKS) {
            genInfo.textContent = `Будут сгенерированы недели с ${currentWeekIndex + 1} по ${TOTAL_WEEKS} (всего ${totalToGenerate})`;
            genInfo.classList.remove('hidden');
        } else {
            genInfo.textContent = `Будут сгенерированы все 4368 недель`;
        }
    }
}

function populateTemplates() {
    templatePicker.innerHTML = '';
    TEMPLATES.forEach(tpl => {
        const btn = document.createElement('button');
        btn.id = `tpl-${tpl.id}`;
        const isActive = currentConfig.templateId === tpl.id;
        
        btn.className = isActive 
            ? "border-2 border-black p-4 rounded-xl bg-black text-white transition-all text-left" 
            : "border-2 border-gray-100 p-4 rounded-xl bg-white text-gray-900 transition-all text-left hover:border-gray-300";
            
        btn.innerHTML = `
            <div class="font-medium">${tpl.name}</div>
            <div class="text-xs ${isActive ? 'opacity-70' : 'text-gray-500'}">${tpl.description}</div>
        `;
        
        btn.addEventListener('click', () => {
            currentConfig.templateId = tpl.id;
            populateTemplates();
            renderPreview();
        });
        
        templatePicker.appendChild(btn);
    });
}

function populatePresets(filter = '') {
    const selectedValue = resPresetSelect.value || currentConfig.resolutionId;
    resPresetSelect.innerHTML = '';
    
    const searchTerm = filter.toLowerCase().trim();
    
    const filtered = RESOLUTION_PRESETS.filter(preset => 
        preset.name.toLowerCase().includes(searchTerm) || 
        preset.id.toLowerCase().includes(searchTerm)
    );

    filtered.forEach(preset => {
        const option = document.createElement('option');
        option.value = preset.id;
        option.textContent = `${preset.name} (${preset.width}x${preset.height})`;
        resPresetSelect.appendChild(option);
    });

    // Always add Custom at the end if it matches filter or filter is empty
    if ('custom'.includes(searchTerm) || searchTerm === '') {
        const customOption = document.createElement('option');
        customOption.value = 'custom';
        customOption.textContent = 'Custom / Свой размер';
        resPresetSelect.appendChild(customOption);
    }

    // Try to restore selection
    resPresetSelect.value = selectedValue;
}

function updateResolution() {
    let w, h;
    if (currentConfig.resolutionId === 'custom') {
        w = currentConfig.customWidth;
        h = currentConfig.customHeight;
        resWidthInput.disabled = false;
        resHeightInput.disabled = false;
    } else {
        const preset = RESOLUTION_PRESETS.find(p => p.id === currentConfig.resolutionId);
        if (preset) {
            w = preset.width;
            h = preset.height;
            resWidthInput.value = w;
            resHeightInput.value = h;
        } else {
            // Fallback if preset not found
            w = currentConfig.customWidth;
            h = currentConfig.customHeight;
            resWidthInput.value = w;
            resHeightInput.value = h;
        }
        resWidthInput.disabled = true;
        resHeightInput.disabled = true;
    }

    previewCanvas.width = w;
    previewCanvas.height = h;
    previewContainer.style.setProperty('--ratio', `${w}/${h}`);
}

function updateWeekLabel(index) {
    previewWeekLabel.textContent = `${index + 1} / ${TOTAL_WEEKS}`;
}

function renderPreview() {
    const template = templates[currentConfig.templateId];
    const options = template.getDefaultOptions();
    const weekIndex = parseInt(timeTravelInput.value);
    
    const ctx = previewCanvas.getContext('2d');
    const config = {
        width: previewCanvas.width,
        height: previewCanvas.height
    };

    template.renderBase(ctx, config, options);
    template.renderOverlay(ctx, config, options, weekIndex, TOTAL_WEEKS);
}

function startGeneration() {
    const template = templates[currentConfig.templateId];
    const options = template.getDefaultOptions();
    const currentWeekIndex = calculateWeekIndex(currentConfig.birthDate);
    
    const config = {
        width: previewCanvas.width,
        height: previewCanvas.height,
        templateId: currentConfig.templateId,
        birthDate: currentConfig.birthDate,
        options: options,
        startWeek: currentWeekIndex
    };

    const totalToGenerate = TOTAL_WEEKS - currentWeekIndex;
    btnGenerate.disabled = true;
    progressContainer.classList.remove('hidden');
    updateProgress(0, totalToGenerate);

    const filename = `LifeCalendar_${currentConfig.templateId}_${currentConfig.birthDate}_${previewCanvas.width}x${previewCanvas.height}_${currentWeekIndex + 1}-${TOTAL_WEEKS}.zip`;
    
    // Создаем стрим для скачивания
    let streamController;
    const readableStream = new ReadableStream({
        start(controller) {
            streamController = controller;
        },
        cancel() {
            if (worker) worker.postMessage({ type: 'cancel' });
        }
    });

    // Запускаем скачивание через showSaveFilePicker или накапливаем чанки
    let writableStream;
    let useFileSystemAPI = false;

    async function setupStreaming() {
        if ('showSaveFilePicker' in window) {
            try {
                // Пытаемся получить дескриптор файла. 
                // Важно: на некоторых мобильных устройствах или в WebView это может быть недоступно 
                // или вызывать ошибки даже при наличии метода.
                const handle = await window.showSaveFilePicker({
                    suggestedName: filename,
                    types: [{
                        description: 'ZIP Archive',
                        accept: { 'application/zip': ['.zip'] }
                    }]
                });
                writableStream = await handle.createWritable();
                useFileSystemAPI = true;
                return true;
            } catch (e) {
                console.warn('File System Access API failed, falling back to Blob accumulation', e);
                // Если пользователь нажал отмену (AbortError), прерываем процесс
                if (e.name === 'AbortError') return false;
                // В остальных случаях (SecurityError и др.) продолжаем с использованием Blob
                useFileSystemAPI = false;
            }
        } else {
            console.log('File System Access API not supported');
            useFileSystemAPI = false;
        }
        return true;
    }

    setupStreaming().then(async started => {
        if (!started) {
            finishGeneration();
            return;
        }

        const chunks = [];
        worker = new Worker('js/worker.js', { type: 'module' });
        
        worker.onmessage = async (e) => {
            const { type, current, total, chunk, final, error } = e.data;

            if (type === 'progress') {
                updateProgress(current, total);
            } else if (type === 'zip-chunk') {
                if (useFileSystemAPI && writableStream) {
                    try {
                        if (chunk && chunk.length > 0) {
                            await writableStream.write(chunk);
                        }
                        if (final) {
                            try {
                                await writableStream.close();
                            } catch (e) {
                                console.error('Error closing writableStream', e);
                            }
                            writableStream = null;
                        }
                    } catch (err) {
                        console.error('Error writing to stream', err);
                        worker.postMessage({ type: 'cancel' });
                    }
                } else {
                    if (chunk && chunk.length > 0) {
                        chunks.push(chunk);
                    }
                }
            } else if (type === 'done') {
                if (!useFileSystemAPI) {
                    if (chunks.length > 0) {
                        const blob = new Blob(chunks, { type: 'application/zip' });
                        downloadBlob(blob, filename);
                    } else {
                        console.error('No chunks accumulated for ZIP');
                        alert('Error: ZIP generation failed - no data collected');
                    }
                } else if (writableStream) {
                    // На случай если final чанк не пришел или не закрылся
                    try { await writableStream.close(); } catch(e) {}
                    writableStream = null;
                }
                finishGeneration();
            } else if (type === 'cancelled') {
                if (useFileSystemAPI && writableStream) {
                    try { await writableStream.abort(); } catch(e) {}
                    writableStream = null;
                }
                finishGeneration();
            } else if (type === 'error') {
                console.error('Worker error:', error, e.data);
                alert('Error: ' + (error?.message || error || 'Unknown error'));
                if (useFileSystemAPI && writableStream) {
                    try { await writableStream.abort(); } catch(e) {}
                    writableStream = null;
                }
                finishGeneration();
            }
        };

        worker.postMessage({ type: 'start', data: config });
    });
}

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

function cancelGeneration() {
    if (worker) {
        worker.postMessage({ type: 'cancel' });
    }
}

function finishGeneration() {
    btnGenerate.disabled = false;
    progressContainer.classList.add('hidden');
    if (worker) {
        worker.terminate();
        worker = null;
    }
}

function updateProgress(current, total) {
    const percent = Math.round((current / total) * 100);
    progressBar.style.width = `${percent}%`;
    progressText.textContent = `Генерация ${current} / ${total}`;
    progressPercent.textContent = `${percent}%`;
}

init();
