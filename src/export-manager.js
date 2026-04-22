// Umfangreiches Export: PDF-Bericht (Deckblatt, Etagen, Tabellen) +
// Annotierter Plan-PDF (jede Seite als Bild + Messungen-Overlay) + CSV.

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
    formatNumber, rectangleBounds, calculateDistance,
} from './geometry.js';

export class ExportManager {
    constructor(store, pdfLoader) {
        this.store = store;
        this.pdfLoader = pdfLoader;
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

    // --- Gesamtprojekt-Summary ---
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
    // 1) BERICHT (strukturiert, Corporate-Look)
    // =====================================================
    async exportReport(filename = null) {
        const project = this.store.project;
        const doc = new jsPDF({ unit: 'mm', format: 'a4' });
        const pageW = doc.internal.pageSize.getWidth();
        const pageH = doc.internal.pageSize.getHeight();

        this._drawCover(doc, project, pageW, pageH);

        // Projekt-Übersicht
        doc.addPage();
        this._drawHeader(doc, project, 'Projekt-Übersicht');
        const projSum = this.getProjectSummary();

        autoTable(doc, {
            startY: 40,
            theme: 'plain',
            styles: { fontSize: 11, cellPadding: 3 },
            body: [
                ['Projekt', project.name || '—'],
                ['Kunde', project.client || '—'],
                ['Adresse', project.address || '—'],
                ['Datum', new Date(project.date).toLocaleDateString('de-CH')],
                ['Anzahl Etagen', String(project.floors.length)],
                ['Gesamte Länge', `${formatNumber(projSum.totalLength)} ${projSum.unitLen}`],
                ['Gesamte Fläche', `${formatNumber(projSum.totalArea)} ${projSum.unitArea}`],
                ['Gesamte Zählungen', `${projSum.totalCount} Stk.`],
            ],
            columnStyles: {
                0: { fontStyle: 'bold', cellWidth: 50, textColor: [60, 60, 60] },
                1: { textColor: [30, 30, 30] },
            },
        });

        // Übersicht-Tabelle aller Etagen
        const floorRows = project.floors.map((f, i) => {
            const s = this.getFloorSummary(f);
            return [
                String(i + 1), f.name,
                `${formatNumber(s.totalLength)} ${s.unitLen}`,
                `${formatNumber(s.totalArea)} ${s.unitArea}`,
                String(s.totalCount),
                String(f.measurements.length),
            ];
        });
        if (floorRows.length) {
            autoTable(doc, {
                startY: doc.lastAutoTable.finalY + 10,
                head: [['#', 'Etage', 'Länge', 'Fläche', 'Stk.', 'Messungen']],
                body: floorRows,
                theme: 'striped',
                headStyles: { fillColor: [37, 99, 235], textColor: 255, fontStyle: 'bold' },
                styles: { fontSize: 10, cellPadding: 3 },
            });
        }

        // Detail pro Etage
        for (const floor of project.floors) {
            await this._drawFloorDetail(doc, floor, project);
        }

        this._drawFooterAllPages(doc, project);
        doc.save(filename || `${this._sanitize(project.name)}_Bericht.pdf`);
    }

    // =====================================================
    // 2) ANNOTIERTER PLAN (PDF mit Messungen-Overlay)
    // =====================================================
    async exportAnnotatedPlans(filename = null) {
        const project = this.store.project;
        const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'landscape' });
        let isFirst = true;

        for (const floor of project.floors) {
            if (!this.pdfLoader.hasPdf(floor.id)) continue;
            await this.pdfLoader.setActiveFloor(floor.id);
            const entry = this.pdfLoader.pdfCache.get(floor.id);
            if (!entry) continue;

            for (let p = 1; p <= entry.pageCount; p++) {
                const dataUrl = await this._renderPageWithOverlay(floor, p, 2.0);
                if (!dataUrl) continue;

                if (!isFirst) doc.addPage();
                isFirst = false;

                // Bild in Seite einpassen
                const pageW = doc.internal.pageSize.getWidth();
                const pageH = doc.internal.pageSize.getHeight();
                const img = new Image();
                await new Promise(res => { img.onload = res; img.src = dataUrl; });
                const ratio = Math.min(pageW / img.width, pageH / img.height) * 0.95;
                const w = img.width * ratio, h = img.height * ratio;
                const x = (pageW - w) / 2, y = (pageH - h) / 2;

                // Header
                doc.setFontSize(10);
                doc.setTextColor(100);
                doc.text(`${project.name || 'PlanImpuls'}  •  ${floor.name}  •  Seite ${p}/${entry.pageCount}`, 20, 20);

                doc.addImage(dataUrl, 'PNG', x, y, w, h);
            }
        }

        doc.save(filename || `${this._sanitize(project.name)}_Plaene_annotiert.pdf`);
    }

    // --- Render PDF-Seite + Messungen in Canvas ---
    async _renderPageWithOverlay(floor, pageNum, scale = 2.0) {
        const entry = this.pdfLoader.pdfCache.get(floor.id);
        if (!entry) return null;
        const page = await entry.pdf.getPage(pageNum);
        const viewport = page.getViewport({ scale });
        const c = document.createElement('canvas');
        c.width = viewport.width; c.height = viewport.height;
        const ctx = c.getContext('2d');
        await page.render({ canvasContext: ctx, viewport }).promise;

        // Skalierungs-Faktor zu internem Render (Canvas lief mit pdfLoader.renderScale)
        const internalScale = this.pdfLoader.renderScale;
        const scaleToExport = scale / internalScale;

        const pageMs = floor.measurements.filter(m => m.pageIndex === pageNum);
        for (const m of pageMs) {
            this._drawMeasurementOnCtx(ctx, m, scaleToExport, floor);
        }
        return c.toDataURL('image/png');
    }

    _drawMeasurementOnCtx(ctx, m, sc, floor) {
        const color = m.color || '#3b82f6';
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

    // --- Berichts-Bausteine ---
    _drawCover(doc, project, pageW, pageH) {
        // Kopf-Farbstreifen
        doc.setFillColor(37, 99, 235);
        doc.rect(0, 0, pageW, 70, 'F');

        doc.setTextColor(255);
        doc.setFontSize(28);
        doc.setFont('helvetica', 'bold');
        doc.text('Mengenermittlung', 20, 40);
        doc.setFontSize(13);
        doc.setFont('helvetica', 'normal');
        doc.text('PlanImpuls Pro — Bericht', 20, 55);

        doc.setTextColor(30, 30, 30);
        doc.setFontSize(22);
        doc.setFont('helvetica', 'bold');
        doc.text(project.name || 'Unbenanntes Projekt', 20, 100);

        doc.setFontSize(11);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(80);
        doc.text(`Kunde: ${project.client || '—'}`, 20, 115);
        doc.text(`Adresse: ${project.address || '—'}`, 20, 125);
        doc.text(`Datum: ${new Date(project.date).toLocaleDateString('de-CH')}`, 20, 135);

        const total = this.getProjectSummary();
        doc.setDrawColor(220);
        doc.line(20, 150, pageW - 20, 150);

        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.text('Auf einen Blick', 20, 165);

        const boxW = (pageW - 60) / 3, boxH = 40, y = 175;
        const boxes = [
            { label: 'Gesamte Länge', value: `${formatNumber(total.totalLength)} ${total.unitLen}` },
            { label: 'Gesamte Fläche', value: `${formatNumber(total.totalArea)} ${total.unitArea}` },
            { label: 'Etagen', value: String(project.floors.length) },
        ];
        boxes.forEach((b, i) => {
            const x = 20 + i * (boxW + 10);
            doc.setFillColor(245, 247, 250);
            doc.roundedRect(x, y, boxW, boxH, 3, 3, 'F');
            doc.setFontSize(9); doc.setTextColor(100); doc.setFont('helvetica', 'normal');
            doc.text(b.label, x + 6, y + 12);
            doc.setFontSize(16); doc.setTextColor(37, 99, 235); doc.setFont('helvetica', 'bold');
            doc.text(b.value, x + 6, y + 28);
        });

        doc.setFontSize(9);
        doc.setTextColor(120);
        doc.text(`Erstellt mit PlanImpuls · ${new Date().toLocaleDateString('de-CH')}`, 20, pageH - 15);
    }

    _drawHeader(doc, project, title) {
        doc.setFillColor(37, 99, 235);
        doc.rect(0, 0, doc.internal.pageSize.getWidth(), 20, 'F');
        doc.setTextColor(255);
        doc.setFontSize(11);
        doc.setFont('helvetica', 'bold');
        doc.text(title, 15, 13);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.text(project.name || '—', doc.internal.pageSize.getWidth() - 15, 13, { align: 'right' });
        doc.setTextColor(0);
    }

    _drawFooterAllPages(doc, project) {
        const count = doc.internal.getNumberOfPages();
        for (let i = 1; i <= count; i++) {
            doc.setPage(i);
            const w = doc.internal.pageSize.getWidth();
            const h = doc.internal.pageSize.getHeight();
            doc.setFontSize(8);
            doc.setTextColor(150);
            doc.text(`${project.name || 'PlanImpuls'}`, 15, h - 8);
            doc.text(`Seite ${i} / ${count}`, w - 15, h - 8, { align: 'right' });
        }
    }

    async _drawFloorDetail(doc, floor, project) {
        doc.addPage();
        this._drawHeader(doc, project, `Etage: ${floor.name}`);

        const s = this.getFloorSummary(floor);
        doc.setFontSize(14); doc.setFont('helvetica', 'bold'); doc.setTextColor(20);
        doc.text(floor.name, 15, 32);
        doc.setFontSize(10); doc.setFont('helvetica', 'normal'); doc.setTextColor(100);
        const scaleText = floor.scale.ratio
            ? `Massstab 1:${floor.scale.ratio} (${floor.scale.unit})`
            : (floor.scale.calibrated ? `Kalibriert (${floor.scale.unit})` : 'Nicht kalibriert');
        doc.text(`${scaleText}  •  ${floor.pdfFileName || 'Kein PDF'}`, 15, 39);

        // Thumbnail der ersten Seite
        try {
            if (this.pdfLoader.hasPdf(floor.id)) {
                const thumb = await this.pdfLoader.renderThumbnail(floor.id, 1, 400);
                if (thumb) {
                    const img = new Image();
                    await new Promise(r => { img.onload = r; img.src = thumb; });
                    const maxW = 70; const h = img.height * (maxW / img.width);
                    doc.addImage(thumb, 'PNG', doc.internal.pageSize.getWidth() - 15 - maxW, 27, maxW, h);
                }
            }
        } catch {}

        // Summary-Boxen
        const y = 50;
        const w = (doc.internal.pageSize.getWidth() - 30 - 30) / 4;
        const boxes = [
            { label: 'Länge', value: `${formatNumber(s.totalLength)} ${s.unitLen}` },
            { label: 'Fläche', value: `${formatNumber(s.totalArea)} ${s.unitArea}` },
            { label: 'Umfänge', value: `${formatNumber(s.totalPerimeter)} ${s.unitLen}` },
            { label: 'Zählung', value: `${s.totalCount} Stk.` },
        ];
        boxes.forEach((b, i) => {
            const x = 15 + i * (w + 10);
            doc.setFillColor(245, 247, 250);
            doc.roundedRect(x, y, w, 20, 2, 2, 'F');
            doc.setFontSize(8); doc.setTextColor(110); doc.setFont('helvetica', 'normal');
            doc.text(b.label, x + 4, y + 7);
            doc.setFontSize(12); doc.setTextColor(37, 99, 235); doc.setFont('helvetica', 'bold');
            doc.text(b.value, x + 4, y + 16);
        });

        // Detail-Tabelle
        const rows = floor.measurements.map((m, i) => {
            const layer = this.store.getLayer(m.layerId);
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
            startY: y + 30,
            head: [['#', 'Typ', 'Bezeichnung', 'Ebene', 'Wert', 'Seite']],
            body: rows.length ? rows : [['—', '—', 'Keine Messungen', '—', '—', '—']],
            theme: 'grid',
            styles: { fontSize: 9, cellPadding: 2.5 },
            headStyles: { fillColor: [37, 99, 235], textColor: 255 },
            alternateRowStyles: { fillColor: [248, 250, 252] },
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

    // --- Helpers ---
    _csvEscape(s) { return `"${String(s).replace(/"/g, '""')}"`; }
    _sanitize(s) { return (s || 'Projekt').replace(/[^a-zA-Z0-9\-_ ]/g, '').trim().replace(/\s+/g, '_') || 'Projekt'; }
    _hexToRgba(hex, a) {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return `rgba(${r},${g},${b},${a})`;
    }
}
