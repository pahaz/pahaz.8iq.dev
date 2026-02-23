import { Hono } from 'hono';
import { Resvg, initWasm } from '@resvg/resvg-wasm'

import { templates } from './templates';
import { calculateWeekIndex } from './types';

const lifeCalendar = new Hono();

const wasmReady = (async () => {
  try {
    // @ts-ignore
    const wasmModule = await import('@resvg/resvg-wasm/index_bg.wasm');
    await initWasm(wasmModule.default);
  } catch (e) {
    if (e instanceof Error && e.message.includes('Unknown file extension ".wasm"')) {
      // Quietly ignore expected Node.js error for .wasm import
    } else {
      console.error('Failed to load WASM via import, trying fetch/fs...', e);
    }
    // Fallback for Node.js/Vercel or if import fails
    try {
      if (typeof process !== 'undefined' && process.versions && process.versions.node) {
        const fs = await import('node:fs/promises');
        const path = await import('node:path');
        // This is a bit tricky in Vercel, but let's try to find it in node_modules
        const wasmPath = path.join(process.cwd(), 'node_modules', '@resvg', 'resvg-wasm', 'index_bg.wasm');
        const wasmBuffer = await fs.readFile(wasmPath);
        await initWasm(wasmBuffer);
      } else {
        // Fallback for other environments
        await initWasm('https://unpkg.com/@resvg/resvg-wasm/index_bg.wasm');
      }
    } catch (fallbackErr) {
      console.error('WASM initialization failed', fallbackErr);
    }
  }
})();

// Cache font in memory
let fontPromise: Promise<Uint8Array> | null = null;
const FONT_URL = 'https://github.com/google/fonts/raw/refs/heads/main/ofl/inter/Inter%5Bopsz,wght%5D.ttf';

function getFont() {
  if (!fontPromise) {
    fontPromise = fetch(FONT_URL)
      .then(r => {
        if (!r.ok) throw new Error(`Failed to fetch font: ${r.statusText}`);
        return r.arrayBuffer();
      })
      .then(buf => new Uint8Array(buf));
  }
  return fontPromise;
}

lifeCalendar.get('/png', async (c) => {
  await wasmReady
  const width = parseInt(c.req.query('width') || '1284');
  const height = parseInt(c.req.query('height') || '2778');
  const templateId = c.req.query('templateId') || 'defect';
  const birthDate = c.req.query('birthDate') || '1990-01-01';
  let weekIndex = parseInt(c.req.query('weekIndex') || '-1');

  if (weekIndex === -1) {
    weekIndex = calculateWeekIndex(birthDate);
  }

  const template = templates[templateId];
  if (!template) {
    return c.text('Template not found', 404);
  }

  const svg = template.renderSVG({ width, height, templateId, birthDate, weekIndex });

  // If format is svg, return it directly
  if (c.req.query('format') === 'svg') {
    return c.text(svg, 200, { 'Content-Type': 'image/svg+xml' });
  }

  // PNG conversion
  try {
    const font = await getFont();
    const resvg = new Resvg(svg, {
      font: {
        fontBuffers: [font],
        defaultFontFamily: 'Inter',
        loadSystemFonts: false,
      }
    });
    const pngData = resvg.render();
    const pngBuffer = pngData.asPng();
    
    // @ts-ignore
    return new Response(pngBuffer, {
      headers: { 'Content-Type': 'image/png' }
    });
  } catch (e) {
    console.error('PNG conversion failed, falling back to SVG response', e);
    return c.text(svg, 200, { 
      'Content-Type': 'image/svg+xml',
      'X-Error': `PNG conversion failed: ${e instanceof Error ? e.message : String(e)}`
    });
  }
});

export default lifeCalendar;
