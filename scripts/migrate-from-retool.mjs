// Migrate Retool CSV exports into Supabase.
//
// Setup (one-time):
//   npm install --save-dev csv-parse
//
// Usage:
//   node --env-file=.env.local scripts/migrate-from-retool.mjs           # dry-run
//   node --env-file=.env.local scripts/migrate-from-retool.mjs --commit  # wipe + load

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'csv-parse/sync';
import { createClient } from '@supabase/supabase-js';

const COMMIT = process.argv.includes('--commit');
const EXPORT_DIR = 'retool-export';
const POST_SQL_PATH = 'migrations/post_retool_load_sequence_bump.sql';
const BATCH_SIZE = 100;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env.');
  console.error('Run with:  node --env-file=.env.local scripts/migrate-from-retool.mjs');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

// Parent → child load order. Reverse for delete order so FK children clear first.
const TABLES = [
  {
    name: 'Maintenance_Form_Submission',
    csvPrefix: 'Maintenance_Form_Submission',
    intCols: ['id'],
    numCols: ['Estimate_Cost'],
    dateCols: ['Issue_Date'],
    jsonCols: ['Issue_Photos'],
  },
  {
    name: 'Dispatch',
    csvPrefix: 'Dispatch',
    intCols: ['id', 'ticket_id'],
    numCols: ['Estimate_Cost'],
    dateCols: ['date_assigned', 'due_date', 'created_at'],
    jsonCols: [],
  },
  {
    name: 'Repairs_Closeout',
    csvPrefix: 'Repairs_Closeout',
    intCols: ['id', 'ticket_id'],
    numCols: ['total_repair_cost'],
    dateCols: ['start_date', 'date_completed', 'date_closed', 'created_at', 'updated_at'],
    jsonCols: ['repair_images'],
  },
  {
    name: 'vendor_payment_details',
    csvPrefix: 'vendor_payment_details',
    intCols: ['id', 'ticket_id'],
    numCols: [
      'vendor_cost', 'vendor_cost_2', 'vendor_cost_3', 'vendor_cost_4',
      'vendor_cost_5', 'vendor_cost_6', 'vendor_cost_7', 'total_cost',
    ],
    dateCols: ['created_at', 'updated_at'],
    jsonCols: [],
  },
  {
    name: 'comments',
    csvPrefix: 'comments',
    intCols: ['id', 'ticket_id', 'parent_id'],
    numCols: [],
    dateCols: ['created_at'],
    jsonCols: [],
  },
];

function findCsv(prefix) {
  const files = readdirSync(EXPORT_DIR).filter(
    (f) => f.startsWith(prefix) && f.toLowerCase().endsWith('.csv'),
  );
  if (files.length === 0) throw new Error(`No CSV found for prefix "${prefix}" in ${EXPORT_DIR}/`);
  if (files.length > 1) {
    throw new Error(`Multiple CSVs found for prefix "${prefix}": ${files.join(', ')}`);
  }
  return join(EXPORT_DIR, files[0]);
}

function isBlank(v) {
  return v === '' || v === undefined || v === null;
}

function coerceRow(raw, table) {
  const row = { ...raw };
  for (const col of table.intCols) {
    if (isBlank(row[col])) {
      row[col] = null;
    } else {
      const n = Number(row[col]);
      if (!Number.isFinite(n) || !Number.isInteger(n)) {
        throw new Error(`Bad integer in ${table.name}.${col}: ${JSON.stringify(row[col])}`);
      }
      row[col] = n;
    }
  }
  for (const col of table.numCols) {
    if (isBlank(row[col])) {
      row[col] = null;
    } else {
      const n = Number(row[col]);
      if (!Number.isFinite(n)) {
        throw new Error(`Bad numeric in ${table.name}.${col}: ${JSON.stringify(row[col])}`);
      }
      row[col] = n;
    }
  }
  for (const col of table.dateCols) {
    if (isBlank(row[col])) row[col] = null;
  }
  for (const col of table.jsonCols) {
    if (isBlank(row[col])) {
      row[col] = [];
    } else if (typeof row[col] === 'string') {
      try {
        row[col] = JSON.parse(row[col]);
      } catch {
        throw new Error(
          `Bad JSON in ${table.name}.${col} (id=${row.id}): ${String(row[col]).slice(0, 80)}`,
        );
      }
    }
  }
  return row;
}

function loadCsv(table) {
  const csvPath = findCsv(table.csvPrefix);
  const text = readFileSync(csvPath, 'utf8');
  const raw = parse(text, { columns: true, skip_empty_lines: true, bom: true });
  const rows = [];
  for (let i = 0; i < raw.length; i++) {
    try {
      rows.push(coerceRow(raw[i], table));
    } catch (e) {
      throw new Error(`${csvPath} row ${i + 2}: ${e.message}`);
    }
  }
  // Sort by id ASC — required for self-FK in comments (parent_id), harmless elsewhere.
  rows.sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
  // Detect duplicate primary keys in the CSV.
  const seen = new Set();
  for (const r of rows) {
    if (r.id != null) {
      if (seen.has(r.id)) throw new Error(`Duplicate id ${r.id} in ${csvPath}`);
      seen.add(r.id);
    }
  }
  return { csvPath, rows };
}

async function getRowCount(tableName) {
  const { count, error } = await supabase
    .from(tableName)
    .select('*', { count: 'exact', head: true });
  if (error) throw new Error(`Count failed for ${tableName}: ${error.message}`);
  return count ?? 0;
}

async function preflight(parsed) {
  console.log('--- PRE-FLIGHT ---');
  const summary = [];
  for (const t of TABLES) {
    const { csvPath, rows } = parsed[t.name];
    const supabaseCount = await getRowCount(t.name);
    summary.push({
      table: t.name,
      csv_file: csvPath.replace(/^.*[\\/]/, ''),
      csv_rows: rows.length,
      supabase_rows_now: supabaseCount,
    });
  }
  console.table(summary);
}

async function deleteAll(tableName) {
  // Supabase JS requires a filter; .neq('id', -1) matches every row.
  const { error } = await supabase.from(tableName).delete().neq('id', -1);
  if (error) throw new Error(`Delete failed on ${tableName}: ${error.message}`);
}

async function insertRows(tableName, rows) {
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const slice = rows.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from(tableName).insert(slice);
    if (error) {
      throw new Error(
        `Insert failed on ${tableName} batch starting at row ${i}: ${error.message}`,
      );
    }
    process.stdout.write(`  ${tableName}: ${Math.min(i + BATCH_SIZE, rows.length)}/${rows.length}\r`);
  }
  console.log();
}

function buildSequenceBumpSql() {
  const lines = [
    '-- Run this in the Supabase SQL editor AFTER the migration script completes.',
    '-- It advances each SERIAL sequence to MAX(id) so subsequent auto-id inserts',
    '-- do not collide with the ids imported from Retool.',
    '',
  ];
  for (const t of TABLES) {
    lines.push(
      `SELECT setval(pg_get_serial_sequence('"${t.name}"', 'id'),`
      + ` GREATEST(COALESCE((SELECT MAX(id) FROM "${t.name}"), 0), 1));`
    );
  }
  return lines.join('\n') + '\n';
}

async function main() {
  console.log(`Mode: ${COMMIT ? 'COMMIT (will wipe and load)' : 'DRY RUN (no writes)'}\n`);

  // Parse + validate every CSV before touching Supabase.
  const parsed = {};
  for (const t of TABLES) {
    parsed[t.name] = loadCsv(t);
  }

  await preflight(parsed);

  if (!COMMIT) {
    console.log('\nDry run complete. No writes performed.');
    console.log('Re-run with --commit to wipe the 5 tables and load the CSVs.');
    return;
  }

  console.log('\n--- DELETE (children first) ---');
  for (const t of [...TABLES].reverse()) {
    console.log(`Deleting all rows from ${t.name}...`);
    await deleteAll(t.name);
  }

  console.log('\n--- LOAD (parents first) ---');
  for (const t of TABLES) {
    console.log(`Inserting ${parsed[t.name].rows.length} rows into ${t.name}...`);
    await insertRows(t.name, parsed[t.name].rows);
  }

  writeFileSync(POST_SQL_PATH, buildSequenceBumpSql());
  console.log('\n--- POST-LOAD STEP ---');
  console.log(`Wrote ${POST_SQL_PATH}`);
  console.log('Open it and paste into the Supabase SQL editor to bump SERIAL sequences,');
  console.log('otherwise new auto-id inserts will collide with the imported ids.');
  console.log('\nDone.');
}

main().catch((err) => {
  console.error('\nERROR:', err.message);
  process.exit(1);
});
