// Canvas-Manager: Zeichen-Layer, Tools, Zoom/Pan, Selection, Snapping, Magnifier.
// Messungen werden in der ProjectStore gehalten (pro Etage).

import {
    calculateDistance, calculatePolygonArea, calculatePolylineLength,
    rectangleBounds, boundingBox, pointInPolygon, distancePointToSegment, formatNumber,
} from './geometry.js';

export class CanvasManager {
    constructor(overlayId, pdfCanvasId, store) {
        this.canvas = document.getElementById(overlayId);
        this.ctx = this.canvas.getContext('2d');
        this.pdfCanvas = document.getElementById(pdfCanvasId);
        this.store = store;

        // Lupe (Magnifier) für feine Messungen
        this.magnifier = document.createElement('canvas');
        this.magnifier.width = 160;
        this.magnifier.height = 160;
        this.magnifier.classList.add('magnifier', 'hidden');
        document.body.appendChild(this.magnifier);
        this.magCtx = this.magnifier.getContext('2d');

        // Tool-State
        this.currentTool = 'select';
        this.activePoints = [];
        this.isDrawing = false;
        this.previewEndPos = null;

        // View-State (Zoom in CSS, interne Koords bleiben im Backing Store)
        this.zoom = 1.0;          // User Zoom (CSS)
        this.panX = 0;
        this.panY = 0;

        // Snapping
        this.snapEnabled = true;
        this.snapThreshold = 14;
        this.snappedPoint = null;

        // Selection
        this.selectedId = null;
        this.hoverId = null;

        // Appearance
        this.currentColor = '#3b82f6';
        this.currentStrokeWidth = 2;
        this.currentFont = 'bold 13px Inter, sans-serif';

        // Space-Drag Pan
        this.spaceDown = false;
        this.isPanning = false;

        // Callbacks
        this.onMeasurementsUpdated = null;
        this.onScaleRequested = null;
        this.onSelectionChanged = null;
        this.onZoomChanged = null;
        this.onStatusUpdate = null; // optional cursor-pos etc.

        this.initEvents();
    }

    // --- Public API ---

    resize(widthPx, heightPx) {
        this.canvas.width = widthPx;
        this.canvas.height = heightPx;
        this._applyCssSize();
        this.redraw();
    }

    setZoom(zoom) {
        this.zoom = Math.max(0.1, Math.min(8, zoom));
        this._applyCssSize();
        if (this.onZoomChanged) this.onZoomChanged(this.zoom);
    }

    _applyCssSize() {
        this.canvas.style.width = `${this.canvas.width * this.zoom}px`;
        this.canvas.style.height = `${this.canvas.height * this.zoom}px`;
    }

    setColor(color) {
        this.currentColor = color;
        if (this.selectedId) {
            this.store.updateMeasurement(this.selectedId, { color });
            this.redraw();
        }
    }

    setStrokeWidth(w) {
        this.currentStrokeWidth = w;
        if (this.selectedId) {
            this.store.updateMeasurement(this.selectedId, { strokeWidth: w });
            this.redraw();
        }
    }

    setTool(tool) {
        this.currentTool = tool;
        this.activePoints = [];
        this.isDrawing = false;
        this.previewEndPos = null;
        this.magnifier.classList.add('hidden');

        if (tool === 'select' || tool === 'pan') {
            this.canvas.style.cursor = tool === 'pan' ? 'grab' : 'default';
            this.canvas.style.touchAction = 'pan-x pan-y';
        } else {
            this.canvas.style.cursor = 'crosshair';
            this.canvas.style.touchAction = 'none';
        }
        this.selectedId = null;
        if (this.onSelectionChanged) this.onSelectionChanged(null);
        this.redraw();
    }

    selectMeasurement(id) {
        this.selectedId = id;
        if (this.onSelectionChanged) this.onSelectionChanged(this._findMeasurement(id));
        this.redraw();
    }

    undoLastPoint() {
        if (this.isDrawing && this.activePoints.length > 0) {
            this.activePoints.pop();
            if (this.activePoints.length === 0) this.isDrawing = false;
            this.redraw();
            return;
        }
        const floor = this.store.getActiveFloor();
        if (floor && floor.measurements.length > 0) {
            const last = floor.measurements[floor.measurements.length - 1];
            this.store.deleteMeasurement(last.id);
            this.redraw();
        }
    }

    // --- Scale ---
    setScale(realDistance, unitName) {
        if (this.activePoints.length !== 2) return;
        const pxDist = calculateDistance(this.activePoints[0], this.activePoints[1]);
        if (pxDist < 0.5) {
            alert('Die beiden Massstab-Punkte sind zu nah beieinander. Bitte erneut setzen.');
            this.activePoints = [];
            this.redraw();
            return;
        }
        const floor = this.store.getActiveFloor();
        if (!floor) return;
        // Eingabe-Einheit auf Meter normieren, damit alle Etagen / Exporte konsistent in Metern rechnen.
        const toMeters = unitName === 'mm' ? 0.001 : unitName === 'cm' ? 0.01 : 1;
        const realMeters = realDistance * toMeters;
        floor.scale.factor = realMeters / pxDist;
        floor.scale.unit = 'm';
        floor.scale.calibrated = true;
        floor.scale.ratio = null;
        this.activePoints = [];
        this.setTool('select');
        this.recalculateAll();
    }

    setScaleByRatio(denominator, renderScale, opts = {}) {
        const floor = this.store.getActiveFloor();
        if (!floor) return;
        // Meter pro Pixel im Backing Store: 1 Pixel = (1/72)" / renderScale Papier-Inch.
        // Bei Massstab 1:N entspricht 1 Papier-Meter -> N reale Meter.
        const metersPerPixelPaper = (1 / renderScale) * (1 / 72) * 0.0254;
        floor.scale.factor = metersPerPixelPaper * denominator;
        floor.scale.unit = 'm';
        floor.scale.ratio = denominator;
        floor.scale.calibrated = !opts.silent;
        if (!opts.silent) {
            this.activePoints = [];
            this.setTool('select');
        }
        this.recalculateAll();
    }

    recalculateAll(targetFloor = null) {
        const floor = targetFloor || this.store.getActiveFloor();
        if (!floor) return;
        const sf = floor.scale.factor;
        const unit = floor.scale.unit;
        if (sf == null) return; // ohne factor keine Berechnung
        for (const m of floor.measurements) this._recalcMeasurement(m, sf, unit);
        this.store.notify('measurements:changed');
        this.redraw();
    }

    _recalcMeasurement(m, sf, unit) {
        switch (m.type) {
            case 'distance':
                m.value = calculateDistance(m.points[0], m.points[1]) * sf;
                m.unit = unit; break;
            case 'perimeter':
                m.value = calculatePolylineLength(m.points) * sf;
                m.unit = unit; break;
            case 'area':
                m.value = calculatePolygonArea(m.points) * sf * sf;
                m.unit = `${unit}²`; break;
            case 'rectangle': {
                const b = rectangleBounds(m.points[0], m.points[1]);
                m.value = (b.width * b.height) * sf * sf;
                m.width = b.width * sf; m.height = b.height * sf;
                m.unit = `${unit}²`; break;
            }
            case 'circle': {
                const r = calculateDistance(m.points[0], m.points[1]);
                m.value = Math.PI * r * r * sf * sf;
                m.radius = r * sf;
                m.unit = `${unit}²`; break;
            }
            case 'count':
                m.value = m.points.length;
                m.unit = 'Stk.'; break;
            case 'text':
                m.value = 0; m.unit = ''; break;
        }
    }

    // --- Snapping ---
    findSnapPoint(pos) {
        if (!this.snapEnabled) return null;
        const floor = this.store.getActiveFloor();
        if (!floor) return null;
        const pageMs = floor.measurements.filter(m => m.pageIndex === floor.currentPageIndex);
        for (const m of pageMs) {
            for (const p of (m.points || [])) {
                if (calculateDistance(pos, p) < this.snapThreshold) {
                    return { x: p.x, y: p.y };
                }
            }
        }
        if (this.activePoints.length > 2) {
            const s = this.activePoints[0];
            if (calculateDistance(pos, s) < this.snapThreshold) {
                return { x: s.x, y: s.y, isStart: true };
            }
        }
        return null;
    }

    // --- Magnifier ---
    updateMagnifier(pos) {
        if (!['distance', 'perimeter', 'area', 'scale', 'rectangle', 'circle'].includes(this.currentTool)) {
            this.magnifier.classList.add('hidden');
            return;
        }
        this.magnifier.classList.remove('hidden');

        const rect = this.canvas.getBoundingClientRect();
        const globalX = rect.left + pos.x * this.zoom;
        const globalY = rect.top + pos.y * this.zoom;
        this.magnifier.style.left = `${globalX - 80}px`;
        this.magnifier.style.top = `${globalY - 200}px`;

        const size = 160;
        this.magCtx.clearRect(0, 0, size, size);
        this.magCtx.fillStyle = '#fff';
        this.magCtx.fillRect(0, 0, size, size);

        const zoom = 2.5;
        const sx = pos.x - (size / (2 * zoom));
        const sy = pos.y - (size / (2 * zoom));
        const sw = size / zoom;
        const sh = size / zoom;

        this.magCtx.drawImage(this.pdfCanvas, sx, sy, sw, sh, 0, 0, size, size);
        this.magCtx.drawImage(this.canvas, sx, sy, sw, sh, 0, 0, size, size);

        this.magCtx.strokeStyle = '#ef4444';
        this.magCtx.lineWidth = 1;
        this.magCtx.beginPath();
        this.magCtx.moveTo(size / 2, 0); this.magCtx.lineTo(size / 2, size);
        this.magCtx.moveTo(0, size / 2); this.magCtx.lineTo(size, size / 2);
        this.magCtx.stroke();

        if (this.snappedPoint) {
            this.magCtx.strokeStyle = '#10b981';
            this.magCtx.lineWidth = 2;
            this.magCtx.beginPath();
            this.magCtx.arc(size / 2, size / 2, 10, 0, Math.PI * 2);
            this.magCtx.stroke();
        }
    }

    // --- Events ---
    initEvents() {
        const getPos = (e) => {
            const rect = this.canvas.getBoundingClientRect();
            return {
                x: (e.clientX - rect.left) / this.zoom,
                y: (e.clientY - rect.top) / this.zoom,
            };
        };

        this.canvas.addEventListener('contextmenu', (e) => {
            if (this.isDrawing) { e.preventDefault(); this._finishDrawingGracefully(); }
        });

        this.canvas.addEventListener('pointerdown', (e) => {
            if (!e.isPrimary) return;
            const pos = getPos(e);

            // Pan-Modus: Spacebar gedrückt oder Middle-Mouse
            if (this.spaceDown || e.button === 1 || this.currentTool === 'pan') {
                this.isPanning = true;
                this._panStart = { x: e.clientX, y: e.clientY };
                this._panScrollStart = this._getScrollParent();
                this.canvas.style.cursor = 'grabbing';
                e.preventDefault();
                return;
            }

            if (this.currentTool === 'select') {
                const hit = this._hitTest(pos);
                this.selectedId = hit ? hit.id : null;
                if (this.onSelectionChanged) this.onSelectionChanged(hit);
                this.redraw();
                return;
            }

            e.preventDefault();
            let p = pos;
            const snap = this.findSnapPoint(p);
            if (snap) p = { x: snap.x, y: snap.y };

            switch (this.currentTool) {
                case 'distance':
                case 'scale':
                    if (this.activePoints.length === 0) {
                        this.activePoints.push(p);
                        this.isDrawing = true;
                        this.canvas.setPointerCapture(e.pointerId);
                    } else {
                        this.activePoints.push(p);
                        this.finishMeasurement();
                        try { this.canvas.releasePointerCapture(e.pointerId); } catch {}
                    }
                    break;
                case 'perimeter':
                case 'area':
                    if (snap && snap.isStart && this.activePoints.length > 2) {
                        this.finishMeasurement();
                        return;
                    }
                    this.activePoints.push(p);
                    this.isDrawing = true;
                    this.canvas.setPointerCapture(e.pointerId);
                    break;
                case 'rectangle':
                case 'circle':
                    if (this.activePoints.length === 0) {
                        this.activePoints.push(p);
                        this.isDrawing = true;
                    } else {
                        this.activePoints.push(p);
                        this.finishMeasurement();
                    }
                    break;
                case 'count':
                    // Jeder Klick = neuer Zählpunkt - akkumuliert in einer Count-Messung,
                    // die per Tool-Wechsel abgeschlossen wird.
                    this._addCountPoint(p);
                    break;
                case 'text':
                    this._promptText(p);
                    break;
            }
            this.redraw();
            this.updateMagnifier(p);
        });

        this.canvas.addEventListener('pointermove', (e) => {
            const pos = getPos(e);

            if (this.isPanning) {
                const parent = this._getScrollParent();
                if (parent) {
                    const dx = e.clientX - this._panStart.x;
                    const dy = e.clientY - this._panStart.y;
                    parent.scrollLeft = this._panScrollStart.scrollLeft - dx;
                    parent.scrollTop = this._panScrollStart.scrollTop - dy;
                }
                return;
            }

            if (this.currentTool === 'select') {
                const hit = this._hitTest(pos);
                this.hoverId = hit ? hit.id : null;
                this.canvas.style.cursor = hit ? 'pointer' : 'default';
                this.redraw();
                return;
            }

            let p = pos;
            const snap = this.findSnapPoint(p);
            if (snap) { this.snappedPoint = { x: snap.x, y: snap.y }; p = this.snappedPoint; }
            else this.snappedPoint = null;

            this.previewEndPos = p;
            this.redraw(p);
            this.updateMagnifier(p);

            if (this.onStatusUpdate) this.onStatusUpdate({ x: p.x, y: p.y });
        });

        const endPan = () => {
            if (this.isPanning) {
                this.isPanning = false;
                this.canvas.style.cursor = this.spaceDown ? 'grab' : (this.currentTool === 'pan' ? 'grab' : (this.currentTool === 'select' ? 'default' : 'crosshair'));
            }
        };

        const hideMag = () => this.magnifier.classList.add('hidden');
        this.canvas.addEventListener('pointerup', () => { endPan(); hideMag(); });
        this.canvas.addEventListener('pointercancel', () => { endPan(); hideMag(); });
        this.canvas.addEventListener('pointerleave', hideMag);

        window.addEventListener('keydown', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

            if (e.code === 'Space' && !this.spaceDown) {
                this.spaceDown = true;
                this.canvas.style.cursor = 'grab';
                e.preventDefault();
            }

            if (e.key === 'Enter' && this.isDrawing && this.activePoints.length > 1
                && ['area', 'perimeter'].includes(this.currentTool)) {
                this.finishMeasurement();
            }
            if (e.key === 'Escape') {
                this.activePoints = [];
                this.isDrawing = false;
                this.selectedId = null;
                this.redraw();
                hideMag();
            }
            if (e.key === 'Delete' || e.key === 'Backspace') {
                if (this.selectedId) {
                    this.store.deleteMeasurement(this.selectedId);
                    this.selectedId = null;
                    this.redraw();
                    e.preventDefault();
                    return;
                }
            }
            if ((e.key.toLowerCase() === 'z' && (e.ctrlKey || e.metaKey))) {
                e.preventDefault();
                this.undoLastPoint();
            }
        });

        window.addEventListener('keyup', (e) => {
            if (e.code === 'Space') {
                this.spaceDown = false;
                if (!this.isPanning) {
                    this.canvas.style.cursor = this.currentTool === 'select' ? 'default'
                        : this.currentTool === 'pan' ? 'grab' : 'crosshair';
                }
            }
        });
    }

    _getScrollParent() {
        let el = this.canvas.parentElement;
        while (el) {
            const style = getComputedStyle(el);
            if (/auto|scroll/.test(style.overflow + style.overflowX + style.overflowY)) return el;
            el = el.parentElement;
        }
        return null;
    }

    _finishDrawingGracefully() {
        if (this.currentTool === 'area' && this.activePoints.length >= 3) {
            this.finishMeasurement();
        } else if (this.currentTool === 'perimeter' && this.activePoints.length >= 2) {
            this.finishMeasurement();
        } else {
            this.activePoints = [];
            this.isDrawing = false;
            this.redraw();
        }
    }

    _promptText(pos) {
        const txt = prompt('Notiztext:');
        if (!txt) return;
        const floor = this.store.getActiveFloor();
        if (!floor) return;
        const layer = this.store.project.activeLayerId;
        this.store.addMeasurement({
            id: `m-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            type: 'text',
            points: [pos],
            value: 0,
            unit: '',
            color: this.currentColor,
            strokeWidth: this.currentStrokeWidth,
            name: txt,
            text: txt,
            pageIndex: floor.currentPageIndex,
            floorId: floor.id,
            layerId: layer,
        });
        this.redraw();
    }

    _activeCountId = null;
    _addCountPoint(pos) {
        const floor = this.store.getActiveFloor();
        if (!floor) return;
        const layer = this.store.project.activeLayerId;

        // Existierende aktive Count-Messung auf dieser Seite suchen, sonst neu
        let existing = floor.measurements.find(m => m.id === this._activeCountId);
        if (!existing || existing.pageIndex !== floor.currentPageIndex) {
            existing = {
                id: `m-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                type: 'count',
                points: [],
                value: 0,
                unit: 'Stk.',
                color: this.currentColor,
                strokeWidth: this.currentStrokeWidth,
                name: `Zählung ${floor.measurements.filter(m => m.type === 'count').length + 1}`,
                pageIndex: floor.currentPageIndex,
                floorId: floor.id,
                layerId: layer,
            };
            this.store.addMeasurement(existing);
            this._activeCountId = existing.id;
        }
        existing.points.push(pos);
        existing.value = existing.points.length;
        this.store.notify('measurements:changed');
        this.redraw();
    }

    finishMeasurement() {
        if (this.currentTool === 'scale') {
            this.isDrawing = false;
            this.magnifier.classList.add('hidden');
            if (this.onScaleRequested) this.onScaleRequested();
            return;
        }
        const floor = this.store.getActiveFloor();
        if (!floor) return;
        const sf = floor.scale.factor;
        const unit = floor.scale.unit;
        const layer = this.store.project.activeLayerId;

        const type = this.currentTool;
        const baseName = (() => {
            const count = floor.measurements.filter(m => m.type === type).length + 1;
            return ({
                distance: 'Distanz',
                perimeter: 'Umfang',
                area: 'Fläche',
                rectangle: 'Rechteck',
                circle: 'Kreis',
            })[type] + ' ' + count;
        })();

        const m = {
            id: `m-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            type,
            points: [...this.activePoints],
            value: 0,
            unit: type === 'area' || type === 'rectangle' || type === 'circle' ? `${unit}²` : unit,
            color: this.currentColor,
            strokeWidth: this.currentStrokeWidth,
            name: baseName,
            pageIndex: floor.currentPageIndex,
            floorId: floor.id,
            layerId: layer,
        };
        this._recalcMeasurement(m, sf, unit);
        this.store.addMeasurement(m);

        this.activePoints = [];
        this.isDrawing = false;
        this.previewEndPos = null;
        this.magnifier.classList.add('hidden');
        this.redraw();
    }

    // --- Hit Testing ---
    _hitTest(pos) {
        const floor = this.store.getActiveFloor();
        if (!floor) return null;
        const tol = 6; // px
        const pageMs = floor.measurements.filter(m => m.pageIndex === floor.currentPageIndex);
        // Umgekehrt: zuletzt gezeichnete zuerst
        for (let i = pageMs.length - 1; i >= 0; i--) {
            const m = pageMs[i];
            const layer = this.store.getLayer(m.layerId);
            if (layer && !layer.visible) continue;
            if (this._hitMeasurement(m, pos, tol)) return m;
        }
        return null;
    }

    _hitMeasurement(m, pos, tol) {
        switch (m.type) {
            case 'distance':
                return distancePointToSegment(pos, m.points[0], m.points[1]) <= tol;
            case 'perimeter': {
                for (let i = 0; i < m.points.length - 1; i++) {
                    if (distancePointToSegment(pos, m.points[i], m.points[i + 1]) <= tol) return true;
                }
                return false;
            }
            case 'area':
                return pointInPolygon(pos, m.points);
            case 'rectangle': {
                const b = rectangleBounds(m.points[0], m.points[1]);
                return pos.x >= b.x - tol && pos.x <= b.x + b.width + tol
                    && pos.y >= b.y - tol && pos.y <= b.y + b.height + tol;
            }
            case 'circle': {
                const r = calculateDistance(m.points[0], m.points[1]);
                return Math.abs(calculateDistance(pos, m.points[0]) - r) <= tol
                    || calculateDistance(pos, m.points[0]) <= r;
            }
            case 'count': {
                for (const p of m.points) {
                    if (calculateDistance(pos, p) <= 10) return true;
                }
                return false;
            }
            case 'text':
                return calculateDistance(pos, m.points[0]) <= 20;
        }
        return false;
    }

    _findMeasurement(id) {
        const floor = this.store.getActiveFloor();
        if (!floor) return null;
        return floor.measurements.find(m => m.id === id) || null;
    }

    // --- Drawing ---
    redraw(previewPos = null) {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        const floor = this.store.getActiveFloor();
        if (!floor) return;

        const pageMs = floor.measurements.filter(m => m.pageIndex === floor.currentPageIndex);
        for (const m of pageMs) {
            const layer = this.store.getLayer(m.layerId);
            if (layer && !layer.visible) continue;
            this._drawMeasurement(m, m.id === this.selectedId, m.id === this.hoverId);
        }

        if (this.activePoints.length > 0) {
            const pts = [...this.activePoints];
            if (previewPos) pts.push(previewPos);
            this._drawActive(pts);
        }

        if (this.snappedPoint) {
            this.ctx.beginPath();
            this.ctx.arc(this.snappedPoint.x, this.snappedPoint.y, 6, 0, Math.PI * 2);
            this.ctx.fillStyle = 'rgba(16,185,129,0.7)';
            this.ctx.fill();
            this.ctx.strokeStyle = 'white';
            this.ctx.lineWidth = 2;
            this.ctx.stroke();
        }
    }

    _hexToRgba(hex, alpha) {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return `rgba(${r},${g},${b},${alpha})`;
    }

    _drawMeasurement(m, selected, hovered) {
        const color = m.color || '#3b82f6';
        const fill = this._hexToRgba(color, selected ? 0.3 : 0.18);
        const strokeW = (m.strokeWidth || 2) * (selected ? 1.5 : 1);

        this.ctx.strokeStyle = color;
        this.ctx.fillStyle = fill;
        this.ctx.lineWidth = strokeW;

        switch (m.type) {
            case 'distance': {
                this._strokeLine(m.points);
                this._drawEndpoints(m.points, color);
                this._drawLabel(m.points[1], `${m.name}: ${formatNumber(m.value)} ${m.unit}`, color);
                break;
            }
            case 'perimeter': {
                this._strokeLine(m.points);
                this._drawEndpoints(m.points, color);
                this._drawLabel(m.points[m.points.length - 1], `${m.name}: ${formatNumber(m.value)} ${m.unit}`, color);
                break;
            }
            case 'area': {
                this._strokePoly(m.points, true);
                this._drawEndpoints(m.points, color);
                const c = this._centroid(m.points);
                this._drawLabel(c, `${m.name}: ${formatNumber(m.value)} ${m.unit}`, color, true);
                break;
            }
            case 'rectangle': {
                const b = rectangleBounds(m.points[0], m.points[1]);
                this.ctx.beginPath();
                this.ctx.rect(b.x, b.y, b.width, b.height);
                this.ctx.fill(); this.ctx.stroke();
                this._drawLabel({ x: b.x + b.width / 2, y: b.y + b.height / 2 },
                    `${m.name}: ${formatNumber(m.value)} ${m.unit}`, color, true);
                break;
            }
            case 'circle': {
                const r = calculateDistance(m.points[0], m.points[1]);
                this.ctx.beginPath();
                this.ctx.arc(m.points[0].x, m.points[0].y, r, 0, Math.PI * 2);
                this.ctx.fill(); this.ctx.stroke();
                this._drawLabel(m.points[0], `${m.name}: ${formatNumber(m.value)} ${m.unit}`, color, true);
                break;
            }
            case 'count': {
                m.points.forEach((p, i) => {
                    this.ctx.beginPath();
                    this.ctx.arc(p.x, p.y, 10, 0, Math.PI * 2);
                    this.ctx.fillStyle = this._hexToRgba(color, 0.25);
                    this.ctx.strokeStyle = color;
                    this.ctx.lineWidth = 2;
                    this.ctx.fill(); this.ctx.stroke();
                    this.ctx.fillStyle = color;
                    this.ctx.font = 'bold 11px Inter, sans-serif';
                    this.ctx.textAlign = 'center';
                    this.ctx.textBaseline = 'middle';
                    this.ctx.fillText(String(i + 1), p.x, p.y);
                    this.ctx.textAlign = 'start';
                    this.ctx.textBaseline = 'alphabetic';
                });
                if (m.points.length > 0) {
                    const last = m.points[m.points.length - 1];
                    this._drawLabel(last, `${m.name}: ${m.points.length} Stk.`, color);
                }
                break;
            }
            case 'text': {
                const p = m.points[0];
                this.ctx.fillStyle = color;
                this.ctx.beginPath();
                this.ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
                this.ctx.fill();
                this._drawLabel(p, m.text || m.name, color);
                break;
            }
        }

        if (selected) this._drawSelectionHandles(m);
    }

    _drawActive(pts) {
        const color = this.currentColor;
        const fill = this._hexToRgba(color, 0.2);
        this.ctx.strokeStyle = color;
        this.ctx.fillStyle = fill;
        this.ctx.lineWidth = this.currentStrokeWidth;
        this.ctx.setLineDash([6, 4]);

        switch (this.currentTool) {
            case 'rectangle':
                if (pts.length >= 2) {
                    const b = rectangleBounds(pts[0], pts[pts.length - 1]);
                    this.ctx.beginPath();
                    this.ctx.rect(b.x, b.y, b.width, b.height);
                    this.ctx.fill(); this.ctx.stroke();
                }
                break;
            case 'circle':
                if (pts.length >= 2) {
                    const r = calculateDistance(pts[0], pts[pts.length - 1]);
                    this.ctx.beginPath();
                    this.ctx.arc(pts[0].x, pts[0].y, r, 0, Math.PI * 2);
                    this.ctx.fill(); this.ctx.stroke();
                }
                break;
            case 'area':
                this._strokePoly(pts, true);
                break;
            default:
                this._strokeLine(pts);
        }
        this.ctx.setLineDash([]);
        this._drawEndpoints(pts, color);
    }

    _strokeLine(points) {
        if (points.length < 2) return;
        this.ctx.beginPath();
        this.ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) this.ctx.lineTo(points[i].x, points[i].y);
        this.ctx.stroke();
    }

    _strokePoly(points, fill) {
        if (points.length < 2) return;
        this.ctx.beginPath();
        this.ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) this.ctx.lineTo(points[i].x, points[i].y);
        if (fill) { this.ctx.closePath(); this.ctx.fill(); }
        this.ctx.stroke();
    }

    _drawEndpoints(points, color) {
        this.ctx.fillStyle = '#fff';
        this.ctx.strokeStyle = color;
        this.ctx.lineWidth = 1.5;
        for (const p of points) {
            this.ctx.beginPath();
            this.ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
            this.ctx.fill(); this.ctx.stroke();
        }
    }

    _centroid(points) {
        let x = 0, y = 0;
        for (const p of points) { x += p.x; y += p.y; }
        return { x: x / points.length, y: y / points.length };
    }

    _drawLabel(pos, text, bgColor, centered = false) {
        this.ctx.font = this.currentFont;
        const padX = 7, padY = 4;
        const metrics = this.ctx.measureText(text);
        const w = metrics.width + padX * 2;
        const h = 20;
        const x = centered ? pos.x - w / 2 : pos.x + 10;
        const y = centered ? pos.y - h / 2 : pos.y + 10;

        this.ctx.fillStyle = bgColor;
        this._roundedRect(x, y, w, h, 4);
        this.ctx.fill();
        this.ctx.fillStyle = '#fff';
        this.ctx.textBaseline = 'middle';
        this.ctx.fillText(text, x + padX, y + h / 2);
        this.ctx.textBaseline = 'alphabetic';
    }

    _roundedRect(x, y, w, h, r) {
        this.ctx.beginPath();
        this.ctx.moveTo(x + r, y);
        this.ctx.lineTo(x + w - r, y);
        this.ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        this.ctx.lineTo(x + w, y + h - r);
        this.ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        this.ctx.lineTo(x + r, y + h);
        this.ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        this.ctx.lineTo(x, y + r);
        this.ctx.quadraticCurveTo(x, y, x + r, y);
        this.ctx.closePath();
    }

    _drawSelectionHandles(m) {
        const bb = boundingBox(m.type === 'rectangle' ? [
            m.points[0],
            m.points[1],
            { x: m.points[0].x, y: m.points[1].y },
            { x: m.points[1].x, y: m.points[0].y },
        ] : m.points);

        this.ctx.save();
        this.ctx.setLineDash([4, 3]);
        this.ctx.strokeStyle = '#2563eb';
        this.ctx.lineWidth = 1;
        this.ctx.strokeRect(bb.x - 4, bb.y - 4, bb.w + 8, bb.h + 8);
        this.ctx.setLineDash([]);
        this.ctx.restore();
    }
}
