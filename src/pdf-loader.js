// Kapselt PDF.js Logik
export class PDFLoader {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.currentPdf = null;
        this.currentPage = null;
        this.currentPageNum = 1;
        this.totalPageCount = 0;
        this.scale = 1.5; // Basis-Zoom
    }

    get currentScale() {
        return this.scale;
    }

    async loadFile(file) {
        const arrayBuffer = await file.arrayBuffer();
        const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
        this.currentPdf = await loadingTask.promise;
        this.totalPageCount = this.currentPdf.numPages;
        this.currentPageNum = 1;
        return this.renderPage(1);
    }

    async renderPage(pageNumber) {
        if (!this.currentPdf) return;

        this.currentPageNum = pageNumber;
        this.currentPage = await this.currentPdf.getPage(pageNumber);
        
        const viewport = this.currentPage.getViewport({ scale: this.scale });
        
        // Canvas anpassen
        this.canvas.width = viewport.width;
        this.canvas.height = viewport.height;
        this.canvas.style.width = `${viewport.width}px`;
        this.canvas.style.height = `${viewport.height}px`;

        const renderContext = {
            canvasContext: this.ctx,
            viewport: viewport
        };

        await this.currentPage.render(renderContext).promise;
        
        return { 
            width: viewport.width, 
            height: viewport.height,
            pageNum: pageNumber,
            totalPages: this.totalPageCount 
        };
    }

    async nextPage() {
        if (this.currentPageNum >= this.totalPageCount) return null;
        return this.renderPage(this.currentPageNum + 1);
    }

    async prevPage() {
        if (this.currentPageNum <= 1) return null;
        return this.renderPage(this.currentPageNum - 1);
    }
}
