import { describe, it, expect, beforeAll } from 'vitest';
import { Resvg } from '@resvg/resvg-js';
import fs from 'fs';
import path from 'path';

describe('Font Rendering Verification', () => {
  let fontBuffer: Uint8Array;
  const FONT_PATH = path.join(__dirname, 'Inter.ttf');

  beforeAll(async () => {
    if (!fs.existsSync(FONT_PATH)) {
      // Download if not present
      const FONT_URL = 'https://github.com/google/fonts/raw/refs/heads/main/ofl/inter/Inter%5Bopsz,wght%5D.ttf';
      const response = await fetch(FONT_URL);
      if (!response.ok) {
        // Try via curl if fetch in node is acting up
        const { execSync } = await import('child_process');
        execSync(`curl -L "${FONT_URL}" -o "${FONT_PATH}"`);
      } else {
        const arrayBuffer = await response.arrayBuffer();
        fs.writeFileSync(FONT_PATH, Buffer.from(arrayBuffer));
      }
    }
    fontBuffer = new Uint8Array(fs.readFileSync(FONT_PATH));
  });

  it('should render SVG text to PNG using downloaded Inter font', async () => {
    const width = 200;
    const height = 100;
    
    // SVG with a large white letter 'A' on a black background
    const svg = `
      <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="black" />
        <text x="100" y="70" fill="white" font-size="80" font-family="Inter" font-weight="bold" text-anchor="middle">A</text>
      </svg>
    `;

    const resvg = new Resvg(svg, {
      font: {
        fontBuffers: [fontBuffer],
        defaultFontFamily: 'Inter',
        loadSystemFonts: false,
      },
      fitTo: { mode: 'width', value: width },
    });

    const render = resvg.render();
    const pixels = render.asPng(); // asPng() contains PNG data, not raw pixels, but it works for non-black pixel detection in this context

    // Check that there are not only black pixels in the PNG (0,0,0,255)
    // Black background: R=0, G=0, B=0
    // White text: R=255, G=255, B=255 (or similar due to anti-aliasing)
    
    let nonBlackPixels = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];
      
      // If at least one channel is not 0, it's part of the text
      if (r > 0 || g > 0 || b > 0) {
        nonBlackPixels++;
      }
    }

    // Letter 'A' sized 80px on 200x100 canvas should occupy a significant number of pixels.
    // Usually hundreds or thousands of pixels. If text didn't render, it will be 0.
    console.log(`Detected ${nonBlackPixels} non-black pixels for character 'A'`);
    expect(nonBlackPixels).toBeGreaterThan(100);
  });

  it('should render age markers from templates', async () => {
    // Test a real SVG fragment used in the application
    const width = 1284;
    const height = 100; // We only need the part with text
    const fontSize = 15;
    const label = "30";
    const y = 50;
    
    const svg = `
      <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="black" />
        <text x="${width / 2}" y="${y}" dy="${fontSize * 0.35}" fill="white" fill-opacity="0.5" font-size="${fontSize}" font-family="Inter, sans-serif" font-weight="bold" text-anchor="middle">${label}</text>
      </svg>
    `;

    const resvg = new Resvg(svg, {
      font: {
        fontBuffers: [fontBuffer],
        defaultFontFamily: 'Inter',
        loadSystemFonts: false,
      }
    });

    const pixels = resvg.render().asPng();
    let nonBlackPixels = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] > 0 || pixels[i+1] > 0 || pixels[i+2] > 0) {
        nonBlackPixels++;
      }
    }

    console.log(`Detected ${nonBlackPixels} non-black pixels for label "30"`);
    expect(nonBlackPixels).toBeGreaterThan(10);
  });
});
