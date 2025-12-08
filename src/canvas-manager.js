// Verwaltet das Zeichen-Canvas und die Werkzeuge
import { calculateDistance, calculatePolygonArea, formatNumber } from './geometry.js';

export class CanvasManager {
    constructor(overlayId, pdfCanvasId) {
        this.canvas = document.getElementById(overlayId);
        this.ctx = this.canvas.getContext('2d');
        this.pdfCanvas = document.getElementById(pdfCanvasId);
        
        // Lupe Canvas erstellen
        this.magnifier = document.createElement('canvas');
        this.magnifier.width = 150;
        this.magnifier.height = 150;
        this.magnifier.classList.add('magnifier', 'hidden');
        document.body.appendChild(this.magnifier);
        this.magCtx = this.magnifier.getContext('2d');

        // Status
        this.measurements = []; // Array von { id, type, points, value, unit, color, name, pageIndex }
        this.currentTool = 'none';
        this.activePoints = []; 
        this.isDrawing = false;
        
        // Settings
        this.scaleFactor = 1.0; 
        this.unit = 'px';
        this.currentColor = '#007bff';
        this.currentPageIndex = 1;

        // Snapping
        this.snapThreshold = 15; // Pixel Radius
        this.snappedPoint = null;

        // Callbacks
        this.onMeasurementAdded = null;
        this.onScaleRequested = null; 
        this.onMeasurementsUpdated = null; 

        this.initEvents();
    }

    setPage(pageIndex) {
        this.currentPageIndex = pageIndex;
        this.activePoints = [];
        this.isDrawing = false;
        this.redraw();
    }

    setColor(color) {
        this.currentColor = color;
    }

    resize(width, height) {
        this.canvas.width = width;
        this.canvas.height = height;
        this.canvas.style.width = `${width}px`;
        this.canvas.style.height = `${height}px`;
        this.redraw();
    }

    setTool(tool) {
        this.currentTool = tool;
        this.activePoints = [];
        this.isDrawing = false;
        
        if (tool === 'none') {
            this.canvas.style.cursor = 'default';
        } else {
            this.canvas.style.cursor = 'crosshair';
        }
        this.redraw();
    }

    undoLastPoint() {
        if (this.isDrawing && this.activePoints.length > 0) {
            this.activePoints.pop();
            if (this.activePoints.length === 0) {
                this.isDrawing = false;
            }
            this.redraw();
        }
    }

    setScale(realDistance, unitName) {
        if (this.activePoints.length !== 2) return;
        const p1 = this.activePoints[0];
        const p2 = this.activePoints[1];
        const pixelDist = calculateDistance(p1, p2);
        
        this.scaleFactor = realDistance / pixelDist;
        this.unit = unitName;
        this.activePoints = []; 
        this.setTool('none'); 
        this.recalculateAll();
    }

    setScaleByRatio(denominator, renderScale) {
        const metersPerPixelOnPaper = (1 / renderScale) * (1 / 72) * 0.0254;
        this.scaleFactor = metersPerPixelOnPaper * denominator;
        this.unit = 'm'; 
        this.activePoints = [];
        this.setTool('none');
        this.recalculateAll();
    }

    recalculateAll() {
        this.measurements.forEach(m => {
            if (m.type === 'distance') {
                const pxDist = calculateDistance(m.points[0], m.points[1]);
                m.value = pxDist * this.scaleFactor;
            } else if (m.type === 'area') {
                const pxArea = calculatePolygonArea(m.points);
                m.value = pxArea * (this.scaleFactor * this.scaleFactor);
            }
            m.unit = m.type === 'area' ? `${this.unit}²` : this.unit;
        });
        if (this.onMeasurementsUpdated) this.onMeasurementsUpdated(this.measurements);
        this.redraw();
    }

    clearAll() {
        // Löscht nur Messungen der aktuellen Seite oder alle? 
        // User Erwartung "Alles löschen" -> Alles weg.
        this.measurements = [];
        this.activePoints = [];
        this.redraw();
        if (this.onMeasurementsUpdated) this.onMeasurementsUpdated(this.measurements);
    }

    deleteMeasurement(index) {
        // Index bezieht sich auf das gesamte Array, das muss in der UI beachtet werden
        this.measurements.splice(index, 1);
        this.redraw();
        if (this.onMeasurementsUpdated) this.onMeasurementsUpdated(this.measurements);
    }

    updateMeasurementName(index, newName) {
        if (this.measurements[index]) {
            this.measurements[index].name = newName;
        }
    }

    // --- Snapping Logic ---
    findSnapPoint(pos) {
        // Nur snappen, wenn wir zeichnen
        // Suche in allen Messungen der aktuellen Seite
        const currentMeasurements = this.measurements.filter(m => m.pageIndex === this.currentPageIndex);
        
        for (let m of currentMeasurements) {
            for (let p of m.points) {
                const dist = calculateDistance(pos, p);
                if (dist < this.snapThreshold) {
                    return { x: p.x, y: p.y };
                }
            }
        }
        
        // Auch an Startpunkt der aktuellen Zeichnung snappen (Polygon schließen)
        if (this.activePoints.length > 2) {
            const start = this.activePoints[0];
            if (calculateDistance(pos, start) < this.snapThreshold) {
                return { x: start.x, y: start.y, isStart: true };
            }
        }
        
        return null;
    }

    // --- Magnifier Logic ---
    updateMagnifier(pos) {
        if (this.currentTool === 'none') {
            this.magnifier.classList.add('hidden');
            return;
        }

        this.magnifier.classList.remove('hidden');
        
        // Positioniere Lupe versetzt zum Finger (damit man nicht verdeckt)
        // Globalen Offset berechnen
        const rect = this.canvas.getBoundingClientRect();
        const globalX = rect.left + pos.x;
        const globalY = rect.top + pos.y;
        
        this.magnifier.style.left = `${globalX - 75}px`; // Zentriert horizontal
        this.magnifier.style.top = `${globalY - 180}px`; // Darüber

        // Inhalt rendern: Kopiere PDF Canvas + Drawing Canvas
        this.magCtx.clearRect(0, 0, 150, 150);
        this.magCtx.fillStyle = 'white';
        this.magCtx.fillRect(0,0,150,150);

        // Zoom Level der Lupe (2x)
        const zoom = 2;
        
        // Source Koordinaten (um den Cursor herum)
        const sx = pos.x - (75 / zoom);
        const sy = pos.y - (75 / zoom);
        const sw = 150 / zoom;
        const sh = 150 / zoom;

        // PDF Layer zeichnen
        this.magCtx.drawImage(this.pdfCanvas, sx, sy, sw, sh, 0, 0, 150, 150);
        // Drawing Layer zeichnen (ohne Cursor)
        this.magCtx.drawImage(this.canvas, sx, sy, sw, sh, 0, 0, 150, 150);

        // Fadenkreuz in Lupe
        this.magCtx.strokeStyle = 'red';
        this.magCtx.lineWidth = 1;
        this.magCtx.beginPath();
        this.magCtx.moveTo(75, 0); this.magCtx.lineTo(75, 150);
        this.magCtx.moveTo(0, 75); this.magCtx.lineTo(150, 75);
        this.magCtx.stroke();
        
        // Snap Indikator in Lupe
        if (this.snappedPoint) {
            this.magCtx.strokeStyle = '#00ff00';
            this.magCtx.lineWidth = 2;
            this.magCtx.beginPath();
            this.magCtx.arc(75, 75, 10, 0, Math.PI*2);
            this.magCtx.stroke();
        }
    }

    initEvents() {
        const getPos = (e) => {
            const rect = this.canvas.getBoundingClientRect();
            return {
                x: e.clientX - rect.left,
                y: e.clientY - rect.top
            };
        };

        this.canvas.addEventListener('pointerdown', (e) => {
            if (!e.isPrimary) return;
            if (this.currentTool === 'none') return;
            
            e.preventDefault(); 
            let pos = getPos(e);
            
            // Apply Snap
            const snap = this.findSnapPoint(pos);
            if (snap) {
                pos = { x: snap.x, y: snap.y };
            }

            if (this.currentTool === 'distance' || this.currentTool === 'scale') {
                if (this.activePoints.length === 0) {
                    this.activePoints.push(pos);
                    this.isDrawing = true;
                    this.canvas.setPointerCapture(e.pointerId);
                } else {
                    this.activePoints.push(pos);
                    this.finishMeasurement();
                    this.canvas.releasePointerCapture(e.pointerId);
                }
            } else if (this.currentTool === 'area') {
                // Polygon Schließen Check (via Snap flag)
                if (snap && snap.isStart && this.activePoints.length > 2) {
                    this.finishMeasurement();
                    return;
                }
                
                this.activePoints.push(pos);
                this.isDrawing = true;
                this.canvas.setPointerCapture(e.pointerId);
            }
            this.redraw();
            this.updateMagnifier(pos);
        });

        this.canvas.addEventListener('pointermove', (e) => {
            if (this.currentTool === 'none') return;
            // e.preventDefault(); // Kann Scrollen blockieren, nur wenn drawing? 
            // Besser nur preventDefault wenn isDrawing oder tool active
            
            let pos = getPos(e);
            
            // Snap Logic Check
            const snap = this.findSnapPoint(pos);
            if (snap) {
                this.snappedPoint = { x: snap.x, y: snap.y };
                pos = this.snappedPoint;
            } else {
                this.snappedPoint = null;
            }

            if (this.isDrawing) {
                this.redraw(pos);
            } else {
                // Auch ohne Drawing Snapping zeigen
                this.redraw(); // Redraw cursor/snap indicator
            }
            
            this.updateMagnifier(pos);
        });

        this.canvas.addEventListener('pointerup', (e) => {
            // Magnifier ausblenden wenn Stift weg? Oder lassen?
            // Bei Touch verschwindet PointerUp oft.
            // Wir verstecken Lupe, wenn tool none ist oder pointerleave.
        });
        
        this.canvas.addEventListener('pointerleave', () => {
             this.magnifier.classList.add('hidden');
        });

        window.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && this.isDrawing) {
                if (this.currentTool === 'area' && this.activePoints.length > 2) {
                    this.finishMeasurement();
                }
            }
            if (e.key === 'Escape' && this.isDrawing) {
                this.activePoints = [];
                this.isDrawing = false;
                this.redraw();
            }
            // Undo mit Z (oder Backspace?)
            if ((e.key === 'z' && (e.ctrlKey || e.metaKey)) || e.key === 'Backspace') {
                this.undoLastPoint();
            }
        });
    }

    finishMeasurement() {
        if (this.currentTool === 'scale') {
            this.isDrawing = false;
            if (this.onScaleRequested) this.onScaleRequested();
            return; 
        }

        let value = 0;
        let type = this.currentTool;

        if (this.currentTool === 'distance') {
            const pxDist = calculateDistance(this.activePoints[0], this.activePoints[1]);
            value = pxDist * this.scaleFactor;
        } else if (this.currentTool === 'area') {
            const pxArea = calculatePolygonArea(this.activePoints);
            value = pxArea * (this.scaleFactor * this.scaleFactor);
        }

        const count = this.measurements.filter(m => m.type === type).length + 1;
        const name = type === 'area' ? `Fläche ${count}` : `Distanz ${count}`;

        this.measurements.push({
            id: Date.now(),
            type: type,
            points: [...this.activePoints],
            value: value,
            unit: type === 'area' ? `${this.unit}²` : this.unit,
            color: this.currentColor,
            name: name,
            pageIndex: this.currentPageIndex // Seite speichern
        });

        this.activePoints = [];
        this.isDrawing = false;
        this.redraw();

        if (this.onMeasurementsUpdated) this.onMeasurementsUpdated(this.measurements);
    }

    redraw(previewPos = null) {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        // 1. Gespeicherte Messungen (NUR AKTUELLE SEITE)
        const pageMeasurements = this.measurements.filter(m => m.pageIndex === this.currentPageIndex);
        
        pageMeasurements.forEach(m => {
            const color = m.color || '#007bff';
            const r = parseInt(color.slice(1, 3), 16);
            const g = parseInt(color.slice(3, 5), 16);
            const b = parseInt(color.slice(5, 7), 16);
            const fillStyle = `rgba(${r}, ${g}, ${b}, 0.2)`;

            this.drawShape(m.points, m.type === 'area', fillStyle, color);
            const center = m.points[m.points.length - 1]; 
            this.drawLabel(center, `${formatNumber(m.value)} ${m.unit}`, color);
        });

        // 2. Aktive Zeichnung
        if (this.activePoints.length > 0) {
            const pointsToDraw = [...this.activePoints];
            if (previewPos) pointsToDraw.push(previewPos);

            const isArea = this.currentTool === 'area';
            const color = this.currentColor;
            const r = parseInt(color.slice(1, 3), 16);
            const g = parseInt(color.slice(3, 5), 16);
            const b = parseInt(color.slice(5, 7), 16);

            this.drawShape(pointsToDraw, isArea, `rgba(${r},${g},${b}, 0.2)`, color);
        }
        
        // 3. Snap Indikator
        if (this.snappedPoint) {
             this.ctx.beginPath();
             this.ctx.arc(this.snappedPoint.x, this.snappedPoint.y, 6, 0, Math.PI * 2);
             this.ctx.fillStyle = 'rgba(0, 255, 0, 0.5)';
             this.ctx.fill();
             this.ctx.strokeStyle = 'white';
             this.ctx.lineWidth = 2;
             this.ctx.stroke();
        }
    }

    drawShape(points, fill, fillColor, strokeColor) {
        if (points.length === 0) return;

        this.ctx.beginPath();
        this.ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) {
            this.ctx.lineTo(points[i].x, points[i].y);
        }
        
        if (fill) {
            this.ctx.closePath();
            this.ctx.fillStyle = fillColor;
            this.ctx.fill();
        }
        
        this.ctx.strokeStyle = strokeColor;
        this.ctx.lineWidth = 2;
        this.ctx.stroke();

        this.ctx.fillStyle = strokeColor;
        points.forEach(p => {
            this.ctx.beginPath();
            this.ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
            this.ctx.fill();
        });
    }

    drawLabel(pos, text, bgColor) {
        this.ctx.font = 'bold 12px Inter, sans-serif';
        const padding = 6;
        const textWidth = this.ctx.measureText(text).width;
        
        this.ctx.fillStyle = bgColor;
        this.ctx.fillRect(pos.x + 10, pos.y + 10, textWidth + (padding*2), 24);
        
        this.ctx.fillStyle = 'white';
        this.ctx.fillText(text, pos.x + 10 + padding, pos.y + 10 + 16);
    }
}
