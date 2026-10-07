import { REVIEW_COLUMNS } from './process.js';

const PRICE_COLUMNS = ['Variant Price', 'Variant Compare At Price', 'Original Price', 'Discounted Price', 'Original Compare At Price'];
const CHANGED_COLUMNS = ['Variant Price', 'Variant Compare At Price', 'Variant SKU'];
const GREEN = 'FFC6EFCE';
const YELLOW = 'FFFFEB9C';

// ExcelJS is passed in so the same code runs in Node and in the browser.
export function buildWorkbook(ExcelJS, { headers, result, summary, checks, issues }) {
  const workbook = new ExcelJS.Workbook();
  const columns = [...headers, ...REVIEW_COLUMNS];
  const columnNumber = (name) => columns.indexOf(name) + 1;

  const sheet = workbook.addWorksheet('Products', { views: [{ state: 'frozen', xSplit: 2, ySplit: 1 }] });
  sheet.addRow(columns);
  for (const row of result.rows) {
    sheet.addRow(columns.map((h) => (PRICE_COLUMNS.includes(h) && row[h] ? Number(row[h]) : row[h] ?? '')));
  }

  const header = sheet.getRow(1);
  header.font = { name: 'Arial', bold: true };
  for (const name of [...REVIEW_COLUMNS, ...CHANGED_COLUMNS]) {
    const color = REVIEW_COLUMNS.includes(name) ? GREEN : YELLOW;
    header.getCell(columnNumber(name)).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
  }
  for (const name of PRICE_COLUMNS) sheet.getColumn(columnNumber(name)).numFmt = '#,##0.00';
  for (const name of ['Handle', 'Title', 'Variant SKU', ...REVIEW_COLUMNS]) sheet.getColumn(columnNumber(name)).width = 22;

  const notes = workbook.addWorksheet('Summary');
  const add = (...cells) => notes.addRow(cells);
  const heading = (text) => (add(text).font = { name: 'Arial', bold: true });

  heading('Summary');
  add('Unique products (by Handle)', summary.uniqueProducts);
  add('Products 1–10 at 5%', summary.discountCounts[5]);
  add('Products 11–20 at 10%', summary.discountCounts[10]);
  add('Products 21+ at 15%', summary.discountCounts[15]);
  add('Products given the Pack option', summary.productsWithPack);
  add('Size × Pack variants', summary.sizePackCombinations);
  add('Pack not added', summary.productsWithoutPack.join(', '));
  add('Rows in / out', `${summary.rowsIn} / ${summary.rowsOut}`);
  add();
  heading('Columns');
  add('Changed (yellow)', 'Variant Price = discounted price. Variant Compare At Price = original price, or the existing compare-at if it was higher. Variant SKU = original SKU-SIZE-P2/P3. Option2 (Option3 on two-size sets) = Pack.');
  add('Added (green, review only – not in the import CSV)', REVIEW_COLUMNS.join(', '));
  add('Pack pricing', 'No pack pricing in the source: Pack of 2 and Pack of 3 use the size’s existing price (not multiplied).');
  add();
  heading('Validation');
  for (const c of checks) add(c.name, c.pass ? 'PASS' : `FAIL: ${c.failures.slice(0, 5).join('; ')}`);
  add();
  heading('Issues in the source file');
  for (const issue of issues) add(issue);
  notes.getColumn(1).width = 70;
  notes.getColumn(2).width = 80;

  return workbook;
}
