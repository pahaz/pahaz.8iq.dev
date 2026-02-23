export function extractFontFamilies(svg: string): string[] {
  const families = new Set<string>();
  
  // 1. Match font-family="..." attribute
  const attrRegex = /font-family="([^"]+)"/g;
  let match;
  while ((match = attrRegex.exec(svg)) !== null) {
    const parts = match[1].split(',').map(f => f.trim().replace(/['"]/g, ''));
    parts.forEach(f => {
      if (f && isNotGeneric(f)) {
        families.add(f);
      }
    });
  }

  // 2. Match style="...font-family: ..."
  const styleRegex = /font-family:\s*([^;"]+)/g;
  while ((match = styleRegex.exec(svg)) !== null) {
    const parts = match[1].split(',').map(f => f.trim().replace(/['"]/g, ''));
    parts.forEach(f => {
      if (f && isNotGeneric(f)) {
        families.add(f);
      }
    });
  }

  // 3. Match <style> blocks
  const styleBlocks = svg.match(/<style[^>]*>([\s\S]*?)<\/style>/g);
  if (styleBlocks) {
    const innerStyleRegex = /font-family:\s*([^;{}]+)/g;
    styleBlocks.forEach(block => {
      while ((match = innerStyleRegex.exec(block)) !== null) {
        const parts = match[1].split(',').map(f => f.trim().replace(/['"]/g, ''));
        parts.forEach(f => {
          if (f && isNotGeneric(f)) {
            families.add(f);
          }
        });
      }
    });
  }

  return Array.from(families);
}

function isNotGeneric(font: string): boolean {
  const generics = ['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded'];
  return !generics.includes(font.toLowerCase());
}

const fontCache = new Map<string, Uint8Array>();

export async function loadFont(fontName: string): Promise<Uint8Array | null> {
  if (fontCache.has(fontName)) {
    return fontCache.get(fontName)!;
  }

  try {
    // Attempt to get font from Google Fonts (using v1 API to better force TTF)
    const cssUrl = `https://fonts.googleapis.com/css?family=${encodeURIComponent(fontName)}`;
    const response = await fetch(cssUrl, {
      headers: {
        // Force TTF (older UA often triggers TTF on v1 API)
        'User-Agent': 'Mozilla/5.0 (Linux; U; Android 2.2; en-gb; Nexus One Build/FRF91) AppleWebKit/533.1 (KHTML, like Gecko) Version/4.0 Mobile Safari/533.1'
      }
    });
    
    if (!response.ok) return null;
    const css = await response.text();

    const fontUrlMatch = css.match(/url\((https:\/\/[^)]+)\)/);
    if (!fontUrlMatch) return null;
    const fontUrl = fontUrlMatch[1];
    
    if (!fontUrl.toLowerCase().endsWith('.ttf')) {
      console.warn(`SVG2PNG: Google Fonts returned non-TTF font URL: ${fontUrl}`);
    }

    const fontResponse = await fetch(fontUrl);
    console.log(`SVG2PNG: Loaded font "${fontName}" from ${fontUrl}`);
    if (!fontResponse.ok) return null;
    
    const buffer = new Uint8Array(await fontResponse.arrayBuffer());
    fontCache.set(fontName, buffer);
    return buffer;
  } catch (e) {
    console.error(`SVG2PNG: Failed to load font "${fontName}":`, e);
    return null;
  }
}

const DEFAULT_FONT_URL = 'https://github.com/google/fonts/raw/refs/heads/main/ofl/inter/Inter%5Bopsz,wght%5D.ttf';
let defaultFontPromise: Promise<Uint8Array | null> | null = null;

export async function getDefaultFont(): Promise<Uint8Array | null> {
    if (fontCache.has('Inter')) return fontCache.get('Inter')!;
    
    if (!defaultFontPromise) {
        defaultFontPromise = (async () => {
            try {
                const response = await fetch(DEFAULT_FONT_URL);
                if (!response.ok) return null;
                const buffer = new Uint8Array(await response.arrayBuffer());
                fontCache.set('Inter', buffer);
                return buffer;
            } catch (e) {
                console.error('SVG2PNG: Failed to load default font:', e);
                return null;
            }
        })();
    }
    return defaultFontPromise;
}
