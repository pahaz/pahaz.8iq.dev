import { RenderConfig, WEEKS_PER_YEAR, TOTAL_WEEKS, START_AGE } from './types';

// Common interface for template (simplified for API)
export interface Template {
  render(ctx: any, config: RenderConfig): void;
  renderSVG(config: RenderConfig): string;
}

const getGridParams = (config: RenderConfig) => {
  const { width, height } = config;
  const gridPadding = 0.05;
  const topOffset = 0.20;

  const sidePadding = width * gridPadding;
  const topPadding = height * topOffset;
  const bottomPadding = height * gridPadding;
  
  const availableWidth = width - sidePadding * 2;
  const availableHeight = height - topPadding - bottomPadding;
  
  const rows = TOTAL_WEEKS / WEEKS_PER_YEAR;
  const gapRows = 2; 
  const totalEffectiveRows = rows + gapRows;

  const step = Math.floor(Math.min(availableWidth / WEEKS_PER_YEAR, availableHeight / totalEffectiveRows));
  const stepX = step;
  const stepY = step;
  const gapSize = step;
  
  const gridWidth = stepX * WEEKS_PER_YEAR;
  const gridHeight = stepY * rows + gapSize * 2;
  
  const gridX = (width - gridWidth) / 2;
  const gridY = topPadding + (availableHeight - gridHeight) / 2;
  
  return { gridX, gridY, gridWidth, gridHeight, stepX, stepY, gapSize };
};

export const defectTemplate: Template = {
  renderSVG(config) {
    const { width, height, weekIndex } = config;
    const { gridX, gridY, gridHeight, stepX, stepY, gapSize } = getGridParams(config);
    const dotRadius = 0.4;
    const radius = Math.max(0.5, stepX * dotRadius);
    const row30 = 30 - START_AGE;
    const row60 = 60 - START_AGE;
    const textColor = 'rgba(255, 255, 255, 0.5)';
    const fontSize = Math.floor(height * 0.012);
    const progressFontSize = Math.floor(height * 0.015);

    let svg = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">`;
    svg += `<rect width="100%" height="100%" fill="#000000" />`;

    // Grid
    const rows = TOTAL_WEEKS / WEEKS_PER_YEAR;
    for (let i = 0; i < TOTAL_WEEKS; i++) {
      const row = Math.floor(i / WEEKS_PER_YEAR);
      const col = i % WEEKS_PER_YEAR;
      let offsetY = 0;
      if (row >= row30) offsetY += gapSize;
      if (row >= row60) offsetY += gapSize;
      const x = gridX + col * stepX + stepX / 2;
      const y = gridY + row * stepY + stepY / 2 + offsetY;
      
      let fill = '#ffffff';
      let r = radius;
      if (i < weekIndex) fill = '#444444';
      else if (i === weekIndex) { fill = '#ff8c00'; r = radius * 1.2; }
      
      svg += `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}" />`;
    }

    // Lines
    const drawLine = (ageRow: number, label: string, gapOffset: number) => {
      const y = gridY + ageRow * stepY + gapOffset - gapSize / 2;
      svg += `<line x1="${gridX}" y1="${y}" x2="${gridX + stepX * 24}" y2="${y}" stroke="${textColor}" stroke-width="4" />`;
      svg += `<text x="${gridX + stepX * 26}" y="${y}" dy="${fontSize * 0.35}" fill="white" fill-opacity="0.5" font-size="${fontSize}" font-family="Inter, sans-serif" font-weight="bold" text-anchor="middle">${label}</text>`;
      svg += `<line x1="${gridX + stepX * 28}" y1="${y}" x2="${gridX + stepX * 52}" y2="${y}" stroke="${textColor}" stroke-width="4" />`;
    };
    drawLine(row30, '30', gapSize);
    drawLine(row60, '60', gapSize * 2);

    // Progress
    const progress = ((weekIndex + 1) / TOTAL_WEEKS * 100).toFixed(1);
    const bottomAreaStart = gridY + gridHeight;
    const textY = bottomAreaStart + (height - bottomAreaStart) / 2;
    svg += `<text x="${width / 2}" y="${textY}" dy="${progressFontSize * 0.35}" fill="white" fill-opacity="0.5" font-size="${progressFontSize}" font-family="Inter, sans-serif" font-weight="bold" text-anchor="middle">${progress}% to 90</text>`;
    svg += `</svg>`;
    return svg;
  },
  render(ctx, config) {
    const { width, height, weekIndex } = config;
    const { gridX, gridY, gridHeight, stepX, stepY, gapSize } = getGridParams(config);
    const dotRadius = 0.4;
    const radius = Math.max(0.5, stepX * dotRadius);
    const row30 = 30 - START_AGE;
    const row60 = 60 - START_AGE;

    // Background
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, width, height);

    // Grid (Future)
    ctx.fillStyle = '#ffffff';
    const rows = TOTAL_WEEKS / WEEKS_PER_YEAR;
    for (let row = 0; row < rows; row++) {
      let offsetY = 0;
      if (row >= row30) offsetY += gapSize;
      if (row >= row60) offsetY += gapSize;
      const y = gridY + row * stepY + stepY / 2 + offsetY;
      for (let col = 0; col < WEEKS_PER_YEAR; col++) {
        const x = gridX + col * stepX + stepX / 2;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Lines & Labels
    const textColor = 'rgba(255, 255, 255, 0.5)';
    ctx.strokeStyle = textColor;
    ctx.fillStyle = textColor;
    ctx.lineWidth = 4;
    const fontSize = Math.floor(height * 0.012);
    ctx.font = `${fontSize}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const drawYearLine = (ageRow: number, label: string, gapOffset: number) => {
      const y = gridY + ageRow * stepY + gapOffset - gapSize / 2;
      ctx.beginPath(); ctx.moveTo(gridX, y); ctx.lineTo(gridX + stepX * 24, y); ctx.stroke();
      ctx.fillText(label, gridX + stepX * 26, y);
      ctx.beginPath(); ctx.moveTo(gridX + stepX * 28, y); ctx.lineTo(gridX + stepX * 52, y); ctx.stroke();
    };
    drawYearLine(row30, '30', gapSize);
    drawYearLine(row60, '60', gapSize * 2);

    // Past weeks
    ctx.fillStyle = '#444444';
    for (let i = 0; i < weekIndex; i++) {
      const row = Math.floor(i / WEEKS_PER_YEAR);
      const col = i % WEEKS_PER_YEAR;
      let offsetY = 0;
      if (row >= row30) offsetY += gapSize;
      if (row >= row60) offsetY += gapSize;
      const x = gridX + col * stepX + stepX / 2;
      const y = gridY + row * stepY + stepY / 2 + offsetY;
      ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill();
    }

    // Current week
    if (weekIndex >= 0 && weekIndex < TOTAL_WEEKS) {
      const row = Math.floor(weekIndex / WEEKS_PER_YEAR);
      const col = weekIndex % WEEKS_PER_YEAR;
      let offsetY = 0;
      if (row >= row30) offsetY += gapSize;
      if (row >= row60) offsetY += gapSize;
      const x = gridX + col * stepX + stepX / 2;
      const y = gridY + row * stepY + stepY / 2 + offsetY;
      ctx.fillStyle = '#ff8c00';
      ctx.beginPath(); ctx.arc(x, y, radius * 1.2, 0, Math.PI * 2); ctx.fill();
    }

    // Progress text
    const progress = ((weekIndex + 1) / TOTAL_WEEKS * 100).toFixed(1);
    ctx.fillStyle = textColor;
    const progressFontSize = Math.floor(height * 0.015);
    ctx.font = `${progressFontSize}px sans-serif`;
    ctx.textAlign = 'center';
    const bottomAreaStart = gridY + gridHeight;
    const textY = bottomAreaStart + (height - bottomAreaStart) / 2 + progressFontSize / 2;
    ctx.fillText(`${progress}% to 90`, width / 2, textY);
  }
};

const ageColors = [
  { maxAge: 6, color: '#A0C4FF' }, { maxAge: 11, color: '#2D5A27' },
  { maxAge: 15, color: '#4B7B43' }, { maxAge: 18, color: '#9DCC9D' },
  { maxAge: 22, color: '#E9E9BE' }, { maxAge: 23, color: '#F0B67F' }, // wait, was it 26 in original?
  { maxAge: 26, color: '#F0B67F' }, { maxAge: 30, color: '#D96C6C' },
  { maxAge: 60, color: '#C04040' }, { maxAge: 90, color: '#916BBF' },
];

export const coloredTemplate: Template = {
  renderSVG(config) {
    const { width, height, weekIndex } = config;
    const { gridX, gridY, gridHeight, stepX, stepY, gapSize } = getGridParams(config);
    const dotRadius = 0.4;
    const radius = Math.max(0.5, stepX * dotRadius);
    const row30 = 30 - START_AGE;
    const row60 = 60 - START_AGE;
    const textColor = 'rgba(255, 255, 255, 0.5)';
    const fontSize = Math.floor(height * 0.012);
    const progressFontSize = Math.floor(height * 0.015);

    let svg = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">`;
    svg += `<rect width="100%" height="100%" fill="#000000" />`;

    const rows = TOTAL_WEEKS / WEEKS_PER_YEAR;
    for (let i = 0; i < TOTAL_WEEKS; i++) {
      const row = Math.floor(i / WEEKS_PER_YEAR);
      const col = i % WEEKS_PER_YEAR;
      let offsetY = 0;
      if (row >= row30) offsetY += gapSize;
      if (row >= row60) offsetY += gapSize;
      const x = gridX + col * stepX + stepX / 2;
      const y = gridY + row * stepY + stepY / 2 + offsetY;
      
      let fill = '#ffffff';
      let r = radius;
      let opacity = 1.0;
      
      if (i < weekIndex) {
        fill = '#444444';
      } else if (i === weekIndex) {
        fill = '#ffffff';
        r = radius * 1.2;
      } else {
        const age = START_AGE + row;
        const colorObj = ageColors.find(c => age < c.maxAge) || ageColors[ageColors.length-1];
        fill = colorObj.color;
        opacity = 0.6;
      }
      
      svg += `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}" fill-opacity="${opacity}" />`;
    }

    const drawLine = (ageRow: number, label: string, gapOffset: number) => {
      const y = gridY + ageRow * stepY + gapOffset - gapSize / 2;
      svg += `<line x1="${gridX}" y1="${y}" x2="${gridX + stepX * 24}" y2="${y}" stroke="${textColor}" stroke-width="4" />`;
      svg += `<text x="${gridX + stepX * 26}" y="${y}" dy="${fontSize * 0.35}" fill="white" fill-opacity="0.5" font-size="${fontSize}" font-family="Inter, sans-serif" font-weight="bold" text-anchor="middle">${label}</text>`;
      svg += `<line x1="${gridX + stepX * 28}" y1="${y}" x2="${gridX + stepX * 52}" y2="${y}" stroke="${textColor}" stroke-width="4" />`;
    };
    drawLine(row30, '30', gapSize);
    drawLine(row60, '60', gapSize * 2);

    const progress = ((weekIndex + 1) / TOTAL_WEEKS * 100).toFixed(1);
    const bottomAreaStart = gridY + gridHeight;
    const textY = bottomAreaStart + (height - bottomAreaStart) / 2;
    svg += `<text x="${width / 2}" y="${textY}" dy="${progressFontSize * 0.35}" fill="white" fill-opacity="0.5" font-size="${progressFontSize}" font-family="Inter, sans-serif" font-weight="bold" text-anchor="middle">${progress}% to 90</text>`;
    svg += `</svg>`;
    return svg;
  },
  render(ctx, config) {
    const { width, height, weekIndex } = config;
    const { gridX, gridY, gridHeight, stepX, stepY, gapSize } = getGridParams(config);
    const dotRadius = 0.4;
    const radius = Math.max(0.5, stepX * dotRadius);
    const row30 = 30 - START_AGE;
    const row60 = 60 - START_AGE;

    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, width, height);

    const rows = TOTAL_WEEKS / WEEKS_PER_YEAR;
    for (let row = 0; row < rows; row++) {
      let offsetY = 0;
      if (row >= row30) offsetY += gapSize;
      if (row >= row60) offsetY += gapSize;
      const y = gridY + row * stepY + stepY / 2 + offsetY;
      
      const age = START_AGE + row;
      const colorObj = ageColors.find(c => age < c.maxAge) || ageColors[ageColors.length-1];
      
      ctx.globalAlpha = 0.6; // colorDimmer
      ctx.fillStyle = colorObj.color;
      for (let col = 0; col < WEEKS_PER_YEAR; col++) {
        const x = gridX + col * stepX + stepX / 2;
        ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1.0;
    }

    // Lines & Labels
    const textColor = 'rgba(255, 255, 255, 0.5)';
    ctx.strokeStyle = textColor; ctx.fillStyle = textColor;
    ctx.lineWidth = 4;
    const fontSize = Math.floor(height * 0.012);
    ctx.font = `${fontSize}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const drawYearLine = (ageRow: number, label: string, gapOffset: number) => {
      const y = gridY + ageRow * stepY + gapOffset - gapSize / 2;
      ctx.beginPath(); ctx.moveTo(gridX, y); ctx.lineTo(gridX + stepX * 24, y); ctx.stroke();
      ctx.fillText(label, gridX + stepX * 26, y);
      ctx.beginPath(); ctx.moveTo(gridX + stepX * 28, y); ctx.lineTo(gridX + stepX * 52, y); ctx.stroke();
    };
    drawYearLine(row30, '30', gapSize);
    drawYearLine(row60, '60', gapSize * 2);

    // Past weeks
    ctx.fillStyle = '#444444';
    for (let i = 0; i < weekIndex; i++) {
      const row = Math.floor(i / WEEKS_PER_YEAR);
      const col = i % WEEKS_PER_YEAR;
      let offsetY = 0;
      if (row >= row30) offsetY += gapSize;
      if (row >= row60) offsetY += gapSize;
      const x = gridX + col * stepX + stepX / 2;
      const y = gridY + row * stepY + stepY / 2 + offsetY;
      ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill();
    }

    // Current week
    if (weekIndex >= 0 && weekIndex < TOTAL_WEEKS) {
      const row = Math.floor(weekIndex / WEEKS_PER_YEAR);
      const col = weekIndex % WEEKS_PER_YEAR;
      let offsetY = 0;
      if (row >= row30) offsetY += gapSize;
      if (row >= row60) offsetY += gapSize;
      const x = gridX + col * stepX + stepX / 2;
      const y = gridY + row * stepY + stepY / 2 + offsetY;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(x, y, radius * 1.2, 0, Math.PI * 2); ctx.fill();
    }

    // Progress
    const progress = ((weekIndex + 1) / TOTAL_WEEKS * 100).toFixed(1);
    ctx.fillStyle = textColor;
    const progressFontSize = Math.floor(height * 0.015);
    ctx.font = `${progressFontSize}px sans-serif`;
    ctx.textAlign = 'center';
    const bottomAreaStart = gridY + gridHeight;
    const textY = bottomAreaStart + (height - bottomAreaStart) / 2 + progressFontSize / 2;
    ctx.fillText(`${progress}% to 90`, width / 2, textY);
  }
};

export const templates: Record<string, Template> = {
  defect: defectTemplate,
  colored: coloredTemplate
};
