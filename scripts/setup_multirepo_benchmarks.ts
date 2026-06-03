import * as child_process from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const REPOSITORIES = [
  {
    name: 'nestjs-realworld',
    url: 'https://github.com/lujakob/nestjs-realworld-example-app.git',
  },
  {
    name: 'nestjs-prisma-starter',
    url: 'https://github.com/notiz-dev/nestjs-prisma-starter.git',
  },
  {
    name: 'domain-driven-hexagon',
    url: 'https://github.com/Sairyss/domain-driven-hexagon.git',
  },
  {
    name: 'nestjs-boilerplate',
    url: 'https://github.com/brocoders/nestjs-boilerplate.git',
  },
  {
    name: 'ghostfolio',
    url: 'https://github.com/ghostfolio/ghostfolio.git',
  }
];

const BENCHMARKS_DIR = path.join(__dirname, '..', 'benchmarks_real');

function execPromise(command: string, cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    child_process.exec(command, { cwd }, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(stdout);
    });
  });
}

async function main() {
  if (!fs.existsSync(BENCHMARKS_DIR)) {
    fs.mkdirSync(BENCHMARKS_DIR, { recursive: true });
  }

  console.log('Setting up multi-repository benchmarks...');

  for (const repo of REPOSITORIES) {
    const repoDir = path.join(BENCHMARKS_DIR, repo.name);
    const sourceDir = path.join(repoDir, 'source');

    if (fs.existsSync(sourceDir)) {
      console.log(`[SKIP] ${repo.name} already exists.`);
      continue;
    }

    if (!fs.existsSync(repoDir)) {
      fs.mkdirSync(repoDir, { recursive: true });
    }

    console.log(`[CLONE] Cloning ${repo.name}...`);
    try {
      await execPromise(`git clone --depth 1 ${repo.url} source`, repoDir);
      console.log(`[OK] Successfully cloned ${repo.name}.`);
    } catch (e) {
      console.error(`[ERROR] Failed to clone ${repo.name}:`, e);
    }
  }

  console.log('All repositories set up.');
}

main().catch(console.error);
