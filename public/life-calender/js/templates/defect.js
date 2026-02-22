import { WEEKS_PER_YEAR, TOTAL_WEEKS, START_AGE } from '../config.js';

export default {
    id: 'defect',
    name: 'Defect',
    getDefaultOptions() {
        return {
            bgColor: '#000000',
            dotColorFuture: '#ffffff',
            dotColorPast: '#444444',
            dotColorCurrent: '#ff8c00',
            textColor: 'rgba(255, 255, 255, 0.5)',
            dotRadius: 0.4, // Относительно шага сетки
            gridPadding: 0.05, // Минимальный боковой и нижний отступ (5% от меньшей стороны)
            topOffset: 0.20, // Отступ сверху для часов (20% от высоты)
        };
    },

    renderBase(ctx, config, options) {
        const { width, height } = config;
        ctx.fillStyle = options.bgColor;
        ctx.fillRect(0, 0, width, height);

        const { gridX, gridY, stepX, stepY, gapSize } = this._getGridParams(config, options);
        const radius = Math.max(0.5, stepX * options.dotRadius);

        ctx.fillStyle = options.dotColorFuture;
        const rows = TOTAL_WEEKS / WEEKS_PER_YEAR;

        const row30 = 30 - START_AGE;
        const row60 = 60 - START_AGE;

        for (let row = 0; row < rows; row++) {
            let offsetY = 0;
            if (row >= row30) offsetY += gapSize; // После 30 лет
            if (row >= row60) offsetY += gapSize; // После 60 лет

            const y = gridY + row * stepY + stepY / 2 + offsetY;
            for (let col = 0; col < WEEKS_PER_YEAR; col++) {
                const x = gridX + col * stepX + stepX / 2;
                
                ctx.beginPath();
                ctx.arc(x, y, radius, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        // Рисуем линии и подписи 30/60 лет
        ctx.strokeStyle = options.textColor;
        ctx.fillStyle = options.textColor;
        ctx.lineWidth = 4;
        const fontSize = Math.floor(config.height * 0.012);
        ctx.font = `${fontSize}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        const drawYearLine = (ageRow, label, gapOffset) => {
            const y = gridY + ageRow * stepY + gapOffset - gapSize / 2;
            
            // Линия слева
            ctx.beginPath();
            ctx.moveTo(gridX, y);
            ctx.lineTo(gridX + stepX * 24, y);
            ctx.stroke();

            // Текст
            ctx.fillText(label, gridX + stepX * 26, y);

            // Линия справа
            ctx.beginPath();
            ctx.moveTo(gridX + stepX * 28, y);
            ctx.lineTo(gridX + stepX * 52, y);
            ctx.stroke();
        };

        drawYearLine(row30, '30', gapSize);
        drawYearLine(row60, '60', gapSize * 2);
    },

    renderOverlay(ctx, config, options, weekIndex, totalWeeks) {
        const { gridX, gridY, gridHeight, stepX, stepY, gapSize } = this._getGridParams(config, options);
        const radius = Math.max(0.5, stepX * options.dotRadius);

        const row30 = 30 - START_AGE;
        const row60 = 60 - START_AGE;

        // Рисуем прошедшие недели
        ctx.fillStyle = options.dotColorPast;
        for (let i = 0; i < weekIndex; i++) {
            const row = Math.floor(i / WEEKS_PER_YEAR);
            const col = i % WEEKS_PER_YEAR;

            let offsetY = 0;
            if (row >= row30) offsetY += gapSize;
            if (row >= row60) offsetY += gapSize;

            const x = gridX + col * stepX + stepX / 2;
            const y = gridY + row * stepY + stepY / 2 + offsetY;

            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.fill();
        }

        // Текущая неделя
        if (weekIndex >= 0 && weekIndex < totalWeeks) {
            const row = Math.floor(weekIndex / WEEKS_PER_YEAR);
            const col = weekIndex % WEEKS_PER_YEAR;

            let offsetY = 0;
            if (row >= row30) offsetY += gapSize;
            if (row >= row60) offsetY += gapSize;

            const x = gridX + col * stepX + stepX / 2;
            const y = gridY + row * stepY + stepY / 2 + offsetY;

            ctx.fillStyle = options.dotColorCurrent;
            ctx.beginPath();
            ctx.arc(x, y, radius * 1.2, 0, Math.PI * 2);
            ctx.fill();
        }

        // Текст прогресса
        const progress = ((weekIndex + 1) / totalWeeks * 100).toFixed(1);
        ctx.fillStyle = options.textColor;
        const fontSize = Math.floor(config.height * 0.015);
        ctx.font = `${fontSize}px sans-serif`;
        ctx.textAlign = 'center';
        
        // Рисуем текст посередине нижнего отступа
        const bottomAreaStart = gridY + gridHeight;
        const bottomAreaHeight = config.height - bottomAreaStart;
        const textY = bottomAreaStart + bottomAreaHeight / 2 + fontSize / 2;
        ctx.fillText(`${progress}% to 90`, config.width / 2, textY);
    },

    _getGridParams(config, options) {
        const { width, height } = config;
        const sidePadding = width * options.gridPadding;
        const topPadding = height * options.topOffset;
        const bottomPadding = height * options.gridPadding;
        
        const availableWidth = width - sidePadding * 2;
        const availableHeight = height - topPadding - bottomPadding;
        
        const rows = TOTAL_WEEKS / WEEKS_PER_YEAR;
        
        // Добавляем пространство для двух линий (на 30 и 60 годах)
        // Каждая линия "занимает" высоту примерно одного шага сетки
        const gapRows = 2; 
        const totalEffectiveRows = rows + gapRows;

        // Чтобы ячейки были строго квадратными
        const step = Math.floor(Math.min(availableWidth / WEEKS_PER_YEAR, availableHeight / totalEffectiveRows));
        
        const stepX = step;
        const stepY = step;
        const gapSize = step; // Расстояние между блоками
        
        const gridWidth = stepX * WEEKS_PER_YEAR;
        const gridHeight = stepY * rows + gapSize * 2;
        
        const gridX = (width - gridWidth) / 2;
        const gridY = topPadding + (availableHeight - gridHeight) / 2;
        
        return {
            gridX,
            gridY,
            gridWidth,
            gridHeight,
            stepX,
            stepY,
            gapSize
        };
    }
};
