// Zentrale Datenhaltung: Projekt -> Etagen -> Messungen
// Inspiriert von Bluebeam: strukturierte Projekte mit mehreren Etagen.

export const DEFAULT_LAYERS = [
    { id: 'layer-default', name: 'Allgemein', color: '#3b82f6', visible: true, locked: false },
    { id: 'layer-walls',   name: 'Wände',      color: '#ef4444', visible: true, locked: false },
    { id: 'layer-floor',   name: 'Bodenflächen', color: '#10b981', visible: true, locked: false },
    { id: 'layer-electro', name: 'Elektro',    color: '#f59e0b', visible: true, locked: false },
];

export function createEmptyProject(name = 'Neues Projekt') {
    return {
        id: `proj-${Date.now()}`,
        name,
        client: '',
        address: '',
        date: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        version: '2.0',
        floors: [],
        activeFloorId: null,
        layers: JSON.parse(JSON.stringify(DEFAULT_LAYERS)),
        activeLayerId: 'layer-default',
    };
}

export function createFloor(name = 'Neue Etage') {
    return {
        id: `floor-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name,
        pdfData: null,       // Base64 der PDF-Datei
        pdfFileName: null,
        pageCount: 0,
        currentPageIndex: 1,
        // Massstab pro Etage (oft pro Plan unterschiedlich)
        scale: {
            factor: 0.017638,  // 1 px ≈ 1.7 cm bei 1:50 auf 72 DPI * 1.5 render
            unit: 'm',
            ratio: 50,         // 1:50 default
            calibrated: false,
        },
        measurements: [],      // { ..., pageIndex, floorId, layerId }
        viewState: {           // letzter Zoom/Pan pro Etage
            zoom: 1.0,
            panX: 0,
            panY: 0,
            fitMode: 'width',  // 'width' | 'page' | 'custom'
        },
    };
}

export class ProjectStore {
    constructor() {
        this.project = createEmptyProject();
        this.listeners = new Set();
    }

    subscribe(fn) {
        this.listeners.add(fn);
        return () => this.listeners.delete(fn);
    }

    notify(event = 'change') {
        this.listeners.forEach(fn => fn(this.project, event));
    }

    // --- Projekt ---
    setProject(project) {
        this.project = project;
        this.notify('project:replaced');
    }

    updateProjectMeta(patch) {
        Object.assign(this.project, patch);
        this.notify('project:meta');
    }

    // --- Etagen ---
    addFloor(floor) {
        this.project.floors.push(floor);
        if (!this.project.activeFloorId) {
            this.project.activeFloorId = floor.id;
        }
        this.notify('floors:changed');
        return floor;
    }

    removeFloor(id) {
        const idx = this.project.floors.findIndex(f => f.id === id);
        if (idx >= 0) {
            this.project.floors.splice(idx, 1);
            if (this.project.activeFloorId === id) {
                this.project.activeFloorId = this.project.floors[0]?.id || null;
            }
            this.notify('floors:changed');
        }
    }

    renameFloor(id, name) {
        const f = this.getFloor(id);
        if (f) {
            f.name = name;
            this.notify('floors:renamed');
        }
    }

    getFloor(id = this.project.activeFloorId) {
        return this.project.floors.find(f => f.id === id) || null;
    }

    getActiveFloor() {
        return this.getFloor(this.project.activeFloorId);
    }

    setActiveFloor(id) {
        if (this.project.floors.find(f => f.id === id)) {
            this.project.activeFloorId = id;
            this.notify('floor:activated');
        }
    }

    // --- Measurements ---
    addMeasurement(m) {
        const floor = this.getActiveFloor();
        if (!floor) return null;
        floor.measurements.push(m);
        this.notify('measurements:changed');
        return m;
    }

    updateMeasurement(id, patch) {
        const floor = this.getActiveFloor();
        if (!floor) return;
        const m = floor.measurements.find(x => x.id === id);
        if (m) {
            Object.assign(m, patch);
            this.notify('measurements:changed');
        }
    }

    deleteMeasurement(id) {
        const floor = this.getActiveFloor();
        if (!floor) return;
        const idx = floor.measurements.findIndex(x => x.id === id);
        if (idx >= 0) {
            floor.measurements.splice(idx, 1);
            this.notify('measurements:changed');
        }
    }

    clearMeasurements(floorId = this.project.activeFloorId) {
        const floor = this.getFloor(floorId);
        if (!floor) return;
        floor.measurements = [];
        this.notify('measurements:changed');
    }

    allMeasurements() {
        return this.project.floors.flatMap(f =>
            f.measurements.map(m => ({ ...m, _floorName: f.name, _floorId: f.id }))
        );
    }

    // --- Layers ---
    addLayer(layer) {
        this.project.layers.push(layer);
        this.notify('layers:changed');
    }

    updateLayer(id, patch) {
        const l = this.project.layers.find(x => x.id === id);
        if (l) {
            Object.assign(l, patch);
            this.notify('layers:changed');
        }
    }

    deleteLayer(id) {
        if (this.project.layers.length <= 1) return;
        this.project.layers = this.project.layers.filter(x => x.id !== id);
        if (this.project.activeLayerId === id) {
            this.project.activeLayerId = this.project.layers[0].id;
        }
        this.notify('layers:changed');
    }

    getLayer(id) {
        return this.project.layers.find(l => l.id === id);
    }

    setActiveLayer(id) {
        if (this.getLayer(id)) {
            this.project.activeLayerId = id;
            this.notify('layer:activated');
        }
    }
}
