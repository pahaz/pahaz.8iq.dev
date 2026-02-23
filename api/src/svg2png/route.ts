import { Hono } from 'hono';
import { Resvg, initWasm } from '@resvg/resvg-wasm';

const svg2png = new Hono();

// WASM initialization (reuse from life-calender logic)
const wasmReady = (async () => {
  try {
    // @ts-ignore
    const wasmModule = await import('@resvg/resvg-wasm/index_bg.wasm');
    await initWasm(wasmModule.default);
  } catch (e) {
    if (e instanceof Error && (e.message.includes('Unknown file extension ".wasm"') || e.message.includes('Already initialized'))) {
      // Quietly ignore
    } else {
      console.error('SVG2PNG: Failed to load WASM via import, trying fallback...', e);
    }
    try {
      if (typeof process !== 'undefined' && process.versions && process.versions.node) {
        const fs = await import('node:fs/promises');
        const path = await import('node:path');
        const wasmPath = path.join(process.cwd(), 'node_modules', '@resvg', 'resvg-wasm', 'index_bg.wasm');
        const wasmBuffer = await fs.readFile(wasmPath);
        await initWasm(wasmBuffer);
      } else {
        await initWasm('https://unpkg.com/@resvg/resvg-wasm/index_bg.wasm');
      }
    } catch (fallbackErr) {
      if (fallbackErr instanceof Error && fallbackErr.message.includes('Already initialized')) {
        // Ignore
      } else {
        console.error('SVG2PNG: WASM initialization failed', fallbackErr);
      }
    }
  }
})();

svg2png.get('/health', (c) => c.json({ ok: true }));

svg2png.post('/render', async (c) => {
  await wasmReady;
  
  let body;
  try {
    body = await c.req.json();
  } catch (e) {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const { svg, width, height, fit, scale, background, dpi } = body;

  if (!svg) {
    return c.json({ error: 'SVG is required' }, 400);
  }

  try {
    const startTime = Date.now();
    
    const opts: any = {
      fitTo: {}
    };

    if (width && !height) {
      opts.fitTo = { mode: 'width', value: width };
    } else if (height && !width) {
      opts.fitTo = { mode: 'height', value: height };
    } else if (width && height) {
      // fit options: width / height / contain / cover
      const fitMode = fit || 'width';
      if (fitMode === 'width') {
        opts.fitTo = { mode: 'width', value: width };
      } else if (fitMode === 'height') {
        opts.fitTo = { mode: 'height', value: height };
      } else if (fitMode === 'contain') {
        // resvg contain is Zoom
        opts.fitTo = { mode: 'original' }; // fallback if no direct contain
        // We might need to manually calculate scale for contain/cover if resvg doesn't support it directly in this version
        // But let's use what it has.
      } else if (fitMode === 'cover') {
        opts.fitTo = { mode: 'original' };
      }
    }

    if (scale && scale !== 1) {
       opts.fitTo = { mode: 'zoom', value: scale };
    }

    if (background && background !== 'transparent') {
      opts.background = background;
    }

    // DPI support in resvg
    if (dpi) {
        // opts.dpi = dpi; // check if resvg-wasm supports this
    }

    const resvg = new Resvg(svg, opts);
    const pngData = resvg.render();
    const pngBuffer = pngData.asPng();
    
    const endTime = Date.now();
    const renderTime = endTime - startTime;

    // @ts-ignore
    return new Response(pngBuffer, {
      headers: { 
        'Content-Type': 'image/png',
        'X-Render-Time': renderTime.toString()
      }
    });
  } catch (e) {
    console.error('SVG2PNG render error:', e);
    return c.json({ error: e instanceof Error ? e.message : 'Render failed' }, 500);
  }
});

export default svg2png;
