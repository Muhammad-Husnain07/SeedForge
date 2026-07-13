import pc from 'picocolors';
import Table from 'cli-table3';

export function isJsonMode(): boolean {
  return process.argv.includes('--json') || process.env.SEEDFORGE_JSON === 'true';
}

export function printJson(data: unknown): void {
  if (isJsonMode()) {
    console.log(JSON.stringify(data, null, 2));
  }
}

export function printError(msg: string, jsonPayload?: Record<string, unknown>): void {
  if (isJsonMode()) {
    console.log(JSON.stringify({ error: true, message: msg, ...jsonPayload }, null, 2));
  } else {
    console.error(pc.red(`✖ ${msg}`));
  }
}

export function printSuccess(msg: string): void {
  if (!isJsonMode()) console.log(pc.green(`✔ ${msg}`));
}

export function printInfo(msg: string): void {
  if (!isJsonMode()) console.log(pc.cyan(msg));
}

export function printWarning(msg: string): void {
  if (!isJsonMode()) console.warn(pc.yellow(`⚠ ${msg}`));
}

export function printHeading(text: string): void {
  if (!isJsonMode()) console.log(pc.bold(pc.underline(text)));
}

export function renderTable(headers: string[], rows: string[][]): string {
  const t = new Table({ head: headers.map((h) => pc.bold(h)) });
  for (const row of rows) t.push(row);
  return t.toString();
}

export function renderValidationTable(
  entries: { table: string; column?: string; rule: string; status: string; message?: string }[],
): string {
  const t = new Table({
    head: [pc.bold('Table'), pc.bold('Column'), pc.bold('Rule'), pc.bold('Status'), pc.bold('Message')],
    style: { head: [], border: [] },
  });
  for (const e of entries) {
    const statusCol =
      e.status === 'pass' ? pc.green(e.status) :
      e.status === 'fail' ? pc.red(e.status) :
      pc.yellow(e.status);
    t.push([e.table, e.column ?? '—', e.rule, statusCol, e.message ?? '']);
  }
  return t.toString();
}

export function renderDiffTable(
  entries: { type: string; table: string; column?: string; detail: string }[],
): string {
  const t = new Table({
    head: [pc.bold('Type'), pc.bold('Table'), pc.bold('Column'), pc.bold('Detail')],
    style: { head: [], border: [] },
  });
  for (const e of entries) {
    const typeCol =
      e.type.includes('removed') ? pc.red(e.type) :
      e.type.includes('added') ? pc.green(e.type) :
      pc.yellow(e.type);
    t.push([typeCol, e.table, e.column ?? '—', e.detail]);
  }
  return t.toString();
}

export function renderRowPreview(
  tableName: string,
  rows: Record<string, unknown>[],
): string {
  if (rows.length === 0) return `${tableName}: (no rows)`;
  const cols = Object.keys(rows[0]!);
  const t = new Table({
    head: [pc.bold('#'), ...cols.map((c) => pc.bold(c))],
    style: { head: [], border: [] },
  });
  for (let i = 0; i < rows.length; i++) {
    t.push([String(i + 1), ...cols.map((c) => {
      const val = rows[i]![c];
      if (val === null || val === undefined) return 'NULL';
      if (typeof val === 'object') return JSON.stringify(val);
      if (typeof val === 'string') return val;
      // eslint-disable-next-line @typescript-eslint/no-base-to-string
      return String(val);
    })]);
  }
  return pc.underline(tableName) + '\n' + t.toString();
}

export function renderDoctorReport(
  checks: { name: string; status: 'pass' | 'fail' | 'warn'; message: string }[],
): string {
  const t = new Table({
    head: [pc.bold('Check'), pc.bold('Status'), pc.bold('Detail')],
    style: { head: [], border: [] },
  });
  for (const c of checks) {
    const statusCol =
      c.status === 'pass' ? pc.green('✔ pass') :
      c.status === 'fail' ? pc.red('✖ fail') :
      pc.yellow('⚠ warn');
    t.push([c.name, statusCol, c.message]);
  }
  return t.toString();
}