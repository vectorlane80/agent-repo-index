import path from 'path';
import {
  absFromRel,
  code,
  git,
  heading,
  isTestFile,
  mdCell,
  read,
  relFromRoot,
  sha256,
  sortAlpha,
  uniq
} from './core.mjs';

export function generateRoutesMd(ctx, rows) {
  const lines = [heading(ctx, 'Backend Routes'), ''];
  if (rows.length === 0) lines.push('No backend routes detected.', '');
  else {
    lines.push('| Method | Path | Controller | Handler | Source |', '|---|---|---|---|---|');
    for (const row of rows) lines.push(`| ${row.method} | ${code(row.path)} | ${mdCell(row.controller)} | ${mdCell(row.handler)} | ${row.file} |`);
    lines.push('');
  }
  return lines.join('\n');
}

export function generatePagesMd(ctx, rows) {
  const lines = [heading(ctx, 'Frontend Routes'), ''];
  if (rows.length === 0) lines.push('No Angular route file detected.', '');
  else {
    lines.push('| Path | Target | Guards | Source |', '|---|---|---|---|');
    for (const row of rows) lines.push(`| ${code(row.path)} | ${mdCell(row.target)} | ${mdCell(row.guards)} | ${row.file} |`);
    lines.push('');
  }
  return lines.join('\n');
}

export function generateSchemaMd(ctx, rows) {
  const lines = [heading(ctx, 'Entity Schema'), ''];
  if (rows.length === 0) lines.push('No entities detected.', '');
  for (const entity of rows) {
    lines.push(`## ${entity.className} (table: ${code(entity.tableName)})`, '', `Source: ${entity.file}`, '');
    lines.push('| Field | Type | Kind | Notes |', '|---|---|---|---|');
    for (const pk of entity.pks) lines.push(`| ${pk} | primary | pk | - |`);
    for (const col of entity.cols.slice(0, 60)) lines.push(`| ${col.name} | ${mdCell(col.type)} | ${col.kind} | ${mdCell(col.notes)} |`);
    for (const rel of entity.rels.slice(0, 40)) lines.push(`| ${rel.name} | ${rel.type} | ${rel.kind} | - |`);
    lines.push('');
  }
  return lines.join('\n');
}

export function generateComponentsMd(ctx, rows) {
  const lines = [heading(ctx, 'Angular Components'), ''];
  if (rows.length === 0) lines.push('No Angular components detected.', '');
  else {
    lines.push('| Selector | Class | Template | Styles | Lines | Source |', '|---|---|---|---|---:|---|');
    for (const row of rows) lines.push(`| ${code(row.selector)} | ${mdCell(row.className)} | ${mdCell(row.template)} | ${mdCell(row.styles)} | ${row.lines} | ${row.file} |`);
    lines.push('');
  }
  return lines.join('\n');
}

export function extractExports(content) {
  const patterns = [
    [/export\s+function\s+([A-Za-z0-9_]+)/g, 'fn'],
    [/export\s+class\s+([A-Za-z0-9_]+)/g, 'class'],
    [/export\s+interface\s+([A-Za-z0-9_]+)/g, 'interface'],
    [/export\s+type\s+([A-Za-z0-9_]+)/g, 'type'],
    [/export\s+enum\s+([A-Za-z0-9_]+)/g, 'enum'],
    [/export\s+const\s+([A-Za-z0-9_]+)/g, 'const'],
    [/public\s+(?:static\s+)?class\s+([A-Za-z0-9_]+)/g, 'class'],
    [/public\s+interface\s+([A-Za-z0-9_]+)/g, 'interface'],
    [/public\s+enum\s+([A-Za-z0-9_]+)/g, 'enum'],
    [/public\s+record\s+([A-Za-z0-9_]+)/g, 'record'],
    [/public\s+(?:async\s+)?(?:[A-Za-z0-9_<>,?.\[\]]+\s+)+([A-Za-z0-9_]+)\s*\(/g, 'method'],
    [/\b(?:create|alter)(?:\s+or\s+alter)?\s+procedure\s+((?:\[[^\]]+\]|[A-Za-z0-9_]+)(?:\.(?:\[[^\]]+\]|[A-Za-z0-9_]+))?)/gi, 'sql procedure'],
    [/\b(?:create|alter)(?:\s+or\s+alter)?\s+function\s+((?:\[[^\]]+\]|[A-Za-z0-9_]+)(?:\.(?:\[[^\]]+\]|[A-Za-z0-9_]+))?)/gi, 'sql function'],
    [/\b(?:create|alter)(?:\s+or\s+alter)?\s+view\s+((?:\[[^\]]+\]|[A-Za-z0-9_]+)(?:\.(?:\[[^\]]+\]|[A-Za-z0-9_]+))?)/gi, 'sql view'],
    [/\b(?:create|alter)(?:\s+or\s+alter)?\s+table\s+((?:\[[^\]]+\]|[A-Za-z0-9_]+)(?:\.(?:\[[^\]]+\]|[A-Za-z0-9_]+))?)/gi, 'sql table'],
    [/\b(?:create|alter)(?:\s+or\s+alter)?\s+trigger\s+((?:\[[^\]]+\]|[A-Za-z0-9_]+)(?:\.(?:\[[^\]]+\]|[A-Za-z0-9_]+))?)/gi, 'sql trigger']
  ];
  const items = [];
  for (const [regex, label] of patterns) {
    let match;
    while ((match = regex.exec(content)) !== null) items.push(`${label} ${match[1]}`);
  }
  return items;
}

export function generateLibMd(ctx) {
  const files = ctx.allFiles.filter((f) => /\.(ts|tsx|js|jsx|mjs|cjs|cs|sql)$/.test(f) && !isTestFile(relFromRoot(ctx, f))).sort();
  const lines = [heading(ctx, 'Library Exports'), ''];
  for (const file of files) {
    const exports = extractExports(read(file));
    if (exports.length === 0) continue;
    lines.push(`## ${relFromRoot(ctx, file)}`);
    for (const item of exports.slice(0, 30)) lines.push(`- ${item}`);
    if (exports.length > 30) lines.push(`- ... ${exports.length - 30} more`);
    lines.push('');
  }
  if (lines.length === 2) lines.push('No exported/public symbols detected.', '');
  return lines.join('\n');
}

export function generateFeatureMapMd(ctx, rows) {
  const lines = [heading(ctx, 'Feature Map'), '', 'Use this before broad repo searches. Pick the closest feature, then read the listed files first.', ''];
  if (rows.length === 0) lines.push('No feature groups inferred.', '');
  else {
    lines.push('| Feature | Route roots | Backend first reads | Frontend first reads | Entities | Tests |', '|---|---|---|---|---|---|');
    for (const row of rows) {
      const routeRoots = uniq(row.routes.map((r) => `/${r.path.split('/').filter(Boolean)[0] || ''}`)).join('<br>') || '-';
      lines.push(`| ${row.moduleName} | ${mdCell(routeRoots)} | ${mdCell(row.backendFiles.slice(0, 8).join('<br>') || '-')} | ${mdCell(row.frontendPaths.slice(0, 10).join('<br>') || '-')} | ${mdCell(row.entityFiles.slice(0, 8).join('<br>') || '-')} | ${mdCell(row.tests.slice(0, 8).join('<br>') || '-')} |`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

export function generateApiClientMapMd(ctx, rows) {
  const lines = [heading(ctx, 'API Client Map'), '', 'Frontend service HTTP calls mapped to backend routes where a simple path/method match exists. Dynamic paths are normalized.', ''];
  if (rows.length === 0) lines.push('No frontend HTTP calls detected.', '');
  else {
    lines.push('| Frontend service | Method | HTTP | Route | Backend match | Line |', '|---|---|---|---|---|---:|');
    for (const row of rows) lines.push(`| ${row.serviceFile} | ${row.serviceMethod} | ${row.httpMethod} | ${code(row.route)} | ${mdCell(row.backend)} | ${row.line} |`);
    lines.push('');
  }
  return lines.join('\n');
}

export function generateTestMapMd(ctx, rows) {
  const lines = [heading(ctx, 'Test Map'), '', 'Direct tests are same-basename `.spec`/`.test` or nearby `__tests__` matches. Nearby tests are listed as fallback context.', ''];
  lines.push('| Source | Lines | Direct test | Nearby tests |', '|---|---:|---|---|');
  for (const row of rows) {
    if (!row.directSpec && row.nearbySpecs.length === 0 && row.lines < 300) continue;
    lines.push(`| ${row.source} | ${row.lines} | ${row.directSpec || '-'} | ${mdCell(row.nearbySpecs.join('<br>') || '-')} |`);
  }
  lines.push('');
  return lines.join('\n');
}

export function generateLargeFilesMd(ctx, rows) {
  const threshold = Number(ctx.config.largeFileThreshold || 300);
  const lines = [heading(ctx, 'Large Files'), '', `Files over ${threshold} lines. Read landmarks first, then jump directly to the relevant section instead of loading the whole file.`, ''];
  if (rows.length === 0) lines.push(`No files over ${threshold} lines detected.`, '');
  else {
    lines.push('| Lines | File | Landmarks |', '|---:|---|---|');
    for (const row of rows) lines.push(`| ${row.lines} | ${row.rel} | ${mdCell(row.landmarks.join('<br>') || '-')} |`);
    lines.push('');
  }
  return lines.join('\n');
}

export function generateI18nMapMd(ctx, stats) {
  const lines = [heading(ctx, 'I18N Map'), ''];
  if (stats.localeRows.length === 0) {
    lines.push('No RESX localization files detected.', '');
    return lines.join('\n');
  }
  lines.push('RESX localization files and frontend localization hot spots.', '', '## Locale Files', '');
  lines.push('| Locale | File | Keys | Lines | Missing vs baseline | Extra vs baseline |', '|---|---|---:|---:|---:|---:|');
  for (const row of stats.localeRows) lines.push(`| ${row.locale} | ${row.file} | ${row.keys.length} | ${row.lines} | ${row.missingFromEn.length} | ${row.extraVsEn.length} |`);
  lines.push('', '## Key Prefix Counts', '', '| Prefix | Count |', '|---|---:|');
  for (const [prefix, count] of Object.entries(stats.prefixCounts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) lines.push(`| ${prefix} | ${count} |`);
  lines.push('', '## Frontend Localization Hot Spots', '', '| File | t() calls | Directive keys | porterText calls | Total |', '|---|---:|---:|---:|---:|');
  for (const row of stats.usageRows.slice(0, 50)) lines.push(`| ${row.file} | ${row.tCalls} | ${row.directiveKeys} | ${row.porterText} | ${row.total} |`);
  lines.push('');
  return lines.join('\n');
}

export function generateEnvConfigMd(ctx, rows) {
  const lines = [heading(ctx, 'Env and Config Map'), '', 'Variables come from example env files plus detected source, pipeline, and config references. Values shown here are examples only.', ''];
  if (rows.length === 0) lines.push('No env/config variables detected.', '');
  else {
    lines.push('| Variable | Example/default | Example source | Used in |', '|---|---|---|---|');
    for (const row of rows) lines.push(`| ${code(row.name)} | ${mdCell(row.example || '[empty]')} | ${row.exampleFile} | ${mdCell(row.usedIn.slice(0, 10).join('<br>') || '-')} |`);
    lines.push('');
  }
  return lines.join('\n');
}

export function generateStalenessMd(ctx) {
  const tracked = git(ctx, ['ls-files']).split(/\r?\n/).filter(Boolean);
  const indexedSet = new Set(ctx.allFiles.map((file) => relFromRoot(ctx, file)));
  const indexedTracked = tracked.length ? tracked.filter((file) => indexedSet.has(file)) : [...indexedSet];
  const digest = sha256(sortAlpha(indexedTracked).map((file) => `${file}\0${sha256(read(absFromRel(ctx, file)))}`).join('\0'));
  const lines = [heading(ctx, 'Index Staleness'), '', '| Field | Value |', '|---|---|'];
  if (ctx.includeGeneratedDate) lines.push(`| Generated date | ${ctx.generatedDate} |`);
  lines.push(`| Config file | ${ctx.configPath ? relFromRoot(ctx, ctx.configPath) : '[auto-discovery only]'} |`);
  lines.push(`| Indexed files | ${indexedTracked.length} |`);
  lines.push(`| Indexed source digest | ${code(digest)} |`);
  lines.push(`| Detected adapters | ${Object.entries(ctx.detected).filter(([, v]) => v).map(([k]) => k).sort().join(', ') || '-'} |`);
  lines.push('', 'Regenerate with the `agent-repo-index` skill after source, route, entity, i18n, or config changes.', '');
  return lines.join('\n');
}

export function generateStartHereMd(ctx, counts) {
  const lines = [heading(ctx, 'AI Start Here'), '', 'Read this file first, then jump to the smallest relevant map. Avoid broad repo scans until these maps fail to answer the routing question.', ''];
  lines.push('## Fast Routing', '', '| Task | Read first | Then read |', '|---|---|---|');
  lines.push('| Backend endpoint/API work | `routes.md` | `feature-map.md`, matching controller/service files |');
  lines.push('| Frontend route/page work | `pages.md` | `components.md`, `feature-map.md`, matching page component |');
  lines.push('| Frontend service/API mismatch | `api-client-map.md` | Matching backend controller/service from the map |');
  lines.push('| Database/entity/migration work | `schema.md` | Entity file, latest matching migrations |');
  lines.push('| Localization/UI text work | `i18n-map.md` | RESX files and page/component hot spots |');
  lines.push('| Config/deployment work | `env-config.md` | Pipeline, deployment, Docker, package, and env files |');
  lines.push('| Test planning | `test-map.md` | Direct or nearby spec/test files |');
  lines.push('| Large-file edits | `large-files.md` | Jump to listed landmarks before reading entire file |');
  lines.push('', '## Generated Inventory', '');
  for (const [label, count] of Object.entries(counts)) lines.push(`- ${label}: ${count}`);
  lines.push('', '## Detected Adapters', '');
  for (const [name, enabled] of Object.entries(ctx.detected).sort()) lines.push(`- ${name}: ${enabled ? 'detected' : 'not detected'}`);
  lines.push('');
  return lines.join('\n');
}

export function getInventoryCounts(model) {
  return {
    'Backend routes': model.routes.length,
    'Frontend routes': model.pages.length,
    'Entities': model.entities.length,
    'Components': model.components.length,
    'Feature groups': model.features.length,
    'Frontend HTTP calls': model.apiClients.length,
    'Large files': model.largeFiles.length,
    'Env/config variables': model.env.length
  };
}

export function renderOutputs(ctx, model) {
  return {
    'START_HERE.md': generateStartHereMd(ctx, getInventoryCounts(model)),
    'routes.md': generateRoutesMd(ctx, model.routes),
    'pages.md': generatePagesMd(ctx, model.pages),
    'schema.md': generateSchemaMd(ctx, model.entities),
    'components.md': generateComponentsMd(ctx, model.components),
    'lib.md': generateLibMd(ctx),
    'feature-map.md': generateFeatureMapMd(ctx, model.features),
    'api-client-map.md': generateApiClientMapMd(ctx, model.apiClients),
    'test-map.md': generateTestMapMd(ctx, model.tests),
    'large-files.md': generateLargeFilesMd(ctx, model.largeFiles),
    'i18n-map.md': generateI18nMapMd(ctx, model.i18n),
    'env-config.md': generateEnvConfigMd(ctx, model.env),
    'staleness.md': generateStalenessMd(ctx)
  };
}
