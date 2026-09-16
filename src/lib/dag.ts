export type DagStep = {
  id: string;
  name: string;
  dependsOn: string[];
  sourceDatasourceId?: string;
  targetDatasourceId?: string;
  sourceConfig?: Record<string, unknown>;
  targetConfig?: Record<string, unknown>;
  fieldMapping?: unknown[];
  jobId?: string;
  x?: number;
  y?: number;
  [key: string]: unknown;
};

export type DagLayoutNode = {
  id: string;
  step: DagStep;
  x: number;
  y: number;
};

export const DAG_NODE_W = 176;
export const DAG_NODE_H = 80;
const COL_GAP = 56;
const ROW_GAP = 28;

export function normalizeDagSteps(raw: unknown): DagStep[] {
  if (!Array.isArray(raw)) return [];
  const steps: DagStep[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const id = String(row.id || row.code || '').trim();
    if (!id) continue;
    let depends = row.dependsOn ?? row.depends_on ?? [];
    if (typeof depends === 'string') {
      depends = depends.replace(/,/g, ' ').split(/\s+/).filter(Boolean);
    }
    if (!Array.isArray(depends)) depends = [];
    const x = Number(row.x);
    const y = Number(row.y);
    steps.push({
      ...(row as DagStep),
      id,
      name: String(row.name || id),
      dependsOn: (depends as unknown[]).map((d) => String(d)),
      sourceDatasourceId: String(row.sourceDatasourceId || row.source_datasource_id || '') || undefined,
      targetDatasourceId: String(row.targetDatasourceId || row.target_datasource_id || '') || undefined,
      sourceConfig: (row.sourceConfig || row.source_config || undefined) as Record<string, unknown> | undefined,
      targetConfig: (row.targetConfig || row.target_config || undefined) as Record<string, unknown> | undefined,
      jobId: String(row.jobId || row.job_id || '') || undefined,
      x: Number.isFinite(x) ? x : undefined,
      y: Number.isFinite(y) ? y : undefined,
    });
  }
  return steps;
}

export function parseDagSteps(raw: string): { steps: DagStep[]; error: string } {
  const text = raw.trim();
  if (!text) return { steps: [], error: '' };
  try {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) return { steps: [], error: 'DAG 步骤需为 JSON 数组' };
    return { steps: normalizeDagSteps(parsed), error: '' };
  } catch {
    return { steps: [], error: 'DAG 步骤需为合法 JSON 数组' };
  }
}

export function stringifyDagSteps(steps: DagStep[]): string {
  if (!steps.length) return '';
  return JSON.stringify(
    steps.map((step) => {
      const {
        depends_on: _dependsOnSnake,
        source_datasource_id: _sourceSnake,
        target_datasource_id: _targetSnake,
        source_config: _sourceCfgSnake,
        target_config: _targetCfgSnake,
        job_id: _jobSnake,
        code: _code,
        ...rest
      } = step as DagStep & Record<string, unknown>;
      const out: Record<string, unknown> = {
        ...rest,
        id: step.id,
        name: step.name || step.id,
        dependsOn: step.dependsOn || [],
      };
      if (step.sourceDatasourceId) out.sourceDatasourceId = step.sourceDatasourceId;
      else delete out.sourceDatasourceId;
      if (step.targetDatasourceId) out.targetDatasourceId = step.targetDatasourceId;
      else delete out.targetDatasourceId;
      if (step.sourceConfig && Object.keys(step.sourceConfig).length) out.sourceConfig = step.sourceConfig;
      else delete out.sourceConfig;
      if (step.targetConfig && Object.keys(step.targetConfig).length) out.targetConfig = step.targetConfig;
      else delete out.targetConfig;
      if (step.jobId) out.jobId = step.jobId;
      else delete out.jobId;
      if (typeof step.x === 'number') out.x = Math.round(step.x);
      if (typeof step.y === 'number') out.y = Math.round(step.y);
      return out;
    }),
    null,
    2,
  );
}

export function dagHasCycle(steps: DagStep[]): boolean {
  const graph = new Map(steps.map((s) => [s.id, s.dependsOn.filter((d) => d !== s.id)]));
  const color = new Map<string, 0 | 1 | 2>();
  const visit = (id: string): boolean => {
    color.set(id, 1);
    for (const dep of graph.get(id) || []) {
      if (!graph.has(dep)) continue;
      const c = color.get(dep) ?? 0;
      if (c === 1) return true;
      if (c === 0 && visit(dep)) return true;
    }
    color.set(id, 2);
    return false;
  };
  for (const id of graph.keys()) {
    if ((color.get(id) ?? 0) === 0 && visit(id)) return true;
  }
  return false;
}

export function wouldCreateCycle(steps: DagStep[], stepId: string, dependOn: string): boolean {
  if (stepId === dependOn) return true;
  return dagHasCycle(
    steps.map((s) => (s.id === stepId ? { ...s, dependsOn: [...new Set([...s.dependsOn, dependOn])] } : s)),
  );
}

export function nextStepId(steps: DagStep[]): string {
  const used = new Set(steps.map((s) => s.id));
  let i = steps.length + 1;
  while (used.has(`s${i}`)) i += 1;
  return `s${i}`;
}

export function mergeStepsWithStates(steps: DagStep[], states?: Record<string, string>): DagStep[] {
  const byId = new Map(steps.map((s) => [s.id, s]));
  for (const id of Object.keys(states || {})) {
    if (!byId.has(id)) byId.set(id, { id, name: id, dependsOn: [] });
  }
  return [...byId.values()];
}

export function layoutDag(steps: DagStep[]): { nodes: DagLayoutNode[]; width: number; height: number } {
  const rank = new Map<string, number>();
  const visiting = new Set<string>();
  const walk = (id: string): number => {
    if (rank.has(id)) return rank.get(id)!;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const step = steps.find((s) => s.id === id);
    const deps = (step?.dependsOn || []).filter((d) => steps.some((s) => s.id === d));
    const value = deps.length ? Math.max(...deps.map(walk)) + 1 : 0;
    visiting.delete(id);
    rank.set(id, value);
    return value;
  };
  for (const step of steps) walk(step.id);

  const columns = new Map<number, DagStep[]>();
  for (const step of steps) {
    const col = rank.get(step.id) ?? 0;
    const list = columns.get(col) || [];
    list.push(step);
    columns.set(col, list);
  }

  const nodes: DagLayoutNode[] = [];
  const cols = [...columns.keys()].sort((a, b) => a - b);
  for (const col of cols) {
    const list = columns.get(col) || [];
    list.forEach((step, row) => {
      const autoX = 24 + col * (DAG_NODE_W + COL_GAP);
      const autoY = 24 + row * (DAG_NODE_H + ROW_GAP);
      nodes.push({
        id: step.id,
        step,
        x: typeof step.x === 'number' ? step.x : autoX,
        y: typeof step.y === 'number' ? step.y : autoY,
      });
    });
  }

  const width = Math.max(480, ...nodes.map((n) => n.x + DAG_NODE_W + 24), 24);
  const height = Math.max(280, ...nodes.map((n) => n.y + DAG_NODE_H + 24), 24);
  return { nodes, width, height };
}

export function tableOf(config?: Record<string, unknown>): string {
  if (!config) return '';
  const value = config.table ?? config.path ?? '';
  return value == null ? '' : String(value);
}

export function withTable(config: Record<string, unknown> | undefined, table: string): Record<string, unknown> {
  const next = { ...(config || {}) };
  const trimmed = table.trim();
  if (!trimmed) {
    delete next.table;
    delete next.path;
    return next;
  }
  next.table = trimmed;
  next.path = trimmed;
  return next;
}

export function validateDagText(raw: string): string {
  const { steps, error } = parseDagSteps(raw);
  if (error) return error;
  if (!raw.trim()) return '';
  const ids = steps.map((s) => s.id);
  if (new Set(ids).size !== ids.length) return '步骤 ID 不能重复';
  if (steps.some((s) => !s.id.trim())) return '每个步骤都需要 ID';
  if (dagHasCycle(steps)) return 'DAG 存在依赖环，无法执行';
  return '';
}
