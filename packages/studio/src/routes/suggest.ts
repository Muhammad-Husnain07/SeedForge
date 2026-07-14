import type { FastifyInstance } from 'fastify';
import { execSync } from 'node:child_process';
import { writeFileSync, unlinkSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getContext } from '../context.js';

export function suggestRoutes(server: FastifyInstance): void {
  server.post<{ Body: { description: string } }>('/suggest-describe', async (req) => {
    const { description } = req.body;
    if (!description || typeof description !== 'string' || description.trim().length === 0) {
      return { error: 'description is required' };
    }

    const ctx = getContext();
    const configPath = process.env.SEEDFORGE_CONFIG_PATH ?? 'seedforge.config.ts';

    // Write description to a temp file to avoid shell escaping issues
    const tmpDir = mkdtempSync(join(tmpdir(), 'sf-suggest-'));
    const descFile = join(tmpDir, 'description.txt');
    const outFile = join(tmpDir, 'suggested.ts');
    writeFileSync(descFile, description, 'utf-8');

    try {
      const cliPath = process.env.SEEDFORGE_CLI_PATH ?? 'seedforge';
      const provider = process.env.SEEDFORGE_LLM_PROVIDER ?? 'anthropic';
      const model = process.env.SEEDFORGE_LLM_MODEL ?? '';
      const modelFlag = model ? `--model "${model}"` : '';

      const cmd = `${cliPath} suggest --config "${configPath}" --describe "$(cat "${descFile}")" --output "${outFile}" --provider ${provider} ${modelFlag}`;

      execSync(cmd, {
        timeout: 120_000,
        stdio: 'pipe',
        env: { ...process.env },
        shell: true,
      });

      // Read the generated file
      const fs = await import('node:fs/promises');
      let configDraft: string;
      try {
        configDraft = await fs.readFile(outFile, 'utf-8');
      } catch {
        return { error: 'CLI did not produce output', configDraft: null };
      }

      return {
        configDraft,
        dialect: ctx.connectConfig.dialect,
        reasoning: null,
      };
    } finally {
      try { unlinkSync(descFile); } catch { /* cleanup */ }
      try { unlinkSync(outFile); } catch { /* cleanup */ }
      try { unlinkSync(tmpDir); } catch { /* cleanup */ }
    }
  });
}
