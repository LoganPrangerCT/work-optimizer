import { describe, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

describe('source build', () => {
  it('compiles cleanly from source', () => {
    const repo = path.resolve(__dirname, '..');
    const out = mkdtempSync(path.join(os.tmpdir(), 'bb-build-'));
    try {
      execFileSync(process.execPath, [path.join(repo, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.json', '--outDir', out], { cwd: repo, stdio: 'pipe' });
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }, 60_000);
});
