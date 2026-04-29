// PDF-Loader mit Multi-Dokument-Fähigkeit (pro Etage ein PDF) und Zoom.

export class PDFLoader {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.pdfCache = new Map(); // floorId -> { pdf, pageCount, arrayBuffer }
        this.currentFloorId = null;
        this.currentPdf = null;
        this.currentPageNum = 1;
        this.renderScale = 1.5;   // Basis Render-Auflösung
        this.userZoom = 1.0;      // User-Zoom (CSS-Skalierung)
        this._lastViewport = null;
        this.currentUserUnit = 1; // PDF /UserUnit der aktiven Page (default 1.0)
    }

    get effectiveScale() {
        return this.renderScale; // Render immer in voller Auflösung, Zoom = CSS
    }

    async loadFloorPdf(floorId, file) {
        const arrayBuffer = await file.arrayBuffer();
        // Bytes behalten, um sie mit dem Projekt speichern zu können
        const bytes = new Uint8Array(arrayBuffer).slice(0);
        const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
        const pdf = await loadingTask.promise;
        this.pdfCache.set(floorId, { pdf, pageCount: pdf.numPages, bytes, fileName: file.name });
        return { pageCount: pdf.numPages, fileName: file.name, bytes };
    }

    async loadFloorPdfFromBase64(floorId, base64, fileName = 'stored.pdf') {
        if (this.pdfCache.has(floorId)) return this.pdfCache.get(floorId);
        const bytes = base64ToUint8(base64);
        const loadingTask = pdfjsLib.getDocument({ data: bytes });
        const pdf = await loadingTask.promise;
        this.pdfCache.set(floorId, { pdf, pageCount: pdf.numPages, bytes, fileName });
        return this.pdfCache.get(floorId);
    }

    hasPdf(floorId) {
        return this.pdfCache.has(floorId);
    }

    // /UserUnit der Page lesen, ohne den aktiven Floor zu wechseln.
    async getUserUnit(floorId, pageNumber = 1) {
        const entry = this.pdfCache.get(floorId);
        if (!entry) return 1;
        try {
            const page = await entry.pdf.getPage(pageNumber);
            return page.userUnit || 1;
        } catch {
            return 1;
        }
    }

    async setActiveFloor(floorId) {
        this.currentFloorId = floorId;
        const entry = this.pdfCache.get(floorId);
        this.currentPdf = entry ? entry.pdf : null;
    }

    async renderPage(pageNumber, userZoom = null) {
        if (!this.currentPdf) {
            this.clear();
            return null;
        }
        this.currentPageNum = pageNumber;
        if (userZoom !== null) this.userZoom = userZoom;

        const page = await this.currentPdf.getPage(pageNumber);
        const viewport = page.getViewport({ scale: this.renderScale });
        // PDF /UserUnit (default 1) wird in viewport-Pixeln bereits multipliziert.
        // Wir merken sie uns für die Massstab-Berechnung (Meter pro Backing-Store-Pixel).
        this.currentUserUnit = page.userUnit || 1;

        // Backing Store in voller Auflösung (scharfer Render)
        this.canvas.width = viewport.width;
        this.canvas.height = viewport.height;

        // CSS-Größe für Zoom (Retina-freundlich)
        const cssW = viewport.width * this.userZoom;
        const cssH = viewport.height * this.userZoom;
        this.canvas.style.width = `${cssW}px`;
        this.canvas.style.height = `${cssH}px`;

        await page.render({ canvasContext: this.ctx, viewport }).promise;
        this._lastViewport = viewport;

        return {
            width: viewport.width,
            height: viewport.height,
            cssWidth: cssW,
            cssHeight: cssH,
            pageNum: pageNumber,
            totalPages: this.pdfCache.get(this.currentFloorId)?.pageCount || 1,
            userUnit: this.currentUserUnit,
        };
    }

    setUserZoom(zoom) {
        this.userZoom = zoom;
        if (this._lastViewport) {
            this.canvas.style.width = `${this._lastViewport.width * zoom}px`;
            this.canvas.style.height = `${this._lastViewport.height * zoom}px`;
        }
    }

    clear() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.canvas.width = 0;
        this.canvas.height = 0;
        this._lastViewport = null;
    }

    async renderThumbnail(floorId, pageNumber, targetWidth = 160) {
        const entry = this.pdfCache.get(floorId);
        if (!entry) return null;
        const page = await entry.pdf.getPage(pageNumber);
        const base = page.getViewport({ scale: 1 });
        const scale = targetWidth / base.width;
        const vp = page.getViewport({ scale });
        const c = document.createElement('canvas');
        c.width = vp.width; c.height = vp.height;
        await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
        return c.toDataURL('image/png');
    }

    getBase64(floorId) {
        const entry = this.pdfCache.get(floorId);
        if (!entry) return null;
        return uint8ToBase64(entry.bytes);
    }
}

// --- Base64 Helpers ---
function uint8ToBase64(bytes) {
    let binary = '';
    const len = bytes.byteLength;
    const chunk = 0x8000;
    for (let i = 0; i < len; i += chunk) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
}

function base64ToUint8(base64) {
    const binary = atob(base64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}
