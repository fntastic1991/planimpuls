// Geometrie-Hilfsfunktionen

export function calculateDistance(p1, p2) {
    return Math.hypot(p2.x - p1.x, p2.y - p1.y);
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

export function calculatePolylineLength(points) {
    if (points.length < 2) return 0;
    let length = 0;
    for (let i = 0; i < points.length - 1; i++) {
        length += calculateDistance(points[i], points[i + 1]);
    }
    return length;
}

export function rectangleBounds(p1, p2) {
    return {
        x: Math.min(p1.x, p2.x),
        y: Math.min(p1.y, p2.y),
        width: Math.abs(p2.x - p1.x),
        height: Math.abs(p2.y - p1.y),
    };
}

export function pointsCentroid(points) {
    if (!points.length) return { x: 0, y: 0 };
    const sum = points.reduce((a, p) => ({ x: a.x + p.x, y: a.y + p.y }), { x: 0, y: 0 });
    return { x: sum.x / points.length, y: sum.y / points.length };
}

export function boundingBox(points) {
    if (!points.length) return { x: 0, y: 0, w: 0, h: 0 };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of points) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function formatNumber(num, decimals = 2) {
    return new Intl.NumberFormat('de-CH', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
    }).format(num);
}

// Punkt in Polygon (Ray casting)
export function pointInPolygon(point, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i].x, yi = polygon[i].y;
        const xj = polygon[j].x, yj = polygon[j].y;
        const intersect = ((yi > point.y) !== (yj > point.y)) &&
            (point.x < (xj - xi) * (point.y - yi) / (yj - yi + 1e-12) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

// Kürzester Abstand Punkt zu Segment
export function distancePointToSegment(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) return calculateDistance(p, a);
    let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    return calculateDistance(p, { x: a.x + t * dx, y: a.y + t * dy });
}
