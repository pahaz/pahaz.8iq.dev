import { RESOLUTION_PRESETS, DEFAULT_CONFIG, TOTAL_WEEKS, TEMPLATES } from './config.js';
import { calculateWeekIndex } from './engine.js';

// DOM Elements
const templatePicker = document.getElementById('template-picker');
const resSearchInput = document.getElementById('res-search');
const resPresetSelect = document.getElementById('res-preset');
const resWidthInput = document.getElementById('res-width');
const resHeightInput = document.getElementById('res-height');
const birthDateInput = document.getElementById('birth-date');
const timeTravelInput = document.getElementById('time-travel');
const previewWeekLabel = document.getElementById('preview-week-label');
const previewImage = document.getElementById('preview-image');
const previewContainer = document.getElementById('preview-container');
const automationUrlInput = document.getElementById('automation-url');
const btnCopy = document.getElementById('btn-copy');

let currentConfig = { ...DEFAULT_CONFIG };

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
        });
    });

    timeTravelInput.addEventListener('input', (e) => {
        updateWeekLabel(parseInt(e.target.value));
    });

    timeTravelInput.addEventListener('change', () => {
        renderPreview();
    });

    btnCopy.addEventListener('click', () => {
        automationUrlInput.select();
        document.execCommand('copy');
        const oldText = btnCopy.textContent;
        btnCopy.textContent = 'Copied!';
        setTimeout(() => {
            btnCopy.textContent = oldText;
        }, 2000);
    });
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

    if ('custom'.includes(searchTerm) || searchTerm === '') {
        const customOption = document.createElement('option');
        customOption.value = 'custom';
        customOption.textContent = 'Custom / Own size';
        resPresetSelect.appendChild(customOption);
    }

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
            w = currentConfig.customWidth;
            h = currentConfig.customHeight;
            resWidthInput.value = w;
            resHeightInput.value = h;
        }
        resWidthInput.disabled = true;
        resHeightInput.disabled = true;
    }

    previewContainer.style.setProperty('--ratio', `${w}/${h}`);
}

function updateWeekLabel(index) {
    previewWeekLabel.textContent = `${index + 1} / ${TOTAL_WEEKS}`;
}

function renderPreview() {
    const apiBaseUrl = window.LIFE_CALENDAR_API_URL || '/api/life-calendar/png';
    const weekIndex = parseInt(timeTravelInput.value);
    const w = resWidthInput.value;
    const h = resHeightInput.value;
    
    const params = new URLSearchParams({
        birthDate: currentConfig.birthDate,
        templateId: currentConfig.templateId,
        width: w,
        height: h,
        weekIndex: weekIndex
    });
    
    const apiUrl = `${apiBaseUrl}?${params.toString()}`;
    previewImage.src = apiUrl;

    // Update automation URL (without weekIndex so it updates daily)
    const automationParams = new URLSearchParams({
        birthDate: currentConfig.birthDate,
        templateId: currentConfig.templateId,
        width: w,
        height: h
    });
    
    let fullUrlBase = apiBaseUrl;
    if (apiBaseUrl.startsWith('/')) {
        fullUrlBase = window.location.origin + apiBaseUrl;
    }
    const fullAutomationUrl = `${fullUrlBase}?${automationParams.toString()}`;
    automationUrlInput.value = fullAutomationUrl;
}

init();
