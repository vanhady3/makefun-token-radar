// Token-radar entry point, rewritten for the resubmission.
//
// What this file does, in order: locate the sealed snapshot, score it
// through the radar model, refuse to continue when the gate rejects
// the board, then lay out everything the scorer expects in the output
// directory — the ranked board, the dashboard data, a per-category
// insights file, the static dashboard, the screenshots, and finally
// the dossier the judge rebuilds and compares byte for byte.
//
// Run it outside the grading container with an explicit output folder:
//   MAKEFUN_OUTPUT_DIR=/tmp/tr-out2 node main.ts --input <snapshot.json>

import {
  copyFileSync as copyOne,
  existsSync as pathExists,
  mkdirSync as makeDir,
  readFileSync as readText,
  readdirSync as listDir,
  statSync as statOne,
  writeFileSync as writeText,
} from 'node:fs';
import { join as joinPath } from 'node:path';
import { fileURLToPath as urlToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildInsights } from './lib/insights.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const repoRoot = urlToPath(new URL('.', import.meta.url));
const TEXT_CAP = 65536;
const SHOT_LIMIT = 4;
const SHOT_MAX_BYTES = 524288;
const DASH_LIMIT = 400;
const DASH_MAX_BYTES = 4194304;
const SHOT_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
const MIN_SHOTS = 3;

/** The value after `--flag <value>` or `--flag=<value>`, else the fallback. */
function flagValue(flag: string, fallback: string): string {
  const argv = process.argv;
  const pos = argv.indexOf(`--${flag}`);
  if (pos !== -1 && pos + 1 < argv.length) return argv[pos + 1] as string;
  const joined = argv.find((entry) => entry.startsWith(`--${flag}=`));
  if (joined === undefined) return fallback;
  return joined.slice(flag.length + 3);
}

/** A snapshot path from the --input argument: a file, or a directory holding one. */
function snapshotPathFrom(rawInput: string): string {
  if (rawInput.endsWith('.json')) return rawInput;
  return joinPath(rawInput, 'snapshot.json');
}

/** Mirror one directory's regular files into another, skipping dotfiles. */
function mirrorTree(sourceDir: string, targetDir: string): string[] {
  if (!pathExists(sourceDir)) return [];
  makeDir(targetDir, { recursive: true });
  const names: string[] = [];
  for (const entry of listDir(sourceDir)) {
    if (entry.startsWith('.')) continue;
    const from = joinPath(sourceDir, entry);
    if (!statOne(from).isFile()) continue;
    copyOne(from, joinPath(targetDir, entry));
    names.push(entry);
  }
  return names;
}

const rawInput = flagValue('input', '/input');
const snapPath = snapshotPathFrom(rawInput);
if (!pathExists(snapPath)) {
  process.stderr.write(
    `token radar: no snapshot at ${snapPath}: pass --input <snapshot.json|directory> or mount the sealed /input\n`,
  );
  process.exit(2);
}
const destDir = flagValue('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');
const snap = parseSnapshot(readText(snapPath, 'utf8'));
const { board: ranked, radar: radarData } = buildRadar(snap);
const refusal = boardIssue(ranked, snap);
if (refusal !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${refusal}\n`);
  process.exit(1);
}

makeDir(destDir, { recursive: true });
writeText(joinPath(destDir, 'board.json'), `${JSON.stringify({ rows: ranked })}\n`);
writeText(joinPath(destDir, 'data.js'), dataScript(radarData));
const insights = buildInsights(ranked, snap);
writeText(joinPath(destDir, 'insights.json'), `${JSON.stringify(insights, null, 2)}\n`);

mirrorTree(joinPath(repoRoot, 'dashboard'), joinPath(destDir, 'dashboard'));
const shotNames = mirrorTree(joinPath(repoRoot, 'screenshots'), joinPath(destDir, 'screenshots'));
if (shotNames.length < MIN_SHOTS) {
  process.stderr.write(
    `token radar: screenshots/ holds ${shotNames.length} image${shotNames.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view\n`,
  );
  process.exit(1);
}
for (const shot of shotNames) {
  if (!SHOT_NAME.test(shot)) {
    process.stderr.write(
      `token radar: screenshots/${shot}: a name is letters, digits and . _ -, 1 to 128 characters\n`,
    );
    process.exit(1);
  }
}

// The dossier goes last: the scorer rebuilds it from this output and compares bytes.
writeText(
  joinPath(destDir, 'dossier.json'),
  buildDossier(destDir, {
    text_max_bytes: TEXT_CAP,
    screenshots: { max: SHOT_LIMIT, max_bytes: SHOT_MAX_BYTES },
    dashboard: { max_files: DASH_LIMIT, max_bytes: DASH_MAX_BYTES },
  }),
);

const firstLine = `token radar: ${snap.protocols.length} protocols, ${snap.watchlist.length} on the watchlist, ${ranked.length} rows scored (${radarData.early_size} early, ${radarData.live_size} live set aside)`;
const secondLine = `token radar: wrote ${joinPath(destDir, 'board.json')}, ${joinPath(destDir, 'data.js')}, ${joinPath(destDir, 'dashboard')} (3 files), ${joinPath(destDir, 'screenshots')} (${shotNames.length} images) and ${joinPath(destDir, 'dossier.json')}`;
process.stdout.write(`${firstLine}\n${secondLine}\n`);
