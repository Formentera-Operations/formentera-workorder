// Migrate ticket photos from external storage (Retool) into the Supabase
// `ticket-images` bucket, then rewrite the URLs stored in DB.
//
// Scope:
//   - Maintenance_Form_Submission.Issue_Photos  →  tickets/{id}/issue-{N}.{ext}
//   - Repairs_Closeout.repair_images            →  tickets/{ticket_id}/repair-{N}.{ext}
//
// What it skips:
//   - URLs already in our Supabase project (work-orders or ticket-images) —
//     so re-runs are safe and won't reshuffle existing photos.
//   - `idb://photo-{id}` refs (queued offline photos that shouldn't be in
//     the DB but are defensive-skipped if encountered).
//
// Usage:
//   node --env-file=.env.local scripts/migrate-images-to-supabase.mjs           # dry-run
//   node --env-file=.env.local scripts/migrate-images-to-supabase.mjs --commit  # download + upload + DB update

import { createClient } from '@supabase/supabase-js';

const COMMIT = process.argv.includes('--commit');
const BUCKET = 'ticket-images';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env.');
  console.error('Run with:  node --env-file=.env.local scripts/migrate-images-to-supabase.mjs');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

// URLs already inside our Supabase project (any bucket) are left alone.
// Only foreign URLs (i.e. Retool storage) get pulled across.
function isOurSupabaseUrl(url) {
  return typeof url === 'string' && url.startsWith(SUPABASE_URL);
}

function isMigratable(url) {
  if (typeof url !== 'string' || !url) return false;
  if (url.startsWith('idb://')) return false;
  if (isOurSupabaseUrl(url)) return false;
  return url.startsWith('http://') || url.startsWith('https://');
}

function extFromContentType(contentType) {
  if (!contentType) return 'jpg';
  const ct = contentType.toLowerCase();
  if (ct.includes('jpeg')) return 'jpg';
  if (ct.includes('png')) return 'png';
  if (ct.includes('webp')) return 'webp';
  if (ct.includes('gif')) return 'gif';
  if (ct.includes('heic')) return 'heic';
  if (ct.includes('heif')) return 'heif';
  return 'jpg';
}

async function downloadImage(url, attempt = 1) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    const contentType = res.headers.get('content-type') || 'image/jpeg';
    return { buffer, contentType };
  } catch (e) {
    if (attempt >= 3) throw new Error(`Download failed after ${attempt} attempts (${e.message}): ${url}`);
    await new Promise(r => setTimeout(r, 1000 * attempt));
    return downloadImage(url, attempt + 1);
  }
}

async function uploadToSupabase(path, buffer, contentType) {
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, buffer, { contentType, upsert: true });
  if (error) throw error;
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

// Process one row's URL array. Returns the new array AND counts.
// Throws on any individual photo failure so the caller can skip the row
// entirely (preserves array integrity — no half-migrated rows).
async function migrateUrlArray({ ticketId, urls, subfolder }) {
  const newUrls = [];
  let migrated = 0;
  let skipped = 0;
  for (let i = 0; i < urls.length; i++) {
    const original = urls[i];
    if (!isMigratable(original)) {
      newUrls.push(original);
      skipped++;
      continue;
    }
    const { buffer, contentType } = await downloadImage(original);
    const ext = extFromContentType(contentType);
    const path = `tickets/${ticketId}/${subfolder}-${i + 1}.${ext}`;
    if (COMMIT) {
      const publicUrl = await uploadToSupabase(path, buffer, contentType);
      newUrls.push(publicUrl);
    } else {
      // Dry-run: pretend the new URL would replace the old one so we can
      // log a clean before/after, but never write to DB.
      newUrls.push(`[DRY-RUN: ${BUCKET}/${path}]`);
    }
    migrated++;
  }
  return { newUrls, migrated, skipped };
}

async function fetchAllRows({ table, selectCols, idCol }) {
  // Page through the table — PostgREST caps a single request at ~1000 rows.
  const PAGE = 500;
  const all = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select(selectCols)
      .order(idCol, { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

async function migrateTable({ table, urlCol, idCol, ticketIdCol, subfolder }) {
  console.log(`--- ${table}.${urlCol} ---`);

  const selectCols = ticketIdCol === idCol
    ? `${idCol}, ${urlCol}`
    : `${idCol}, ${ticketIdCol}, ${urlCol}`;

  const rows = await fetchAllRows({ table, selectCols, idCol });

  let rowsTouched = 0;
  let photosMigrated = 0;
  let photosSkipped = 0;
  let errors = 0;

  for (const row of rows) {
    const urls = Array.isArray(row[urlCol]) ? row[urlCol] : [];
    if (urls.length === 0) continue;
    if (!urls.some(isMigratable)) continue;

    const ticketId = row[ticketIdCol];
    const rowId = row[idCol];

    try {
      const { newUrls, migrated, skipped } = await migrateUrlArray({
        ticketId,
        urls,
        subfolder,
      });
      rowsTouched++;
      photosMigrated += migrated;
      photosSkipped += skipped;
      const label = ticketIdCol === idCol
        ? `Ticket ${ticketId}`
        : `Ticket ${ticketId} (${table} ${rowId})`;
      console.log(`  ${label}: migrated ${migrated}, skipped ${skipped}`);

      if (COMMIT && migrated > 0) {
        const { error: updateErr } = await supabase
          .from(table)
          .update({ [urlCol]: newUrls })
          .eq(idCol, rowId);
        if (updateErr) throw updateErr;
      }
    } catch (e) {
      console.error(`  Ticket ${ticketId} (${table} ${rowId}): FAILED — ${e.message}`);
      errors++;
    }
  }

  console.log(`  → ${rowsTouched} rows touched, ${photosMigrated} migrated, ${photosSkipped} skipped, ${errors} errors`);
  console.log('');
  return { rowsTouched, photosMigrated, photosSkipped, errors };
}

async function main() {
  console.log(`Mode:          ${COMMIT ? 'COMMIT (will write)' : 'DRY-RUN (no writes)'}`);
  console.log(`Target bucket: ${BUCKET}`);
  console.log('');

  const issueResult = await migrateTable({
    table: 'Maintenance_Form_Submission',
    urlCol: 'Issue_Photos',
    idCol: 'id',
    ticketIdCol: 'id',
    subfolder: 'issue',
  });

  const repairResult = await migrateTable({
    table: 'Repairs_Closeout',
    urlCol: 'repair_images',
    idCol: 'id',
    ticketIdCol: 'ticket_id',
    subfolder: 'repair',
  });

  console.log('--- Summary ---');
  console.log(`Rows touched:    ${issueResult.rowsTouched + repairResult.rowsTouched}`);
  console.log(`Photos migrated: ${issueResult.photosMigrated + repairResult.photosMigrated}`);
  console.log(`Photos skipped:  ${issueResult.photosSkipped + repairResult.photosSkipped}`);
  console.log(`Errors:          ${issueResult.errors + repairResult.errors}`);
  if (!COMMIT) {
    console.log('');
    console.log('Re-run with --commit to actually download + upload + update DB.');
  }
}

main().catch(err => {
  console.error('Migration aborted:', err);
  process.exit(1);
});
