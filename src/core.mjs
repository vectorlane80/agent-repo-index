import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

export const DEFAULT_EXCLUDES = [
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  '.angular',
  '.agent-index',
  '.claude',
  'coverage',
  'worktrees',
  '.turbo',
  '.cache'
];

export const DEFAULT_INCLUDE_HINTS = ['src', 'app', 'lib', 'server', 'client', 'backend/src', 'frontend/src', 'packages', 'apps', 'Api', 'Services', 'tests'];
export const SOURCE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.html',
  '.scss',
  '.css',
  '.resx',
  '.yml',
  '.yaml',
  '.env',
  '.example',
  '.cs',
  '.csproj',
  '.sln',
  '.props',
  '.targets',
  '.config',
  '.cshtml',
  '.sql',
  '.sqlproj'
]);
export const HTTP_METHODS = { Get: 'GET', Post: 'POST', Put: 'PUT', Patch: 'PATCH', Delete: 'DELETE', Options: 'OPTIONS', Head: 'HEAD', Sse: 'SSE' };
export const ADAPTER_IDS = ['nestjs', 'angular', 'typeorm', 'dotnet', 'sql', 'resx', 'env', 'tests', 'large-files', 'exports', 'api-client'];

export function normalizeAdapterId(value) {
  const raw = String(value || '').trim();
  const aliases = {
    apiClient: 'api-client',
    api_client: 'api-client',
    largeFiles: 'large-files',
    large_files: 'large-files',
    test: 'tests',
    typeOrm: 'typeorm',
    type_orm: 'typeorm',
    csharp: 'dotnet',
    aspnet: 'dotnet',
    asp_net: 'dotnet',
    mssql: 'sql',
    database: 'sql'
  };
  return aliases[raw] || raw;
}

export function read(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return '';
  }
}

export function readJson(filePath) {
  const content = read(filePath);
  if (!content) return {};
  try {
    return JSON.parse(content);
  } catch (error) {
    throw new Error(`Invalid JSON in ${filePath}: ${error.message}`);
  }
}

export function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

export function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

export function mdCell(value) {
  return String(value ?? '-').replace(/\r?\n/g, '<br>').replace(/\|/g, '\\|') || '-';
}

export function code(value) {
  return `\`${String(value ?? '-').replace(/`/g, '\\`')}\``;
}

export function uniq(values) {
  return [...new Set(values.filter(Boolean))];
}

export function sortAlpha(values) {
  return [...values].sort((a, b) => String(a).localeCompare(String(b)));
}

export function isInside(child, parent) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export function buildContext(args) {
  const rootDir = path.resolve(args.root);
  const configPath = resolveConfigPath(rootDir, args.config);
  const config = configPath ? readJson(configPath) : {};
  const outputRel = args.output || config.output || '.agent-index';
  const outputDir = path.resolve(rootDir, outputRel);
  const excludes = uniq([...(config.exclude || []), ...DEFAULT_EXCLUDES, path.relative(rootDir, outputDir).replace(/\\/g, '/')].filter(Boolean));
  const include = Array.isArray(config.include) ? config.include : [];
  const rawAdapters = args.adapters
    ? args.adapters.split(',')
    : (Array.isArray(config.adapters) && config.adapters.length ? config.adapters : ['auto']);
  const adapters = rawAdapters.map(normalizeAdapterId).filter(Boolean);
  const invalidAdapters = adapters.filter((adapter) => adapter !== 'auto' && !ADAPTER_IDS.includes(adapter));
  if (invalidAdapters.length > 0) {
    throw new Error(`Unknown adapter(s): ${invalidAdapters.join(', ')}. Valid adapters: auto, ${ADAPTER_IDS.join(', ')}`);
  }

  const ctx = {
    rootDir,
    outputDir,
    outputRel,
    config,
    configPath,
    excludes,
    include,
    adapters,
    includeGeneratedDate: args.includeGeneratedDate,
    generatedDate: new Date().toISOString().slice(0, 10)
  };
  ctx.allFiles = collectSourceFiles(ctx);
  ctx.packageJson = readJsonIfExists(path.join(rootDir, 'package.json'));
  ctx.roots = discoverRoots(ctx);
  ctx.detected = detectAdapters(ctx);
  return ctx;
}

export function resolveConfigPath(rootDir, explicitPath) {
  if (explicitPath) {
    const resolved = path.resolve(rootDir, explicitPath);
    if (!fs.existsSync(resolved)) {
      throw new Error(`Config file not found: ${resolved}`);
    }
    return resolved;
  }
  const candidates = [path.join(rootDir, 'agent-index.config.json'), path.join(rootDir, '.agent-index.config.json')];
  return candidates.find((candidate) => fs.existsSync(candidate)) || '';
}

export function readJsonIfExists(filePath) {
  return fs.existsSync(filePath) ? readJson(filePath) : {};
}

export function shouldSkipRel(rel, excludes) {
  const normalized = rel.replace(/\\/g, '/');
  return excludes.some((skip) => {
    const s = String(skip).replace(/\\/g, '/').replace(/\/$/, '');
    return normalized === s || normalized.startsWith(`${s}/`) || normalized.split('/').includes(s);
  });
}

export function collectSourceFiles(ctx) {
  const roots = candidateIncludeRoots(ctx);
  const out = [];
  const seen = new Set();
  for (const absRoot of roots) {
    walk(absRoot, ctx, (file) => {
      const rel = relFromRoot(ctx, file);
      if (seen.has(rel)) return;
      seen.add(rel);
      out.push(file);
    });
  }
  return sortAlpha(out);
}

export function candidateIncludeRoots(ctx) {
  const configured = ctx.include.map((rel) => path.resolve(ctx.rootDir, rel)).filter((p) => fs.existsSync(p));
  if (configured.length > 0) return configured;
  const hinted = DEFAULT_INCLUDE_HINTS.map((rel) => path.resolve(ctx.rootDir, rel)).filter((p) => fs.existsSync(p));
  return hinted.length > 0 ? uniq([...hinted, ctx.rootDir]) : [ctx.rootDir];
}

export function walk(dirPath, ctx, visit) {
  if (!fs.existsSync(dirPath)) return;
  const stat = fs.statSync(dirPath);
  if (stat.isFile()) {
    const rel = relFromRoot(ctx, dirPath);
    if (!shouldSkipRel(rel, ctx.excludes) && isLikelySourceFile(dirPath)) visit(dirPath);
    return;
  }
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dirPath, entry.name);
    const rel = relFromRoot(ctx, full);
    if (shouldSkipRel(rel, ctx.excludes)) continue;
    if (entry.isDirectory()) {
      walk(full, ctx, visit);
    } else if (entry.isFile() && isLikelySourceFile(full)) {
      visit(full);
    }
  }
}

export function isLikelySourceFile(filePath) {
  const base = path.basename(filePath);
  if (base.startsWith('.env')) return true;
  return SOURCE_EXTENSIONS.has(path.extname(filePath));
}

export function isTestFile(rel) {
  return /(^|\/)__tests__\//.test(rel)
    || /\.(spec|test)\.[jt]sx?$/.test(rel)
    || /(^|\/)(tests?|test-projects)\//i.test(rel)
    || /(Tests?|Specs?)\.cs$/i.test(rel);
}

export function relFromRoot(ctx, filePath) {
  return path.relative(ctx.rootDir, filePath).replace(/\\/g, '/');
}

export function absFromRel(ctx, relPath) {
  return path.resolve(ctx.rootDir, relPath);
}

export function discoverRoots(ctx) {
  const cfg = ctx.config.roots || {};
  const files = ctx.allFiles.map((file) => ({ abs: file, rel: relFromRoot(ctx, file) }));
  const controller = files.find((f) => f.rel.endsWith('.controller.ts'));
  const dotnetProgram = files.find((f) => /(^|\/)Program\.cs$/.test(f.rel));
  const dotnetController = files.find((f) => /Controller\.cs$/.test(f.rel));
  const component = files.find((f) => f.rel.endsWith('.component.ts'));
  const routeFile = firstExisting(ctx, cfg.angularRoutes)
    || files.find((f) => /(^|\/)app\.routes\.ts$/.test(f.rel))?.abs
    || files.find((f) => /\.routes\.ts$/.test(f.rel) && /path\s*:/.test(read(f.abs)))?.abs
    || '';
  const entityDir = firstExisting(ctx, cfg.typeormEntities)
    || commonDir(files.filter((f) => f.rel.endsWith('.entity.ts')).map((f) => path.dirname(f.abs)))
    || '';
  const i18nDir = firstExisting(ctx, cfg.i18n)
    || commonDir(files.filter((f) => f.rel.endsWith('.resx')).map((f) => path.dirname(f.abs)))
    || '';
  const serviceDir = firstExisting(ctx, cfg.frontendServices)
    || commonDir(files.filter((f) => /\/services\/[^/]+\.ts$/.test(f.rel) && !isTestFile(f.rel)).map((f) => path.dirname(f.abs)))
    || '';

  return {
    backend: firstExisting(ctx, cfg.backend)
      || inferRootFromFile(ctx, controller?.abs, ['backend/src', 'src'])
      || inferRootFromFile(ctx, dotnetProgram?.abs || dotnetController?.abs, ['src'])
      || '',
    frontend: firstExisting(ctx, cfg.frontend) || inferRootFromFile(ctx, component?.abs || routeFile, ['frontend/src', 'src']) || '',
    angularRoutes: routeFile,
    typeormEntities: entityDir,
    i18n: i18nDir,
    frontendServices: serviceDir
  };
}

export function firstExisting(ctx, relOrAbs) {
  if (!relOrAbs) return '';
  const abs = path.isAbsolute(relOrAbs) ? relOrAbs : absFromRel(ctx, relOrAbs);
  return fs.existsSync(abs) ? abs : '';
}

export function inferRootFromFile(ctx, filePath, markers) {
  if (!filePath) return '';
  const rel = relFromRoot(ctx, filePath);
  for (const marker of markers) {
    if (rel === marker || rel.startsWith(`${marker}/`)) return absFromRel(ctx, marker);
  }
  const parts = rel.split('/');
  const srcIndex = parts.indexOf('src');
  if (srcIndex >= 0) return absFromRel(ctx, parts.slice(0, srcIndex + 1).join('/'));
  return absFromRel(ctx, parts[0]);
}

export function commonDir(dirs) {
  const unique = uniq(dirs);
  if (unique.length === 0) return '';
  if (unique.length === 1) return unique[0];
  const split = unique.map((dir) => dir.split(path.sep));
  const first = split[0];
  let i = 0;
  while (i < first.length && split.every((parts) => parts[i] === first[i])) i += 1;
  return first.slice(0, i).join(path.sep) || path.sep;
}

export function detectAdapters(ctx) {
  const pkgText = JSON.stringify({ ...(ctx.packageJson.dependencies || {}), ...(ctx.packageJson.devDependencies || {}) });
  const contentNeedle = (pattern) => ctx.allFiles.some((file) => pattern.test(read(file)));
  const hasDotnetProjectFile = ctx.allFiles.some((f) => /\.(csproj|sln|props|targets)$/i.test(f));
  const hasDotnetSdk = ctx.allFiles.some((f) => /\.csproj$/i.test(f) && /Microsoft\.NET\.Sdk/.test(read(f)));
  const hasAspNetMarkers = ctx.allFiles.some((f) => /\.cs$/i.test(f) && /(\[ApiController\]|ControllerBase|Map(Get|Post|Put|Patch|Delete))/m.test(read(f)));
  const hasSqlScripts = ctx.allFiles.some((f) => /\.sql$/i.test(f));
  return {
    nestjs: /@nestjs\//.test(pkgText) || ctx.allFiles.some((f) => f.endsWith('.controller.ts')) || contentNeedle(/@Controller\s*\(/),
    angular: /@angular\//.test(pkgText) || Boolean(ctx.roots.angularRoutes) || ctx.allFiles.some((f) => f.endsWith('.component.ts')),
    typeorm: /typeorm/.test(pkgText) || ctx.allFiles.some((f) => f.endsWith('.entity.ts')) || contentNeedle(/@Entity\s*\(/),
    dotnet: hasDotnetProjectFile || hasDotnetSdk || hasAspNetMarkers,
    sql: hasSqlScripts,
    resx: ctx.allFiles.some((f) => f.endsWith('.resx')),
    env: true,
    tests: true,
    'large-files': true,
    exports: true,
    'api-client': true
  };
}

export function adapterEnabled(ctx, name) {
  return ctx.adapters.includes('auto') || ctx.adapters.includes(name);
}

export function heading(ctx, title) {
  return ctx.includeGeneratedDate ? `# ${title} (generated ${ctx.generatedDate})` : `# ${title}`;
}

export function lineCount(filePath) {
  const content = read(filePath);
  if (!content) return 0;
  return content.split(/\r?\n/).length;
}

export function normalizeRoute(controllerPath, methodPath) {
  const combined = `${controllerPath || ''}/${methodPath || ''}`;
  const compact = combined.replace(/\/+/g, '/').replace(/^\//, '').replace(/\/$/, '');
  return `/${compact}`.replace(/\/+/g, '/');
}

export function normalizeComparableRoute(routePath) {
  return String(routePath || '')
    .split('?')[0]
    .replace(/\$\{[^}]+\}/g, ':param')
    .replace(/:[A-Za-z0-9_]+/g, ':param')
    .replace(/\{[A-Za-z0-9_]+\}/g, ':param')
    .replace(/\/+/g, '/')
    .replace(/\/$/, '') || '/';
}

export function git(ctx, args) {
  try {
    return execFileSync('git', args, { cwd: ctx.rootDir, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

export function writeOutput(ctx, name, content) {
  fs.writeFileSync(path.join(ctx.outputDir, name), `${content.replace(/\s+$/u, '')}\n`, 'utf-8');
}
