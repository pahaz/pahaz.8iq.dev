import { describe, it, expect } from 'vitest';
import { extractFontFamilies } from './font-utils';

describe('Font Utils', () => {
  it('should extract font families from attributes', () => {
    const svg = '<svg><text font-family="Roboto">Hello</text><text font-family="Open Sans, sans-serif">World</text></svg>';
    const families = extractFontFamilies(svg);
    expect(families).toContain('Roboto');
    expect(families).toContain('Open Sans');
    expect(families).not.toContain('sans-serif');
  });

  it('should extract font families from inline styles', () => {
    const svg = '<svg><text style="font-family: Roboto">Hello</text><text style="fill: red; font-family: \'Playfair Display\', serif">World</text></svg>';
    const families = extractFontFamilies(svg);
    expect(families).toContain('Roboto');
    expect(families).toContain('Playfair Display');
    expect(families).not.toContain('serif');
  });

  it('should extract font families from style blocks', () => {
    const svg = `
      <svg>
        <style>
          .text1 { font-family: "Montserrat"; }
          .text2 { font-family: Lato, sans-serif; }
        </style>
        <text class="text1">Hello</text>
      </svg>
    `;
    const families = extractFontFamilies(svg);
    expect(families).toContain('Montserrat');
    expect(families).toContain('Lato');
  });

  it('should ignore generic font families', () => {
    const svg = '<svg><text font-family="serif, sans-serif, monospace">Hello</text></svg>';
    const families = extractFontFamilies(svg);
    expect(families).toEqual([]);
  });
});
