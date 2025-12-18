import { PDFLoader } from './pdf-loader.js';
import { CanvasManager } from './canvas-manager.js';
import { ExportManager } from './export-manager.js';
import { formatNumber } from './geometry.js';

document.addEventListener('DOMContentLoaded', () => {
    const TYPE_CONFIG = {
        distance: { label: 'Distanz', color: '#3b82f6' },   // Blau (Default)
        perimeter: { label: 'Umfang', color: '#f59e0b' },   // Orange (Default)
        area: { label: 'Fläche', color: '#10b981' }         // Grün (Default)
    };
    const formatIntCH = (num) => new Intl.NumberFormat('de-CH', { maximumFractionDigits: 0 }).format(num);

    const pdfLoader = new PDFLoader('pdf-render');
    const canvasManager = new CanvasManager('drawing-layer', 'pdf-render');
    const exportManager = new ExportManager([]);

    // --- UI Elements ---
    const fileInput = document.getElementById('file-input');
    // New: Tool Buttons in Sidebar have class 'tool-icon'
    const toolBtns = document.querySelectorAll('.tool-icon'); 
    
    // Bottom Panel Elements
    const measurementListTbody = document.getElementById('measurement-list');
    const measurementEmptyState = document.getElementById('empty-state');
    const clearBtn = document.getElementById('clear-measurements');

    // Scale UI
    const scaleTrigger = document.getElementById('scale-trigger');
    const scaleChoiceModal = document.getElementById('scale-choice-modal');
    const closeChoiceModalBtn = document.getElementById('close-choice-modal');
    const choiceKnown = document.getElementById('choice-known');
    const choiceMeasure = document.getElementById('choice-measure');
    const scaleInputView = document.getElementById('scale-input-view');
    const manualRatioInput = document.getElementById('manual-ratio-input');
    const saveRatioBtn = document.getElementById('save-ratio-btn');
    const backToChoiceBtn = document.getElementById('back-to-choice');
    const currentScaleBadge = document.getElementById('current-scale-badge');

    // Calibration Overlay UI
    const calibrationOverlay = document.getElementById('calibration-overlay');
    const calibLengthInput = document.getElementById('calib-length');
    const calibUnitSelect = document.getElementById('calib-unit');
    const calibSaveBtn = document.getElementById('calib-save');
    const calibCancelBtn = document.getElementById('calib-cancel');
    
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

    // Init Color
    const colorInput = document.getElementById('stroke-color');
    canvasManager.setColor(colorInput.value);

    // Empty State & Canvas Toggle
    const appRoot = document.getElementById('app-root');
    const canvasStage = document.getElementById('canvas-stage');
    const appEmptyState = document.getElementById('app-empty-state');
    const canvasContainer = document.getElementById('canvas-container');
    const bigOpenBtn = document.getElementById('big-open-btn');

    // Live Summary UI
    const bottomTabsEl = document.getElementById('bottom-panel-tabs');
    const panelTabContents = document.querySelectorAll('.panel-tab-content[data-tab-content]');
    const panelActionsList = document.querySelector('[data-actions="list"]');
    const panelActionsSummary = document.querySelector('[data-actions="summary"]');
    const summaryScopeEl = document.getElementById('summary-scope');
    const liveTotalDistance = document.getElementById('live-total-distance');
    const liveTotalPerimeter = document.getElementById('live-total-perimeter');
    const liveTotalArea = document.getElementById('live-total-area');
    const liveSummaryMeta = document.getElementById('live-summary-meta');
    document.getElementById('dot-distance').style.background = canvasManager.typeColors.distance;
    document.getElementById('dot-perimeter').style.background = canvasManager.typeColors.perimeter;
    document.getElementById('dot-area').style.background = canvasManager.typeColors.area;
    let summaryScope = 'page'; // 'page' | 'all'
    let bottomPanelTab = 'list'; // 'list' | 'summary'

    // --- Event Listeners ---

    // --- Scale Workflow ---

    // 1. Open Choice Modal
    scaleTrigger.addEventListener('click', (e) => {
        scaleChoiceModal.classList.remove('hidden');
        scaleInputView.classList.add('hidden'); // Reset view
        document.querySelector('.choice-body').classList.remove('hidden');
        e.stopPropagation();
    });

    closeChoiceModalBtn.addEventListener('click', () => {
        scaleChoiceModal.classList.add('hidden');
    });

    // Option A: Known Scale
    choiceKnown.addEventListener('click', () => {
        document.querySelector('.choice-body').classList.add('hidden');
        scaleInputView.classList.remove('hidden');
        manualRatioInput.focus();
    });

    backToChoiceBtn.addEventListener('click', () => {
        scaleInputView.classList.add('hidden');
        document.querySelector('.choice-body').classList.remove('hidden');
    });

    saveRatioBtn.addEventListener('click', () => {
        const ratio = parseFloat(manualRatioInput.value);
        if (ratio && ratio > 0) {
            const renderScale = pdfLoader.currentScale;
            canvasManager.setScaleByRatio(ratio, renderScale);
            currentScaleBadge.textContent = `1:${formatIntCH(Math.round(ratio))} (m)`;
            scaleChoiceModal.classList.add('hidden');
        } else {
            alert("Bitte einen gültigen Massstab eingeben (z.B. 50)");
        }
    });

    // Option B: Measure Reference
    choiceMeasure.addEventListener('click', () => {
        scaleChoiceModal.classList.add('hidden');
        // Activate Scale Tool directly
        document.querySelector('[data-tool="scale"]').click();
    });

    // 2. Handle Scale Tool Activation
    // (Already handled in toolBtns listener, just ensure it triggers guided mode)

    // 3. After Drawing Reference -> Show Calibration Overlay
    canvasManager.onScaleRequested = () => {
        calibrationOverlay.classList.remove('hidden');
        calibLengthInput.value = ''; // Reset
        calibLengthInput.focus();
    };

    // 4. Save Calibration
    calibSaveBtn.addEventListener('click', () => {
        const dist = parseFloat(calibLengthInput.value);
        if (dist && dist > 0) {
            const calibration = canvasManager.setScaleFromReference(dist, calibUnitSelect.value, pdfLoader.currentScale);
            calibrationOverlay.classList.add('hidden');
            
            if (calibration && calibration.ratio && calibration.ratio > 0) {
                const denom = Math.round(calibration.ratio);
                currentScaleBadge.textContent = `1:${formatIntCH(denom)} (${canvasManager.unit})`;
            } else {
                currentScaleBadge.textContent = `Kalibriert (${canvasManager.unit})`;
            }
            // Switch back to Select tool
            document.querySelector('[data-tool="none"]').click();
        } else {
            alert("Bitte eine gültige Länge eingeben.");
        }
    });

    calibCancelBtn.addEventListener('click', () => {
        calibrationOverlay.classList.add('hidden');
        canvasManager.activePoints = []; // Reset incomplete drawing
        canvasManager.isDrawing = false;
        canvasManager.redraw();
        document.querySelector('[data-tool="none"]').click();
    });

    // Close Modals on Outside Click
    document.addEventListener('click', (e) => {
        if (e.target === scaleChoiceModal) scaleChoiceModal.classList.add('hidden');
        // Note: Calibration Overlay forces interaction (modal), so no outside click close ideally, 
        // or treat same as cancel.
    });


    colorInput.addEventListener('input', (e) => {
        // Farbe pro Typ speichern (damit Distanz/Umfang/Fläche immer unterscheidbar bleiben)
        const tool = canvasManager.currentTool;
        if (TYPE_CONFIG[tool]) {
            canvasManager.setTypeColor(tool, e.target.value);
            // Dots in der Zusammenfassung mitziehen
            const dotId = tool === 'distance' ? 'dot-distance' : (tool === 'perimeter' ? 'dot-perimeter' : 'dot-area');
            const dot = document.getElementById(dotId);
            if (dot) dot.style.background = e.target.value;
        } else {
            canvasManager.setColor(e.target.value);
        }
    });

    // Bottom Tabs (Messungen / Zusammenfassung)
    function setBottomPanelTab(tab) {
        bottomPanelTab = tab;
        if (bottomTabsEl) {
            bottomTabsEl.querySelectorAll('button[data-tab]').forEach(b => {
                const isActive = b.dataset.tab === tab;
                b.classList.toggle('active', isActive);
                b.setAttribute('aria-selected', isActive ? 'true' : 'false');
            });
        }
        panelTabContents.forEach(el => {
            el.classList.toggle('hidden', el.dataset.tabContent !== tab);
        });
        if (panelActionsList) panelActionsList.classList.toggle('hidden', tab !== 'list');
        if (panelActionsSummary) panelActionsSummary.classList.toggle('hidden', tab !== 'summary');

        try { localStorage.setItem('pi_bottomTab', tab); } catch {}
        if (tab === 'summary') updateLiveSummary(canvasManager.measurements);
    }

    if (bottomTabsEl) {
        bottomTabsEl.addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-tab]');
            if (!btn) return;
            setBottomPanelTab(btn.dataset.tab);
        });
        // Restore last tab
        try {
            const saved = localStorage.getItem('pi_bottomTab');
            if (saved === 'summary' || saved === 'list') setBottomPanelTab(saved);
            else setBottomPanelTab('list');
        } catch {
            setBottomPanelTab('list');
        }
    }
    
    async function loadPdfFile(file) {
        const dimensions = await pdfLoader.loadFile(file);

        // Switch View: Hide Empty State, Show Canvas + enable layout
        if (appRoot) {
            appRoot.classList.remove('app-empty');
            appRoot.classList.add('app-loaded');
        }
        if (appEmptyState) appEmptyState.classList.add('hidden');
        if (canvasContainer) canvasContainer.classList.remove('hidden');

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
    }

    fileInput.addEventListener('change', async (e) => {
        if (e.target.files.length > 0) {
            try {
                await loadPdfFile(e.target.files[0]);
            } catch (err) {
                console.error(err);
                alert("Fehler beim Laden der PDF.");
            }
        }
    });

    // Big Open Button Trigger
    if(bigOpenBtn) {
        bigOpenBtn.addEventListener('click', () => {
            fileInput.click();
        });
    }

    // --- Page Navigation ---
    async function changePage(dir) {
        let result;
        if (dir === 'next') result = await pdfLoader.nextPage();
        else result = await pdfLoader.prevPage();

        if (result) {
            canvasManager.resize(result.width, result.height);
            canvasManager.setPage(result.pageNum);
            pageIndicator.textContent = `${result.pageNum} / ${result.totalPages}`;
            updateLiveSummary(canvasManager.measurements);
        }
    }

    nextPageBtn.addEventListener('click', () => changePage('next'));
    prevPageBtn.addEventListener('click', () => changePage('prev'));

    // --- Tool Selection ---
    toolBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            // Spezial-Buttons ignorieren (die haben zwar .tool-icon, aber evtl kein data-tool)
            if (!btn.dataset.tool) return;

            // Remove active class from all TOOLS only
            document.querySelectorAll('[data-tool]').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            const tool = btn.dataset.tool;
            canvasManager.setTool(tool);

            // Standard-Farben pro Messart (User kann danach via Picker anpassen)
            if (TYPE_CONFIG[tool]) {
                // Quelle der Wahrheit ist CanvasManager (setzt ebenfalls currentColor)
                colorInput.value = canvasManager.typeColors?.[tool] || TYPE_CONFIG[tool].color;
            }
            
            // Undo Btn Visibility
            if (tool !== 'none') {
                undoGroup.classList.remove('hidden');
            } else {
                undoGroup.classList.add('hidden');
            }
            
            // Handle Scale Tool specifically
            if (tool === 'scale') {
                // scalePopover logic removed, now handled by choice modal
            } else {
                // reset logic removed
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
        // "Total Länge" = Distanz + Umfang (für Export/Reporting)
        const unitLen = summary.distanceCount > 0
            ? summary.unitDist
            : (summary.perimeterCount > 0 ? summary.unitPerimeter : (canvasManager.unit || 'm'));
        summaryDist.textContent = `${formatNumber(summary.totalLength)} ${unitLen}`;
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
        if(confirm("ACHTUNG: Möchtest du wirklich ALLE Messungen aus der Liste löschen?")) {
            canvasManager.clearAll();
        }
    });

    // Callbacks from CanvasManager
    canvasManager.onMeasurementsUpdated = (measurements) => {
        updateMeasurementTable(measurements);
        updateLiveSummary(measurements);
    };

    // Live Summary Scope Toggle
    if (summaryScopeEl) {
        summaryScopeEl.addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-scope]');
            if (!btn) return;
            summaryScopeEl.querySelectorAll('button').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            summaryScope = btn.dataset.scope;
            updateLiveSummary(canvasManager.measurements);
        });
    }

    function updateLiveSummary(measurements) {
        const scopeMeasurements = (summaryScope === 'page')
            ? (measurements || []).filter(m => m.pageIndex === canvasManager.currentPageIndex)
            : (measurements || []);

        let totalDistance = 0;
        let totalPerimeter = 0;
        let totalArea = 0;
        scopeMeasurements.forEach(m => {
            if (m.type === 'distance') totalDistance += m.value;
            else if (m.type === 'perimeter') totalPerimeter += m.value;
            else if (m.type === 'area') totalArea += m.value;
        });

        const unit = canvasManager.unit || 'm';
        liveTotalDistance.textContent = `${formatNumber(totalDistance)} ${unit}`;
        liveTotalPerimeter.textContent = `${formatNumber(totalPerimeter)} ${unit}`;
        liveTotalArea.textContent = `${formatNumber(totalArea)} ${unit}²`;

        const scopeLabel = (summaryScope === 'page') ? `Seite ${canvasManager.currentPageIndex}` : 'Alle Seiten';
        liveSummaryMeta.textContent = `${scopeLabel} • ${scopeMeasurements.length} Messung(en)`;
    }

    // --- Render List as Table ---
    function updateMeasurementTable(measurements) {
        measurementListTbody.innerHTML = '';
        
        if (!measurements || measurements.length === 0) {
            measurementEmptyState.style.display = 'block';
            return;
        }
        measurementEmptyState.style.display = 'none';

        measurements.forEach((m, index) => {
            const tr = document.createElement('tr');
            
            // Formatierung Typ
            const typeLabel = TYPE_CONFIG[m.type]?.label || m.type;
            
            tr.innerHTML = `
                <td><span class="color-dot" style="background-color: ${m.color}"></span></td>
                <td>${typeLabel}</td>
                <td>
                    <input type="text" class="table-input" value="${m.name}" data-index="${index}" placeholder="Beschriftung">
                </td>
                <td><strong>${formatNumber(m.value)} ${m.unit}</strong></td>
                <td>${m.pageIndex}</td>
                <td style="text-align:center;">
                    <button class="btn-icon-table delete-single-btn" data-index="${index}" title="Löschen">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                    </button>
                </td>
            `;
            
            measurementListTbody.appendChild(tr);
        });

        // Event Listeners for Table Inputs
        document.querySelectorAll('.table-input').forEach(input => {
            // Touch-Focus Verbesserung für iPad
            input.addEventListener('touchend', (e) => {
                e.target.focus();
            });
            
            input.addEventListener('focus', (e) => {
                e.target.select(); // Auto-Select Text on focus
            });

            input.addEventListener('change', (e) => {
                const idx = parseInt(e.target.dataset.index);
                canvasManager.updateMeasurementName(idx, e.target.value);
            });
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
