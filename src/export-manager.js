import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { formatNumber } from './geometry.js';

export class ExportManager {
    constructor(measurements) {
        this.measurements = measurements;
    }

    updateMeasurements(measurements) {
        this.measurements = measurements;
    }

    getSummary() {
        let totalDistance = 0;
        let totalPerimeter = 0;
        let totalArea = 0;
        let distanceCount = 0;
        let perimeterCount = 0;
        let areaCount = 0;
        let unitDist = 'm';
        let unitPerimeter = 'm';
        let unitArea = 'm²';

        this.measurements.forEach(m => {
            if (m.type === 'distance') {
                totalDistance += m.value;
                distanceCount++;
                unitDist = m.unit; // Nimmt die letzte Einheit an (meist gleich)
            } else if (m.type === 'perimeter') {
                totalPerimeter += m.value;
                perimeterCount++;
                unitPerimeter = m.unit;
            } else if (m.type === 'area') {
                totalArea += m.value;
                areaCount++;
                unitArea = m.unit;
            }
        });

        return {
            totalLength: totalDistance + totalPerimeter,
            totalDistance,
            totalPerimeter,
            totalArea,
            distanceCount,
            perimeterCount,
            areaCount,
            unitDist,
            unitPerimeter,
            unitArea
        };
    }

    exportToPDF(filename = 'Mengenermittlung.pdf') {
        const doc = new jsPDF();
        
        // Titel
        doc.setFontSize(18);
        doc.text('Mengenermittlung', 14, 22);
        
        doc.setFontSize(11);
        doc.setTextColor(100);
        doc.text(`Projekt: PlanImpuls Export`, 14, 30);
        doc.text(`Datum: ${new Date().toLocaleDateString('de-CH')}`, 14, 36);

        // Tabelle vorbereiten
        const tableBody = this.measurements.map((m, index) => [
            index + 1,
            m.name,
            m.type === 'area' ? 'Fläche' : (m.type === 'perimeter' ? 'Umfang' : 'Distanz'),
            `${formatNumber(m.value)} ${m.unit}`
        ]);

        // Zusammenfassung hinzufügen
        const summary = this.getSummary();
        if (summary.distanceCount > 0) {
            tableBody.push(['', 'Total Distanzen', '', `${formatNumber(summary.totalDistance)} ${summary.unitDist}`]);
        }
        if (summary.perimeterCount > 0) {
            tableBody.push(['', 'Total Umfänge', '', `${formatNumber(summary.totalPerimeter)} ${summary.unitPerimeter}`]);
        }
        if (summary.areaCount > 0) {
            tableBody.push(['', 'Total Flächen', '', `${formatNumber(summary.totalArea)} ${summary.unitArea}`]);
        }

        autoTable(doc, {
            head: [['#', 'Bezeichnung', 'Typ', 'Wert']],
            body: tableBody,
            startY: 44,
            theme: 'grid',
            headStyles: { fillColor: [59, 130, 246] }, // Primary Blue
            footStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0], fontStyle: 'bold' }
        });

        doc.save(filename);
    }

    exportToCSV(filename = 'Mengenermittlung.csv') {
        let csvContent = "data:text/csv;charset=utf-8,";
        csvContent += "Name;Typ;Wert;Einheit\n";

        this.measurements.forEach(m => {
            const row = [
                m.name,
                m.type === 'area' ? 'Fläche' : (m.type === 'perimeter' ? 'Umfang' : 'Distanz'),
                formatNumber(m.value).replace('.', ','), // Deutsche CSV Formatierung
                m.unit
            ].join(";");
            csvContent += row + "\n";
        });

        // Summary Rows
        const summary = this.getSummary();
        csvContent += `\nTotal Distanzen;;${formatNumber(summary.totalDistance).replace('.', ',')};${summary.unitDist}\n`;
        csvContent += `Total Umfänge;;${formatNumber(summary.totalPerimeter).replace('.', ',')};${summary.unitPerimeter}\n`;
        csvContent += `Total Flächen;;${formatNumber(summary.totalArea).replace('.', ',')};${summary.unitArea}\n`;

        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", filename);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
}


