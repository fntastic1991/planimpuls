import { PDFLoader } from './pdf-loader.js';
import { CanvasManager } from './canvas-manager.js';
import { ExportManager } from './export-manager.js';
import { formatNumber } from './geometry.js';

document.addEventListener('DOMContentLoaded', () => {
    const pdfLoader = new PDFLoader('pdf-render');
    const canvasManager = new CanvasManager('drawing-layer', 'pdf-render');
    const exportManager = new ExportManager([]);

    // --- UI Elements ---
    const fileInput = document.getElementById('file-input');
    const toolBtns = document.querySelectorAll('.dock-item'); 
    const clearBtn = document.getElementById('clear-measurements');
    const measurementList = document.getElementById('measurement-list');
    const emptyState = document.getElementById('empty-state');
    
    // Scale UI
    const scaleTrigger = document.getElementById('scale-trigger');
    const scalePopover = document.getElementById('scale-popover');
    const currentScaleBadge = document.getElementById('current-scale-badge');
    const ratioInput = document.getElementById('scale-ratio-input');
    const applyRatioBtn = document.getElementById('apply-ratio-btn');
    const manualScaleInputs = document.getElementById('manual-scale-inputs');
    const confirmScaleBtn = document.getElementById('confirm-scale');
    
    // Export UI
    const exportTriggerBtn = document.getElementById('export-trigger-btn');
    const exportModal = document.getElementById('export-modal');
    const closeExportModalBtn = document.getElementById('close-export-modal');
    const btnExportPdf = document.getElementById('btn-export-pdf');
    const btnExportCsv = document.getElementById('btn-export-csv');
    const summaryDist = document.getElementById('summary-dist');
    const summaryArea = document.getElementById('summary-area');
    
    // Page UI
    const pageControls = document.getElementById('page-controls');
    const prevPageBtn = document.getElementById('prev-page');
    const nextPageBtn = document.getElementById('next-page');
    const pageIndicator = document.getElementById('page-indicator');
    const undoGroup = document.getElementById('undo-group');
    const undoBtn = document.getElementById('undo-btn');

    // Save/Load UI
    const saveBtn = document.getElementById('save-btn');
    const importBtn = document.getElementById('import-btn');
    const importInput = document.getElementById('import-json');

    // --- Initialization ---

    // Init Color
    const colorInput = document.getElementById('stroke-color');
    canvasManager.setColor(colorInput.value);

    // Toggle Scale Popover
    scaleTrigger.addEventListener('click', (e) => {
        scalePopover.classList.toggle('hidden');
        e.stopPropagation();
    });
    
    // Toggle Export Modal
    exportTriggerBtn.addEventListener('click', () => {
        updateExportSummary();
        exportModal.classList.remove('hidden');
    });

    closeExportModalBtn.addEventListener('click', () => {
        exportModal.classList.add('hidden');
    });

    // Close popovers when clicking outside
    document.addEventListener('click', (e) => {
        if (!scalePopover.contains(e.target) && !scaleTrigger.contains(e.target)) {
            scalePopover.classList.add('hidden');
        }
        if (e.target === exportModal) {
            exportModal.classList.add('hidden');
        }
    });

    colorInput.addEventListener('input', (e) => {
        canvasManager.setColor(e.target.value);
    });
    
    fileInput.addEventListener('change', async (e) => {
        if (e.target.files.length > 0) {
            try {
                const dimensions = await pdfLoader.loadFile(e.target.files[0]);
                canvasManager.resize(dimensions.width, dimensions.height);
                canvasManager.setPage(1); // Reset
                canvasManager.clearAll(); 
                
                // Pagination UI
                if (dimensions.totalPages > 1) {
                    pageControls.style.display = 'flex';
                    pageIndicator.textContent = `1 / ${dimensions.totalPages}`;
                } else {
                    pageControls.style.display = 'none';
                }
            } catch (err) {
                console.error(err);
                alert("Fehler beim Laden der PDF.");
            }
        }
    });

    // --- Page Navigation ---
    async function changePage(dir) {
        let result;
        if (dir === 'next') result = await pdfLoader.nextPage();
        else result = await pdfLoader.prevPage();

        if (result) {
            canvasManager.resize(result.width, result.height);
            canvasManager.setPage(result.pageNum);
            pageIndicator.textContent = `${result.pageNum} / ${result.totalPages}`;
        }
    }

    nextPageBtn.addEventListener('click', () => changePage('next'));
    prevPageBtn.addEventListener('click', () => changePage('prev'));

    // --- Tool Selection ---
    toolBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            // Spezial-Buttons ignorieren (die haben zwar .dock-item, aber kein data-tool)
            if (!btn.dataset.tool) return;

            // Remove active class from all TOOLS only
            document.querySelectorAll('[data-tool]').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            const tool = btn.dataset.tool;
            canvasManager.setTool(tool);
            
            // Undo Btn Visibility
            if (tool !== 'none') {
                undoGroup.classList.remove('hidden');
            } else {
                undoGroup.classList.add('hidden');
            }
            
            // Handle Scale Tool specifically
            if (tool === 'scale') {
                scalePopover.classList.remove('hidden');
                document.querySelector('.scale-option:last-child').classList.add('active-manual');
            } else {
                document.querySelector('.scale-option:last-child').classList.remove('active-manual');
            }
        });
    });

    undoBtn.addEventListener('click', () => {
        canvasManager.undoLastPoint();
    });

    // --- Actions ---

    // Export Logic
    function updateExportSummary() {
        exportManager.updateMeasurements(canvasManager.measurements);
        const summary = exportManager.getSummary();
        summaryDist.textContent = `${formatNumber(summary.totalDistance)} ${summary.unitDist}`;
        summaryArea.textContent = `${formatNumber(summary.totalArea)} ${summary.unitArea}`;
    }

    btnExportPdf.addEventListener('click', () => {
        exportManager.exportToPDF();
    });

    btnExportCsv.addEventListener('click', () => {
        exportManager.exportToCSV();
    });

    // Save Project (JSON)
    saveBtn.addEventListener('click', () => {
        if (canvasManager.measurements.length === 0) {
            alert("Keine Messungen zum Speichern.");
            return;
        }
        const data = {
            version: "1.0",
            date: new Date().toISOString(),
            scaleFactor: canvasManager.scaleFactor,
            unit: canvasManager.unit,
            measurements: canvasManager.measurements
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `planimpuls-messungen-${new Date().toLocaleDateString('de-CH')}.json`;
        a.click();
    });

    // Import Project
    importBtn.addEventListener('click', () => importInput.click());
    
    importInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const data = JSON.parse(event.target.result);
                if (data.measurements && Array.isArray(data.measurements)) {
                    if (data.scaleFactor) {
                        canvasManager.scaleFactor = data.scaleFactor;
                        canvasManager.unit = data.unit || 'm';
                        currentScaleBadge.textContent = `Geladen (${data.unit})`;
                    }
                    canvasManager.measurements = data.measurements;
                    canvasManager.redraw();
                    canvasManager.onMeasurementsUpdated(canvasManager.measurements);
                }
            } catch (err) {
                console.error(err);
                alert("Fehler beim Laden der Projektdatei.");
            }
        };
        reader.readAsText(file);
        e.target.value = '';
    });

    clearBtn.addEventListener('click', () => {
        if(confirm("Alle Messungen unwiderruflich löschen?")) {
            canvasManager.clearAll();
        }
    });

    // Callbacks from CanvasManager
    canvasManager.onMeasurementsUpdated = (measurements) => {
        updateMeasurementList(measurements);
    };

    canvasManager.onScaleRequested = () => {
        scalePopover.classList.remove('hidden');
        document.querySelector('.scale-option:last-child').classList.add('active-manual');
        document.getElementById('real-distance-input').focus();
    };

    // Confirm Manual Scale
    confirmScaleBtn.addEventListener('click', () => {
        const input = document.getElementById('real-distance-input');
        const unitSelect = document.getElementById('unit-select');
        const dist = parseFloat(input.value);
        
        if (dist && dist > 0) {
            canvasManager.setScale(dist, unitSelect.value);
            scalePopover.classList.add('hidden');
            currentScaleBadge.textContent = `Kalibriert (${canvasManager.unit})`;
            document.querySelector('[data-tool="none"]').click();
        } else {
            alert("Bitte eine gültige Distanz eingeben.");
        }
    });

    // Confirm Ratio Scale (1:50)
    applyRatioBtn.addEventListener('click', () => {
        const ratio = parseFloat(ratioInput.value);
        if (ratio && ratio > 0) {
            const renderScale = pdfLoader.currentScale;
            canvasManager.setScaleByRatio(ratio, renderScale);
            currentScaleBadge.textContent = `1:${ratio} (m)`;
            scalePopover.classList.add('hidden');
        } else {
            alert("Bitte einen gültigen Massstab eingeben (z.B. 50 für 1:50)");
        }
    });

    // --- Render List ---
    function updateMeasurementList(measurements) {
        measurementList.innerHTML = '';
        
        // Filter: Nur Messungen der aktuellen Seite anzeigen? 
        // Aktuell ist measurements ALLE Messungen. Wir sollten vielleicht filtern oder kennzeichnen.
        // Aber die Liste zeigt üblicherweise alle an. 
        // Optional: Seiten-Badge anzeigen.
        
        if (!measurements || measurements.length === 0) {
            emptyState.style.display = 'block';
            return;
        }
        emptyState.style.display = 'none';

        measurements.forEach((m, index) => {
            const li = document.createElement('li');
            li.className = 'measurement-item';
            
            // Seite anzeigen wenn > 1
            const pageInfo = m.pageIndex > 1 ? `<span style="font-size:0.7em; color:#999; margin-left:4px;">(S.${m.pageIndex})</span>` : '';

            li.innerHTML = `
                <div class="m-left">
                    <div class="m-color-dot" style="background-color: ${m.color}"></div>
                    <input type="text" 
                           class="m-name-input" 
                           value="${m.name}" 
                           data-index="${index}"
                           aria-label="Name ändern">
                    ${pageInfo}
                </div>
                <div class="m-right" style="display:flex; align-items:center; gap:8px;">
                    <div class="m-value">${formatNumber(m.value)} ${m.unit}</div>
                    <button class="icon-btn danger delete-single-btn" data-index="${index}" title="Löschen" style="padding:2px;">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                    </button>
                </div>
            `;
            
            measurementList.appendChild(li);
        });

        document.querySelectorAll('.m-name-input').forEach(input => {
            input.addEventListener('change', (e) => {
                const idx = parseInt(e.target.dataset.index);
                canvasManager.updateMeasurementName(idx, e.target.value);
            });
            input.addEventListener('click', (e) => e.stopPropagation());
        });

        document.querySelectorAll('.delete-single-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const idx = parseInt(btn.dataset.index);
                canvasManager.deleteMeasurement(idx);
            });
        });
    }
});
