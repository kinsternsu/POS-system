import ExcelJS from 'exceljs';

export function escapeCSV(value) {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

export function generateCSV(rows, columns) {
  const headers = columns.map(c => c.label);
  const data = rows.map(row =>
    columns.map(c => escapeCSV(c.value(row))).join(',')
  );
  return [headers.join(','), ...data].join('\n');
}

export async function generateXLSX(rows, columns, sheetName = 'Sheet1') {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'POS System';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(sheetName);

  sheet.columns = columns.map(c => ({
    header: c.label,
    key: c.key || c.label.toLowerCase().replace(/\s+/g, '_'),
    width: Math.max(c.label.length + 2, 12)
  }));

  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1a1a2e' } };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' };

  rows.forEach((row, i) => {
    const values = columns.map(c => c.value(row));
    const rowData = sheet.addRow(values);
    if (i % 2 === 0) {
      rowData.eachCell(cell => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F5F5' } }; });
    }
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return buffer;
}
