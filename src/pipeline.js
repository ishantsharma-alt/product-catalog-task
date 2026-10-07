import { parseCsv, toCsv } from './csv.js';
import { findMissingColumns, processProducts, summarize } from './process.js';
import { validateProducts, findSourceIssues } from './validate.js';

// Shared by the CLI and the browser page.
export function processCsv(text) {
  const { headers, rows, blankRows } = parseCsv(text);
  const missing = findMissingColumns(headers);
  if (missing.length) throw new Error(`Not a Shopify product export – missing columns: ${missing.join(', ')}`);

  const result = processProducts(headers, rows);
  const csv = toCsv(headers, result.rows);
  const checks = validateProducts(headers, rows, result);

  const reread = parseCsv(csv);
  const csvProblems = [];
  if (reread.headers.join() !== headers.join()) csvProblems.push('header differs from the source');
  if (reread.rows.length !== result.rows.length) csvProblems.push(`${reread.rows.length} rows read back, expected ${result.rows.length}`);
  checks.push({ name: 'Import CSV reads back with the original Shopify header and every row', pass: !csvProblems.length, failures: csvProblems });

  return { headers, result, csv, checks, summary: summarize(result), issues: findSourceIssues(rows, blankRows) };
}
