#!/usr/bin/env node

import path from 'path';
import { buildContext, ensureDir, writeOutput } from '../src/core.mjs';
import { buildIndexModel } from '../src/adapters.mjs';
import { renderOutputs } from '../src/writers.mjs';

function parseArgs(argv) {
  const args = { root: '.', output: '', config: '', adapters: '', includeGeneratedDate: false };
  const readValue = (index, flag) => {
    const value = argv[index + 1];
    if (!value || value.startsWith('-')) {
      throw new Error(`${flag} requires a value`);
    }
    return value;
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--root') args.root = readValue(i++, arg);
    else if (arg === '--output') args.output = readValue(i++, arg);
    else if (arg === '--config') args.config = readValue(i++, arg);
    else if (arg === '--adapters') args.adapters = readValue(i++, arg);
    else if (arg === '--include-generated-date') args.includeGeneratedDate = true;
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
  console.log(`Usage: node generate-agent-repo-index.mjs [--root .] [--output .agent-index] [--config agent-index.config.json] [--include-generated-date]

Generates .agent-index repository navigation maps with auto-discovery plus optional config.`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const ctx = buildContext(args);
  ensureDir(ctx.outputDir);

  const model = buildIndexModel(ctx);
  const outputs = renderOutputs(ctx, model);

  for (const [name, content] of Object.entries(outputs)) writeOutput(ctx, name, content);
  console.log(`Agent repo index generated in ${path.relative(process.cwd(), ctx.outputDir) || ctx.outputDir}:`);
  for (const name of Object.keys(outputs)) console.log(`- ${name}`);
}

try {
  main();
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exit(1);
}
