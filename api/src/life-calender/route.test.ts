import { describe, it, expect } from 'vitest';
import app from '../index';

describe('Life Calendar Route', () => {
  it('GET /life-calendar/png?format=svg should return SVG', async () => {
    const res = await app.request('/life-calendar/png?format=svg&birthDate=1990-01-01');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('image/svg+xml');
    const body = await res.text();
    expect(body).toContain('<svg');
  });

  it('GET /life-calendar/png with invalid template should return 404', async () => {
    const res = await app.request('/life-calendar/png?templateId=invalid');
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('Template not found');
  });

  it('GET /life-calendar/png should handle missing parameters with defaults', async () => {
    // defaults: width=1284, height=2778, templateId=defect, birthDate=1990-01-01
    const res = await app.request('/life-calendar/png?format=svg');
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('width="1284"');
    expect(body).toContain('height="2778"');
  });

  it('GET /life-calendar/png should accept custom dimensions', async () => {
    const res = await app.request('/life-calendar/png?format=svg&width=500&height=500');
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('width="500"');
    expect(body).toContain('height="500"');
  });

  it('GET /life-calendar/png should return PNG (if WASM is loaded)', async () => {
    const res = await app.request('/life-calendar/png?birthDate=1990-01-01');
    expect(res.status).toBe(200);
    const contentType = res.headers.get('Content-Type');
    if (contentType === 'image/png') {
      const body = await res.arrayBuffer();
      expect(body.byteLength).toBeGreaterThan(0);
      // PNG magic number: 89 50 4E 47
      const view = new Uint8Array(body);
      expect(view[0]).toBe(0x89);
      expect(view[1]).toBe(0x50);
      expect(view[2]).toBe(0x4E);
      expect(view[3]).toBe(0x47);
    } else {
      // If WASM failed to load in test environment, it falls back to SVG
      expect(contentType).toBe('image/svg+xml');
      console.warn('WASM not loaded, falling back to SVG in test');
    }
  });
});
