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
write(path.join(root, 'src/Api/Api.csproj'), '<Project Sdk="Microsoft.NET.Sdk.Web"></Project>\n');
write(path.join(root, 'src/Api/Program.cs'), 'var app = WebApplication.CreateBuilder(args).Build();\napp.MapGet("/health", () => Results.Ok());\napp.Run();\n');
write(path.join(root, 'src/Api/Controllers/WeatherController.cs'), '[ApiController]\n[Route("api/[controller]")]\npublic class WeatherController : ControllerBase {\n  [HttpGet("{id}")]\n  public IActionResult Get(int id) => Ok(id);\n}\n');
write(path.join(root, 'src/Domain/Entities/WeatherReading.cs'), '[Table("weather_readings")]\npublic class WeatherReading {\n  [Key]\n  public int Id { get; set; }\n  public string Summary { get; set; }\n}\n');
write(path.join(root, 'database/scripts/bootstrap.sql'), 'CREATE TABLE [dbo].[Widget] (Id INT);\nGO\nALTER TABLE [dbo].[Widget] ADD CONSTRAINT [FK_Widget] FOREIGN KEY (Id) REFERENCES [dbo].[Widget](Id);\nGO\nCREATE PROCEDURE [dbo].[usp_GetWidget] AS SELECT 1;\n');
write(path.join(root, 'tests/Api/WeatherControllerTests.cs'), 'public class WeatherControllerTests { }\n');
write(path.join(root, 'backend/.env.example'), 'API_KEY=example\n');
write(path.join(root, 'azure-pipelines.yml'), 'variables:\n  FROM_PIPELINE: $(API_KEY)\n');
write(path.join(root, 'docker-compose.yml'), 'services:\n  app:\n    environment:\n      API_KEY: ${API_KEY}\n');
write(path.join(root, 'frontend/src/environments/environment.ts'), "export const environment = { apiUrl: 'http://localhost' };\n");
write(path.join(root, 'src/app/services/foo.service.ts'), "export class FooService {\n  getData() { return this.http.get(`${environment.apiUrl}/api/foo`); }\n}\n");
write(path.join(root, 'src/app/services/foo.service.spec.ts'), 'describe("foo", () => {});\n');
write(path.join(root, 'composer.json'), JSON.stringify({ require: { 'laravel/framework': '^11.0' } }, null, 2));
write(path.join(root, 'routes/api.php'), "<?php\nuse Illuminate\\Support\\Facades\\Route;\nRoute::get('/users/{id}', [App\\Http\\Controllers\\UserController::class, 'show']);\nRoute::apiResource('/posts', App\\Http\\Controllers\\PostController::class);\n");
write(path.join(root, 'app/Models/User.php'), "<?php\nnamespace App\\Models;\nuse Illuminate\\Database\\Eloquent\\Model;\nclass User extends Model {\n  protected $table = 'users';\n  protected $primaryKey = 'user_id';\n  protected $fillable = ['name', 'email'];\n  protected $casts = ['email_verified_at' => 'datetime'];\n  public function posts() { return $this->hasMany(Post::class); }\n}\n");
write(path.join(root, 'app/Http/Controllers/UserController.php'), "<?php\nnamespace App\\Http\\Controllers;\nclass UserController { public function show($id) { return env('API_KEY'); } }\n");
write(path.join(root, 'tests/Feature/UserControllerTest.php'), '<?php class UserControllerTest {}\n');

const ctx = buildContext({ root, output: path.join(root, '.agent-index'), config: '', adapters: '', includeGeneratedDate: false });
assert(ctx.roots.frontendServices.endsWith('src/app/services'), 'frontendServices root should be inferred without throwing');
assert(ctx.detected.dotnet, 'dotnet adapter should be auto-detected from C# project markers');
assert(ctx.detected.php, 'php adapter should be auto-detected from Composer/Laravel markers');
assert(ctx.detected.sql, 'sql adapter should be auto-detected from .sql files');
const baseModel = buildIndexModel(ctx);

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
const dotnetRoute = baseModel.routes.find((row) => row.path === '/api/Weather/{id}' && row.method === 'GET');
const minimalRoute = baseModel.routes.find((row) => row.path === '/health' && row.method === 'GET');
const phpRoute = baseModel.routes.find((row) => row.path === '/users/{id}' && row.method === 'GET' && row.controller === 'UserController');
const phpResourceRoute = baseModel.routes.find((row) => row.path === '/posts/{id}' && row.method === 'DELETE' && row.handler === 'destroy');
const dotnetEntity = baseModel.entities.find((row) => row.className === 'WeatherReading' && row.tableName === 'weather_readings');
const phpEntity = baseModel.entities.find((row) => row.className === 'User' && row.tableName === 'users');
const sqlEntity = baseModel.entities.find((row) => row.className === '[dbo].[usp_GetWidget]');
const sqlTableEntities = baseModel.entities.filter((row) => row.className === '[dbo].[Widget]');
const dotnetTestMap = baseModel.tests.find((row) => row.source.endsWith('WeatherController.cs'));
const phpTestMap = baseModel.tests.find((row) => row.source.endsWith('UserController.php'));
assert(apiKey, 'API_KEY from backend/.env.example should be included even when include is src only');
assert(apiKey.example === 'example', 'API_KEY example value should come from backend/.env.example');
assert(apiKey.usedIn.some((file) => file === 'azure-pipelines.yml'), 'azure-pipelines.yml should be scanned for env references');
assert(apiKey.usedIn.some((file) => file === 'docker-compose.yml'), 'docker-compose.yml should be scanned for env references');
assert(dotnetRoute, 'ASP.NET controller routes should be indexed');
assert(minimalRoute, 'ASP.NET minimal API routes should be indexed');
assert(phpRoute, 'Laravel route declarations should be indexed');
assert(phpResourceRoute, 'Laravel API resources should expand to conventional routes');
assert(dotnetEntity, 'Entity-style C# models should be indexed');
assert(phpEntity, 'Eloquent-style PHP models should be indexed');
assert(phpEntity.pks.includes('user_id'), 'PHP model primary key should be indexed');
assert(sqlEntity, 'SQL scripts should be indexed into schema rows');
assert(sqlTableEntities.length === 1, 'ALTER TABLE statements should not create duplicate table entities');
assert(dotnetTestMap?.directSpec?.endsWith('WeatherControllerTests.cs'), 'C# test mapping should detect conventional test file names');
assert(phpTestMap?.directSpec?.endsWith('UserControllerTest.php'), 'PHP test mapping should detect conventional test file names');

const plainPhpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-repo-index-plain-php-'));
write(path.join(plainPhpRoot, 'index.php'), "<?php\nrequire __DIR__ . '/lib/session.php';\n");
write(path.join(plainPhpRoot, 'lib/session.php'), "<?php\nfunction app_absolute_url(string $path): string { return $path; }\n");
write(path.join(plainPhpRoot, 'settings/index.php'), "<?php\nrequire __DIR__ . '/../lib/session.php';\n");
const plainPhpCtx = buildContext({ root: plainPhpRoot, output: path.join(plainPhpRoot, '.agent-index'), config: '', adapters: '', includeGeneratedDate: false });
const plainPhpModel = buildIndexModel(plainPhpCtx);
assert(plainPhpCtx.detected.php, 'plain PHP app shape should be auto-detected without Composer metadata');
assert(plainPhpModel.features.some((row) => row.moduleName === 'lib'), 'plain PHP library files should appear in the feature map');
assert(plainPhpModel.features.some((row) => row.moduleName === 'settings'), 'plain PHP page folders should appear in the feature map');

console.log('self-test ok');
