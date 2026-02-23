import { describe, it, expect } from 'vitest';
import app from '../index';

describe('SVG2PNG API', () => {
  it('should return health status', async () => {
    const res = await app.request('/svg2png/health');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({ ok: true });
  });

  it('should return error if SVG is missing', async () => {
    const res = await app.request('/svg2png/render', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ width: 100 }),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('SVG is required');
  });

  it('should render a simple SVG to PNG', async () => {
    const svg = '<svg width="100" height="100" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="40" fill="red" /></svg>';
    const res = await app.request('/svg2png/render', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        svg,
        width: 100,
        height: 100
      }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    expect(res.headers.get('X-Render-Time')).toBeDefined();
    
    const body = await res.arrayBuffer();
    expect(body.byteLength).toBeGreaterThan(0);
    
    // Check for PNG signature
    const uint8 = new Uint8Array(body.slice(0, 8));
    expect(uint8).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  });

  it('should handle different fit modes and scale', async () => {
    const svg = '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><rect width="100" height="100" fill="blue" /></svg>';
    const res = await app.request('/svg2png/render', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        svg,
        width: 200,
        height: 200,
        fit: 'width',
        scale: 2
      }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    const body = await res.arrayBuffer();
    expect(body.byteLength).toBeGreaterThan(0);
  });

  it('should render SVG with custom fonts', async () => {
    const svg = `
      <svg width="200" height="100" xmlns="http://www.w3.org/2000/svg">
        <text x="10" y="50" font-family="Roboto" font-size="24">Hello Roboto</text>
      </svg>
    `;
    const res = await app.request('/svg2png/render', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        svg,
        width: 200,
        height: 100
      }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    const body = await res.arrayBuffer();
    expect(body.byteLength).toBeGreaterThan(0);
    
    // Check for PNG signature
    const uint8 = new Uint8Array(body.slice(0, 8));
    expect(uint8).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  });

  it('should fallback gracefully for non-existent fonts', async () => {
    const svg = `
      <svg width="200" height="100" xmlns="http://www.w3.org/2000/svg">
        <text x="10" y="50" font-family="SomeNonExistentFont123" font-size="24">Fallback Test</text>
      </svg>
    `;
    const res = await app.request('/svg2png/render', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        svg,
        width: 200,
        height: 100
      }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    const body = await res.arrayBuffer();
    expect(body.byteLength).toBeGreaterThan(0);
  });
});
