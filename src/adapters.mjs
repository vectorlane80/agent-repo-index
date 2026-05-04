import fs from 'fs';
import path from 'path';
import {
  HTTP_METHODS,
  absFromRel,
  adapterEnabled,
  isInside,
  isTestFile,
  lineCount,
  normalizeComparableRoute,
  normalizeRoute,
  read,
  relFromRoot,
  sortAlpha,
  uniq
} from './core.mjs';

export function extractControllerPath(content) {
  const match = content.match(/@Controller\(([^)]*)\)/s);
  if (!match) return '';
  const quoted = match[1].match(/['"]([^'"]*)['"]/);
  return quoted ? quoted[1] : '';
}

export function extractHandlerName(content, startIndex) {
  const window = content.slice(startIndex, startIndex + 1200);
  const cleaned = window.replace(/@[A-Za-z0-9_]+(?:\([^)]*\))?/g, ' ');
  const match = cleaned.match(/(?:public\s+|private\s+|protected\s+)?(?:async\s+)?([A-Za-z0-9_]+)\s*\(/);
  return match ? match[1] : '-';
}

export function extractHttpRoutes(content) {
  const out = [];
  const regex = /@(Get|Post|Put|Patch|Delete|Options|Head|Sse)\s*(?:\(([^)]*)\))?/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    const quoted = (match[2] || '').match(/['"]([^'"]*)['"]/);
    out.push({ method: HTTP_METHODS[match[1]], methodPath: quoted ? quoted[1] : '', handler: extractHandlerName(content, regex.lastIndex) });
  }
  return out;
}

export function extractDotnetControllerPath(content, controllerName) {
  const routeMatch = content.match(/\[Route\(\s*"([^"]*)"\s*\)\]/);
  const fallback = `[controller]`;
  return (routeMatch?.[1] || fallback)
    .replace(/\[controller\]/gi, controllerName.replace(/Controller$/, ''))
    .replace(/\[action\]/gi, '');
}

export function extractDotnetHandlerName(content, startIndex) {
  const window = content.slice(startIndex, startIndex + 1600);
  const match = window.match(/(?:public|private|protected|internal)\s+(?:async\s+)?(?:[A-Za-z0-9_<>,?.\[\]\s]+\s+)?([A-Za-z0-9_]+)\s*\(/);
  return match ? match[1] : '-';
}

export function extractDotnetHttpRoutes(content) {
  const methodMap = {
    HttpGet: 'GET',
    HttpPost: 'POST',
    HttpPut: 'PUT',
    HttpPatch: 'PATCH',
    HttpDelete: 'DELETE',
    HttpOptions: 'OPTIONS',
    HttpHead: 'HEAD'
  };
  const out = [];
  const regex = /\[(HttpGet|HttpPost|HttpPut|HttpPatch|HttpDelete|HttpOptions|HttpHead)(?:\(\s*"([^"]*)"\s*\))?\]/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    out.push({ method: methodMap[match[1]] || 'GET', methodPath: match[2] || '', handler: extractDotnetHandlerName(content, regex.lastIndex) });
  }
  return out;
}

export function extractDotnetMinimalApiRoutes(content) {
  const out = [];
  const regex = /\.Map(Get|Post|Put|Patch|Delete)\s*\(\s*"([^"]+)"/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    out.push({ method: match[1].toUpperCase(), methodPath: match[2], handler: 'minimal-api' });
  }
  return out;
}

export function getRouteRows(ctx) {
  const rows = [];

  if (adapterEnabled(ctx, 'nestjs') && ctx.detected.nestjs) {
    const files = ctx.allFiles.filter((f) => f.endsWith('.controller.ts') || /@Controller\s*\(/.test(read(f))).sort();
    for (const file of files) {
      const content = read(file);
      const controllerPath = extractControllerPath(content);
      const controllerName = path.basename(file).replace(/\.controller\.ts$/, '').replace(/\.(ts|tsx|js|jsx)$/, '');
      for (const route of extractHttpRoutes(content)) {
        const fullPath = normalizeRoute(controllerPath, route.methodPath);
        rows.push({
          method: route.method,
          path: fullPath,
          comparablePath: normalizeComparableRoute(fullPath),
          controller: controllerName,
          handler: route.handler,
          file: relFromRoot(ctx, file)
        });
      }
    }
  }

  if (adapterEnabled(ctx, 'dotnet') && ctx.detected.dotnet) {
    const files = ctx.allFiles.filter((f) => /\.cs$/.test(f)).filter((file) => {
      const rel = relFromRoot(ctx, file);
      if (/Controller\.cs$/.test(rel) || /(^|\/)Program\.cs$/.test(rel)) return true;
      const content = read(file);
      return /\[ApiController\]|ControllerBase|\.Map(Get|Post|Put|Patch|Delete)\(/.test(content);
    }).sort();

    for (const file of files) {
      const content = read(file);
      const rel = relFromRoot(ctx, file);

      if (/Controller\.cs$/.test(rel) || /\[ApiController\]|ControllerBase/.test(content)) {
        const controllerName = (content.match(/class\s+([A-Za-z0-9_]+Controller)\b/) || [null, path.basename(file, '.cs')])[1];
        const controllerPath = extractDotnetControllerPath(content, controllerName);
        for (const route of extractDotnetHttpRoutes(content)) {
          const fullPath = normalizeRoute(controllerPath, route.methodPath);
          rows.push({
            method: route.method,
            path: fullPath,
            comparablePath: normalizeComparableRoute(fullPath),
            controller: controllerName.replace(/Controller$/, ''),
            handler: route.handler,
            file: rel
          });
        }
      }

      if (/(^|\/)Program\.cs$/.test(rel) || /\.Map(Get|Post|Put|Patch|Delete)\(/.test(content)) {
        for (const route of extractDotnetMinimalApiRoutes(content)) {
          const fullPath = normalizeRoute('', route.methodPath);
          rows.push({
            method: route.method,
            path: fullPath,
            comparablePath: normalizeComparableRoute(fullPath),
            controller: 'Program',
            handler: route.handler,
            file: rel
          });
        }
      }
    }
  }

  return rows.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}

export function parseRouteBlocks(content) {
  const blocks = [];
  let idx = 0;
  while (idx < content.length) {
    const p = content.indexOf('path:', idx);
    if (p === -1) break;
    const open = content.lastIndexOf('{', p);
    if (open === -1) {
      idx = p + 5;
      continue;
    }
    let depth = 0;
    let close = -1;
    for (let i = open; i < content.length; i += 1) {
      const ch = content[i];
      if (ch === '{') depth += 1;
      if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          close = i;
          break;
        }
      }
    }
    if (close === -1) break;
    blocks.push(content.slice(open, close + 1));
    idx = close + 1;
  }
  return blocks;
}

export function extractValue(block, key) {
  const regex = new RegExp(`${key}\\s*:\\s*([^,\\n]+)`);
  const match = block.match(regex);
  return match ? match[1].trim() : '';
}

export function extractQuoted(value) {
  const match = String(value || '').match(/['"]([^'"]*)['"]/);
  return match ? match[1] : String(value || '').trim();
}

export function getPageRows(ctx) {
  if (!adapterEnabled(ctx, 'angular') || !ctx.detected.angular || !ctx.roots.angularRoutes) return [];
  const content = read(ctx.roots.angularRoutes);
  const rows = [];
  for (const block of parseRouteBlocks(content)) {
    const pathRaw = extractValue(block, 'path');
    if (!pathRaw) continue;
    const componentRaw = extractValue(block, 'component');
    const loadComponentMatch = block.match(/=>\s*m\.([A-Za-z0-9_]+)/);
    const redirectRaw = extractValue(block, 'redirectTo');
    const canActivate = block.match(/canActivate\s*:\s*\[([^\]]+)\]/);
    let target = 'redirect/other';
    if (componentRaw) target = componentRaw.replace(/\s+/g, ' ');
    else if (loadComponentMatch) target = `lazy-load ${loadComponentMatch[1]}`;
    else if (redirectRaw) target = `redirect -> ${extractQuoted(redirectRaw)}`;
    rows.push({
      path: extractQuoted(pathRaw),
      target,
      guards: canActivate ? canActivate[1].split(',').map((g) => g.trim()).filter(Boolean).join(', ') : '-',
      file: relFromRoot(ctx, ctx.roots.angularRoutes)
    });
  }
  return rows.sort((a, b) => a.path.localeCompare(b.path));
}

export function extractEntityName(content, fallback) {
  const explicit = content.match(/@Entity\s*\(\s*(?:\{\s*name\s*:\s*)?['"]([^'"]+)['"]/s);
  if (explicit) return explicit[1];
  const objectName = content.match(/@Entity\s*\(\s*\{\s*name\s*:\s*['"]([^'"]+)['"]/s);
  return objectName ? objectName[1] : fallback;
}

export function extractPrimaryKeys(content) {
  return [...content.matchAll(/@Primary(?:Generated)?Column\([^)]*\)\s*(?:public\s+)?([a-zA-Z0-9_]+)/g)].map((m) => m[1]);
}

export function extractColumns(content) {
  const out = [];
  const regex = /@Column\(([^)]*)\)\s*(?:public\s+)?([a-zA-Z0-9_]+)\s*[!:?]\s*([^;\n]+)/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    const opts = match[1].replace(/\s+/g, ' ').trim();
    const notes = [];
    if (/nullable\s*:\s*true/.test(opts)) notes.push('nullable');
    if (/unique\s*:\s*true/.test(opts)) notes.push('unique');
    const defaultMatch = opts.match(/default\s*:\s*([^,}]+)/);
    if (defaultMatch) notes.push(`default ${defaultMatch[1].trim()}`);
    out.push({ name: match[2], type: match[3].trim(), kind: 'column', notes: notes.join(', ') || '-' });
  }
  return out;
}

export function extractRelations(content) {
  const out = [];
  for (const decorator of ['ManyToOne', 'OneToMany', 'OneToOne', 'ManyToMany']) {
    const regex = new RegExp(`@${decorator}\\([^)]*\\)\\s*(?:public\\s+)?([a-zA-Z0-9_]+)`, 'g');
    let match;
    while ((match = regex.exec(content)) !== null) out.push({ name: match[1], type: decorator, kind: 'relation', notes: '-' });
  }
  return out;
}

export function extractDotnetPrimaryKeys(content, className) {
  const keys = [...content.matchAll(/\[Key\][\s\S]{0,200}?public\s+[A-Za-z0-9_<>,?.\[\]]+\s+([A-Za-z0-9_]+)\s*\{\s*get;\s*set;\s*\}/g)].map((m) => m[1]);
  const conventional = [...content.matchAll(/public\s+[A-Za-z0-9_<>,?.\[\]]+\s+([A-Za-z0-9_]+)\s*\{\s*get;\s*set;\s*\}/g)]
    .map((m) => m[1])
    .filter((name) => name === 'Id' || name === `${className}Id`);
  return uniq([...keys, ...conventional]);
}

export function extractDotnetColumns(content, className) {
  const primitiveTypes = new Set(['string', 'int', 'long', 'short', 'bool', 'DateTime', 'decimal', 'double', 'float', 'Guid', 'byte[]', 'TimeSpan']);
  const out = [];
  const regex = /public\s+([A-Za-z0-9_<>,?.\[\]]+)\s+([A-Za-z0-9_]+)\s*\{\s*get;\s*set;\s*\}/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    const fieldType = match[1].replace(/\?$/, '');
    const name = match[2];
    const collection = /^(ICollection|IEnumerable|List)<.+>$/.test(fieldType);
    const primitive = primitiveTypes.has(fieldType) || /^Nullable<.+>$/.test(fieldType);
    if (name === className) continue;
    if (collection || (!primitive && !name.endsWith('Id'))) {
      out.push({ name, type: fieldType, kind: 'relation', notes: collection ? 'collection' : 'navigation' });
    }
    else {
      out.push({ name, type: fieldType, kind: 'column', notes: '-' });
    }
  }
  return out;
}

export function getDotnetEntityRows(ctx) {
  if (!adapterEnabled(ctx, 'dotnet') || !ctx.detected.dotnet) return [];
  const files = ctx.allFiles.filter((file) => /\.cs$/.test(file)).filter((file) => {
    const rel = relFromRoot(ctx, file);
    if (/Controller\.cs$/.test(rel) || /(^|\/)Program\.cs$/.test(rel) || /(^|\/)Migrations\//.test(rel)) return false;
    const content = read(file);
    return /\[Table\(|\[Key\]|DbSet<|public\s+class\s+[A-Za-z0-9_]+/.test(content) && /(^|\/)(Entities|Models)\//i.test(rel);
  }).sort();

  return files.map((file) => {
    const content = read(file);
    const className = (content.match(/public\s+class\s+([A-Za-z0-9_]+)/) || [null, path.basename(file, '.cs')])[1];
    const tableName = (content.match(/\[Table\(\s*"([^"]+)"\s*\)\]/) || [null, className])[1];
    const members = extractDotnetColumns(content, className);
    return {
      className,
      fallback: className,
      tableName,
      pks: extractDotnetPrimaryKeys(content, className),
      cols: members.filter((m) => m.kind === 'column'),
      rels: members.filter((m) => m.kind === 'relation'),
      file: relFromRoot(ctx, file)
    };
  });
}

export function getSqlEntityRows(ctx) {
  if (!adapterEnabled(ctx, 'sql') || !ctx.detected.sql) return [];
  const files = ctx.allFiles.filter((file) => /\.sql$/i.test(file)).sort();
  const rows = [];
  const regex = /\b(?:create|alter)(?:\s+or\s+alter)?\s+(procedure|proc|function|view|table|trigger)\s+((?:\[[^\]]+\]|[A-Za-z0-9_]+)(?:\.(?:\[[^\]]+\]|[A-Za-z0-9_]+))?)/ig;
  for (const file of files) {
    const content = read(file);
    let match;
    while ((match = regex.exec(content)) !== null) {
      const objectType = match[1].toLowerCase() === 'proc' ? 'procedure' : match[1].toLowerCase();
      const objectName = match[2];
      const line = content.slice(0, match.index).split(/\r?\n/).length;
      rows.push({
        className: objectName,
        fallback: objectName,
        tableName: objectName,
        pks: [],
        cols: [{ name: 'object_type', type: objectType, kind: 'sql-object', notes: `line ${line}` }],
        rels: [],
        file: relFromRoot(ctx, file)
      });
    }
  }
  return rows;
}

export function getEntityRows(ctx) {
  const rows = [];
  if (adapterEnabled(ctx, 'typeorm') && ctx.detected.typeorm) {
    const files = ctx.allFiles.filter((file) => file.endsWith('.entity.ts') || /@Entity\s*\(/.test(read(file))).sort();
    for (const file of files) {
      const content = read(file);
      const fallback = path.basename(file).replace(/\.entity\.ts$/, '').replace(/\.(ts|js)$/, '');
      rows.push({
        className: (content.match(/export\s+class\s+([A-Za-z0-9_]+)/) || [null, fallback])[1],
        fallback,
        tableName: extractEntityName(content, fallback),
        pks: extractPrimaryKeys(content),
        cols: extractColumns(content),
        rels: extractRelations(content),
        file: relFromRoot(ctx, file)
      });
    }
  }
  rows.push(...getDotnetEntityRows(ctx));
  rows.push(...getSqlEntityRows(ctx));
  return rows;
}

export function getComponentRows(ctx) {
  if (!adapterEnabled(ctx, 'angular') || !ctx.detected.angular) return [];
  const files = ctx.allFiles.filter((file) => file.endsWith('.component.ts') || /@Component\s*\(/.test(read(file))).sort();
  return files.map((file) => {
    const content = read(file);
    const styleUrls = (content.match(/styleUrls\s*:\s*\[([^\]]+)\]/) || [null, ''])[1].split(',').map((s) => extractQuoted(s.trim())).filter(Boolean);
    const imports = (content.match(/imports\s*:\s*\[([\s\S]*?)\]/) || [null, ''])[1].split(',').map((s) => s.trim()).filter(Boolean).slice(0, 12).join(', ');
    return {
      selector: (content.match(/selector\s*:\s*['"]([^'"]+)['"]/) || [null, '-'])[1],
      className: (content.match(/export\s+class\s+([A-Za-z0-9_]+)/) || [null, '-'])[1],
      template: (content.match(/templateUrl\s*:\s*['"]([^'"]+)['"]/) || [null, ''])[1] || (/template\s*:\s*[`'"]/.test(content) ? '[inline]' : '-'),
      styles: (content.match(/styleUrl\s*:\s*['"]([^'"]+)['"]/) || [null, ''])[1] || styleUrls.join(', ') || '-',
      imports: imports || '-',
      lines: lineCount(file),
      file: relFromRoot(ctx, file)
    };
  });
}

export function featureNameFromRel(rel) {
  const parts = rel.split('/');
  const markers = ['modules', 'features', 'pages', 'routes', 'services'];
  for (const marker of markers) {
    const i = parts.indexOf(marker);
    if (i >= 0 && parts[i + 1]) return parts[i + 1].replace(/\.(service|controller|module|component)$/, '');
  }
  const srcIndex = parts.indexOf('src');
  if (srcIndex >= 0 && parts[srcIndex + 1]) return parts[srcIndex + 1];
  return parts[0] || 'root';
}

export function getFeatureRows(ctx, routeRows, entityRows, componentRows) {
  const featureMap = new Map();
  const ensure = (name) => {
    const key = name || 'root';
    if (!featureMap.has(key)) featureMap.set(key, { moduleName: key, routes: [], backendFiles: new Set(), frontendPaths: new Set(), entityFiles: new Set(), tests: new Set() });
    return featureMap.get(key);
  };

  for (const route of routeRows) {
    const name = featureNameFromRel(route.file);
    const row = ensure(name);
    row.routes.push(route);
    row.backendFiles.add(route.file);
  }

  for (const file of ctx.allFiles) {
    const rel = relFromRoot(ctx, file);
    if (isTestFile(rel)) {
      ensure(featureNameFromRel(rel)).tests.add(rel);
      continue;
    }
    if (/\.(controller|service|module)\.[jt]s$/.test(rel) || /Controller\.cs$/.test(rel) || /(^|\/)Program\.cs$/.test(rel) || /\.sql$/i.test(rel)) ensure(featureNameFromRel(rel)).backendFiles.add(rel);
    if (/\/(pages|components|routes|app)\//.test(rel) || rel.endsWith('.component.ts')) ensure(featureNameFromRel(rel)).frontendPaths.add(rel);
  }

  for (const entity of entityRows) ensure(featureNameFromRel(entity.file)).entityFiles.add(entity.file);
  for (const component of componentRows) ensure(featureNameFromRel(component.file)).frontendPaths.add(component.file);

  for (const [name, hint] of Object.entries(ctx.config.featureHints || {})) {
    const row = ensure(name);
    for (const p of [...(hint.paths || []), ...(hint.services || [])]) {
      if (fs.existsSync(absFromRel(ctx, p))) row.frontendPaths.add(p);
    }
    for (const entityNeedle of hint.entities || []) {
      for (const entity of entityRows) {
        if (entity.file.includes(entityNeedle) || entity.tableName.includes(String(entityNeedle).replace(/-/g, '_'))) row.entityFiles.add(entity.file);
      }
    }
  }

  return sortAlpha([...featureMap.values()].map((row) => ({
    moduleName: row.moduleName,
    routes: row.routes,
    backendFiles: sortAlpha([...row.backendFiles]),
    frontendPaths: sortAlpha([...row.frontendPaths]),
    entityFiles: sortAlpha([...row.entityFiles]),
    tests: sortAlpha([...row.tests])
  }))).filter((row) => row.routes.length || row.backendFiles.length || row.frontendPaths.length || row.entityFiles.length || row.tests.length);
}

export function extractUrlVariables(lines) {
  const vars = new Map();
  const content = lines.join('\n');
  const patterns = [
    /(?:const|let|var)\s+([A-Za-z0-9_]+)\s*=\s*(`[^`]*(?:environment\.apiUrl|this\.api|API_URL|apiUrl)[^`]*`)/g,
    /(?:private\s+)?(?:readonly\s+)?([A-Za-z0-9_]+)\s*=\s*(`[^`]*(?:environment\.apiUrl|this\.api|API_URL|apiUrl)[^`]*`)/g
  ];
  for (const regex of patterns) {
    let match;
    while ((match = regex.exec(content)) !== null) vars.set(match[1], match[2].slice(1, -1));
  }
  return vars;
}

export function routeFromApiTemplate(raw) {
  const apiStripped = String(raw || '')
    .replace(/^.*\$\{\s*(?:environment\.apiUrl|this\.api|API_URL|apiUrl)\s*\}/, '')
    .replace(/^.*(?:environment\.apiUrl|this\.api|API_URL|apiUrl)/, '');
  const noQuery = apiStripped.replace(/\$\{\s*(?:query|suffix)\b[\s\S]*$/m, '').split('?')[0];
  return noQuery
    .replace(/\$\{\s*encodeURIComponent\(([^)]+)\)\s*\}/g, (_, expr) => `:${String(expr).trim().split('.').pop().replace(/[^A-Za-z0-9_]/g, '') || 'param'}`)
    .replace(/\$\{([^}]+)\}/g, (_, expr) => `:${String(expr).trim().split('.').pop().replace(/[^A-Za-z0-9_]/g, '') || 'param'}`)
    .replace(/\/+/g, '/')
    .replace(/\/$/, '') || '/';
}

export function extractHttpUrl(chunk, urlVars) {
  const directArg = chunk.match(/(?:\.|fetch\s*\()\s*(?:get|post|put|patch|delete)?[\s\S]{0,2000}?\(\s*(?:this\.)?([A-Za-z0-9_]+)\s*[,)]/i);
  const templateMatch = [...chunk.matchAll(/`([^`]*(?:environment\.apiUrl|this\.api|API_URL|apiUrl|\/api\/|\/api)[^`]*)`/gs)].find((m) => !m[1].includes('assets/build-info.json'));
  if (directArg && urlVars.has(directArg[1]) && (!templateMatch || templateMatch.index > directArg.index + 300)) {
    const raw = urlVars.get(directArg[1]);
    return { raw, route: routeFromApiTemplate(raw) };
  }
  const stringMatch = chunk.match(/['"]([^'"]*(?:environment\.apiUrl|this\.api|API_URL|apiUrl|\/api\/|\/api)[^'"]*)['"]/s);
  const assetMatch = chunk.match(/['"]((?:assets|\/assets)\/[^'"]+)['"]/);
  const raw = templateMatch?.[1] || stringMatch?.[1] || assetMatch?.[1] || '';
  if (raw) {
    if (assetMatch && !/(environment\.apiUrl|this\.api|API_URL|apiUrl|\/api)/.test(raw)) return { raw, route: raw };
    return { raw, route: routeFromApiTemplate(raw) };
  }
  if (directArg && urlVars.has(directArg[1])) {
    const raw = urlVars.get(directArg[1]);
    return { raw, route: routeFromApiTemplate(raw) };
  }
  return { raw: '', route: '' };
}

export function extractServiceMethodsAndCalls(ctx, file) {
  const lines = read(file).split(/\r?\n/);
  const calls = [];
  let currentMethod = '-';
  const urlVars = extractUrlVariables(lines);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const methodMatch = line.match(/^\s{2}(?:async\s+)?([A-Za-z0-9_]+)\s*\(/);
    if (methodMatch && !['if', 'for', 'while', 'switch', 'catch'].includes(methodMatch[1])) currentMethod = methodMatch[1];
    const fetchMatch = line.match(/\bfetch\s*\(/i);
    const axiosMatch = line.match(/\baxios\.(get|post|put|patch|delete)\s*\(/i);
    const httpClientMatch = line.match(/\b(?:this\.)?[A-Za-z0-9_]*(?:http|api|client)[A-Za-z0-9_]*\s*\.\s*(get|post|put|patch|delete)\s*</i)
      || line.match(/\b(?:this\.)?[A-Za-z0-9_]*(?:http|api|client)[A-Za-z0-9_]*\s*\.\s*(get|post|put|patch|delete)\s*\(/i);
    if (!fetchMatch && !axiosMatch && !httpClientMatch) continue;
    const chunk = lines.slice(i, Math.min(i + 160, lines.length)).join('\n');
    const url = extractHttpUrl(chunk, urlVars);
    const fetchMethod = fetchMatch ? ((chunk.match(/method\s*:\s*['"]([A-Z]+)['"]/i) || [null, 'GET'])[1].toUpperCase()) : '';
    calls.push({
      serviceFile: relFromRoot(ctx, file),
      serviceMethod: currentMethod,
      httpMethod: (axiosMatch?.[1] || httpClientMatch?.[1] || fetchMethod || 'GET').toUpperCase(),
      url: url.raw || '-',
      route: url.route || '-',
      line: i + 1
    });
  }
  return calls;
}

export function getApiClientRows(ctx, routeRows) {
  if (!adapterEnabled(ctx, 'api-client')) return [];
  const frontendRoot = ctx.roots.frontend || '';
  const serviceRoot = ctx.roots.frontendServices || '';
  const files = ctx.allFiles.filter((f) => /\.(ts|tsx|js|jsx)$/.test(f) && !isTestFile(relFromRoot(ctx, f))).filter((file) => {
    const rel = relFromRoot(ctx, file);
    const inFrontend = frontendRoot ? isInside(file, frontendRoot) : true;
    const inConfiguredServices = serviceRoot ? isInside(file, serviceRoot) : false;
    if (!inFrontend && !inConfiguredServices) return false;
    return inConfiguredServices || /\/services\//.test(rel) || /\b(HttpClient|fetch\s*\(|axios\.)\b/.test(read(file));
  }).sort();
  const routeIndex = new Map(routeRows.map((r) => [`${r.method} ${r.comparablePath}`, r]));
  const rows = files.flatMap((file) => extractServiceMethodsAndCalls(ctx, file));
  for (const row of rows) {
    if (row.route.startsWith('assets/')) {
      row.backend = 'frontend asset';
      continue;
    }
    const match = routeIndex.get(`${row.httpMethod} ${normalizeComparableRoute(row.route)}`);
    row.backend = match ? `${match.controller}.${match.handler} (${match.file})` : 'no exact route match';
  }
  return rows;
}

export function getTestRows(ctx) {
  const sourceFiles = ctx.allFiles.filter((f) => /\.(ts|tsx|js|jsx|mjs|cjs|cs)$/.test(f) && !isTestFile(relFromRoot(ctx, f))).sort();
  const testFiles = new Set(ctx.allFiles.filter((f) => isTestFile(relFromRoot(ctx, f))).map((f) => relFromRoot(ctx, f)));
  const testList = [...testFiles];
  return sourceFiles.map((file) => {
    const rel = relFromRoot(ctx, file);
    const dir = path.dirname(rel);
    const ext = path.extname(rel);
    const base = rel.slice(0, -ext.length);
    const directCandidates = [
      `${base}.spec${ext}`,
      `${base}.test${ext}`,
      `${dir}/__tests__/${path.basename(base)}.spec${ext}`,
      `${dir}/__tests__/${path.basename(base)}.test${ext}`,
      `${base}Tests.cs`,
      `${base}Test.cs`,
      `${base}Specs.cs`,
      `${dir}/${path.basename(base)}Tests.cs`
    ];
    let direct = directCandidates.find((candidate) => testFiles.has(candidate)) || '';
    if (!direct && ext === '.cs') {
      const baseName = path.basename(base);
      direct = testList.find((candidate) => /(^|\/)(tests?|test-projects)\//i.test(candidate) && new RegExp(`${baseName}(Test|Tests|Spec|Specs)\\.cs$`, 'i').test(path.basename(candidate))) || '';
    }
    const nearby = testList.filter((spec) => spec.startsWith(`${dir}/`) && spec !== direct).slice(0, 5);
    return { source: rel, lines: lineCount(file), directSpec: direct, nearbySpecs: nearby };
  });
}

export function extractLandmarks(file) {
  const lines = read(file).split(/\r?\n/);
  const landmarks = [];
  const patterns = [
    [/export\s+class\s+([A-Za-z0-9_]+)/, 'class'],
    [/export\s+function\s+([A-Za-z0-9_]+)/, 'fn'],
    [/^\s{2,}(?:async\s+)?([A-Za-z0-9_]+)\s*\([^)]*\)\s*(?::[^{]+)?\{/, 'method'],
    [/^\s{2,}(?:readonly\s+)?([A-Za-z0-9_]+)\s*=\s*(?:computed|signal|new\s+BehaviorSubject)/, 'state'],
    [/public\s+class\s+([A-Za-z0-9_]+)/, 'class'],
    [/public\s+(?:async\s+)?(?:[A-Za-z0-9_<>,?.\[\]]+\s+)+([A-Za-z0-9_]+)\s*\(/, 'method'],
    [/\b(?:create|alter)(?:\s+or\s+alter)?\s+(?:procedure|proc|function|view|table|trigger)\s+((?:\[[^\]]+\]|[A-Za-z0-9_]+)(?:\.(?:\[[^\]]+\]|[A-Za-z0-9_]+))?)/i, 'sql']
  ];
  for (let i = 0; i < lines.length; i += 1) {
    for (const [regex, label] of patterns) {
      const match = lines[i].match(regex);
      if (match) {
        landmarks.push(`${label} ${match[1]}:${i + 1}`);
        break;
      }
    }
    if (landmarks.length >= 24) break;
  }
  return landmarks;
}

export function getLargeFileRows(ctx) {
  const threshold = Number(ctx.config.largeFileThreshold || 300);
  return ctx.allFiles
    .filter((f) => /\.(ts|tsx|js|jsx|html|scss|css|json|resx|yml|yaml|cs|csproj|sql|sqlproj)$/.test(f))
    .map((file) => ({ file, rel: relFromRoot(ctx, file), lines: lineCount(file), landmarks: extractLandmarks(file) }))
    .filter((row) => row.lines >= threshold)
    .sort((a, b) => b.lines - a.lines || a.rel.localeCompare(b.rel));
}

export function parseResxKeys(file) {
  return [...read(file).matchAll(/<data\s+name="([^"]+)"/g)].map((m) => m[1]);
}

export function getI18nStats(ctx) {
  if (!adapterEnabled(ctx, 'resx') || !ctx.detected.resx) return { localeRows: [], prefixCounts: {}, usageRows: [] };
  const resxFiles = ctx.allFiles.filter((f) => f.endsWith('.resx')).sort();
  const files = resxFiles.map((file) => ({ file: relFromRoot(ctx, file), locale: path.basename(file, '.resx'), keys: parseResxKeys(file), lines: lineCount(file) }));
  const en = files.find((f) => f.locale === 'en') || files[0];
  const enKeys = new Set(en?.keys || []);
  const localeRows = files.map((f) => {
    const keys = new Set(f.keys);
    return { ...f, missingFromEn: [...enKeys].filter((key) => !keys.has(key)), extraVsEn: [...keys].filter((key) => !enKeys.has(key)) };
  });
  const prefixCounts = {};
  for (const key of en?.keys || []) {
    const prefix = key.includes('.') ? key.split('.')[0] : '[none]';
    prefixCounts[prefix] = (prefixCounts[prefix] || 0) + 1;
  }
  const usageRows = ctx.allFiles
    .filter((f) => /\.(ts|tsx|html)$/.test(f) && !isTestFile(relFromRoot(ctx, f)))
    .map((file) => {
      const content = read(file);
      const tCalls = [...content.matchAll(/\bt\(\s*['"]([^'"]+)['"]/g)].length;
      const directiveKeys = [...content.matchAll(/(?:vmResx|resxKey|data-resx)=["']([^"']+)["']/g)].length;
      const porterText = [...content.matchAll(/\bporterText\(\s*['"]([^'"]+)['"]/g)].length;
      return { file: relFromRoot(ctx, file), tCalls, directiveKeys, porterText, total: tCalls + directiveKeys + porterText };
    })
    .filter((row) => row.total > 0)
    .sort((a, b) => b.total - a.total || a.file.localeCompare(b.file));
  return { localeRows, prefixCounts, usageRows };
}

export function getEnvRows(ctx) {
  const envFiles = collectEnvConfigFiles(ctx);
  const exampleFiles = envFiles.filter((file) => /(^|\/)\.env(\.[A-Za-z0-9_-]+)?(\.example|\.sample)?$/.test(relFromRoot(ctx, file)) || /\.env\.example$/.test(file));
  const exampleVars = new Map();
  for (const file of exampleFiles) {
    for (const line of read(file).split(/\r?\n/)) {
      const match = line.match(/^([A-Z][A-Z0-9_]+)=(.*)$/);
      if (match && !exampleVars.has(match[1])) exampleVars.set(match[1], { value: match[2], file: relFromRoot(ctx, file) });
    }
  }
  const uses = new Map();
  const patterns = [
    /process\.env\.([A-Z0-9_]+)/g,
    /process\.env\[['"]([A-Z0-9_]+)['"]\]/g,
    /ConfigService[^\n]+get(?:OrThrow)?\(['"]([A-Z0-9_]+)['"]\)/g,
    /Configuration\[['"]([A-Z0-9_:]+)['"]\]/g,
    /GetValue<[^>]+>\(['"]([A-Z0-9_:]+)['"]\)/g,
    /\$\(([A-Z0-9_]+)\)/g,
    /\$\{([A-Z0-9_]+)\}/g
  ];
  for (const file of envFiles) {
    const content = read(file);
    for (const regex of patterns) {
      let match;
      while ((match = regex.exec(content)) !== null) {
        if (!uses.has(match[1])) uses.set(match[1], new Set());
        uses.get(match[1]).add(relFromRoot(ctx, file));
      }
    }
  }
  const allVars = sortAlpha([...new Set([...exampleVars.keys(), ...uses.keys()])]);
  return allVars.map((name) => ({
    name,
    example: exampleVars.has(name) ? exampleVars.get(name).value : '[not in example env]',
    exampleFile: exampleVars.get(name)?.file || '-',
    usedIn: sortAlpha([...(uses.get(name) || [])])
  }));
}

export function collectEnvConfigFiles(ctx) {
  const files = new Map(ctx.allFiles.map((file) => [relFromRoot(ctx, file), file]));
  const candidates = [
    '.env',
    '.env.example',
    '.env.sample',
    'backend/.env',
    'backend/.env.example',
    'backend/.env.sample',
    'frontend/.env',
    'frontend/.env.example',
    'frontend/.env.sample',
    'azure-pipelines.yml',
    'azure-pipelines.yaml',
    'docker-compose.yml',
    'docker-compose.yaml',
    'appsettings.json',
    'appsettings.Development.json',
    'appsettings.Production.json',
    'package.json',
    'backend/package.json',
    'frontend/package.json'
  ];
  for (const rel of candidates) {
    const abs = absFromRel(ctx, rel);
    if (fs.existsSync(abs)) files.set(rel, abs);
  }
  const envDirs = [
    'src/environments',
    'frontend/src/environments',
    'frontend/src/app/environments',
    'app/environments'
  ];
  for (const relDir of envDirs) {
    const absDir = absFromRel(ctx, relDir);
    if (!fs.existsSync(absDir) || !fs.statSync(absDir).isDirectory()) continue;
    for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
      if (entry.isFile() && /\.(ts|js|json)$/.test(entry.name)) {
        const abs = path.join(absDir, entry.name);
        files.set(relFromRoot(ctx, abs), abs);
      }
    }
  }
  return sortAlpha([...files.values()]);
}

export function buildIndexModel(ctx) {
  const routes = getRouteRows(ctx);
  const pages = getPageRows(ctx);
  const entities = getEntityRows(ctx);
  const components = getComponentRows(ctx);
  const features = getFeatureRows(ctx, routes, entities, components);
  const apiClients = getApiClientRows(ctx, routes);
  const tests = getTestRows(ctx);
  const largeFiles = getLargeFileRows(ctx);
  const i18n = getI18nStats(ctx);
  const env = getEnvRows(ctx);

  return {
    meta: {
      rootDir: ctx.rootDir,
      configPath: ctx.configPath,
      detected: ctx.detected,
      generatedDate: ctx.includeGeneratedDate ? ctx.generatedDate : null
    },
    routes,
    pages,
    entities,
    components,
    features,
    apiClients,
    tests,
    largeFiles,
    i18n,
    env
  };
}
