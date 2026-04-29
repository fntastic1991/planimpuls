// Zentrale Marken-Konstanten — Farben aus dem office.impuls-Logo extrahiert.

export const BRAND = {
    name: 'plan.impuls',
    tagline: 'Mengenermittlung & Plan-Annotation',
    colors: {
        teal: '#386e79',
        tealDark: '#264e57',
        tealLight: '#e8eef0',
        coral: '#c65145',
        coralDark: '#a23a30',
        coralLight: '#fbeceb',
        ink: '#1f2937',
        muted: '#6b7280',
        line: '#e5e7eb',
        paper: '#ffffff',
        paperSoft: '#f7f8f9',
    },
    logoPath: '/logo.png',
};

// jsPDF erwartet RGB-Tupel — Helper für die Brand-Farben
export function brandRgb(name) {
    const map = {
        teal: [56, 110, 121],
        tealDark: [38, 78, 87],
        tealLight: [232, 238, 240],
        coral: [198, 81, 69],
        coralDark: [162, 58, 48],
        coralLight: [251, 236, 235],
        ink: [31, 41, 55],
        muted: [107, 114, 128],
        line: [229, 231, 235],
        paperSoft: [247, 248, 249],
    };
    return map[name] || [0, 0, 0];
}

// Lädt das Logo als HTMLImageElement (cached) — für jsPDF.addImage.
let _logoPromise = null;
export function loadLogo() {
    if (_logoPromise) return _logoPromise;
    _logoPromise = new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = BRAND.logoPath;
    });
    return _logoPromise;
}
