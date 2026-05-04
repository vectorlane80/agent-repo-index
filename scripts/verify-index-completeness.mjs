#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { buildContext, ensureDir, writeOutput, read, sha256, sortAlpha, absFromRel, relFromRoot, git } from '../src/core.mjs';
import { buildIndexModel } from '../src/adapters.mjs';
import { renderOutputs } from '../src/writers.mjs';

function parseArgs(argv) {
  const args = {
    root: '.',
    output: '.agent-index',
    runGenerator: false,
    verifyDeterminism: false,
    cleanup: false
  };

  const readValue = (index, flag) => {
    const value = argv[index + 1];
    if (!value || value.startsWith('-')) throw new Error(`${flag} requires a value`);
    return value;
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--root') args.root = readValue(i++, arg);
    else if (arg === '--output') args.output = readValue(i++, arg);
    else if (arg === '--run-generator') args.runGenerator = true;
    else if (arg === '--verify-determinism') args.verifyDeterminism = true;
    else if (arg === '--cleanup') args.cleanup = true;
    else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
    else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return args;
}

function printHelp() {
  console.log(`Usage: node scripts/verify-index-completeness.mjs [--root .] [--output .agent-index] [--run-generator] [--verify-determinism] [--cleanup]

Checks index completeness by comparing expected indexed files and digest to staleness.md.
- --run-generator: generate index before validation.
- --verify-determinism: generate a second time and assert digest stability.
- --cleanup: delete output directory when done (useful for CI).`);
}

function generateIndex(ctx) {
  ensureDir(ctx.outputDir);
  const model = buildIndexModel(ctx);
  const outputs = renderOutputs(ctx, model);
  for (const [name, content] of Object.entries(outputs)) writeOutput(ctx, name, content);
}

function parseStaleness(stalenessPath) {
  const content = read(stalenessPath);
  if (!content) throw new Error(`Missing staleness file: ${stalenessPath}`);
  const indexedMatch = content.match(/\| Indexed files \| ([0-9]+) \|/);
  const digestMatch = content.match(/\| Indexed source digest \| `([a-f0-9]+)` \|/i);
  if (!indexedMatch || !digestMatch) throw new Error(`Unable to parse staleness file: ${stalenessPath}`);
  return {
    indexedFiles: Number(indexedMatch[1]),
    digest: digestMatch[1]
  };
}

function indexedTrackedFiles(ctx) {
  const tracked = git(ctx, ['ls-files']).split(/\r?\n/).filter(Boolean);
  const indexedSet = new Set(ctx.allFiles.map((file) => relFromRoot(ctx, file)));
  return tracked.length ? tracked.filter((file) => indexedSet.has(file)) : [...indexedSet];
}

function expectedDigest(ctx) {
  const indexedTracked = indexedTrackedFiles(ctx);
  return sha256(sortAlpha(indexedTracked).map((file) => `${file}\0${sha256(read(absFromRel(ctx, file)))}`).join('\0'));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const rootDir = path.resolve(args.root);
  const outputRel = args.output;

  let ctx = buildContext({ root: rootDir, output: outputRel, config: '', adapters: '', includeGeneratedDate: false });
  if (args.runGenerator) generateIndex(ctx);

  const stalenessPath = path.join(ctx.outputDir, 'staleness.md');
  const report = parseStaleness(stalenessPath);
  const expectedCount = indexedTrackedFiles(ctx).length;
  const digest = expectedDigest(ctx);

  console.log(`ROOT=${ctx.rootDir}`);
  console.log(`OUTPUT=${ctx.outputDir}`);
  console.log(`INDEXED_FILES_REPORTED=${report.indexedFiles}`);
  console.log(`INDEXED_FILES_EXPECTED=${expectedCount}`);
  console.log(`DIGEST_REPORTED=${report.digest}`);
  console.log(`DIGEST_EXPECTED=${digest}`);

  if (report.indexedFiles !== expectedCount) {
    throw new Error(`Indexed file count mismatch: expected ${expectedCount}, got ${report.indexedFiles}`);
  }
  if (report.digest !== digest) {
    throw new Error('Indexed digest mismatch between staleness report and source snapshot');
  }

  if (args.verifyDeterminism) {
    const before = report.digest;
    ctx = buildContext({ root: rootDir, output: outputRel, config: '', adapters: '', includeGeneratedDate: false });
    generateIndex(ctx);
    const after = parseStaleness(path.join(ctx.outputDir, 'staleness.md')).digest;
    console.log(`DIGEST_AFTER_RERUN=${after}`);
    if (before !== after) {
      throw new Error(`Determinism check failed: digest changed (${before} -> ${after})`);
    }
  }

  console.log('INDEX_COMPLETENESS=OK');

  if (args.cleanup && fs.existsSync(ctx.outputDir)) {
    fs.rmSync(ctx.outputDir, { recursive: true, force: true });
    console.log(`CLEANUP=REMOVED ${ctx.outputDir}`);
  }
}

try {
  main();
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exit(1);
}
