import { ProjectStore, createFloor, createEmptyProject, ensureFloorScale } from './state.js';
import { PDFLoader } from './pdf-loader.js';
import { CanvasManager } from './canvas-manager.js';
import { ExportManager } from './export-manager.js';
import { saveProjectToFile, loadProjectFromFile } from './project-io.js';
import { formatNumber } from './geometry.js';

document.addEventListener('DOMContentLoaded', () => {

    // ====== Core ======
    const store = new ProjectStore();
    const pdfLoader = new PDFLoader('pdf-render');
    const canvasManager = new CanvasManager('drawing-layer', 'pdf-render', store);
    const exportManager = new ExportManager(store, pdfLoader);

    // ====== DOM refs ======
    const $ = (id) => document.getElementById(id);

    const ui = {
        // titlebar
        projectNameLabel: $('project-name-label'),
        btnSettings: $('btn-project-settings'),
        // ribbon
        btnNew: $('btn-new-project'),
        btnOpen: $('btn-open-project'),
        btnSave: $('btn-save-project'),
        fileProject: $('file-project'),
        btnAddFloor: $('btn-add-floor'),
        btnImportPdf: $('btn-import-pdf'),
        filePdf: $('file-pdf'),
        btnUndo: $('btn-undo'),
        btnDelete: $('btn-delete'),
        btnZoomIn: $('btn-zoom-in'),
        btnZoomOut: $('btn-zoom-out'),
        btnZoomFitW: $('btn-zoom-fit-width'),
        btnZoomFitP: $('btn-zoom-fit-page'),
        btnZoomDisplay: $('btn-zoom-display'),
        // scale
        scaleTrigger: $('scale-trigger'),
        scalePopover: $('scale-popover'),
        closeScale: $('close-scale-popover'),
        scaleBadge: $('current-scale-badge'),
        ratioInput: $('scale-ratio-input'),
        applyRatioBtn: $('apply-ratio-btn'),
        realDistance: $('real-distance-input'),
        unitSelect: $('unit-select'),
        confirmScale: $('confirm-scale'),
        // color / width
        colorInput: $('stroke-color'),
        // left side
        projectTree: $('project-tree'),
        thumbList: $('thumb-list'),
        btnAddFloorTree: $('btn-add-floor-tree'),
        layerList: $('layer-list'),
        btnAddLayer: $('btn-add-layer'),
        // right side
        propsEmpty: $('props-empty'),
        propsForm: $('props-form'),
        propName: $('prop-name'),
        propType: $('prop-type'),
        propValue: $('prop-value'),
        propColor: $('prop-color'),
        propLayer: $('prop-layer'),
        propWidth: $('prop-width'),
        propDelete: $('prop-delete'),
        sumLength: $('sum-length'),
        sumArea: $('sum-area'),
        sumPeri: $('sum-peri'),
        sumCount: $('sum-count'),
        // canvas + empty state
        emptyCanvas: $('empty-canvas'),
        emptyNewFloor: $('empty-new-floor'),
        emptyLoadPdf: $('empty-load-pdf'),
        canvasScroll: $('canvas-scroll'),
        // status
        statusTool: $('status-tool'),
        statusCoords: $('status-coords'),
        statusFloor: $('status-floor'),
        statusPage: $('status-page'),
        // bottom
        measurementList: $('measurement-list'),
        emptyState: $('empty-state'),
        btnClearFloor: $('btn-clear-floor'),
        btnTogglePanel: $('btn-toggle-panel'),
        bottomPanel: $('bottom-panel'),
        bpTabs: document.querySelectorAll('.bp-tab'),
        // settings
        settingsModal: $('settings-modal'),
        closeSettings: $('close-settings'),
        projName: $('proj-name'),
        projClient: $('proj-client'),
        projAddress: $('proj-address'),
        projDate: $('proj-date'),
        projFloorsCount: $('proj-floors-count'),
        settingsSave: $('settings-save'),
        // export modal
        exportModal: document.querySelector('#export-modal'),
        closeExportModal: $('close-export-modal'),
        expReport: $('exp-report'),
        expPlans: $('exp-plans'),
        expCsv: $('exp-csv'),
        summaryDist: $('summary-dist'),
        summaryArea: $('summary-area'),
        summaryCount: $('summary-count'),
        // progress
        progressOverlay: $('progress-overlay'),
        progressText: $('progress-text'),
    };

    // Tool buttons + width buttons
    const toolButtons = document.querySelectorAll('.tool-btn');
    const widthButtons = document.querySelectorAll('.width-btn');

    // Bottom tab state
    let bottomTab = 'current';

    // ====== Init color ======
    canvasManager.setColor(ui.colorInput.value);

    // ====== Helpers ======
    function showProgress(text = 'Bitte warten…') {
        ui.progressText.textContent = text;
        ui.progressOverlay.classList.remove('hidden');
    }
    function hideProgress() { ui.progressOverlay.classList.add('hidden'); }

    function getActiveFloor() { return store.getActiveFloor(); }

    function updateProjectNameLabel() {
        ui.projectNameLabel.textContent = store.project.name;
        document.title = `${store.project.name} — plan.impuls`;
    }

    // ====== Project Tree ======
    function renderProjectTree() {
        const p = store.project;
        ui.projectTree.innerHTML = '';
        if (!p.floors.length) {
            const div = document.createElement('div');
            div.className = 'tree-empty';
            div.textContent = 'Noch keine Etagen. Klicke „+“ um zu starten.';
            ui.projectTree.appendChild(div);
            return;
        }
        for (const f of p.floors) {
            const el = document.createElement('div');
            el.className = 'tree-floor' + (f.id === p.activeFloorId ? ' active' : '');
            el.innerHTML = `
                <span class="tf-icon">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="3" y="8" width="18" height="10" rx="1"/>
                        <line x1="3" y1="12" x2="21" y2="12"/>
                    </svg>
                </span>
                <span class="tf-name" data-id="${f.id}">${escapeHtml(f.name)}</span>
                <span class="tf-count">${f.measurements.length}</span>
                <button class="tf-del" data-del="${f.id}" title="Etage löschen">✕</button>
            `;
            el.querySelector('.tf-name').addEventListener('click', (e) => {
                e.stopPropagation();
                activateFloor(f.id);
            });
            el.querySelector('.tf-name').addEventListener('dblclick', (e) => {
                e.preventDefault();
                startRenameFloor(e.currentTarget, f.id);
            });
            el.querySelector('.tf-del').addEventListener('click', async (e) => {
                e.stopPropagation();
                if (!confirm(`Etage "${f.name}" inkl. aller Messungen löschen?`)) return;
                const wasActive = (store.project.activeFloorId === f.id);
                pdfLoader.pdfCache.delete(f.id);
                if (pdfLoader.currentFloorId === f.id) {
                    pdfLoader.currentFloorId = null;
                    pdfLoader.currentPdf = null;
                }
                store.removeFloor(f.id);
                // Wenn die aktive Etage gelöscht wurde: Canvas auf neuen Stand bringen.
                if (wasActive) {
                    const next = store.project.activeFloorId;
                    if (next) await activateFloor(next);
                    else clearCanvasArea();
                }
            });
            ui.projectTree.appendChild(el);
        }
    }

    function startRenameFloor(span, id) {
        span.contentEditable = 'true';
        span.focus();
        const range = document.createRange();
        range.selectNodeContents(span);
        const sel = window.getSelection();
        sel.removeAllRanges(); sel.addRange(range);
        const commit = () => {
            span.contentEditable = 'false';
            const v = span.textContent.trim() || 'Unbenannt';
            store.renameFloor(id, v);
        };
        span.addEventListener('blur', commit, { once: true });
        span.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); span.blur(); }
            if (e.key === 'Escape') { span.textContent = store.getFloor(id)?.name || ''; span.blur(); }
        });
    }

    // ====== Thumbnails ======
    async function renderThumbnails() {
        ui.thumbList.innerHTML = '';
        const floor = getActiveFloor();
        if (!floor || !pdfLoader.hasPdf(floor.id)) return;
        const entry = pdfLoader.pdfCache.get(floor.id);
        for (let p = 1; p <= entry.pageCount; p++) {
            const tn = document.createElement('div');
            tn.className = 'thumb' + (p === floor.currentPageIndex ? ' active' : '');
            tn.innerHTML = `
                <div class="thumb-img" style="width:100%;display:flex;justify-content:center;min-height:60px;align-items:center;">
                    <div class="spinner" style="width:20px;height:20px;border-width:2px;"></div>
                </div>
                <span class="tn-label">Seite ${p}</span>
            `;
            tn.addEventListener('click', () => activatePage(p));
            ui.thumbList.appendChild(tn);
            // Lazy render thumbnail
            pdfLoader.renderThumbnail(floor.id, p, 160).then(url => {
                if (url) {
                    const holder = tn.querySelector('.thumb-img');
                    holder.innerHTML = `<img src="${url}" alt="Seite ${p}">`;
                }
            }).catch(() => {});
        }
    }

    // ====== Layers ======
    function renderLayers() {
        ui.layerList.innerHTML = '';
        const active = store.project.activeLayerId;
        for (const l of store.project.layers) {
            const row = document.createElement('div');
            row.className = 'layer-row' + (l.id === active ? ' active' : '');
            row.innerHTML = `
                <label class="layer-dot" style="background:${l.color}" title="Farbe der Ebene ändern">
                    <input type="color" class="layer-color-input" value="${l.color}">
                </label>
                <span class="layer-name" title="Ebene aktivieren">${escapeHtml(l.name)}</span>
                <button class="layer-vis ${l.visible ? '' : 'off'}" title="Sichtbar">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        ${l.visible
                            ? '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>'
                            : '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>'}
                    </svg>
                </button>
                <button class="layer-del" title="Ebene löschen">✕</button>
            `;
            row.querySelector('.layer-name').addEventListener('click', () => {
                store.setActiveLayer(l.id);
            });
            row.querySelector('.layer-name').addEventListener('dblclick', () => {
                const newName = prompt('Ebene umbenennen:', l.name);
                if (newName && newName.trim()) store.updateLayer(l.id, { name: newName.trim() });
            });
            const colorInput = row.querySelector('.layer-color-input');
            colorInput.addEventListener('input', (e) => {
                store.updateLayer(l.id, { color: e.target.value });
            });
            colorInput.addEventListener('click', (e) => e.stopPropagation());
            row.querySelector('.layer-vis').addEventListener('click', (e) => {
                e.stopPropagation();
                store.updateLayer(l.id, { visible: !l.visible });
            });
            row.querySelector('.layer-del').addEventListener('click', (e) => {
                e.stopPropagation();
                if (store.project.layers.length === 1) return alert('Mindestens eine Ebene muss existieren.');
                if (confirm(`Ebene "${l.name}" löschen?`)) store.deleteLayer(l.id);
            });
            ui.layerList.appendChild(row);
        }
        // auch propLayer select updaten
        ui.propLayer.innerHTML = store.project.layers
            .map(l => `<option value="${l.id}">${escapeHtml(l.name)}</option>`).join('');
    }

    // ====== Measurement Table ======
    function renderTable() {
        const rows = bottomTab === 'current'
            ? (getActiveFloor()?.measurements.map(m => ({ ...m, _floorName: getActiveFloor().name })) || [])
            : store.allMeasurements();

        ui.measurementList.innerHTML = '';
        if (!rows.length) {
            ui.emptyState.style.display = 'block';
            return;
        }
        ui.emptyState.style.display = 'none';

        const layerMap = Object.fromEntries(store.project.layers.map(l => [l.id, l]));
        const typeLabels = { distance: 'Distanz', perimeter: 'Umfang', area: 'Fläche',
            rectangle: 'Rechteck', circle: 'Kreis', count: 'Zählung', text: 'Notiz' };

        rows.forEach((m, i) => {
            const tr = document.createElement('tr');
            if (m.id === canvasManager.selectedId) tr.classList.add('selected');
            const layer = layerMap[m.layerId];
            const dotColor = (layer && layer.color) || m.color || '#386e79';
            const valueStr = m.type === 'text' ? '—' : `${formatNumber(m.value)} ${m.unit}`;
            tr.innerHTML = `
                <td><span class="color-dot" style="background:${dotColor}"></span></td>
                <td>${typeLabels[m.type] || m.type}</td>
                <td><input type="text" class="table-input" value="${escapeAttr(m.name)}" data-id="${m.id}"></td>
                <td><strong>${valueStr}</strong></td>
                <td>${layer ? escapeHtml(layer.name) : '—'}</td>
                <td>${escapeHtml(m._floorName || '—')}</td>
                <td>${m.pageIndex}</td>
                <td><button class="btn-icon-table" data-del-id="${m.id}" title="Löschen">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                </button></td>
            `;
            tr.addEventListener('click', (e) => {
                if (e.target.closest('input') || e.target.closest('button')) return;
                // Auswahl aktivieren (nur für aktuelle Etage)
                if (bottomTab === 'current') canvasManager.selectMeasurement(m.id);
            });
            ui.measurementList.appendChild(tr);
        });

        ui.measurementList.querySelectorAll('.table-input').forEach(inp => {
            inp.addEventListener('change', () => {
                const id = inp.dataset.id;
                store.updateMeasurement(id, { name: inp.value });
            });
        });
        ui.measurementList.querySelectorAll('[data-del-id]').forEach(btn => {
            btn.addEventListener('click', () => {
                store.deleteMeasurement(btn.dataset.delId);
            });
        });
    }

    // ====== Summary ======
    function renderSummary() {
        const floor = getActiveFloor();
        if (!floor) {
            ui.sumLength.textContent = '0.00 m';
            ui.sumArea.textContent = '0.00 m²';
            ui.sumPeri.textContent = '0.00 m';
            ui.sumCount.textContent = '0 Stk.';
            return;
        }
        const s = exportManager.getFloorSummary(floor);
        ui.sumLength.textContent = `${formatNumber(s.totalLength)} ${s.unitLen}`;
        ui.sumArea.textContent = `${formatNumber(s.totalArea)} ${s.unitArea}`;
        ui.sumPeri.textContent = `${formatNumber(s.totalPerimeter)} ${s.unitLen}`;
        ui.sumCount.textContent = `${s.totalCount} Stk.`;
    }

    // ====== Properties ======
    function renderProperties(m) {
        if (!m) {
            ui.propsForm.classList.add('hidden');
            ui.propsEmpty.classList.remove('hidden');
            return;
        }
        ui.propsForm.classList.remove('hidden');
        ui.propsEmpty.classList.add('hidden');
        ui.propName.value = m.name;
        ui.propType.value = ({
            distance: 'Distanz', perimeter: 'Umfang', area: 'Fläche',
            rectangle: 'Rechteck', circle: 'Kreis', count: 'Zählung', text: 'Notiz',
        })[m.type] || m.type;
        ui.propValue.value = m.type === 'text' ? '—' : `${formatNumber(m.value)} ${m.unit}`;
        const layerForColor = store.getLayer(m.layerId);
        ui.propColor.value = (layerForColor && layerForColor.color) || m.color || '#386e79';
        ui.propLayer.value = m.layerId;
        ui.propWidth.value = String(m.strokeWidth || 2);
    }

    ui.propName.addEventListener('change', () => {
        if (!canvasManager.selectedId) return;
        store.updateMeasurement(canvasManager.selectedId, { name: ui.propName.value });
    });
    ui.propColor.addEventListener('input', () => {
        if (!canvasManager.selectedId) return;
        const m = getActiveFloor()?.measurements.find(x => x.id === canvasManager.selectedId);
        if (!m) return;
        // Farbe einer Ebene = Farbe aller Messungen darin: Layer-Farbe ändern.
        if (m.layerId) store.updateLayer(m.layerId, { color: ui.propColor.value });
    });
    ui.propLayer.addEventListener('change', () => {
        if (!canvasManager.selectedId) return;
        store.updateMeasurement(canvasManager.selectedId, { layerId: ui.propLayer.value });
    });
    ui.propWidth.addEventListener('change', () => {
        if (!canvasManager.selectedId) return;
        store.updateMeasurement(canvasManager.selectedId, { strokeWidth: +ui.propWidth.value });
    });
    ui.propDelete.addEventListener('click', () => {
        if (!canvasManager.selectedId) return;
        store.deleteMeasurement(canvasManager.selectedId);
        canvasManager.selectedId = null;
        renderProperties(null);
    });

    // ====== Activation ======
    async function activateFloor(floorId) {
        store.setActiveFloor(floorId);
        const floor = getActiveFloor();
        if (!floor) { clearCanvasArea(); return; }
        await pdfLoader.setActiveFloor(floor.id);
        if (pdfLoader.hasPdf(floor.id)) {
            const res = await pdfLoader.renderPage(floor.currentPageIndex, floor.viewState.zoom || 1);
            if (res) {
                canvasManager.resize(res.width, res.height);
                canvasManager.setZoom(floor.viewState.zoom || 1);
                canvasManager.redraw();
                ui.emptyCanvas.classList.add('hidden');
            }
        } else {
            clearCanvasArea();
        }
        updateScaleBadge();
        updateStatus();
    }

    async function activatePage(pageNum) {
        const floor = getActiveFloor();
        if (!floor) return;
        floor.currentPageIndex = pageNum;
        const res = await pdfLoader.renderPage(pageNum, canvasManager.zoom);
        if (res) {
            canvasManager.resize(res.width, res.height);
            canvasManager.redraw();
        }
        renderThumbnails();
        updateStatus();
    }

    function clearCanvasArea() {
        pdfLoader.clear();
        canvasManager.resize(0, 0);
        ui.emptyCanvas.classList.remove('hidden');
    }

    function updateScaleBadge() {
        const floor = getActiveFloor();
        if (!floor) { ui.scaleBadge.textContent = '—'; return; }
        if (floor.scale.ratio) ui.scaleBadge.textContent = `1:${floor.scale.ratio}`;
        else if (floor.scale.calibrated) ui.scaleBadge.textContent = `Kalibriert (${floor.scale.unit})`;
        else ui.scaleBadge.textContent = '1:50 (default)';
    }

    function updateStatus() {
        const floor = getActiveFloor();
        ui.statusFloor.textContent = floor ? floor.name : 'Keine Etage';
        if (floor && pdfLoader.hasPdf(floor.id)) {
            const entry = pdfLoader.pdfCache.get(floor.id);
            ui.statusPage.textContent = `Seite ${floor.currentPageIndex} / ${entry.pageCount}`;
        } else {
            ui.statusPage.textContent = '—';
        }
    }

    function setTool(tool) {
        canvasManager.setTool(tool);
        toolButtons.forEach(b => b.classList.toggle('active', b.dataset.tool === tool));
        const labels = {
            select: 'Auswählen', pan: 'Verschieben', scale: 'Massstab',
            distance: 'Distanz', perimeter: 'Polylinie', area: 'Fläche',
            rectangle: 'Rechteck', circle: 'Kreis', count: 'Zählen', text: 'Notiz',
        };
        ui.statusTool.textContent = `Tool: ${labels[tool] || tool}`;
    }

    // ====== Store subscription ======
    store.subscribe((project, event) => {
        if (event === 'project:replaced' || event === 'project:meta') {
            updateProjectNameLabel();
        }
        if (['floors:changed', 'floors:renamed', 'floor:activated', 'project:replaced'].includes(event)) {
            renderProjectTree();
            renderThumbnails();
            renderTable();
            renderSummary();
            updateStatus();
            updateScaleBadge();
        }
        if (event === 'measurements:changed' || event === 'project:replaced') {
            renderTable();
            renderSummary();
            renderProjectTree();
            canvasManager.redraw();
            if (canvasManager.selectedId) {
                const m = getActiveFloor()?.measurements.find(x => x.id === canvasManager.selectedId);
                renderProperties(m || null);
            }
        }
        if (event === 'layers:changed' || event === 'layer:activated') {
            renderLayers();
            renderTable();
            canvasManager.redraw();
        }
    });

    // ====== Canvas callbacks ======
    canvasManager.onSelectionChanged = (m) => renderProperties(m);
    canvasManager.onZoomChanged = (z) => {
        ui.btnZoomDisplay.textContent = `${Math.round(z * 100)}%`;
        const floor = getActiveFloor();
        if (floor) floor.viewState.zoom = z;
    };
    canvasManager.onScaleRequested = () => {
        ui.scalePopover.classList.remove('hidden');
        setTimeout(() => ui.realDistance.focus(), 50);
    };
    canvasManager.onStatusUpdate = ({ x, y }) => {
        ui.statusCoords.textContent = `X: ${Math.round(x)}  Y: ${Math.round(y)}`;
    };

    // ====== Event Bindings ======
    toolButtons.forEach(btn => {
        btn.addEventListener('click', () => setTool(btn.dataset.tool));
    });

    widthButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            widthButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            canvasManager.setStrokeWidth(+btn.dataset.w);
        });
    });

    ui.colorInput.addEventListener('input', (e) => canvasManager.setColor(e.target.value));

    // File ops
    ui.btnNew.addEventListener('click', () => {
        if (!confirm('Neues Projekt starten? Nicht gespeicherte Änderungen gehen verloren.')) return;
        store.setProject(createEmptyProject('Neues Projekt'));
        pdfLoader.pdfCache.clear();
        clearCanvasArea();
    });
    ui.btnOpen.addEventListener('click', () => ui.fileProject.click());
    ui.fileProject.addEventListener('change', async (e) => {
        if (!e.target.files[0]) return;
        try {
            showProgress('Projekt wird geladen…');
            await loadProjectFromFile(e.target.files[0], store, pdfLoader);
            // Migration: alte Projekte hatten einen Default-Faktor, der nicht mit
            // renderScale 1.5 übereinstimmt — nur unkalibrierte Etagen anpassen
            // und deren Messungen mit dem korrigierten Faktor neu berechnen.
            for (const floor of store.project.floors) {
                const prev = floor.scale.factor;
                const userUnit = pdfLoader.hasPdf(floor.id)
                    ? await pdfLoader.getUserUnit(floor.id, floor.currentPageIndex || 1)
                    : (floor.scale.userUnit || 1);
                ensureFloorScale(floor, pdfLoader.renderScale, userUnit);
                if (prev !== floor.scale.factor && floor.measurements.length) {
                    canvasManager.recalculateAll(floor);
                }
            }
            const first = store.project.floors[0];
            if (first) await activateFloor(first.id);
        } catch (err) {
            alert('Fehler: ' + err.message);
        } finally {
            hideProgress();
            e.target.value = '';
        }
    });
    ui.btnSave.addEventListener('click', async () => {
        try {
            showProgress('Projekt wird gespeichert…');
            await saveProjectToFile(store, pdfLoader);
        } finally { hideProgress(); }
    });

    // Floors
    const addFloor = async () => {
        const name = prompt('Name der neuen Etage:', `Etage ${store.project.floors.length + 1}`);
        if (!name) return;
        const f = createFloor(name);
        store.addFloor(f);
        store.setActiveFloor(f.id);
        // Direkt PDF-Dialog öffnen
        setTimeout(() => ui.filePdf.click(), 100);
    };
    ui.btnAddFloor.addEventListener('click', addFloor);
    ui.btnAddFloorTree.addEventListener('click', addFloor);
    ui.emptyNewFloor.addEventListener('click', addFloor);

    ui.btnImportPdf.addEventListener('click', () => {
        const f = getActiveFloor();
        if (!f) {
            addFloor();
            return;
        }
        ui.filePdf.click();
    });
    ui.emptyLoadPdf.addEventListener('click', () => ui.btnImportPdf.click());

    ui.filePdf.addEventListener('change', async (e) => {
        const file = e.target.files[0]; if (!file) return;
        let floor = getActiveFloor();
        if (!floor) {
            floor = createFloor(file.name.replace(/\.pdf$/i, ''));
            store.addFloor(floor);
            store.setActiveFloor(floor.id);
        }
        try {
            showProgress('PDF wird geladen…');
            const info = await pdfLoader.loadFloorPdf(floor.id, file);
            floor.pdfFileName = info.fileName;
            floor.pageCount = info.pageCount;
            floor.currentPageIndex = 1;
            // Default-Massstab anhand des effektiven renderScale UND PDF /UserUnit berechnen,
            // wenn noch nicht kalibriert wurde.
            const userUnit = await pdfLoader.getUserUnit(floor.id, 1);
            ensureFloorScale(floor, pdfLoader.renderScale, userUnit);
            await activateFloor(floor.id);
            renderProjectTree();
        } catch (err) {
            console.error(err);
            alert('Fehler beim Laden der PDF-Datei.');
        } finally {
            hideProgress();
            e.target.value = '';
        }
    });

    // Undo / Delete
    ui.btnUndo.addEventListener('click', () => canvasManager.undoLastPoint());
    ui.btnDelete.addEventListener('click', () => {
        if (canvasManager.selectedId) store.deleteMeasurement(canvasManager.selectedId);
    });

    // Zoom
    function zoomTo(z) { canvasManager.setZoom(z); }
    ui.btnZoomIn.addEventListener('click', () => zoomTo(canvasManager.zoom * 1.25));
    ui.btnZoomOut.addEventListener('click', () => zoomTo(canvasManager.zoom / 1.25));
    ui.btnZoomDisplay.addEventListener('click', () => zoomTo(1.0));
    ui.btnZoomFitW.addEventListener('click', () => {
        const floor = getActiveFloor();
        if (!floor || !canvasManager.canvas.width) return;
        const scrollRect = ui.canvasScroll.getBoundingClientRect();
        const z = (scrollRect.width - 48) / canvasManager.canvas.width;
        zoomTo(z);
    });
    ui.btnZoomFitP.addEventListener('click', () => {
        const floor = getActiveFloor();
        if (!floor || !canvasManager.canvas.width || !canvasManager.canvas.height) return;
        const r = ui.canvasScroll.getBoundingClientRect();
        const z = Math.min((r.width - 48) / canvasManager.canvas.width,
                           (r.height - 48) / canvasManager.canvas.height);
        zoomTo(z);
    });

    // Wheel zoom (Ctrl/Cmd)
    ui.canvasScroll.addEventListener('wheel', (e) => {
        if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            const delta = e.deltaY > 0 ? 0.9 : 1.1;
            zoomTo(canvasManager.zoom * delta);
        }
    }, { passive: false });

    // Scale popover
    ui.scaleTrigger.addEventListener('click', (e) => {
        e.stopPropagation();
        ui.scalePopover.classList.toggle('hidden');
        const f = getActiveFloor();
        if (f && f.scale.ratio) ui.ratioInput.value = f.scale.ratio;
    });
    function closeScalePopover({ resetTool = false } = {}) {
        ui.scalePopover.classList.add('hidden');
        if (resetTool && canvasManager.currentTool === 'scale') {
            canvasManager.activePoints = [];
            canvasManager.isDrawing = false;
            setTool('select');
        }
    }
    ui.closeScale.addEventListener('click', () => closeScalePopover({ resetTool: true }));
    document.addEventListener('click', (e) => {
        if (ui.scalePopover.classList.contains('hidden')) return;
        if (ui.scalePopover.contains(e.target)) return;
        if (ui.scaleTrigger.contains(e.target)) return;
        if (e.target.closest('[data-tool="scale"]')) return;
        // Während aktivem Massstab-Tool: Klicks auf den Plan setzen Punkte — Popover offen lassen.
        if (canvasManager.currentTool === 'scale') return;
        closeScalePopover();
    });
    function applyRatio() {
        const r = parseFloat(ui.ratioInput.value);
        if (!r || r <= 0) return alert('Bitte einen gültigen Massstab eingeben.');
        if (!getActiveFloor()) return alert('Bitte zuerst eine Etage anlegen / aktivieren.');
        canvasManager.setScaleByRatio(r, pdfLoader.renderScale, pdfLoader.currentUserUnit);
        updateScaleBadge();
        ui.scalePopover.classList.add('hidden');
    }
    function confirmManualScale() {
        const d = parseFloat(ui.realDistance.value);
        if (!d || d <= 0) return alert('Bitte gültige Länge eingeben.');
        if (canvasManager.activePoints.length !== 2) {
            return alert('Bitte zuerst zwei Punkte auf dem Plan setzen (Tool „Massstab kalibrieren“).');
        }
        // Eingabe ggf. auf Meter normieren — Faktor wird intern in der gewählten Einheit gespeichert,
        // alle Folgemessungen rechnen mit derselben Einheit.
        canvasManager.setScale(d, ui.unitSelect.value);
        updateScaleBadge();
        ui.scalePopover.classList.add('hidden');
        ui.realDistance.value = '';
    }
    ui.applyRatioBtn.addEventListener('click', applyRatio);
    ui.confirmScale.addEventListener('click', confirmManualScale);
    ui.ratioInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); applyRatio(); }
    });
    ui.realDistance.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); confirmManualScale(); }
    });

    // Layers
    const LAYER_PALETTE = [
        '#386e79', '#c65145', '#10b981', '#f59e0b',
        '#6366f1', '#ec4899', '#8b5cf6', '#0ea5e9',
        '#84cc16', '#f43f5e', '#14b8a6', '#a855f7',
    ];
    function nextLayerColor() {
        const used = new Set(store.project.layers.map(l => (l.color || '').toLowerCase()));
        const free = LAYER_PALETTE.find(c => !used.has(c.toLowerCase()));
        return free || LAYER_PALETTE[store.project.layers.length % LAYER_PALETTE.length];
    }
    ui.btnAddLayer.addEventListener('click', () => {
        const name = prompt('Name der neuen Ebene:');
        if (!name) return;
        store.addLayer({
            id: `layer-${Date.now()}`,
            name,
            color: nextLayerColor(),
            visible: true,
            locked: false,
        });
    });

    // Bottom panel tabs
    ui.bpTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            ui.bpTabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            bottomTab = tab.dataset.tab;
            renderTable();
        });
    });
    ui.btnClearFloor.addEventListener('click', () => {
        const f = getActiveFloor();
        if (!f || !f.measurements.length) return;
        if (confirm(`Alle Messungen der Etage "${f.name}" löschen?`)) {
            store.clearMeasurements(f.id);
        }
    });
    ui.btnTogglePanel.addEventListener('click', () => {
        ui.bottomPanel.classList.toggle('collapsed');
        ui.btnTogglePanel.textContent = ui.bottomPanel.classList.contains('collapsed') ? '▲' : '▼';
    });

    // Settings Modal
    ui.btnSettings.addEventListener('click', () => {
        const p = store.project;
        ui.projName.value = p.name;
        ui.projClient.value = p.client || '';
        ui.projAddress.value = p.address || '';
        ui.projDate.value = p.date ? new Date(p.date).toISOString().slice(0, 10) : '';
        ui.projFloorsCount.value = (p.floorsCountOverride != null) ? String(p.floorsCountOverride) : '';
        ui.settingsModal.classList.remove('hidden');
    });
    ui.closeSettings.addEventListener('click', () => ui.settingsModal.classList.add('hidden'));
    ui.settingsSave.addEventListener('click', () => {
        const raw = ui.projFloorsCount.value.trim();
        const override = raw === '' ? null : Math.max(0, parseInt(raw, 10) || 0);
        store.updateProjectMeta({
            name: ui.projName.value.trim() || 'Projekt',
            client: ui.projClient.value,
            address: ui.projAddress.value,
            date: ui.projDate.value ? new Date(ui.projDate.value).toISOString() : new Date().toISOString(),
            floorsCountOverride: override,
        });
        ui.settingsModal.classList.add('hidden');
    });

    // Export modal
    document.querySelectorAll('[data-menu="export"]').forEach(el => {
        el.addEventListener('click', openExportModal);
    });
    function openExportModal() {
        const s = exportManager.getProjectSummary();
        ui.summaryDist.textContent = `${formatNumber(s.totalLength)} ${s.unitLen}`;
        ui.summaryArea.textContent = `${formatNumber(s.totalArea)} ${s.unitArea}`;
        ui.summaryCount.textContent = `${s.totalCount}`;
        ui.exportModal.classList.remove('hidden');
    }
    ui.closeExportModal.addEventListener('click', () => ui.exportModal.classList.add('hidden'));

    ui.expReport.addEventListener('click', async () => {
        try {
            showProgress('Bericht wird erstellt…');
            await exportManager.exportReport();
        } catch (err) { console.error(err); alert('Export fehlgeschlagen: ' + err.message); }
        finally { hideProgress(); ui.exportModal.classList.add('hidden'); }
    });
    ui.expPlans.addEventListener('click', async () => {
        try {
            showProgress('Annotierte Pläne werden gerendert…');
            await exportManager.exportAnnotatedPlans();
        } catch (err) { console.error(err); alert('Export fehlgeschlagen: ' + err.message); }
        finally { hideProgress(); ui.exportModal.classList.add('hidden'); }
    });
    ui.expCsv.addEventListener('click', () => {
        exportManager.exportCSV();
        ui.exportModal.classList.add('hidden');
    });

    // Menu items (Datei / Ansicht)
    document.querySelector('[data-menu="file"]').addEventListener('click', () => ui.btnOpen.click());
    document.querySelector('[data-menu="edit"]').addEventListener('click', () => ui.btnSettings.click());
    document.querySelector('[data-menu="view"]').addEventListener('click', () => ui.btnZoomFitP.click());

    // Keyboard shortcuts
    window.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
        const k = e.key.toLowerCase();
        const ctrl = e.ctrlKey || e.metaKey;

        if (ctrl && k === 's') { e.preventDefault(); ui.btnSave.click(); return; }
        if (ctrl && k === 'o') { e.preventDefault(); ui.btnOpen.click(); return; }
        if (ctrl && k === 'n') { e.preventDefault(); ui.btnNew.click(); return; }
        if (ctrl && (k === '=' || k === '+')) { e.preventDefault(); ui.btnZoomIn.click(); return; }
        if (ctrl && k === '-') { e.preventDefault(); ui.btnZoomOut.click(); return; }
        if (ctrl && k === '0') { e.preventDefault(); zoomTo(1); return; }

        const shortcuts = {
            v: 'select', h: 'pan', d: 'distance', p: 'perimeter', a: 'area',
            r: 'rectangle', c: 'circle', n: 'count', t: 'text',
        };
        if (shortcuts[k] && !ctrl) { setTool(shortcuts[k]); }
    });

    // ====== Initial render ======
    renderProjectTree();
    renderLayers();
    renderTable();
    renderSummary();
    updateProjectNameLabel();
    updateStatus();
    updateScaleBadge();

    // ====== Utils ======
    function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c])); }
    function escapeAttr(s) { return escapeHtml(s); }
});
