#!/usr/bin/env node

import fs from 'fs';
import os from 'os';
import path from 'path';
import { buildContext } from '../src/core.mjs';
import { buildIndexModel } from '../src/adapters.mjs';

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function write(file, content) {
  mkdirp(path.dirname(file));
  fs.writeFileSync(file, content, 'utf-8');
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-repo-index-fixture-'));

write(path.join(root, 'package.json'), JSON.stringify({ dependencies: { '@angular/core': '1.0.0' } }, null, 2));
write(path.join(root, 'backend/.env.example'), 'API_KEY=example\n');
write(path.join(root, 'azure-pipelines.yml'), 'variables:\n  FROM_PIPELINE: $(API_KEY)\n');
write(path.join(root, 'docker-compose.yml'), 'services:\n  app:\n    environment:\n      API_KEY: ${API_KEY}\n');
write(path.join(root, 'frontend/src/environments/environment.ts'), "export const environment = { apiUrl: 'http://localhost' };\n");
write(path.join(root, 'src/app/services/foo.service.ts'), "export class FooService {\n  getData() { return this.http.get(`${environment.apiUrl}/api/foo`); }\n}\n");
write(path.join(root, 'src/app/services/foo.service.spec.ts'), 'describe("foo", () => {});\n');

const ctx = buildContext({ root, output: path.join(root, '.agent-index'), config: '', adapters: '', includeGeneratedDate: false });
assert(ctx.roots.frontendServices.endsWith('src/app/services'), 'frontendServices root should be inferred without throwing');

const aliasCtx = buildContext({ root, output: path.join(root, '.agent-index'), config: '', adapters: 'apiClient,largeFiles', includeGeneratedDate: false });
assert(aliasCtx.adapters.includes('api-client'), 'apiClient alias should normalize to api-client');
assert(aliasCtx.adapters.includes('large-files'), 'largeFiles alias should normalize to large-files');

let missingConfigFailed = false;
try {
  buildContext({ root, output: '', config: 'missing-config.json', adapters: '', includeGeneratedDate: false });
} catch {
  missingConfigFailed = true;
}
assert(missingConfigFailed, 'missing explicit config should throw');

const includeConfig = path.join(root, 'agent-index.config.json');
write(includeConfig, JSON.stringify({ include: ['src'] }, null, 2));
const configuredCtx = buildContext({ root, output: path.join(root, '.agent-index'), config: includeConfig, adapters: '', includeGeneratedDate: false });
const model = buildIndexModel(configuredCtx);
const apiKey = model.env.find((row) => row.name === 'API_KEY');
assert(apiKey, 'API_KEY from backend/.env.example should be included even when include is src only');
assert(apiKey.example === 'example', 'API_KEY example value should come from backend/.env.example');
assert(apiKey.usedIn.some((file) => file === 'azure-pipelines.yml'), 'azure-pipelines.yml should be scanned for env references');
assert(apiKey.usedIn.some((file) => file === 'docker-compose.yml'), 'docker-compose.yml should be scanned for env references');

console.log('self-test ok');
