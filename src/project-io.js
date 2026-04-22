// Speichern & Laden des gesamten Projekts (inkl. PDF-Dateien als Base64).
// Dateiformat: .plimp (JSON, gzip wäre möglich, hier bewusst einfach gehalten)

export async function saveProjectToFile(store, pdfLoader) {
    const project = store.project;
    // Deep copy und PDF-Daten einbetten
    const exportData = JSON.parse(JSON.stringify(project));
    for (const floor of exportData.floors) {
        const base64 = pdfLoader.getBase64(floor.id);
        floor.pdfData = base64;
    }
    const blob = new Blob([JSON.stringify(exportData)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${sanitize(project.name)}.plimp.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 500);
}

export async function loadProjectFromFile(file, store, pdfLoader) {
    const text = await file.text();
    const data = JSON.parse(text);
    // Validation (grob)
    if (!data.floors || !Array.isArray(data.floors)) {
        throw new Error('Ungültige Projektdatei.');
    }
    store.setProject(data);
    // PDFs laden
    for (const floor of data.floors) {
        if (floor.pdfData) {
            await pdfLoader.loadFloorPdfFromBase64(floor.id, floor.pdfData, floor.pdfFileName || 'plan.pdf');
        }
    }
}

function sanitize(s) {
    return (s || 'Projekt').replace(/[^a-zA-Z0-9\-_ ]/g, '').trim().replace(/\s+/g, '_') || 'Projekt';
}
