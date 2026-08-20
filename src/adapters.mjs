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

export function extractPhpControllerAction(raw) {
  const value = String(raw || '').replace(/\s+/g, ' ').trim();
  const arrayMatch = value.match(/\[\s*([A-Za-z0-9_\\]+)::class\s*,\s*['"]([A-Za-z0-9_]+)['"]\s*\]/);
  if (arrayMatch) return { controller: arrayMatch[1].split('\\').pop(), handler: arrayMatch[2] };
  const stringMatch = value.match(/['"]([A-Za-z0-9_\\]+)@([A-Za-z0-9_]+)['"]/);
  if (stringMatch) return { controller: stringMatch[1].split('\\').pop(), handler: stringMatch[2] };
  const invokableMatch = value.match(/([A-Za-z0-9_\\]+)::class/);
  if (invokableMatch) return { controller: invokableMatch[1].split('\\').pop(), handler: '__invoke' };
  const closureMatch = value.match(/function\s*\(/);
  if (closureMatch) return { controller: 'closure', handler: 'closure' };
  return { controller: '-', handler: '-' };
}

export function extractPhpRouteArguments(content, startIndex) {
  const open = content.indexOf('(', startIndex);
  if (open === -1) return '';
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let i = open; i < content.length; i += 1) {
    const ch = content[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '(' || ch === '[') depth += 1;
    if (ch === ')' || ch === ']') {
      depth -= 1;
      if (depth === 0) return content.slice(open + 1, i);
    }
  }
  return '';
}

export function splitTopLevelArgs(args) {
  const out = [];
  let start = 0;
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let i = 0; i < args.length; i += 1) {
    const ch = args[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '(' || ch === '[') depth += 1;
    if (ch === ')' || ch === ']') depth -= 1;
    if (ch === ',' && depth === 0) {
      out.push(args.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(args.slice(start).trim());
  return out.filter(Boolean);
}

export function extractPhpRoutes(content) {
  const rows = [];
  const methodMap = {
    get: ['GET'],
    post: ['POST'],
    put: ['PUT'],
    patch: ['PATCH'],
    delete: ['DELETE'],
    options: ['OPTIONS'],
    any: ['ANY']
  };
  const routeRegex = /\bRoute::(get|post|put|patch|delete|options|any|match|resource|apiResource)\s*\(/ig;
  let match;
  while ((match = routeRegex.exec(content)) !== null) {
    const kind = match[1];
    const args = splitTopLevelArgs(extractPhpRouteArguments(content, match.index));
    const firstQuoted = args[0]?.match(/['"]([^'"]*)['"]/);
    const uri = firstQuoted?.[1] || '';
    if (!uri) continue;

    if (kind.toLowerCase() === 'match') {
      const methods = [...(args[0] || '').matchAll(/['"]([A-Za-z]+)['"]/g)].map((m) => m[1].toUpperCase());
      const routeUri = (args[1]?.match(/['"]([^'"]*)['"]/) || [null, ''])[1];
      const action = extractPhpControllerAction(args.slice(2).join(', '));
      for (const method of methods) rows.push({ method, methodPath: routeUri, ...action });
      continue;
    }

    if (/^(apiResource|resource)$/i.test(kind)) {
      const action = extractPhpControllerAction(args[1] || '');
      const resourceMethods = kind === 'apiResource'
        ? [['GET', uri, 'index'], ['POST', uri, 'store'], ['GET', `${uri}/{id}`, 'show'], ['PUT', `${uri}/{id}`, 'update'], ['PATCH', `${uri}/{id}`, 'update'], ['DELETE', `${uri}/{id}`, 'destroy']]
        : [['GET', uri, 'index'], ['GET', `${uri}/create`, 'create'], ['POST', uri, 'store'], ['GET', `${uri}/{id}`, 'show'], ['GET', `${uri}/{id}/edit`, 'edit'], ['PUT', `${uri}/{id}`, 'update'], ['PATCH', `${uri}/{id}`, 'update'], ['DELETE', `${uri}/{id}`, 'destroy']];
      for (const [method, methodPath, handler] of resourceMethods) rows.push({ method, methodPath, controller: action.controller, handler });
      continue;
    }

    const action = extractPhpControllerAction(args.slice(1).join(', '));
    for (const method of methodMap[kind.toLowerCase()] || [kind.toUpperCase()]) rows.push({ method, methodPath: uri, ...action });
  }
  return rows;
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

  if (adapterEnabled(ctx, 'php') && ctx.detected.php) {
    const files = ctx.allFiles.filter((f) => /\.php$/i.test(f)).filter((file) => {
      const rel = relFromRoot(ctx, file);
      return /(^|\/)routes\/[^/]+\.php$/.test(rel) || /\bRoute::/.test(read(file));
    }).sort();

    for (const file of files) {
      const rel = relFromRoot(ctx, file);
      for (const route of extractPhpRoutes(read(file))) {
        const fullPath = normalizeRoute('', route.methodPath);
        rows.push({
          method: route.method,
          path: fullPath,
          comparablePath: normalizeComparableRoute(fullPath),
          controller: route.controller,
          handler: route.handler,
          file: rel
        });
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

function skipPythonString(content, start) {
  const quote = content[start];
  const triple = content.slice(start, start + 3) === quote.repeat(3);
  let i = start + (triple ? 3 : 1);
  while (i < content.length) {
    if (content[i] === '\\') { i += 2; continue; }
    if (triple) {
      if (content.slice(i, i + 3) === quote.repeat(3)) return i + 3;
      i += 1;
    } else if (content[i] === quote) {
      return i + 1;
    } else {
      i += 1;
    }
  }
  return content.length;
}

function matchPythonParens(content, open) {
  let depth = 1;
  let i = open + 1;
  while (i < content.length) {
    const ch = content[i];
    if (ch === '#') { while (i < content.length && content[i] !== '\n') i += 1; continue; }
    if (ch === '"' || ch === "'") { i = skipPythonString(content, i); continue; }
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    if (ch === ')' || ch === ']' || ch === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
    i += 1;
  }
  return -1;
}

function findPythonRouteCalls(content) {
  const calls = [];
  let i = 0;
  const n = content.length;
  while (i < n) {
    const ch = content[i];
    if (ch === '#') { while (i < n && content[i] !== '\n') i += 1; continue; }
    if (ch === '"' || ch === "'") { i = skipPythonString(content, i); continue; }
    if (ch === '@') {
      const lineStart = content.lastIndexOf('\n', i - 1) + 1;
      if (/^[ \t]*$/.test(content.slice(lineStart, i))) {
        const m = content.slice(i + 1, i + 80).match(/^([A-Za-z_][A-Za-z0-9_.]*)/);
        if (m) {
          let j = i + 1 + m[0].length;
          while (j < n && /[ \t]/.test(content[j])) j += 1;
          if (content[j] === '(') {
            const close = matchPythonParens(content, j);
            if (close !== -1) {
              calls.push({ kind: 'decorator', start: i, decorator: m[1], args: content.slice(j + 1, close) });
              i = close + 1;
              continue;
            }
          }
        }
      }
      i += 1;
      continue;
    }
    if (ch === 'p' && content.startsWith('path(', i)) {
      const before = i === 0 ? '' : content[i - 1];
      if (!/[A-Za-z0-9_.]/.test(before)) {
        const close = matchPythonParens(content, i + 4);
        if (close !== -1) {
          calls.push({ kind: 'path', start: i, args: content.slice(i + 5, close) });
          i = close + 1;
          continue;
        }
      }
    }
    i += 1;
  }
  return calls;
}

function splitPythonArgs(args) {
  const out = [];
  let start = 0;
  let depth = 0;
  let quote = '';
  let escaped = false;
  const commentSpans = [];
  const pushItem = (end) => {
    // Comments are never part of an argument's semantic text: a comment may
    // sit between a list item and its trailing comma (e.g. ["GET" # keep\n, "POST"]),
    // so strip every comment span contained in the slice before emitting it.
    let text = args.slice(start, end);
    for (let k = commentSpans.length - 1; k >= 0; k -= 1) {
      const [cs, ce] = commentSpans[k];
      if (cs >= start && ce <= end) text = text.slice(0, cs - start) + text.slice(ce - start);
    }
    out.push(text.trim());
    start = end + 1;
  };
  for (let i = 0; i < args.length; i += 1) {
    const ch = args[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === '#') {
      const commentStart = i;
      while (i < args.length && args[i] !== '\n') i += 1;
      commentSpans.push([commentStart, i]);
      if (depth === 0 && args.slice(start, commentStart).trim() === '') start = i + 1;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
    if (ch === ',' && depth === 0) {
      pushItem(i);
    }
  }
  pushItem(args.length);
  return out.filter(Boolean);
}

function decodePythonEscapes(body) {
  // Decode the escapes Python defines for str/bytes literals; unknown escapes
  // (e.g. \/) keep the backslash, exactly as CPython does, so the result is
  // never semantically wrong. Incomplete \x/\u/\U sequences and \N{name}
  // (which would need the Unicode name table) are invalid/unsupported here,
  // so the literal is explicitly rejected by returning null.
  let out = '';
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (ch !== '\\') { out += ch; continue; }
    i += 1;
    const e = body[i];
    if (e === undefined) { out += '\\'; break; }
    switch (e) {
      case '\\': out += '\\'; break;
      case "'": out += "'"; break;
      case '"': out += '"'; break;
      case 'n': out += '\n'; break;
      case 'r': out += '\r'; break;
      case 't': out += '\t'; break;
      case 'b': out += '\b'; break;
      case 'f': out += '\f'; break;
      case 'v': out += '\v'; break;
      case 'a': out += '\x07'; break;
      case '0': case '1': case '2': case '3':
      case '4': case '5': case '6': case '7': {
        let oct = e;
        while (oct.length < 3 && /[0-7]/.test(body[i + 1] || '')) { i += 1; oct += body[i]; }
        out += String.fromCharCode(parseInt(oct, 8));
        break;
      }
      case 'x': {
        const hex = body.slice(i + 1, i + 3);
        if (!/^[0-9a-fA-F]{2}$/.test(hex)) return null;
        out += String.fromCharCode(parseInt(hex, 16));
        i += 2;
        break;
      }
      case 'u': {
        const hex = body.slice(i + 1, i + 5);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) return null;
        out += String.fromCharCode(parseInt(hex, 16));
        i += 4;
        break;
      }
      case 'U': {
        const hex = body.slice(i + 1, i + 9);
        if (!/^[0-9a-fA-F]{8}$/.test(hex)) return null;
        const cp = parseInt(hex, 16);
        if (cp > 0x10ffff) return null;
        out += String.fromCodePoint(cp);
        i += 8;
        break;
      }
      case 'N': return null;
      default: out += `\\${e}`;
    }
  }
  return out;
}

function parsePythonStringLiteral(raw) {
  const value = String(raw || '').trim();
  const m = value.match(/^([rRbBuUfF]*)(['\"])((?:\\.|(?!\2)[\s\S])*)\2$/);
  if (!m) return null;
  if (m[1].toLowerCase().includes('f')) return null;
  const body = m[3];
  // A triple-quoted string (\"\"\"...\"\"\" or '''...''') is not a single simple
  // literal; emitting it would fabricate a corrupted path, so reject it.
  if (body.startsWith(m[2].repeat(2))) return null;
  const decoded = m[1].toLowerCase().includes('r') ? body : decodePythonEscapes(body);
  if (decoded === null) return null;
  return { value: decoded };
}

function parsePythonMethodsLiteral(raw) {
  const value = String(raw || '').trim();
  const open = value[0];
  const close = open === '[' ? ']' : open === '(' ? ')' : '';
  if (!close || value[value.length - 1] !== close) return null;
  const items = splitPythonArgs(value.slice(1, -1));
  if (items.length === 0) return null;
  const methods = [];
  for (const item of items) {
    const m = item.match(/^(['"])([A-Za-z][A-Za-z0-9_-]*)\1$/);
    if (!m) return null;
    methods.push(m[2].toUpperCase());
  }
  return methods;
}

function parsePythonRouteArgs(argsText) {
  const args = splitPythonArgs(argsText);
  const positional = [];
  const kwargs = new Map();
  for (const arg of args) {
    const kw = arg.match(/^([A-Za-z_]\w*)\s*=/);
    if (kw) kwargs.set(kw[1], arg.slice(kw[0].length).trim());
    else positional.push(arg);
  }
  return {
    path: parsePythonStringLiteral(positional[0] || ''),
    methodsSpecified: kwargs.has('methods'),
    methodsRaw: kwargs.get('methods') || ''
  };
}

export function extractPythonRoutes(content) {
  const rows = [];
  const push = (method, rawPath, index) => {
    const clean = rawPath.replace(/\{([A-Za-z0-9_]+)\}/g, ':$1').replace(/\/+/g, '/').replace(/\/$/, '');
    rows.push({ method, path: clean.startsWith('/') ? clean : `/${clean}`, index });
  };
  const verbMethods = { get: 'GET', post: 'POST', put: 'PUT', patch: 'PATCH', delete: 'DELETE', options: 'OPTIONS', head: 'HEAD', trace: 'TRACE' };
  for (const call of findPythonRouteCalls(content)) {
    if (call.kind === 'decorator') {
      const parts = call.decorator.split('.');
      const name = parts[parts.length - 1];
      const owner = parts.slice(0, -1).join('.');
      if (!/^(app|router|blueprint|bp)$/.test(owner)) continue;
      const isRoute = name === 'route' || name === 'api_route';
      if (!isRoute && !verbMethods[name]) continue;
      const parsed = parsePythonRouteArgs(call.args);
      if (!parsed.path) continue;
      let methods;
      if (parsed.methodsSpecified) {
        methods = parsePythonMethodsLiteral(parsed.methodsRaw);
        if (!methods) continue;
      } else if (isRoute) {
        methods = ['GET'];
      } else {
        methods = [verbMethods[name]];
      }
      for (const method of methods) push(method, parsed.path.value, call.start);
    } else if (call.kind === 'path') {
      const args = splitPythonArgs(call.args);
      const pathLiteral = parsePythonStringLiteral(args[0] || '');
      const viewRef = String(args[1] || '').trim();
      if (!pathLiteral) continue;
      if (!/^[A-Za-z_][A-Za-z0-9_.]*$/.test(viewRef)) continue;
      push('GET', pathLiteral.value, call.start);
    }
  }
  return rows;
}

export function getPythonRouteRows(ctx) {
  if (!adapterEnabled(ctx, 'python') || !ctx.detected.python) return [];
  const rows = [];
  const files = ctx.allFiles.filter((f) => /\.py$/.test(f) && !isTestFile(relFromRoot(ctx, f))).sort();
  for (const file of files) {
    const content = read(file);
    const rel = relFromRoot(ctx, file);
    for (const route of extractPythonRoutes(content)) {
      const handlerMatch = content.slice(route.index, route.index + 800).match(/\bdef\s+(\w+)\s*\(/);
      rows.push({
        method: route.method,
        path: route.path,
        comparablePath: normalizeComparableRoute(route.path),
        controller: rel,
        handler: handlerMatch ? handlerMatch[1] : '-',
        file: rel
      });
    }
  }
  return rows.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}

export function getPythonModuleRows(ctx) {
  if (!adapterEnabled(ctx, 'python') || !ctx.detected.python) return [];
  const files = ctx.allFiles.filter((f) => /\.py$/.test(f) && !isTestFile(relFromRoot(ctx, f))).sort();
  return files.map((file) => {
    const content = read(file);
    const rel = relFromRoot(ctx, file);
    const entrypoint = /if\s+__name__\s*==\s*['"]__main__['"]\s*:/.test(content)
      || /\bdef\s+main\s*\(/.test(content)
      || /(^|\/)(manage|app|main|server|cli|__main__)\.py$/.test(rel);
    const symbols = [...content.matchAll(/^(?:class|def)\s+([A-Za-z0-9_]+)/gm)].length;
    return { file: rel, kind: entrypoint ? 'entrypoint' : 'module', lines: lineCount(file), symbols };
  });
}

export function getRustCrateRows(ctx) {
  if (!adapterEnabled(ctx, 'rust') || !ctx.detected.rust) return [];
  const rows = [];
  const crateKind = (rel) => {
    const dir = rel === '.' ? ctx.rootDir : path.join(ctx.rootDir, rel);
    const cargo = path.join(dir, 'Cargo.toml');
    if (fs.existsSync(cargo) && /\[\[bin\]\]/.test(read(cargo))) return 'bin';
    if (fs.existsSync(path.join(dir, 'src', 'main.rs'))) return 'bin';
    if (fs.existsSync(path.join(dir, 'src', 'lib.rs'))) return 'lib';
    return 'crate';
  };
  const rootCargo = path.join(ctx.rootDir, 'Cargo.toml');
  if (fs.existsSync(rootCargo)) {
    const content = read(rootCargo);
    const workspace = content.match(/\[workspace\]([\s\S]*?)(?=\n\[|\s*$)/);
    if (workspace) {
      const membersMatch = workspace[1].match(/members\s*=\s*\[([\s\S]*?)\]/);
      if (membersMatch) {
        for (const member of membersMatch[1].matchAll(/['"]([^'"]+)['"]/g)) {
          const rel = member[1];
          rows.push({ crate: rel.split('/').filter(Boolean).pop() || rel, path: rel, kind: crateKind(rel) });
        }
      }
    }
    const packageMatch = content.match(/\[package\][\s\S]*?name\s*=\s*"([^"]+)"/);
    if (packageMatch) rows.push({ crate: packageMatch[1], path: '.', kind: crateKind('.') });
  }
  if (rows.length === 0) {
    const cratesDir = path.join(ctx.rootDir, 'crates');
    if (fs.existsSync(cratesDir)) {
      for (const entry of fs.readdirSync(cratesDir, { withFileTypes: true })) {
        if (entry.isDirectory() && fs.existsSync(path.join(cratesDir, entry.name, 'Cargo.toml'))) {
          const rel = `crates/${entry.name}`;
          rows.push({ crate: entry.name, path: rel, kind: crateKind(rel) });
        }
      }
    }
  }
  return rows.sort((a, b) => a.crate.localeCompare(b.crate));
}

export function getSwiftTargetRows(ctx) {
  if (!adapterEnabled(ctx, 'swift') || !ctx.detected.swift) return [];
  const rows = [];
  const sourcesDir = path.join(ctx.rootDir, 'Sources');
  const packageFile = path.join(ctx.rootDir, 'Package.swift');
  if (fs.existsSync(packageFile)) {
    const targetRegex = /\.(?:executableTarget|target)\(\s*name:\s*"([^"]+)"/g;
    let match;
    while ((match = targetRegex.exec(read(packageFile))) !== null) {
      rows.push({ target: match[1], path: fs.existsSync(path.join(sourcesDir, match[1])) ? `Sources/${match[1]}` : '' });
    }
  }
  if (rows.length === 0 && fs.existsSync(sourcesDir)) {
    for (const entry of fs.readdirSync(sourcesDir, { withFileTypes: true })) {
      if (entry.isDirectory()) rows.push({ target: entry.name, path: `Sources/${entry.name}` });
    }
  }
  return rows.sort((a, b) => a.target.localeCompare(b.target));
}

export function getGodotRows(ctx) {
  if (!adapterEnabled(ctx, 'godot') || !ctx.detected.godot) return [];
  const rows = [];
  const projectFile = path.join(ctx.rootDir, 'project.godot');
  if (fs.existsSync(projectFile)) {
    let inAutoload = false;
    for (const line of read(projectFile).split(/\r?\n/)) {
      if (/^\[[^\]]+\]/.test(line.trim())) {
        inAutoload = line.trim() === '[autoload]';
        continue;
      }
      if (!inAutoload) continue;
      const match = line.match(/^([A-Za-z_]\w*)\s*=\s*"\*?(res:\/\/[^"]+)"/);
      if (match) rows.push({ kind: 'autoload', name: match[1], path: match[2] });
    }
  }
  const scripts = ctx.allFiles.filter((f) => /\.gd$/.test(f))
    .map((file) => ({ kind: 'script', name: path.basename(file), path: relFromRoot(ctx, file) }))
    .sort((a, b) => a.path.localeCompare(b.path))
    .slice(0, 200);
  const scenes = ctx.allFiles.filter((f) => /\.tscn$/.test(f))
    .map((file) => ({ kind: 'scene', name: path.basename(file), path: relFromRoot(ctx, file) }))
    .sort((a, b) => a.path.localeCompare(b.path))
    .slice(0, 200);
  rows.push(...scripts, ...scenes);
  return rows;
}


function mapRouteSegment(seg) {
  const optional = seg.match(/^\[\[\.\.\.([^\]]+)\]\]$/);
  if (optional) return `:${optional[1]}*`;
  const catchAll = seg.match(/^\[\.\.\.([^\]]+)\]$/);
  if (catchAll) return `*${catchAll[1]}`;
  return seg.replace(/^\[(.*)\]$/, ':$1');
}

export function getAstroPageRows(ctx) {
  if (!adapterEnabled(ctx, 'astro') || !ctx.detected.astro || !ctx.roots.astroPages) return [];
  const root = ctx.roots.astroPages;
  const files = ctx.allFiles.filter((f) => /\.astro$/.test(f) && isInside(f, root)).sort();
  const rows = [];
  for (const file of files) {
    const rel = relFromRoot(ctx, file);
    const segments = path.relative(root, file).replace(/\\/g, '/').split('/').filter(Boolean);
    if (segments.some((seg) => seg.startsWith('_'))) continue;
    const last = segments[segments.length - 1].replace(/\.astro$/, '');
    const routeSegs = [...segments.slice(0, -1), ...(last === 'index' ? [] : [last])].map((seg) => mapRouteSegment(seg));
    const route = `/${routeSegs.join('/')}`.replace(/\/+/g, '/') || '/';
    const isApi = segments.slice(0, -1).includes('api');
    rows.push({
      path: route,
      comparablePath: normalizeComparableRoute(route),
      target: isApi ? '[api]' : last,
      guards: '-',
      file: rel
    });
  }
  return rows.sort((a, b) => a.path.localeCompare(b.path));
}

function skipJsString(content, start) {
  const quote = content[start];
  let i = start + 1;
  while (i < content.length) {
    const ch = content[i];
    if (ch === '\\') { i += 2; continue; }
    if (quote === '`' && ch === '$' && content[i + 1] === '{') { i = skipJsBraced(content, i + 1); continue; }
    if (ch === quote) return i + 1;
    i += 1;
  }
  return content.length;
}

function skipJsBraced(content, openBrace) {
  let depth = 1;
  let i = openBrace + 1;
  while (i < content.length) {
    const ch = content[i];
    if (ch === '"' || ch === "'" || ch === '`') { i = skipJsString(content, i); continue; }
    if (ch === '/' && content[i + 1] === '/') { while (i < content.length && content[i] !== '\n') i += 1; continue; }
    if (ch === '/' && content[i + 1] === '*') { const end = content.indexOf('*/', i + 2); i = end === -1 ? content.length : end + 2; continue; }
    if (ch === '{') depth += 1;
    if (ch === '}') { depth -= 1; if (depth === 0) return i + 1; }
    i += 1;
  }
  return content.length;
}

function matchJsParens(content, open) {
  let depth = 1;
  let i = open + 1;
  while (i < content.length) {
    const ch = content[i];
    if (ch === '"' || ch === "'" || ch === '`') { i = skipJsString(content, i); continue; }
    if (ch === '/' && content[i + 1] === '/') { while (i < content.length && content[i] !== '\n') i += 1; continue; }
    if (ch === '/' && content[i + 1] === '*') { const end = content.indexOf('*/', i + 2); i = end === -1 ? content.length : end + 2; continue; }
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    if (ch === ')' || ch === ']' || ch === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
    i += 1;
  }
  return -1;
}

function extractTanStackObjectPath(argsText) {
  let depth = 0;
  let i = 0;
  const n = argsText.length;
  while (i < n) {
    const ch = argsText[i];
    if (ch === '"' || ch === "'" || ch === '`') { i = skipJsString(argsText, i); continue; }
    if (ch === '/' && argsText[i + 1] === '/') { while (i < n && argsText[i] !== '\n') i += 1; continue; }
    if (ch === '/' && argsText[i + 1] === '*') { const end = argsText.indexOf('*/', i + 2); i = end === -1 ? n : end + 2; continue; }
    if (ch === '{') depth += 1;
    if (ch === '}') depth -= 1;
    if (depth === 1 && argsText.startsWith('path', i) && !/[A-Za-z0-9_$]/.test(argsText[i - 1] || '') && /\s*:/.test(argsText.slice(i + 4, i + 8))) {
      let j = i + 4;
      while (j < n && /\s/.test(argsText[j])) j += 1;
      if (argsText[j] !== ':') { i += 1; continue; }
      j += 1;
      while (j < n && /\s/.test(argsText[j])) j += 1;
      const q = argsText[j];
      if (q !== '"' && q !== "'") return '';
      let k = j + 1;
      let value = '';
      let escaped = false;
      for (; k < n; k += 1) {
        const c = argsText[k];
        if (escaped) { value += c; escaped = false; }
        else if (c === '\\') escaped = true;
        else if (c === q) break;
        else value += c;
      }
      if (k >= n) return '';
      return value;
    }
    i += 1;
  }
  return '';
}

export function extractTanStackRoutes(content) {
  const rows = [];
  const push = (rawPath, index) => {
    const normalized = rawPath.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, ':$1').replace(/\/+/g, '/').replace(/\/$/, '');
    rows.push({ path: normalized.startsWith('/') ? normalized : `/${normalized}`, index });
  };
  let i = 0;
  while (i < content.length) {
    const ch = content[i];
    if (ch === '"' || ch === "'" || ch === '`') { i = skipJsString(content, i); continue; }
    if (ch === '/' && content[i + 1] === '/') { while (i < content.length && content[i] !== '\n') i += 1; continue; }
    if (ch === '/' && content[i + 1] === '*') { const end = content.indexOf('*/', i + 2); i = end === -1 ? content.length : end + 2; continue; }
    const ident = content.slice(i).match(/^[A-Za-z_$][A-Za-z0-9_$]*/);
    if (!ident) { i += 1; continue; }
    if (ident[0] === 'createFileRoute' || ident[0] === 'createRoute') {
      let j = i + ident[0].length;
      while (j < content.length && /\s/.test(content[j])) j += 1;
      if (content[j] === '(') {
        const close = matchJsParens(content, j);
        if (close !== -1) {
          const argsText = content.slice(j + 1, close);
          if (ident[0] === 'createFileRoute') {
            const m = argsText.trim().match(/^(['"])([\s\S]*?)\1$/);
            if (m) push(m[2], i);
          } else {
            const pathValue = extractTanStackObjectPath(argsText);
            if (pathValue) push(pathValue, i);
          }
          i = close + 1;
          continue;
        }
      }
    }
    i += ident[0].length;
  }
  return rows;
}

export function getReactPageRows(ctx) {
  if (!adapterEnabled(ctx, 'react') || !ctx.detected.react) return [];
  const rows = [];
  const seen = new Set();
  const add = (row) => {
    const key = row.comparablePath || row.path;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push(row);
  };
  const appRoot = ctx.roots.reactApp || '';
  if (appRoot) {
    const files = ctx.allFiles.filter((f) => /\.(tsx|jsx|js|mjs)$/.test(f) && isInside(f, appRoot) && /page\.(tsx|jsx|js|mjs)$/.test(path.basename(f))).sort();
    for (const file of files) {
      const segments = path.relative(appRoot, file).replace(/\\/g, '/').split('/').filter(Boolean)
        .filter((seg) => !seg.startsWith('(') && !seg.startsWith('@'))
        .map((seg) => mapRouteSegment(seg.replace(/\.(tsx|jsx|js|mjs)$/, '')))
        .filter((seg) => seg !== 'page');
      const route = `/${segments.join('/')}`.replace(/\/+/g, '/') || '/';
      add({ path: route, comparablePath: normalizeComparableRoute(route), target: 'page', guards: '-', file: relFromRoot(ctx, file) });
    }
  }
  for (const file of ctx.allFiles.filter((f) => /\.(tsx|jsx|js|mjs)$/.test(f) && !isTestFile(relFromRoot(ctx, f))).sort()) {
    const content = read(file);
    const routeRegex = /<Route\b/g;
    let match;
    while ((match = routeRegex.exec(content)) !== null) {
      const window = content.slice(match.index, match.index + 600);
      const pathMatch = window.match(/\bpath\s*=\s*['"]([^'"]+)['"]/);
      if (!pathMatch) continue;
      const elementMatch = window.match(/\belement\s*=\s*\{?\s*<([A-Za-z0-9_]+)/);
      add({
        path: pathMatch[1],
        comparablePath: normalizeComparableRoute(pathMatch[1]),
        target: elementMatch ? elementMatch[1] : path.basename(file).replace(/\.(tsx|jsx|js|mjs)$/, ''),
        guards: '-',
        file: relFromRoot(ctx, file)
      });
    }
  }
  for (const file of ctx.allFiles.filter((f) => /\.(tsx|jsx|js|mjs)$/.test(f) && !isTestFile(relFromRoot(ctx, f))).sort()) {
    const content = read(file);
    for (const route of extractTanStackRoutes(content)) {
      add({
        path: route.path,
        comparablePath: normalizeComparableRoute(route.path),
        target: path.basename(file).replace(/\.(tsx|jsx|js|mjs)$/, ''),
        guards: '-',
        file: relFromRoot(ctx, file)
      });
    }
  }
  // Always merge the src/pages fallback with every other route source: TanStack,
  // JSX <Route>, and app-router rows must not suppress pages/ or src/pages rows.
  // Exact duplicates are still removed by the comparablePath-based add() dedup.
  for (const pagesDir of [path.join(ctx.rootDir, 'src/pages'), path.join(ctx.rootDir, 'pages')].filter((p) => fs.existsSync(p))) {
    const files = ctx.allFiles.filter((f) => /\.(tsx|jsx|js|mjs)$/.test(f) && isInside(f, pagesDir) && !isTestFile(relFromRoot(ctx, f))).sort();
    for (const file of files) {
      const segments = path.relative(pagesDir, file).replace(/\\/g, '/').split('/').filter(Boolean);
      if (segments.some((seg) => seg.startsWith('_'))) continue;
      const last = segments[segments.length - 1].replace(/\.(tsx|jsx|js|mjs)$/, '');
      const routeSegs = [...segments.slice(0, -1), ...(last === 'index' ? [] : [last])].map((seg) => mapRouteSegment(seg));
      const route = `/${routeSegs.join('/')}`.replace(/\/+/g, '/') || '/';
      add({ path: route, comparablePath: normalizeComparableRoute(route), target: last, guards: '-', file: relFromRoot(ctx, file) });
    }
  }
  return rows.sort((a, b) => a.path.localeCompare(b.path));
}

export function getShellScriptRows(ctx) {
  if (!adapterEnabled(ctx, 'shell') || !ctx.detected.shell) return [];
  const rows = ctx.allFiles
    .filter((f) => /\.(sh|bash|zsh)$/.test(f) && !isTestFile(relFromRoot(ctx, f)))
    .map((file) => {
      const firstLine = read(file).split(/\r?\n/)[0] || '';
      return { file: relFromRoot(ctx, file), lines: lineCount(file), shebang: firstLine.startsWith('#!') ? firstLine : '-' };
    });
  return rows.sort((a, b) => a.file.localeCompare(b.file));
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
  const regex = /\b(?:create(?:\s+or\s+alter)?\s+(procedure|proc|function|view|table|trigger)|alter(?:\s+or\s+alter)?\s+(procedure|proc|function|view|trigger))\s+((?:\[[^\]]+\]|[A-Za-z0-9_]+)(?:\.(?:\[[^\]]+\]|[A-Za-z0-9_]+))?)/ig;
  for (const file of files) {
    const content = read(file);
    let match;
    while ((match = regex.exec(content)) !== null) {
      const rawType = match[1] || match[2] || '';
      const objectType = rawType.toLowerCase() === 'proc' ? 'procedure' : rawType.toLowerCase();
      const objectName = match[3];
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

export function extractPhpArrayStrings(content, propertyName) {
  const regex = new RegExp(`\\$${propertyName}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s*;`, 'm');
  const match = content.match(regex);
  if (!match) return [];
  return [...match[1].matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]);
}

export function extractPhpCasts(content) {
  const regex = /\$casts\s*=\s*\[([\s\S]*?)\]\s*;/m;
  const match = content.match(regex);
  if (!match) return new Map();
  const casts = new Map();
  for (const item of match[1].matchAll(/['"]([^'"]+)['"]\s*=>\s*['"]([^'"]+)['"]/g)) casts.set(item[1], item[2]);
  return casts;
}

export function extractPhpRelations(content) {
  const out = [];
  const regex = /function\s+([A-Za-z0-9_]+)\s*\([^)]*\)\s*(?::\s*[A-Za-z0-9_\\|?]+)?\s*\{([\s\S]{0,900}?)\n\s*\}/g;
  const relationMethods = ['hasOne', 'hasMany', 'belongsTo', 'belongsToMany', 'morphOne', 'morphMany', 'morphTo', 'morphToMany'];
  let match;
  while ((match = regex.exec(content)) !== null) {
    const body = match[2];
    const rel = relationMethods.find((method) => new RegExp(`\\$this->${method}\\s*\\(`).test(body));
    if (rel) out.push({ name: match[1], type: rel, kind: 'relation', notes: '-' });
  }
  return out;
}

export function getPhpEntityRows(ctx) {
  if (!adapterEnabled(ctx, 'php') || !ctx.detected.php) return [];
  const files = ctx.allFiles.filter((file) => /\.php$/i.test(file)).filter((file) => {
    const rel = relFromRoot(ctx, file);
    if (isTestFile(rel) || /(^|\/)(Http|Controllers|Middleware|Requests|Resources)\//.test(rel)) return false;
    const content = read(file);
    return /extends\s+Model\b|use\s+Illuminate\\Database\\Eloquent\\Model\b/.test(content) || /(^|\/)app\/Models\/[^/]+\.php$/.test(rel);
  }).sort();

  return files.map((file) => {
    const content = read(file);
    const className = (content.match(/\bclass\s+([A-Za-z0-9_]+)/) || [null, path.basename(file, '.php')])[1];
    const tableName = (content.match(/\$table\s*=\s*['"]([^'"]+)['"]/) || [null, className])[1];
    const pk = (content.match(/\$primaryKey\s*=\s*['"]([^'"]+)['"]/) || [null, 'id'])[1];
    const hidden = new Set(extractPhpArrayStrings(content, 'hidden'));
    const casts = extractPhpCasts(content);
    const fillable = extractPhpArrayStrings(content, 'fillable');
    const cols = fillable.map((name) => ({ name, type: casts.get(name) || 'fillable', kind: 'column', notes: hidden.has(name) ? 'hidden' : '-' }));
    for (const [name, type] of casts) {
      if (!fillable.includes(name)) cols.push({ name, type, kind: 'column', notes: 'cast' });
    }
    return {
      className,
      fallback: className,
      tableName,
      pks: pk ? [pk] : [],
      cols,
      rels: extractPhpRelations(content),
      file: relFromRoot(ctx, file)
    };
  });
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
  rows.push(...getPhpEntityRows(ctx));
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
  if (parts.length === 1) return parts[0].replace(/\.[^.]+$/, '') || 'root';
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
    if (/\.(controller|service|module)\.[jt]s$/.test(rel) || /Controller\.cs$/.test(rel) || /(^|\/)Program\.cs$/.test(rel) || /\.sql$/i.test(rel) || /(^|\/)routes\/[^/]+\.php$/.test(rel) || /Controller\.php$/.test(rel) || /\.php$/i.test(rel) && !/(^|\/)deploy\//.test(rel)) ensure(featureNameFromRel(rel)).backendFiles.add(rel);
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
  const sourceFiles = ctx.allFiles.filter((f) => /\.(ts|tsx|js|jsx|mjs|cjs|cs|php|py|rs|swift|gd)$/.test(f) && !isTestFile(relFromRoot(ctx, f))).sort();
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
      `${dir}/${path.basename(base)}Tests.cs`,
      `${base}Test.php`,
      `${base}Spec.php`,
      `${dir}/${path.basename(base)}Test.php`,
      `${dir}/__tests__/${path.basename(base)}Test.php`,
      `${base}_test.py`,
      `${dir}/test_${path.basename(base)}.py`,
      `${base}Tests.swift`,
      `${dir}/tests/${path.basename(base)}.rs`,
      `${dir}/test_${path.basename(base)}.gd`
    ];
    let direct = directCandidates.find((candidate) => testFiles.has(candidate)) || '';
    if (!direct && ext === '.cs') {
      const baseName = path.basename(base);
      direct = testList.find((candidate) => /(^|\/)(tests?|test-projects)\//i.test(candidate) && new RegExp(`${baseName}(Test|Tests|Spec|Specs)\\.cs$`, 'i').test(path.basename(candidate))) || '';
    }
    if (!direct && ext === '.php') {
      const baseName = path.basename(base);
      direct = testList.find((candidate) => /(^|\/)(tests?|specs?)\//i.test(candidate) && new RegExp(`${baseName}(Test|Spec)\\.php$`, 'i').test(path.basename(candidate))) || '';
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
    [/\bclass\s+([A-Za-z0-9_]+)/, 'class'],
    [/\bfunction\s+([A-Za-z0-9_]+)\s*\(/, 'fn'],
    [/\bRoute::(get|post|put|patch|delete|options|match|any|resource|apiResource)\s*\(/i, 'route'],
    [/\b(?:create|alter)(?:\s+or\s+alter)?\s+(?:procedure|proc|function|view|table|trigger)\s+((?:\[[^\]]+\]|[A-Za-z0-9_]+)(?:\.(?:\[[^\]]+\]|[A-Za-z0-9_]+))?)/i, 'sql'],
    [/\bdef\s+([A-Za-z0-9_]+)\s*\(/, 'fn'],
    [/\bclass\s+([A-Za-z0-9_]+)\s*[:.(]/, 'class'],
    [/\bpub\s+(?:async\s+)?fn\s+([A-Za-z0-9_]+)/, 'fn'],
    [/\bpub\s+(?:struct|enum|trait|mod)\s+([A-Za-z0-9_]+)/, 'type'],
    [/\bfunc\s+([A-Za-z0-9_]+)\s*\(/, 'fn'],
    [/^([A-Za-z_][A-Za-z0-9_]*)\s*\(\)\s*\{/, 'fn']
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
    .filter((f) => /\.(ts|tsx|js|jsx|html|scss|css|json|resx|yml|yaml|cs|csproj|sql|sqlproj|php|py|rs|swift|gd|astro|sh|bash|zsh|toml)$/.test(f))
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
    /\benv\(\s*['"]([A-Z0-9_]+)['"]/g,
    /\$_ENV\[['"]([A-Z0-9_]+)['"]\]/g,
    /\$_SERVER\[['"]([A-Z0-9_]+)['"]\]/g,
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
  const pythonRoutes = getPythonRouteRows(ctx);
  const routes = [...pythonRoutes, ...getRouteRows(ctx)];
  const astroPages = getAstroPageRows(ctx);
  const pages = [...astroPages, ...getReactPageRows(ctx), ...getPageRows(ctx)];
  const entities = getEntityRows(ctx);
  const components = getComponentRows(ctx);
  const features = getFeatureRows(ctx, routes, entities, components);
  const apiClients = getApiClientRows(ctx, routes);
  const tests = getTestRows(ctx);
  const largeFiles = getLargeFileRows(ctx);
  const i18n = getI18nStats(ctx);
  const env = getEnvRows(ctx);
  const pythonModules = getPythonModuleRows(ctx);
  const rustCrates = getRustCrateRows(ctx);
  const swiftTargets = getSwiftTargetRows(ctx);
  const godotItems = getGodotRows(ctx);
  const shellScripts = getShellScriptRows(ctx);

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
    env,
    pythonModules,
    rustCrates,
    swiftTargets,
    godotItems,
    astroPages,
    shellScripts
  };
}
