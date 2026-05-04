#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { buildContext, ensureDir, writeOutput } from '../src/core.mjs';
import { buildIndexModel } from '../src/adapters.mjs';
import { renderOutputs } from '../src/writers.mjs';

const INSTRUCTION_LINE = 'If .agent-index/START_HERE.md exists, read it first and follow its routing before broad repo search.';

function parseArgs(argv) {
  const args = {
    root: '.',
    output: '',
    config: '',
    adapters: '',
    includeGeneratedDate: false,
    updateAgentInstructions: false,
    noAgentInstructionOffer: false
  };
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
    else if (arg === '--update-agent-instructions') args.updateAgentInstructions = true;
    else if (arg === '--no-agent-instruction-offer') args.noAgentInstructionOffer = true;
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
  console.log(`Usage: node generate-agent-repo-index.mjs [--root .] [--output .agent-index] [--config agent-index.config.json] [--include-generated-date] [--update-agent-instructions] [--no-agent-instruction-offer]

Generates .agent-index repository navigation maps with auto-discovery plus optional config.`);
}

function instructionTargets(rootDir) {
  return ['AGENTS.md', 'CLAUDE.md']
    .map((name) => path.join(rootDir, name))
    .filter((filePath) => fs.existsSync(filePath));
}

function ensureInstructionLine(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  if (content.includes(INSTRUCTION_LINE)) return false;
  const next = content.endsWith('\n') ? `${content}${INSTRUCTION_LINE}\n` : `${content}\n${INSTRUCTION_LINE}\n`;
  fs.writeFileSync(filePath, next, 'utf-8');
  return true;
}

function askYesNo(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(/^y(es)?$/i.test(String(answer || '').trim()));
    });
  });
}

async function handleInstructionGuidance(args, ctx) {
  const targets = instructionTargets(ctx.rootDir);
  console.log('Agent integration hint:');
  console.log(`- Add this line to AGENTS.md or CLAUDE.md: "${INSTRUCTION_LINE}"`);

  if (targets.length === 0) {
    console.log('- No AGENTS.md or CLAUDE.md found at repo root; skipping auto-update offer.');
    return;
  }

  if (args.updateAgentInstructions) {
    let changed = 0;
    for (const filePath of targets) if (ensureInstructionLine(filePath)) changed += 1;
    console.log(`- Updated instruction files: ${changed}/${targets.length}`);
    return;
  }

  if (args.noAgentInstructionOffer || !process.stdout.isTTY || !process.stdin.isTTY) {
    console.log('- To auto-append it, rerun with --update-agent-instructions');
    return;
  }

  const list = targets.map((filePath) => path.relative(ctx.rootDir, filePath)).join(', ');
  const yes = await askYesNo(`- Found ${list}. Append instruction line now? [y/N] `);
  if (!yes) {
    console.log('- Skipped instruction file update.');
    return;
  }

  let changed = 0;
  for (const filePath of targets) if (ensureInstructionLine(filePath)) changed += 1;
  console.log(`- Updated instruction files: ${changed}/${targets.length}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const ctx = buildContext(args);
  ensureDir(ctx.outputDir);

  const model = buildIndexModel(ctx);
  const outputs = renderOutputs(ctx, model);

  for (const [name, content] of Object.entries(outputs)) writeOutput(ctx, name, content);
  console.log(`Agent repo index generated in ${path.relative(process.cwd(), ctx.outputDir) || ctx.outputDir}:`);
  for (const name of Object.keys(outputs)) console.log(`- ${name}`);
  await handleInstructionGuidance(args, ctx);
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exit(1);
});
