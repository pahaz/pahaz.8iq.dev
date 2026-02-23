import * as fflate from './fflate.min.js';
import { TOTAL_WEEKS } from './config.js';
import defectTemplate from './templates/defect.js';
import coloredTemplate from './templates/colored.js';

const templates = {
    defect: defectTemplate,
    colored: coloredTemplate
};

let isCancelled = false;

self.onmessage = async (e) => {
    const { type, data } = e.data;

    if (type === 'cancel') {
        isCancelled = true;
        return;
    }

    if (type === 'start') {
        isCancelled = false;
        try {
            await generateZip(data);
        } catch (error) {
            console.error('Worker generation error:', error);
            self.postMessage({ type: 'error', error: error.message || String(error) });
        }
    }
};

async function generateZip(config) {
    const { width, height, templateId, birthDate, options, startWeek = 0 } = config;
    const template = templates[templateId] || defectTemplate;

    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d', { alpha: false, colorSpace: 'srgb' });
    
    if (!ctx) {
        throw new Error('Could not get 2D context from OffscreenCanvas');
    }

    const baseCanvas = new OffscreenCanvas(width, height);
    const baseCtx = baseCanvas.getContext('2d', { alpha: false, colorSpace: 'srgb' });
    
    if (!baseCtx) {
        throw new Error('Could not get 2D context from base OffscreenCanvas');
    }

    // Render base layer once
    template.renderBase(baseCtx, { width, height }, options);

    const zip = new fflate.Zip();
    
    // Handle data from ZIP stream
    zip.ondata = (err, chunk, final) => {
        if (err) {
            self.postMessage({ type: 'error', error: err.message });
            return;
        }
        
        if (!chunk) {
            if (final) {
                self.postMessage({ type: 'zip-chunk', chunk: null, final: true });
                self.postMessage({ type: 'done' });
            }
            return;
        }

        // Clone chunk before sending to have access to its buffer
        // fflate might return a View on the same array, so we copy it
        const chunkCopy = new Uint8Array(chunk);

        // Send chunk to main thread
        self.postMessage({ 
            type: 'zip-chunk', 
            chunk: chunkCopy, 
            final: final 
        }, [chunkCopy.buffer]); // Transfer buffer ownership to save memory

        if (final) {
            self.postMessage({ type: 'done' });
        }
    };

    // manifest.json
    const manifest = {
        templateId,
        width,
        height,
        birthDate,
        startAge: 6,
        endAge: 90,
        totalWeeks: TOTAL_WEEKS,
        generatedFromWeek: startWeek,
        generatedAt: new Date().toISOString()
    };
    
    const manifestData = new TextEncoder().encode(JSON.stringify(manifest, null, 2));
    const manifestFile = new fflate.ZipDeflate('manifest.json');
    zip.add(manifestFile);
    manifestFile.push(manifestData, true);

    const totalToGenerate = TOTAL_WEEKS - startWeek;
    let count = 0;

    for (let i = startWeek; i < TOTAL_WEEKS; i++) {
        if (isCancelled) {
            self.postMessage({ type: 'cancelled' });
            return;
        }

        // Clear and draw frame
        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(baseCanvas, 0, 0);
        template.renderOverlay(ctx, { width, height }, options, i, TOTAL_WEEKS);

        // Get PNG (standard 8-bit RGBA, but without alpha channel in context)
        // Use PNG for maximum compatibility and clarity.
        const blob = await canvas.convertToBlob({ 
            type: 'image/png'
        });
        
        if (!blob) {
            throw new Error(`Could not convert canvas to blob for frame ${i + 1}`);
        }

        const arrayBuffer = await blob.arrayBuffer();
        if (!arrayBuffer) {
            throw new Error(`Could not get arrayBuffer from blob for frame ${i + 1}`);
        }
        
        const uint8Array = new Uint8Array(arrayBuffer);

        const filename = String(i + 1).padStart(4, '0') + '.png';
        const file = new fflate.ZipDeflate(filename, { level: 6 });
        zip.add(file);
        file.push(uint8Array, true);

        count++;
        if (count % 50 === 0 || i === TOTAL_WEEKS - 1) {
            self.postMessage({ type: 'progress', current: count, total: totalToGenerate });
        }
    }

    zip.end();
    
    // final: true will come via zip.ondata when fflate finishes compressing all files.
    // We don't call self.postMessage({ type: 'done' }) here immediately
    // to ensure all ZIP chunks have been sent.
    // zip.end() synchronously (or almost synchronously for fflate) calls last zip.ondata.
}
