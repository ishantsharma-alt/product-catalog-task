import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { processCsv } from './pipeline.js';
import { buildWorkbook } from './workbook.js';

const input = process.argv[2] ?? 'data/products_export.csv';
const outDir = process.argv[3] ?? 'output';

const output = processCsv(await readFile(input, 'utf8'));
const { summary, checks, issues } = output;

await mkdir(outDir, { recursive: true });
await writeFile(path.join(outDir, 'products_updated.csv'), output.csv);
await buildWorkbook(ExcelJS, output).xlsx.writeFile(path.join(outDir, 'products_updated.xlsx'));

console.log(`Unique products: ${summary.uniqueProducts}`);
console.log(`Discounts: 5% x${summary.discountCounts[5]}, 10% x${summary.discountCounts[10]}, 15% x${summary.discountCounts[15]}`);
console.log(`Pack added to ${summary.productsWithPack} products -> ${summary.sizePackCombinations} Size x Pack variants`);
console.log(`Pack not added: ${summary.productsWithoutPack.join(', ')}`);
console.log(`Rows: ${summary.rowsIn} -> ${summary.rowsOut}\n`);

console.log('Validation:');
for (const c of checks) {
  console.log(`  ${c.pass ? 'PASS' : 'FAIL'}  ${c.name}`);
  for (const failure of c.failures.slice(0, 10)) console.log(`        ${failure}`);
}
console.log('\nSource issues:');
for (const issue of issues) console.log(`  - ${issue}`);
console.log(`\nWrote ${outDir}/products_updated.csv and ${outDir}/products_updated.xlsx`);

if (checks.some((c) => !c.pass)) process.exitCode = 1;
