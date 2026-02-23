import { describe, it, expect } from 'vitest';
import { templates } from './templates';
import { TOTAL_WEEKS } from './types';

describe('Templates', () => {
  const config = {
    width: 1000,
    height: 2000,
    templateId: 'defect',
    birthDate: '1990-01-01',
    weekIndex: 1000
  };

  describe('defectTemplate', () => {
    it('should render SVG string', () => {
      const svg = templates.defect.renderSVG(config);
      expect(svg).toContain('<svg');
      expect(svg).toContain('width="1000"');
      expect(svg).toContain('height="2000"');
      expect(svg).toContain('fill="#000000"'); // background
      expect(svg).toContain('<circle'); // dots
      expect(svg).toContain('30'); // labels
      expect(svg).toContain('60'); // labels
      expect(svg).toContain('% to 90'); // progress
    });
  });

  describe('coloredTemplate', () => {
    it('should render SVG string', () => {
      const svg = templates.colored.renderSVG({ ...config, templateId: 'colored' });
      expect(svg).toContain('<svg');
      expect(svg).toContain('fill-opacity="0.6"'); // colored dots
    });
  });

  it('should have both templates registered', () => {
    expect(templates.defect).toBeDefined();
    expect(templates.colored).toBeDefined();
  });
});
