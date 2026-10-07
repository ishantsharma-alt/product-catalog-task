import { processCsv } from './pipeline.js';
import { buildWorkbook } from './workbook.js';

const status = document.getElementById('status');
let output = null;
let baseName = '';

document.getElementById('file').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  document.getElementById('results').hidden = true;

  try {
    output = processCsv(await file.text());
  } catch (error) {
    status.textContent = error.message;
    status.className = 'fail';
    return;
  }

  baseName = file.name.replace(/\.csv$/i, '');
  const failed = output.checks.filter((c) => !c.pass).length;
  status.textContent = failed
    ? `Processed with ${failed} failed validation check(s) – review before uploading.`
    : `Processed ${file.name}: all ${output.checks.length} validation checks passed.`;
  status.className = failed ? 'fail' : 'pass';

  renderSummary(output.summary);
  renderChecks(output.checks);
  document.getElementById('issues').innerHTML = output.issues.map((i) => `<li>${escapeHtml(i)}</li>`).join('');
  document.getElementById('results').hidden = false;
});

document.getElementById('download-csv').addEventListener('click', () => {
  download(new Blob([output.csv], { type: 'text/csv' }), `${baseName}_updated.csv`);
});

document.getElementById('download-xlsx').addEventListener('click', async () => {
  const buffer = await buildWorkbook(window.ExcelJS, output).xlsx.writeBuffer();
  download(new Blob([buffer]), `${baseName}_updated.xlsx`);
});

function renderSummary(summary) {
  const rows = [
    ['Unique products', summary.uniqueProducts],
    ['5% discount (products 1–10)', summary.discountCounts[5]],
    ['10% discount (products 11–20)', summary.discountCounts[10]],
    ['15% discount (products 21+)', summary.discountCounts[15]],
    ['Products given the Pack option', summary.productsWithPack],
    ['Size × Pack variants', summary.sizePackCombinations],
    ['Pack not added', summary.productsWithoutPack.join(', ') || '—'],
    ['Rows in → out', `${summary.rowsIn} → ${summary.rowsOut}`],
  ];
  document.getElementById('summary').innerHTML = rows
    .map(([label, value]) => `<tr><th>${label}</th><td>${escapeHtml(String(value))}</td></tr>`)
    .join('');
}

function renderChecks(checks) {
  document.getElementById('checks').innerHTML = checks
    .map((c) => {
      const result = c.pass ? '<span class="pass">PASS</span>' : '<span class="fail">FAIL</span>';
      const detail = c.failures.slice(0, 5).map(escapeHtml).join('<br>');
      return `<tr><td>${result}</td><td>${escapeHtml(c.name)}${detail ? `<br>${detail}` : ''}</td></tr>`;
    })
    .join('');
}

function download(blob, filename) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function escapeHtml(text) {
  return text.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
}
