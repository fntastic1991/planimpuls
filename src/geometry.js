// Geometrie-Hilfsfunktionen

export function calculateDistance(p1, p2) {
    return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
}

// Shoelace Formula für Polygon-Fläche
export function calculatePolygonArea(points) {
    if (points.length < 3) return 0;
    
    let area = 0;
    for (let i = 0; i < points.length; i++) {
        const j = (i + 1) % points.length;
        area += points[i].x * points[j].y;
        area -= points[j].x * points[i].y;
    }
    return Math.abs(area) / 2;
}

// Länge eines Pfades (Polyline)
export function calculatePolylineLength(points) {
    if (points.length < 2) return 0;
    let length = 0;
    for (let i = 0; i < points.length - 1; i++) {
        length += calculateDistance(points[i], points[i+1]);
    }
    return length;
}

export function formatNumber(num) {
    return new Intl.NumberFormat('de-CH', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(num);
}
