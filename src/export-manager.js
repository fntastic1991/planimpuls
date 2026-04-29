// Export-Pipeline: Bericht-PDF, annotierter Plan-PDF, CSV.
// Optisch deutlich aufgewertet im plan.impuls-Branding (Teal + Coral).

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
    formatNumber, rectangleBounds, calculateDistance,
} from './geometry.js';
import { BRAND, brandRgb, loadLogo } from './brand.js';

const TEAL = brandRgb('teal');
const TEAL_DARK = brandRgb('tealDark');
const TEAL_LIGHT = brandRgb('tealLight');
const CORAL = brandRgb('coral');
const CORAL_LIGHT = brandRgb('coralLight');
const INK = brandRgb('ink');
const MUTED = brandRgb('muted');
const LINE = brandRgb('line');
const PAPER_SOFT = brandRgb('paperSoft');

export class ExportManager {
    constructor(store, pdfLoader) {
        this.store = store;
        this.pdfLoader = pdfLoader;
        this._logoDataUrl = null;
    }

    // Logo asynchron als DataURL bereitstellen — jsPDF mag DataURL stabil.
    async _getLogoDataUrl() {
        if (this._logoDataUrl) return this._logoDataUrl;
        try {
            const img = await loadLogo();
            const c = document.createElement('canvas');
            c.width = img.naturalWidth || img.width;
            c.height = img.naturalHeight || img.height;
            c.getContext('2d').drawImage(img, 0, 0);
            this._logoDataUrl = c.toDataURL('image/png');
            return this._logoDataUrl;
        } catch (e) {
            console.warn('Logo konnte nicht geladen werden:', e);
            return null;
        }
    }

    // --- Summary je Etage ---
    getFloorSummary(floor) {
        const s = {
            distances: 0, areas: 0, perimeters: 0, counts: 0,
            totalLength: 0, totalArea: 0, totalPerimeter: 0, totalCount: 0,
            unitLen: floor.scale.unit, unitArea: `${floor.scale.unit}²`,
        };
        for (const m of floor.measurements) {
            if (m.type === 'distance') { s.distances++; s.totalLength += m.value; }
            else if (m.type === 'area' || m.type === 'rectangle' || m.type === 'circle') {
                s.areas++; s.totalArea += m.value;
            }
            else if (m.type === 'perimeter') { s.perimeters++; s.totalPerimeter += m.value; }
            else if (m.type === 'count') { s.counts++; s.totalCount += m.value; }
        }
        return s;
    }

    getProjectSummary() {
        const p = this.store.project;
        const total = { totalLength: 0, totalArea: 0, totalCount: 0, unitLen: 'm', unitArea: 'm²' };
        for (const f of p.floors) {
            const s = this.getFloorSummary(f);
            total.totalLength += s.totalLength;
            total.totalArea += s.totalArea;
            total.totalCount += s.totalCount;
            total.unitLen = s.unitLen;
            total.unitArea = s.unitArea;
        }
        return total;
    }

    typeLabel(t) {
        return ({
            distance: 'Distanz', perimeter: 'Umfang', area: 'Fläche',
            rectangle: 'Rechteck', circle: 'Kreis', count: 'Zählung', text: 'Notiz',
        })[t] || t;
    }

    // =====================================================
    // 1) BERICHT
    // =====================================================
    async exportReport(filename = null) {
        const project = this.store.project;
        const doc = new jsPDF({ unit: 'mm', format: 'a4' });
        const pageW = doc.internal.pageSize.getWidth();
        const pageH = doc.internal.pageSize.getHeight();
        const logoUrl = await this._getLogoDataUrl();

        this._drawCover(doc, project, pageW, pageH, logoUrl);

        // Projekt-Übersicht
        doc.addPage();
        this._drawHeader(doc, project, 'Projekt-Übersicht', logoUrl);
        const projSum = this.getProjectSummary();

        autoTable(doc, {
            startY: 38,
            theme: 'plain',
            styles: { fontSize: 10.5, cellPadding: { top: 3, right: 4, bottom: 3, left: 0 } },
            body: [
                ['Projekt', project.name || '—'],
                ['Kunde', project.client || '—'],
                ['Adresse', project.address || '—'],
                ['Datum', new Date(project.date).toLocaleDateString('de-CH')],
                ['Anzahl Etagen', String(project.floors.length)],
            ],
            columnStyles: {
                0: { fontStyle: 'bold', cellWidth: 42, textColor: MUTED },
                1: { textColor: INK },
            },
        });

        // KPI-Boxen
        const kpiY = doc.lastAutoTable.finalY + 8;
        this._drawKpiRow(doc, kpiY, [
            { label: 'Gesamte Länge',   value: `${formatNumber(projSum.totalLength)} ${projSum.unitLen}`, accent: 'teal' },
            { label: 'Gesamte Fläche',  value: `${formatNumber(projSum.totalArea)} ${projSum.unitArea}`,  accent: 'coral' },
            { label: 'Zählungen',       value: `${projSum.totalCount} Stk.`, accent: 'teal' },
        ], pageW);

        // Übersicht alle Etagen
        const floorRows = project.floors.map((f, i) => {
            const s = this.getFloorSummary(f);
            const scaleStr = f.scale.ratio ? `1:${f.scale.ratio}` : (f.scale.calibrated ? 'manuell' : '—');
            return [
                String(i + 1), f.name, scaleStr,
                `${formatNumber(s.totalLength)} ${s.unitLen}`,
                `${formatNumber(s.totalArea)} ${s.unitArea}`,
                String(s.totalCount),
                String(f.measurements.length),
            ];
        });
        if (floorRows.length) {
            autoTable(doc, {
                startY: kpiY + 32,
                head: [['#', 'Etage', 'Massstab', 'Länge', 'Fläche', 'Stk.', 'Messungen']],
                body: floorRows,
                theme: 'plain',
                headStyles: { fillColor: false, textColor: TEAL, fontStyle: 'bold', fontSize: 9, lineColor: TEAL, lineWidth: { bottom: 0.4 } },
                bodyStyles: { fontSize: 9.5, textColor: INK, cellPadding: { top: 2.4, right: 3, bottom: 2.4, left: 3 } },
                styles: { lineColor: LINE, lineWidth: { bottom: 0.1 } },
            });
        }

        // Detail pro Etage
        for (const floor of project.floors) {
            await this._drawFloorDetail(doc, floor, project, logoUrl);
        }

        this._drawFooterAllPages(doc, project);
        doc.save(filename || `${this._sanitize(project.name)}_Bericht.pdf`);
    }

    // =====================================================
    // 2) ANNOTIERTE PLÄNE
    // =====================================================
    async exportAnnotatedPlans(filename = null) {
        const project = this.store.project;
        const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'landscape' });
        const logoUrl = await this._getLogoDataUrl();
        let isFirst = true;
        let anyPage = false;

        for (const floor of project.floors) {
            if (!this.pdfLoader.hasPdf(floor.id)) continue;
            const entry = this.pdfLoader.pdfCache.get(floor.id);
            if (!entry) continue;

            for (let p = 1; p <= entry.pageCount; p++) {
                const dataUrl = await this._renderPageWithOverlay(floor, p, 2.0);
                if (!dataUrl) continue;

                if (!isFirst) doc.addPage();
                isFirst = false;
                anyPage = true;

                const pageW = doc.internal.pageSize.getWidth();
                const pageH = doc.internal.pageSize.getHeight();

                // Header — weisser Hintergrund mit Logo links und Trennlinie
                if (logoUrl) {
                    try { doc.addImage(logoUrl, 'PNG', 18, 10, 60, 60 * (84 / 308)); } catch {}
                }
                doc.setTextColor(...INK);
                doc.setFontSize(12);
                doc.setFont('helvetica', 'bold');
                doc.text(project.name || 'plan.impuls', pageW - 18, 18, { align: 'right' });
                doc.setFont('helvetica', 'normal');
                doc.setFontSize(9);
                doc.setTextColor(...MUTED);
                doc.text(`${floor.name}  •  Seite ${p}/${entry.pageCount}`, pageW - 18, 28, { align: 'right' });
                doc.setDrawColor(...TEAL);
                doc.setLineWidth(0.6);
                doc.line(18, 36, pageW - 18, 36);

                const img = new Image();
                await new Promise(res => { img.onload = res; img.src = dataUrl; });
                const availH = pageH - 60;
                const ratio = Math.min(pageW / img.width, availH / img.height) * 0.95;
                const w = img.width * ratio, h = img.height * ratio;
                const x = (pageW - w) / 2, y = 44 + (availH - h) / 2;

                // Plan ohne Schatten — clean
                doc.addImage(dataUrl, 'PNG', x, y, w, h);

                // Footer
                doc.setDrawColor(...LINE);
                doc.setLineWidth(0.2);
                doc.line(18, pageH - 16, pageW - 18, pageH - 16);
                doc.setFontSize(8);
                doc.setTextColor(...MUTED);
                doc.text(`${BRAND.name} · ${BRAND.company}`, 18, pageH - 10);
                doc.text(new Date().toLocaleDateString('de-CH'), pageW - 18, pageH - 10, { align: 'right' });
            }
        }

        if (!anyPage) {
            throw new Error('Kein PDF-Plan in den Etagen geladen.');
        }
        doc.save(filename || `${this._sanitize(project.name)}_Plaene_annotiert.pdf`);
    }

    async _renderPageWithOverlay(floor, pageNum, scale = 2.0) {
        const entry = this.pdfLoader.pdfCache.get(floor.id);
        if (!entry) return null;
        const page = await entry.pdf.getPage(pageNum);
        const viewport = page.getViewport({ scale });
        const c = document.createElement('canvas');
        c.width = viewport.width; c.height = viewport.height;
        const ctx = c.getContext('2d');
        await page.render({ canvasContext: ctx, viewport }).promise;

        const internalScale = this.pdfLoader.renderScale;
        const scaleToExport = scale / internalScale;

        const layerMap = Object.fromEntries(this.store.project.layers.map(l => [l.id, l]));
        const pageMs = floor.measurements.filter(m => m.pageIndex === pageNum);
        for (const m of pageMs) {
            const layer = layerMap[m.layerId];
            if (layer && !layer.visible) continue;
            const color = (layer && layer.color) || m.color || '#386e79';
            this._drawMeasurementOnCtx(ctx, m, scaleToExport, color);
        }
        return c.toDataURL('image/png');
    }

    _drawMeasurementOnCtx(ctx, m, sc, overrideColor = null) {
        const color = overrideColor || m.color || '#386e79';
        ctx.strokeStyle = color;
        ctx.lineWidth = (m.strokeWidth || 2) * 1.2;
        ctx.fillStyle = this._hexToRgba(color, 0.22);
        const points = m.points.map(p => ({ x: p.x * sc, y: p.y * sc }));

        const label = (txt, at, centered = false) => {
            ctx.font = 'bold 13px Inter, sans-serif';
            const pad = 6;
            const w = ctx.measureText(txt).width + pad * 2;
            const h = 20;
            const x = centered ? at.x - w / 2 : at.x + 10;
            const y = centered ? at.y - h / 2 : at.y + 10;
            ctx.fillStyle = color;
            ctx.fillRect(x, y, w, h);
            ctx.fillStyle = '#fff';
            ctx.textBaseline = 'middle';
            ctx.fillText(txt, x + pad, y + h / 2);
            ctx.textBaseline = 'alphabetic';
            ctx.fillStyle = this._hexToRgba(color, 0.22);
        };

        switch (m.type) {
            case 'distance': {
                ctx.beginPath(); ctx.moveTo(points[0].x, points[0].y);
                ctx.lineTo(points[1].x, points[1].y); ctx.stroke();
                label(`${m.name}: ${formatNumber(m.value)} ${m.unit}`, points[1]);
                break;
            }
            case 'perimeter': {
                ctx.beginPath(); ctx.moveTo(points[0].x, points[0].y);
                for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
                ctx.stroke();
                label(`${m.name}: ${formatNumber(m.value)} ${m.unit}`, points[points.length - 1]);
                break;
            }
            case 'area': {
                ctx.beginPath(); ctx.moveTo(points[0].x, points[0].y);
                for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
                ctx.closePath(); ctx.fill(); ctx.stroke();
                const cx = points.reduce((a, p) => a + p.x, 0) / points.length;
                const cy = points.reduce((a, p) => a + p.y, 0) / points.length;
                label(`${m.name}: ${formatNumber(m.value)} ${m.unit}`, { x: cx, y: cy }, true);
                break;
            }
            case 'rectangle': {
                const b = rectangleBounds(points[0], points[1]);
                ctx.beginPath(); ctx.rect(b.x, b.y, b.width, b.height);
                ctx.fill(); ctx.stroke();
                label(`${m.name}: ${formatNumber(m.value)} ${m.unit}`,
                    { x: b.x + b.width / 2, y: b.y + b.height / 2 }, true);
                break;
            }
            case 'circle': {
                const r = calculateDistance(points[0], points[1]);
                ctx.beginPath(); ctx.arc(points[0].x, points[0].y, r, 0, Math.PI * 2);
                ctx.fill(); ctx.stroke();
                label(`${m.name}: ${formatNumber(m.value)} ${m.unit}`, points[0], true);
                break;
            }
            case 'count': {
                points.forEach((p, i) => {
                    ctx.beginPath(); ctx.arc(p.x, p.y, 12, 0, Math.PI * 2);
                    ctx.fill(); ctx.stroke();
                    ctx.fillStyle = color;
                    ctx.font = 'bold 11px Inter, sans-serif';
                    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                    ctx.fillText(String(i + 1), p.x, p.y);
                    ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
                    ctx.fillStyle = this._hexToRgba(color, 0.22);
                });
                if (points.length) label(`${m.name}: ${points.length} Stk.`, points[points.length - 1]);
                break;
            }
            case 'text': {
                ctx.fillStyle = color;
                ctx.beginPath(); ctx.arc(points[0].x, points[0].y, 6, 0, Math.PI * 2); ctx.fill();
                label(m.text || m.name, points[0]);
                break;
            }
        }
    }

    // =====================================================
    // Berichts-Bausteine
    // =====================================================
    _drawCover(doc, project, pageW, pageH, logoUrl) {
        // Reines Weiss
        doc.setFillColor(255, 255, 255);
        doc.rect(0, 0, pageW, pageH, 'F');

        const margin = 24;

        // Logo oben links
        if (logoUrl) {
            const lw = 50, lh = lw * (84 / 308);
            try { doc.addImage(logoUrl, 'PNG', margin, margin, lw, lh); } catch {}
        }

        // Firmenname oben rechts
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.setTextColor(...INK);
        doc.text(BRAND.company, pageW - margin, margin + 5, { align: 'right' });
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(...MUTED);
        doc.text(BRAND.tagline, pageW - margin, margin + 10, { align: 'right' });

        // Dünne teal Trennlinie unter Header
        doc.setDrawColor(...TEAL);
        doc.setLineWidth(0.4);
        doc.line(margin, margin + 18, pageW - margin, margin + 18);

        // BIG Project Title — viel Weissraum darüber
        const titleY = 90;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.setTextColor(...MUTED);
        doc.text('BERICHT', margin, titleY - 8, { charSpace: 1.2 });

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(28);
        doc.setTextColor(...INK);
        const projectName = project.name || 'Unbenanntes Projekt';
        doc.text(projectName, margin, titleY, { maxWidth: pageW - margin * 2 });

        // Coral Akzent-Strich (kurz, links unter dem Titel)
        doc.setFillColor(...CORAL);
        doc.rect(margin, titleY + 6, 32, 1.2, 'F');

        // Meta-Felder als saubere Tabelle
        const metaY = titleY + 22;
        const metaItems = [
            { label: 'Kunde',   value: project.client || '—' },
            { label: 'Adresse', value: project.address || '—' },
            { label: 'Datum',   value: new Date(project.date).toLocaleDateString('de-CH') },
            { label: 'Etagen',  value: String(project.floors.length) },
        ];
        let my = metaY;
        for (const it of metaItems) {
            doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...MUTED);
            doc.text(it.label.toUpperCase(), margin, my, { charSpace: 0.6 });
            doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...INK);
            doc.text(it.value, margin + 38, my);
            my += 9;
        }

        // KPI-Strip in der Mitte — minimalistisch
        const total = this.getProjectSummary();
        this._drawKpiRow(doc, pageH / 2 + 10, [
            { label: 'Gesamte Länge',  value: `${formatNumber(total.totalLength)} ${total.unitLen}`, accent: 'teal' },
            { label: 'Gesamte Fläche', value: `${formatNumber(total.totalArea)} ${total.unitArea}`,  accent: 'coral' },
            { label: 'Zählungen',      value: `${total.totalCount} Stk.`, accent: 'teal' },
        ], pageW);

        // Footer
        doc.setDrawColor(...LINE);
        doc.setLineWidth(0.2);
        doc.line(margin, pageH - 20, pageW - margin, pageH - 20);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(...MUTED);
        doc.text(`${BRAND.name} · ${BRAND.company}`, margin, pageH - 14);
        doc.text(new Date().toLocaleDateString('de-CH'), pageW - margin, pageH - 14, { align: 'right' });
    }

    _drawKpiRow(doc, y, items, pageW) {
        const margin = 24;
        const gap = 6;
        const w = (pageW - margin * 2 - gap * (items.length - 1)) / items.length;
        const h = 26;
        items.forEach((item, i) => {
            const x = margin + i * (w + gap);
            const accentRgb = item.accent === 'coral' ? CORAL : TEAL;
            // Nur Rahmen + dünner Akzent-Strich oben — kein Hintergrund
            doc.setDrawColor(...LINE);
            doc.setLineWidth(0.2);
            doc.rect(x, y, w, h, 'S');
            doc.setFillColor(...accentRgb);
            doc.rect(x, y, w, 0.8, 'F');

            doc.setTextColor(...MUTED); doc.setFontSize(8); doc.setFont('helvetica', 'normal');
            doc.text(item.label.toUpperCase(), x + 5, y + 9, { charSpace: 0.5 });
            doc.setTextColor(...INK); doc.setFontSize(13); doc.setFont('helvetica', 'bold');
            doc.text(item.value, x + 5, y + 20);
        });
    }

    _drawHeader(doc, project, title, logoUrl) {
        const w = doc.internal.pageSize.getWidth();
        const margin = 14;
        // Weisser Hintergrund (jsPDF default), nur dünne teal Linie unten
        if (logoUrl) {
            try { doc.addImage(logoUrl, 'PNG', margin, 8, 26, 26 * (84 / 308)); } catch {}
        }

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.setTextColor(...INK);
        doc.text(title, w / 2, 14, { align: 'center' });

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8.5);
        doc.setTextColor(...MUTED);
        doc.text(project.name || '—', w - margin, 14, { align: 'right' });

        doc.setDrawColor(...TEAL);
        doc.setLineWidth(0.4);
        doc.line(margin, 22, w - margin, 22);
    }

    _drawFooterAllPages(doc, project) {
        const count = doc.internal.getNumberOfPages();
        for (let i = 1; i <= count; i++) {
            doc.setPage(i);
            const w = doc.internal.pageSize.getWidth();
            const h = doc.internal.pageSize.getHeight();
            // dünne Linie über Footer
            doc.setDrawColor(...LINE);
            doc.setLineWidth(0.2);
            doc.line(15, h - 12, w - 15, h - 12);
            doc.setFontSize(8);
            doc.setTextColor(...MUTED);
            doc.text(`${BRAND.name} · ${BRAND.company}  •  ${project.name || '—'}`, 15, h - 6);
            doc.text(`Seite ${i} / ${count}`, w - 15, h - 6, { align: 'right' });
        }
    }

    async _drawFloorDetail(doc, floor, project, logoUrl) {
        doc.addPage();
        this._drawHeader(doc, project, `Etage: ${floor.name}`, logoUrl);

        const s = this.getFloorSummary(floor);
        const pageW = doc.internal.pageSize.getWidth();

        // Etagen-Titel + Massstab-Info
        doc.setFontSize(16);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...INK);
        doc.text(floor.name, 15, 36);

        doc.setFontSize(9.5);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(...MUTED);
        const scaleText = floor.scale.ratio
            ? `Massstab 1:${floor.scale.ratio}`
            : (floor.scale.calibrated ? 'manuell kalibriert' : 'nicht kalibriert');
        doc.text(`${scaleText}  •  ${floor.pdfFileName || 'Kein PDF'}  •  ${floor.measurements.length} Messung(en)`,
            15, 42);

        // Thumbnail rechts
        try {
            if (this.pdfLoader.hasPdf(floor.id)) {
                const thumb = await this.pdfLoader.renderThumbnail(floor.id, 1, 400);
                if (thumb) {
                    const img = new Image();
                    await new Promise(r => { img.onload = r; img.src = thumb; });
                    const maxW = 56; const h = img.height * (maxW / img.width);
                    doc.setDrawColor(...LINE);
                    doc.setLineWidth(0.2);
                    doc.rect(pageW - 15 - maxW, 28, maxW, h, 'S');
                    doc.addImage(thumb, 'PNG', pageW - 15 - maxW, 28, maxW, h);
                }
            }
        } catch {}

        // KPI-Boxen
        this._drawKpiRow(doc, 56, [
            { label: 'Länge',     value: `${formatNumber(s.totalLength)} ${s.unitLen}`,  accent: 'teal' },
            { label: 'Fläche',    value: `${formatNumber(s.totalArea)} ${s.unitArea}`,   accent: 'coral' },
            { label: 'Umfänge',   value: `${formatNumber(s.totalPerimeter)} ${s.unitLen}`, accent: 'teal' },
            { label: 'Zählung',   value: `${s.totalCount} Stk.`, accent: 'coral' },
        ], pageW);

        // Messungen-Tabelle
        const layerMap = Object.fromEntries(this.store.project.layers.map(l => [l.id, l]));
        const rows = floor.measurements.map((m, i) => {
            const layer = layerMap[m.layerId];
            return [
                String(i + 1),
                this.typeLabel(m.type),
                m.name,
                layer ? layer.name : '—',
                `${formatNumber(m.value)} ${m.unit}`,
                String(m.pageIndex),
            ];
        });
        autoTable(doc, {
            startY: 96,
            head: [['#', 'Typ', 'Bezeichnung', 'Ebene', 'Wert', 'Seite']],
            body: rows.length ? rows : [['—', '—', 'Keine Messungen', '—', '—', '—']],
            theme: 'plain',
            styles: { fontSize: 9, cellPadding: { top: 2.4, right: 3, bottom: 2.4, left: 3 }, lineColor: LINE, lineWidth: { bottom: 0.1 }, textColor: INK },
            headStyles: { fillColor: false, textColor: TEAL, fontStyle: 'bold', fontSize: 9, lineColor: TEAL, lineWidth: { bottom: 0.4 } },
            columnStyles: {
                0: { cellWidth: 10, halign: 'right', textColor: MUTED },
                4: { fontStyle: 'bold' },
                5: { halign: 'center', cellWidth: 14 },
            },
        });
    }

    // =====================================================
    // 3) CSV
    // =====================================================
    exportCSV(filename = null) {
        const project = this.store.project;
        let csv = 'Etage;Typ;Bezeichnung;Wert;Einheit;Seite\n';
        for (const f of project.floors) {
            for (const m of f.measurements) {
                csv += [
                    this._csvEscape(f.name),
                    this.typeLabel(m.type),
                    this._csvEscape(m.name),
                    formatNumber(m.value).replace('.', ','),
                    m.unit,
                    m.pageIndex,
                ].join(';') + '\n';
            }
        }
        const total = this.getProjectSummary();
        csv += `\nTotal;Länge;;${formatNumber(total.totalLength).replace('.', ',')};${total.unitLen};\n`;
        csv += `Total;Fläche;;${formatNumber(total.totalArea).replace('.', ',')};${total.unitArea};\n`;
        csv += `Total;Zählung;;${total.totalCount};Stk.;\n`;

        const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename || `${this._sanitize(project.name)}_Messungen.csv`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 500);
    }

    _csvEscape(s) { return `"${String(s).replace(/"/g, '""')}"`; }
    _sanitize(s) { return (s || 'Projekt').replace(/[^a-zA-Z0-9\-_ ]/g, '').trim().replace(/\s+/g, '_') || 'Projekt'; }
    _hexToRgba(hex, a) {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return `rgba(${r},${g},${b},${a})`;
    }
}
