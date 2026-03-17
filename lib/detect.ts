/**
 * Stack Detection Module
 *
 * Detects project stack/framework from file patterns and package.json
 * Supports 60+ frameworks across Node.js, Python, Ruby, PHP, Java, Elixir, .NET, Go, Rust, and more.
 */

import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import type { StackSignature, DetectedStack, SuggestedIdentity } from '../shared/types.js';

/**
 * Known stack signatures
 * Priority order matters - first match wins
 *
 * stackType values: 'frontend', 'api', 'ssg', 'mobile', 'desktop', 'worker', 'container', 'static', 'bundler'
 */
const STACK_SIGNATURES: readonly StackSignature[] = [
  // ========================================================================
  // Node.js Meta-frameworks (check first - they're more specific)
  // ========================================================================
  {
    name: 'Next.js',
    stackType: 'frontend',
    files: ['next.config.js', 'next.config.mjs', 'next.config.ts'],
    dependencies: ['next'],
    defaultPort: 3000,
    devCmd: 'next dev',
    startCmd: 'next start',
    healthPath: '/',
    portFlag: '--port'
  },
  {
    name: 'Nuxt',
    stackType: 'frontend',
    files: ['nuxt.config.js', 'nuxt.config.ts'],
    dependencies: ['nuxt'],
    defaultPort: 3000,
    devCmd: 'nuxt dev',
    startCmd: 'nuxt start',
    healthPath: '/',
    portFlag: '--port'
  },
  {
    name: 'SvelteKit',
    stackType: 'frontend',
    files: ['svelte.config.js'],
    dependencies: ['@sveltejs/kit'],
    defaultPort: 5173,
    devCmd: 'vite dev',
    startCmd: 'vite preview',
    healthPath: '/',
    portFlag: '--port'
  },
  {
    name: 'Remix',
    stackType: 'frontend',
    files: ['remix.config.js'],
    dependencies: ['@remix-run/node', '@remix-run/react'],
    defaultPort: 3000,
    devCmd: 'remix dev',
    startCmd: 'remix-serve build',
    healthPath: '/',
    portFlag: '--port'
  },
  {
    name: 'Astro',
    stackType: 'frontend',
    files: ['astro.config.mjs', 'astro.config.js'],
    dependencies: ['astro'],
    defaultPort: 4321,
    devCmd: 'astro dev',
    startCmd: 'astro preview',
    healthPath: '/',
    portFlag: '--port'
  },
  {
    name: 'Gatsby',
    stackType: 'frontend',
    files: ['gatsby-config.js', 'gatsby-config.ts'],
    dependencies: ['gatsby'],
    defaultPort: 8000,
    devCmd: 'gatsby develop',
    startCmd: 'gatsby serve',
    healthPath: '/',
    portFlag: '-p'
  },
  {
    name: 'Docusaurus',
    stackType: 'frontend',
    files: ['docusaurus.config.js', 'docusaurus.config.ts'],
    dependencies: ['@docusaurus/core'],
    defaultPort: 3000,
    devCmd: 'docusaurus start',
    startCmd: 'docusaurus serve',
    healthPath: '/',
    portFlag: '--port'
  },
  {
    name: 'Eleventy',
    stackType: 'ssg',
    files: ['.eleventy.js', 'eleventy.config.js', 'eleventy.config.cjs'],
    dependencies: ['@11ty/eleventy'],
    defaultPort: 8080,
    devCmd: 'eleventy --serve',
    startCmd: 'eleventy --serve',
    healthPath: '/',
    portFlag: '--port'
  },
  {
    name: 'TanStack Start',
    stackType: 'frontend',
    files: [],
    dependencies: ['@tanstack/start'],
    defaultPort: 3000,
    devCmd: 'vinxi dev',
    startCmd: 'vinxi start',
    healthPath: '/',
    portFlag: '--port'
  },
  {
    name: 'RedwoodJS',
    stackType: 'frontend',
    files: ['redwood.toml'],
    dependencies: ['@redwoodjs/core'],
    defaultPort: 8910,
    devCmd: 'rw dev',
    startCmd: 'rw serve',
    healthPath: '/',
    portFlag: '--port'
  },
  {
    name: 'Blitz.js',
    stackType: 'frontend',
    files: ['blitz.config.ts', 'blitz.config.js'],
    dependencies: ['blitz'],
    defaultPort: 3000,
    devCmd: 'blitz dev',
    startCmd: 'blitz start',
    healthPath: '/',
    portFlag: '-p'
  },

  // ========================================================================
  // Build tools / bundlers
  // ========================================================================
  {
    name: 'Vite',
    stackType: 'frontend',
    files: ['vite.config.js', 'vite.config.ts', 'vite.config.mjs'],
    dependencies: ['vite'],
    defaultPort: 5173,
    devCmd: 'vite',
    startCmd: 'vite preview',
    healthPath: '/',
    portFlag: '--port'
  },
  {
    name: 'Webpack Dev Server',
    stackType: 'bundler',
    files: ['webpack.config.js', 'webpack.config.ts'],
    dependencies: ['webpack-dev-server'],
    defaultPort: 8080,
    devCmd: 'webpack serve',
    startCmd: 'webpack serve',
    healthPath: '/',
    portFlag: '--port'
  },

  // ========================================================================
  // Frontend frameworks (without meta-framework)
  // ========================================================================
  {
    name: 'Create React App',
    stackType: 'frontend',
    files: [],
    dependencies: ['react-scripts'],
    defaultPort: 3000,
    devCmd: 'react-scripts start',
    startCmd: 'react-scripts start',
    healthPath: '/',
    portEnv: 'PORT'
  },
  {
    name: 'Angular',
    stackType: 'frontend',
    files: ['angular.json'],
    dependencies: ['@angular/core'],
    defaultPort: 4200,
    devCmd: 'ng serve',
    startCmd: 'ng serve',
    healthPath: '/',
    portFlag: '--port'
  },
  {
    name: 'Vue CLI',
    stackType: 'frontend',
    files: ['vue.config.js'],
    dependencies: ['@vue/cli-service'],
    defaultPort: 8080,
    devCmd: 'vue-cli-service serve',
    startCmd: 'vue-cli-service serve',
    healthPath: '/',
    portFlag: '--port'
  },

  // ========================================================================
  // Node.js Backend frameworks
  // ========================================================================
  {
    name: 'Express',
    stackType: 'api',
    files: [],
    dependencies: ['express'],
    defaultPort: 3000,
    devCmd: 'node server.js',
    startCmd: 'node server.js',
    healthPath: '/health',
    portEnv: 'PORT'
  },
  {
    name: 'Fastify',
    stackType: 'api',
    files: [],
    dependencies: ['fastify'],
    defaultPort: 3000,
    devCmd: 'node server.js',
    startCmd: 'node server.js',
    healthPath: '/health',
    portEnv: 'PORT'
  },
  {
    name: 'Koa',
    stackType: 'api',
    files: [],
    dependencies: ['koa'],
    defaultPort: 3000,
    devCmd: 'node server.js',
    startCmd: 'node server.js',
    healthPath: '/health',
    portEnv: 'PORT'
  },
  {
    name: 'Hapi',
    stackType: 'api',
    files: [],
    dependencies: ['@hapi/hapi'],
    defaultPort: 3000,
    devCmd: 'node server.js',
    startCmd: 'node server.js',
    healthPath: '/health',
    portEnv: 'PORT'
  },
  {
    name: 'Hono',
    stackType: 'api',
    files: [],
    dependencies: ['hono'],
    defaultPort: 3000,
    devCmd: 'node server.js',
    startCmd: 'node server.js',
    healthPath: '/health',
    portEnv: 'PORT'
  },
  {
    name: 'Elysia',
    stackType: 'api',
    files: [],
    dependencies: ['elysia'],
    defaultPort: 3000,
    devCmd: 'bun run server.ts',
    startCmd: 'bun run server.ts',
    healthPath: '/health',
    portEnv: 'PORT'
  },
  {
    name: 'NestJS',
    stackType: 'api',
    files: ['nest-cli.json'],
    dependencies: ['@nestjs/core'],
    defaultPort: 3000,
    devCmd: 'nest start --watch',
    startCmd: 'nest start',
    healthPath: '/health',
    portEnv: 'PORT'
  },
  {
    name: 'AdonisJS',
    stackType: 'api',
    files: ['ace', '.adonisrc.json', 'adonisrc.ts'],
    dependencies: ['@adonisjs/core'],
    defaultPort: 3333,
    devCmd: 'node ace serve --watch',
    startCmd: 'node ace serve',
    healthPath: '/health',
    portEnv: 'PORT'
  },
  {
    name: 'Strapi',
    stackType: 'api',
    files: [],
    dependencies: ['@strapi/strapi'],
    defaultPort: 1337,
    devCmd: 'strapi develop',
    startCmd: 'strapi start',
    healthPath: '/_health',
    portEnv: 'PORT'
  },
  {
    name: 'KeystoneJS',
    stackType: 'api',
    files: ['keystone.ts', 'keystone.js'],
    dependencies: ['@keystone-6/core'],
    defaultPort: 3000,
    devCmd: 'keystone dev',
    startCmd: 'keystone start',
    healthPath: '/',
    portFlag: '--port'
  },

  // ========================================================================
  // Python frameworks
  // ========================================================================
  {
    name: 'FastAPI',
    stackType: 'api',
    files: ['main.py'],
    dependencies: [],
    pythonDeps: ['fastapi'],
    defaultPort: 8000,
    devCmd: 'uvicorn main:app --reload',
    startCmd: 'uvicorn main:app',
    healthPath: '/health',
    portFlag: '--port'
  },
  {
    name: 'Flask',
    stackType: 'api',
    files: ['app.py'],
    dependencies: [],
    pythonDeps: ['flask'],
    defaultPort: 5000,
    devCmd: 'flask run',
    startCmd: 'flask run',
    healthPath: '/health',
    portFlag: '--port'
  },
  {
    name: 'Django',
    stackType: 'api',
    files: ['manage.py'],
    dependencies: [],
    pythonDeps: ['django'],
    defaultPort: 8000,
    devCmd: 'python manage.py runserver',
    startCmd: 'python manage.py runserver',
    healthPath: '/admin/',
    portArg: true
  },
  {
    name: 'Streamlit',
    stackType: 'api',
    files: [],
    dependencies: [],
    pythonDeps: ['streamlit'],
    defaultPort: 8501,
    devCmd: 'streamlit run app.py',
    startCmd: 'streamlit run app.py',
    healthPath: '/',
    portFlag: '--server.port'
  },
  {
    name: 'Gradio',
    stackType: 'api',
    files: [],
    dependencies: [],
    pythonDeps: ['gradio'],
    defaultPort: 7860,
    devCmd: 'python app.py',
    startCmd: 'python app.py',
    healthPath: '/',
    portEnv: 'GRADIO_SERVER_PORT'
  },
  {
    name: 'Starlette',
    stackType: 'api',
    files: [],
    dependencies: [],
    pythonDeps: ['starlette'],
    defaultPort: 8000,
    devCmd: 'uvicorn main:app --reload',
    startCmd: 'uvicorn main:app',
    healthPath: '/health',
    portFlag: '--port'
  },

  // ========================================================================
  // Ruby frameworks
  // ========================================================================
  {
    name: 'Rails',
    stackType: 'api',
    files: ['config/routes.rb', 'Rakefile'],
    dependencies: [],
    rubyDeps: ['rails'],
    defaultPort: 3000,
    devCmd: 'rails server',
    startCmd: 'rails server',
    healthPath: '/up',
    portFlag: '-p'
  },
  {
    name: 'Sinatra',
    stackType: 'api',
    files: [],
    dependencies: [],
    rubyDeps: ['sinatra'],
    defaultPort: 4567,
    devCmd: 'ruby app.rb',
    startCmd: 'ruby app.rb',
    healthPath: '/',
    portFlag: '-p'
  },

  // ========================================================================
  // PHP frameworks
  // ========================================================================
  {
    name: 'Laravel',
    stackType: 'api',
    files: ['artisan'],
    dependencies: [],
    phpDeps: ['laravel/framework'],
    defaultPort: 8000,
    devCmd: 'php artisan serve',
    startCmd: 'php artisan serve',
    healthPath: '/',
    portFlag: '--port'
  },
  {
    name: 'Symfony',
    stackType: 'api',
    files: ['symfony.lock'],
    dependencies: [],
    phpDeps: ['symfony/framework-bundle'],
    defaultPort: 8000,
    devCmd: 'symfony server:start',
    startCmd: 'symfony server:start',
    healthPath: '/',
    portFlag: '--port'
  },
  {
    name: 'WordPress',
    stackType: 'api',
    files: ['wp-config.php', 'wp-login.php'],
    dependencies: [],
    phpDeps: [],
    defaultPort: 8080,
    devCmd: 'php -S localhost:8080',
    startCmd: 'php -S localhost:8080',
    healthPath: '/',
    portEnv: 'PORT'
  },

  // ========================================================================
  // Java/JVM frameworks
  // ========================================================================
  {
    name: 'Spring Boot',
    stackType: 'api',
    files: [],
    dependencies: [],
    javaDeps: ['org.springframework.boot'],
    defaultPort: 8080,
    devCmd: './mvnw spring-boot:run',
    startCmd: 'java -jar target/*.jar',
    healthPath: '/actuator/health',
    portEnv: 'SERVER_PORT'
  },
  {
    name: 'Quarkus',
    stackType: 'api',
    files: [],
    dependencies: [],
    javaDeps: ['io.quarkus'],
    defaultPort: 8080,
    devCmd: './mvnw quarkus:dev',
    startCmd: 'java -jar target/quarkus-app/quarkus-run.jar',
    healthPath: '/q/health',
    portEnv: 'QUARKUS_HTTP_PORT'
  },
  {
    name: 'Micronaut',
    stackType: 'api',
    files: [],
    dependencies: [],
    javaDeps: ['io.micronaut'],
    defaultPort: 8080,
    devCmd: './mvnw mn:run',
    startCmd: 'java -jar target/*.jar',
    healthPath: '/health',
    portEnv: 'MICRONAUT_SERVER_PORT'
  },

  // ========================================================================
  // Elixir frameworks
  // ========================================================================
  {
    name: 'Phoenix',
    stackType: 'api',
    files: ['mix.exs'],
    dependencies: [],
    elixirDeps: ['phoenix'],
    defaultPort: 4000,
    devCmd: 'mix phx.server',
    startCmd: 'mix phx.server',
    healthPath: '/',
    portEnv: 'PORT'
  },

  // ========================================================================
  // Deno frameworks
  // ========================================================================
  {
    name: 'Fresh',
    stackType: 'frontend',
    files: ['fresh.config.ts', 'fresh.gen.ts'],
    dependencies: [],
    defaultPort: 8000,
    devCmd: 'deno task start',
    startCmd: 'deno task start',
    healthPath: '/',
    portFlag: '--port'
  },
  {
    name: 'Deno',
    stackType: 'api',
    files: ['deno.json', 'deno.jsonc'],
    dependencies: [],
    defaultPort: 8000,
    devCmd: 'deno run --allow-net main.ts',
    startCmd: 'deno run --allow-net main.ts',
    healthPath: '/health',
    portEnv: 'PORT'
  },

  // ========================================================================
  // .NET frameworks
  // ========================================================================
  {
    name: 'Blazor',
    stackType: 'frontend',
    files: [],
    dependencies: [],
    dotnetDeps: ['Microsoft.AspNetCore.Components.WebAssembly'],
    defaultPort: 5000,
    devCmd: 'dotnet watch run',
    startCmd: 'dotnet run',
    healthPath: '/',
    portEnv: 'ASPNETCORE_URLS'
  },
  {
    name: 'ASP.NET',
    stackType: 'api',
    files: [],
    dependencies: [],
    dotnetDeps: ['Microsoft.AspNetCore'],
    defaultPort: 5000,
    devCmd: 'dotnet watch run',
    startCmd: 'dotnet run',
    healthPath: '/health',
    portEnv: 'ASPNETCORE_URLS'
  },

  // ========================================================================
  // Mobile / Desktop frameworks
  // ========================================================================
  {
    name: 'Expo',
    stackType: 'mobile',
    files: ['app.json', 'app.config.js', 'app.config.ts'],
    dependencies: ['expo'],
    defaultPort: 8081,
    devCmd: 'expo start',
    startCmd: 'expo start',
    healthPath: '/',
    portFlag: '--port'
  },
  {
    name: 'Tauri',
    stackType: 'desktop',
    files: ['src-tauri/tauri.conf.json'],
    dependencies: ['@tauri-apps/cli', '@tauri-apps/api'],
    defaultPort: 1420,
    devCmd: 'tauri dev',
    startCmd: 'tauri dev',
    healthPath: '/',
    portFlag: '--port'
  },
  {
    name: 'Electron',
    stackType: 'desktop',
    files: [],
    dependencies: ['electron'],
    defaultPort: 3000,
    devCmd: 'electron .',
    startCmd: 'electron .',
    healthPath: '/',
    portEnv: 'PORT'
  },

  // ========================================================================
  // Static Site Generators
  // ========================================================================
  {
    name: 'Hugo',
    stackType: 'ssg',
    files: ['hugo.toml', 'hugo.yaml', 'hugo.json', 'config.toml'],
    dependencies: [],
    defaultPort: 1313,
    devCmd: 'hugo server',
    startCmd: 'hugo server',
    healthPath: '/',
    portFlag: '--port'
  },
  {
    name: 'Jekyll',
    stackType: 'ssg',
    files: ['_config.yml'],
    dependencies: [],
    rubyDeps: ['jekyll'],
    defaultPort: 4000,
    devCmd: 'jekyll serve',
    startCmd: 'jekyll serve',
    healthPath: '/',
    portFlag: '--port'
  },
  {
    name: 'Zola',
    stackType: 'ssg',
    files: ['config.toml'],
    dependencies: [],
    defaultPort: 1111,
    devCmd: 'zola serve',
    startCmd: 'zola serve',
    healthPath: '/',
    portFlag: '--port'
  },

  // ========================================================================
  // Static / simple servers
  // ========================================================================
  {
    name: 'http-server',
    stackType: 'static',
    files: [],
    dependencies: ['http-server'],
    defaultPort: 8080,
    devCmd: 'http-server',
    startCmd: 'http-server',
    healthPath: '/',
    portFlag: '-p'
  },
  {
    name: 'serve',
    stackType: 'static',
    files: [],
    dependencies: ['serve'],
    defaultPort: 3000,
    devCmd: 'serve',
    startCmd: 'serve',
    healthPath: '/',
    portFlag: '-l'
  },

  // ========================================================================
  // Edge / Workers
  // ========================================================================
  {
    name: 'Cloudflare Workers',
    stackType: 'worker',
    files: ['wrangler.toml', 'wrangler.json', 'wrangler.jsonc'],
    dependencies: ['wrangler', '@cloudflare/workers-types'],
    defaultPort: 8787,
    devCmd: 'wrangler dev',
    startCmd: 'wrangler dev',
    healthPath: '/',
    portFlag: '--port'
  },

  // ========================================================================
  // Containers
  // ========================================================================
  {
    name: 'Docker',
    stackType: 'container',
    files: ['Dockerfile', 'docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'],
    dependencies: [],
    defaultPort: 3000,
    devCmd: 'docker compose up',
    startCmd: 'docker compose up -d',
    healthPath: '/',
    portEnv: 'PORT'
  },

  // ========================================================================
  // Runtime-level (Bun)
  // ========================================================================
  {
    name: 'Bun',
    stackType: 'api',
    files: ['bunfig.toml'],
    dependencies: [],
    defaultPort: 3000,
    devCmd: 'bun run server.ts',
    startCmd: 'bun run server.ts',
    healthPath: '/health',
    portEnv: 'PORT'
  },

  // ========================================================================
  // Go
  // ========================================================================
  {
    name: 'Go',
    stackType: 'api',
    files: ['go.mod'],
    dependencies: [],
    defaultPort: 8080,
    devCmd: 'go run .',
    startCmd: 'go run .',
    healthPath: '/health',
    portEnv: 'PORT'
  },

  // ========================================================================
  // Rust
  // ========================================================================
  {
    name: 'Rust',
    stackType: 'api',
    files: ['Cargo.toml'],
    dependencies: [],
    defaultPort: 8080,
    devCmd: 'cargo run',
    startCmd: 'cargo run --release',
    healthPath: '/health',
    portEnv: 'PORT'
  }
];

interface PackageJson {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  workspaces?: string[] | { packages?: string[] };
  scripts?: Record<string, string>;
}

/**
 * Read and parse package.json from a directory
 */
function readPackageJson(dir: string): PackageJson | null {
  const pkgPath = join(dir, 'package.json');
  if (!existsSync(pkgPath)) return null;

  try {
    return JSON.parse(readFileSync(pkgPath, 'utf-8')) as PackageJson;
  } catch {
    return null;
  }
}

/**
 * Read Python requirements
 */
function readPythonRequirements(dir: string): string[] {
  const reqPath = join(dir, 'requirements.txt');
  if (!existsSync(reqPath)) return [];

  try {
    const content = readFileSync(reqPath, 'utf-8');
    return content.split('\n')
      .map(line => line.trim().toLowerCase())
      .filter(line => line && !line.startsWith('#'))
      .map(line => line.split(/[=<>]/)[0].trim());
  } catch {
    return [];
  }
}

/**
 * Read Ruby dependencies from Gemfile
 */
function readRubyDeps(dir: string): string[] {
  const gemfilePath = join(dir, 'Gemfile');
  if (!existsSync(gemfilePath)) return [];

  try {
    const content = readFileSync(gemfilePath, 'utf-8');
    const deps = [];
    const gemRegex = /gem\s+['"]([^'"]+)['"]/g;
    let match;
    while ((match = gemRegex.exec(content)) !== null) {
      deps.push(match[1].toLowerCase());
    }
    return deps;
  } catch {
    return [];
  }
}

/**
 * Read PHP dependencies from composer.json
 */
function readPhpDeps(dir: string): string[] {
  const composerPath = join(dir, 'composer.json');
  if (!existsSync(composerPath)) return [];

  try {
    const content = JSON.parse(readFileSync(composerPath, 'utf-8')) as {
      require?: Record<string, string>;
      'require-dev'?: Record<string, string>;
    };
    const deps: string[] = [];
    if (content.require) deps.push(...Object.keys(content.require));
    if (content['require-dev']) deps.push(...Object.keys(content['require-dev']));
    return deps.map(d => d.toLowerCase());
  } catch {
    return [];
  }
}

/**
 * Read Java/JVM dependencies from pom.xml or build.gradle
 */
function readJavaDeps(dir: string): string[] {
  // Try pom.xml first
  const pomPath = join(dir, 'pom.xml');
  if (existsSync(pomPath)) {
    try {
      const content = readFileSync(pomPath, 'utf-8');
      const deps = [];
      const groupRegex = /<groupId>([^<]+)<\/groupId>/g;
      let match;
      while ((match = groupRegex.exec(content)) !== null) {
        deps.push(match[1].toLowerCase());
      }
      return deps;
    } catch {
      // fall through
    }
  }

  // Try build.gradle
  const gradlePath = join(dir, 'build.gradle');
  if (existsSync(gradlePath)) {
    try {
      const content = readFileSync(gradlePath, 'utf-8');
      const deps = [];
      // Match patterns like 'org.springframework.boot:spring-boot-starter'
      const depRegex = /['"]([a-z][a-z0-9._-]+):/gi;
      let match;
      while ((match = depRegex.exec(content)) !== null) {
        deps.push(match[1].toLowerCase());
      }
      return deps;
    } catch {
      // fall through
    }
  }

  return [];
}

/**
 * Read Elixir dependencies from mix.exs
 */
function readElixirDeps(dir: string): string[] {
  const mixPath = join(dir, 'mix.exs');
  if (!existsSync(mixPath)) return [];

  try {
    const content = readFileSync(mixPath, 'utf-8');
    const deps = [];
    const depRegex = /\{:(\w+)/g;
    let match;
    while ((match = depRegex.exec(content)) !== null) {
      deps.push(match[1].toLowerCase());
    }
    return deps;
  } catch {
    return [];
  }
}

/**
 * Read .NET dependencies from *.csproj files
 */
function readDotnetDeps(dir: string): string[] {
  try {
    const files = readdirSync(dir);
    const csprojFile = files.find(f => f.endsWith('.csproj'));
    if (!csprojFile) return [];

    const content = readFileSync(join(dir, csprojFile), 'utf-8');
    const deps = [];
    const pkgRegex = /Include="([^"]+)"/g;
    let match;
    while ((match = pkgRegex.exec(content)) !== null) {
      deps.push(match[1]);
    }
    return deps;
  } catch {
    return [];
  }
}

/**
 * Check if any of the signature files exist
 */
function hasFiles(dir: string, files: string[]): boolean {
  return files.some(f => existsSync(join(dir, f)));
}

/**
 * Check if package.json has any of the dependencies
 */
function hasDependencies(pkg: PackageJson | null, deps: string[]): boolean {
  if (!pkg || !deps.length) return false;

  const allDeps = {
    ...pkg.dependencies,
    ...pkg.devDependencies
  };

  return deps.some(d => d in allDeps);
}

/**
 * Detect the stack for a directory
 */
export function detectStack(dir: string = process.cwd()): DetectedStack | null {
  const pkg = readPackageJson(dir);
  const pythonDeps = readPythonRequirements(dir);
  const rubyDeps = readRubyDeps(dir);
  const phpDeps = readPhpDeps(dir);
  const javaDeps = readJavaDeps(dir);
  const elixirDeps = readElixirDeps(dir);
  const dotnetDeps = readDotnetDeps(dir);

  for (const sig of STACK_SIGNATURES) {
    // Check file signatures
    if (sig.files.length && hasFiles(dir, sig.files)) {
      return { ...sig, detected: 'file' as const };
    }

    // Check npm dependencies
    if (sig.dependencies.length && hasDependencies(pkg, sig.dependencies)) {
      return { ...sig, detected: 'dependency' as const };
    }

    // Check Python dependencies
    if (sig.pythonDeps && sig.pythonDeps.some(d => pythonDeps.includes(d))) {
      return { ...sig, detected: 'python' as const };
    }

    // Check Ruby dependencies
    if (sig.rubyDeps && sig.rubyDeps.some(d => rubyDeps.includes(d))) {
      return { ...sig, detected: 'ruby' as const };
    }

    // Check PHP dependencies
    if (sig.phpDeps && sig.phpDeps.length && sig.phpDeps.some(d => phpDeps.includes(d))) {
      return { ...sig, detected: 'php' as const };
    }

    // Check Java/JVM dependencies
    if (sig.javaDeps && sig.javaDeps.some(d => javaDeps.some(jd => jd.startsWith(d)))) {
      return { ...sig, detected: 'java' as const };
    }

    // Check Elixir dependencies
    if (sig.elixirDeps && sig.elixirDeps.some(d => elixirDeps.includes(d))) {
      return { ...sig, detected: 'elixir' as const };
    }

    // Check .NET dependencies
    if (sig.dotnetDeps && sig.dotnetDeps.some(d => dotnetDeps.some(nd => nd.startsWith(d)))) {
      return { ...sig, detected: 'dotnet' as const };
    }
  }

  return null;
}

/**
 * Get the dev command for a stack, with port injection
 */
export function getDevCommand(stack: StackSignature | null, port: number | string): string | null {
  if (!stack) return null;

  let cmd = stack.devCmd;

  if (stack.portFlag) {
    cmd = `${cmd} ${stack.portFlag} ${port}`;
  } else if (stack.portEnv) {
    cmd = `${stack.portEnv}=${port} ${cmd}`;
  } else if (stack.portArg) {
    cmd = `${cmd} ${port}`;
  }

  return cmd;
}

/**
 * Get recommended port range for a stack
 */
export function getPortRange(stack: StackSignature | null): [number, number] {
  if (!stack) return [3100, 3199];

  const base = stack.defaultPort;
  // Reserve a range around the default port
  return [base, base + 49];
}

/**
 * Detect multiple services in a monorepo
 */
interface DetectServicesMonorepoResult {
  type: 'monorepo';
  workspaces: string[];
}

interface DetectServicesSingleResult {
  type: 'single';
  services: Array<{ name: string; stack: DetectedStack; dir: string }>;
}

type DetectServicesResult = DetectServicesMonorepoResult | DetectServicesSingleResult;

export function detectServices(dir: string = process.cwd()): DetectServicesResult {
  const services: Array<{ name: string; stack: DetectedStack; dir: string }> = [];
  const pkg = readPackageJson(dir);

  // Check for workspaces (npm/yarn/pnpm)
  if (pkg?.workspaces) {
    const workspaces = Array.isArray(pkg.workspaces)
      ? pkg.workspaces
      : pkg.workspaces.packages || [];

    // TODO: Expand globs and detect each workspace
    // For now, just note that it's a monorepo
    return { type: 'monorepo', workspaces };
  }

  // Single project
  const stack = detectStack(dir);
  if (stack) {
    services.push({
      name: pkg?.name || 'app',
      stack,
      dir
    });
  }

  return { type: 'single', services };
}

/**
 * Suggest a service identity based on detection
 */
export function suggestIdentity(dir: string = process.cwd()): SuggestedIdentity {
  const pkg = readPackageJson(dir);
  const stack = detectStack(dir);

  const project = pkg?.name || dir.split('/').pop() || 'app';

  let stackName = 'app';
  if (stack) {
    // Use stackType if available, otherwise infer from framework name
    if (stack.stackType) {
      stackName = stack.stackType;
    }
  }

  return {
    project: project.replace(/[^a-z0-9-]/gi, '-').replace(/^-+/, '').toLowerCase(),
    stack: stackName,
    context: 'main',
    full: `${project}:${stackName}:main`.replace(/[^a-z0-9:-]/gi, '-').toLowerCase()
  };
}
