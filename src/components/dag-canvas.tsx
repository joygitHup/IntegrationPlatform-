'use client';

import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';

type DagStep = {
  id: string;
  name: string;
  dependsOn: string[];
  sourceDatasourceId?: string;
  targetDatasourceId?: string;
  sourceConfig?: Record<string, unknown>;
  targetConfig?: Record<string, unknown>;
  jobId?: string;
  [key: string]: unknown;
};

type Named = { id: string; name?: string };

type Props = {
  steps: DagStep[];
  onChange?: (steps: DagStep[]) => void;
  readOnly?: boolean;
  stepStates?: Record<string, string>;
  selectedId?: string;
  onSelectStep?: (id: string | null) => void;
  datasources?: Named[];
  jobs?: Named[];
  defaultSourceId?: string;
  defaultTargetId?: string;
  onOpenExecution?: (executionId: string) => void;
  executions?: Array<{ id: string; stepId?: string }>;
};

const NODE_W = 220;
const NODE_H = 124;
const COL_GAP = 64;
const ROW_GAP = 32;

const cn = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

const STATUS_STYLE: Record<string, { box: string; label: string; badge: string }> = {
  pending: { box: 'border-slate-300 bg-white', label: '等待', badge: 'bg-slate-100 text-slate-600' },
  running: { box: 'border-blue-600 bg-blue-50 ring-2 ring-blue-200', label: '执行中', badge: 'bg-blue-100 text-blue-700' },
  success: { box: 'border-green-600 bg-green-50', label: '成功', badge: 'bg-green-100 text-green-700' },
  failed: { box: 'border-red-600 bg-red-50', label: '失败', badge: 'bg-red-100 text-red-700' },
};

function nextStepId(steps: DagStep[]): string {
  const used = new Set(steps.map((s) => s.id));
  let i = steps.length + 1;
  while (used.has(`s${i}`)) i += 1;
  return `s${i}`;
}

function dagHasCycle(steps: DagStep[]): boolean {
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

function wouldCreateCycle(steps: DagStep[], stepId: string, dependOn: string): boolean {
  if (stepId === dependOn) return true;
  return dagHasCycle(
    steps.map((s) => (s.id === stepId ? { ...s, dependsOn: [...new Set([...s.dependsOn, dependOn])] } : s)),
  );
}

function layoutSteps(steps: DagStep[]): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  if (!steps.length) return positions;
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
  const cols = [...columns.keys()].sort((a, b) => a - b);
  for (const col of cols) {
    const list = columns.get(col) || [];
    list.forEach((step, row) => {
      positions.set(step.id, {
        x: 24 + col * (NODE_W + COL_GAP),
        y: 24 + row * (NODE_H + ROW_GAP),
      });
    });
  }
  return positions;
}

function tableOf(config?: Record<string, unknown>): string {
  if (!config) return '';
  const value = config.table ?? config.path ?? '';
  return value == null ? '' : String(value);
}

function withTable(config: Record<string, unknown> | undefined, table: string): Record<string, unknown> {
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

function NodeNameInput({
  value,
  readOnly,
  onCommit,
}: {
  value: string;
  readOnly: boolean;
  onCommit: (v: string) => void;
}) {
  const [local, setLocal] = useState(value);
  useEffect(() => {
    setLocal(value);
  }, [value]);
  return (
    <input
      type="text"
      className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
      value={local}
      readOnly={readOnly}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => onCommit(local)}
    />
  );
}

export function DagCanvas({
  steps,
  onChange,
  readOnly = false,
  stepStates,
  selectedId,
  onSelectStep,
  datasources = [],
  jobs = [],
  defaultSourceId = '',
  defaultTargetId = '',
  onOpenExecution,
  executions = [],
}: Props) {
  const [positions, setPositions] = useState<Map<string, { x: number; y: number }>>(() => layoutSteps(steps));
  const [internalSelected, setInternalSelected] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number } | null>(null);
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const selected = selectedId ?? internalSelected;
  const editable = !readOnly && !!onChange;

  useEffect(() => {
    setPositions((prev) => {
      const next = new Map(prev);
      let changed = false;
      const auto = layoutSteps(steps);
      for (const step of steps) {
        if (!next.has(step.id)) {
          next.set(step.id, auto.get(step.id) || { x: 24, y: 24 });
          changed = true;
        }
      }
      for (const id of [...next.keys()]) {
        if (!steps.some((s) => s.id === id)) {
          next.delete(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [steps]);

  const { width, height } = useMemo(() => {
    let w = 480;
    let h = 300;
    for (const [, p] of positions) {
      w = Math.max(w, p.x + NODE_W + 24);
      h = Math.max(h, p.y + NODE_H + 24);
    }
    return { width: w, height: h };
  }, [positions]);

  const select = (id: string | null) => {
    setInternalSelected(id);
    onSelectStep?.(id);
  };

  const emit = (next: DagStep[]) => onChange?.(next);

  const addStep = () => {
    const id = nextStepId(steps);
    const last = steps[steps.length - 1];
    emit([
      ...steps,
      {
        id,
        name: `步骤 ${id}`,
        dependsOn: last ? [last.id] : [],
        sourceDatasourceId: defaultSourceId || undefined,
        targetDatasourceId: defaultTargetId || undefined,
      },
    ]);
    select(id);
  };

  const updateStep = (id: string, patch: Partial<DagStep>) => {
    emit(steps.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };

  const renameId = (oldId: string, nextId: string) => {
    const id = nextId.trim();
    if (!id || id === oldId || steps.some((s) => s.id === id)) return;
    emit(
      steps.map((s) => ({
        ...s,
        id: s.id === oldId ? id : s.id,
        name: s.id === oldId && (s.name === oldId || s.name === `步骤 ${oldId}`) ? `步骤 ${id}` : s.name,
        dependsOn: s.dependsOn.map((d) => (d === oldId ? id : d)),
      })),
    );
    select(id);
  };

  const removeStep = (id: string) => {
    emit(steps.filter((s) => s.id !== id).map((s) => ({ ...s, dependsOn: s.dependsOn.filter((d) => d !== id) })));
    if (selected === id) select(null);
    if (openDropdown === id) setOpenDropdown(null);
  };

  const toggleDep = (stepId: string, depId: string) => {
    const step = steps.find((s) => s.id === stepId);
    if (!step) return;
    const has = step.dependsOn.includes(depId);
    if (has) {
      emit(steps.map((s) => (s.id === stepId ? { ...s, dependsOn: s.dependsOn.filter((d) => d !== depId) } : s)));
    } else {
      if (wouldCreateCycle(steps, stepId, depId)) return;
      emit(steps.map((s) => (s.id === stepId ? { ...s, dependsOn: [...new Set([...s.dependsOn, depId])] } : s)));
    }
  };

  const onBoardMouseMove = (e: MouseEvent) => {
    if (!drag || !editable) return;
    const rect = boardRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = Math.max(8, e.clientX - rect.left - drag.dx);
    const y = Math.max(8, e.clientY - rect.top - drag.dy);
    setPositions((prev) => {
      const next = new Map(prev);
      next.set(drag.id, { x, y });
      return next;
    });
  };

  const selectedStep = steps.find((s) => s.id === selected);
  const selectedExec = executions.find((e) => e.stepId === selected);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {editable
            ? '拖动节点调整位置；用节点下拉框选择依赖步骤，连线可从下拉框取消'
            : '按 dependsOn 从左到右执行，颜色为步骤状态'}
        </p>
        {editable && (
          <button
            type="button"
            className="inline-flex items-center rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50"
            onClick={addStep}
          >
            + 添加步骤
          </button>
        )}
      </div>

      <div className="grid gap-3 lg:grid-cols-[1fr_240px]">
        <div
          ref={boardRef}
          className="relative overflow-auto rounded-lg border border-slate-200"
          style={{
            minHeight: 320,
            maxHeight: 520,
            backgroundColor: '#f8fafc',
            backgroundImage:
              'linear-gradient(to right, #e2e8f0 1px, transparent 1px), linear-gradient(to bottom, #e2e8f0 1px, transparent 1px)',
            backgroundSize: '20px 20px',
          }}
          onMouseMove={onBoardMouseMove}
          onMouseUp={() => setDrag(null)}
          onMouseLeave={() => setDrag(null)}
          onClick={() => {
            setOpenDropdown(null);
            select(null);
          }}
        >
          {steps.length === 0 ? (
            <div className="flex h-[300px] flex-col items-center justify-center text-sm text-slate-500">
              <p>尚未编排步骤，保存后按单步 ETL 执行</p>
              {editable && (
                <button
                  type="button"
                  className="mt-3 inline-flex items-center rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
                  onClick={(e) => {
                    e.stopPropagation();
                    addStep();
                  }}
                >
                  + 添加第一个步骤
                </button>
              )}
            </div>
          ) : (
            <div className="relative" style={{ width, height }}>
              <svg className="absolute inset-0 h-full w-full" width={width} height={height}>
                <defs>
                  <marker id="dag-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                    <path d="M0,0 L8,4 L0,8 Z" fill="#94a3b8" />
                  </marker>
                </defs>
                {steps.flatMap((step) =>
                  step.dependsOn.map((fromId) => {
                    const from = positions.get(fromId);
                    const to = positions.get(step.id);
                    if (!from || !to) return null;
                    const x1 = from.x + NODE_W;
                    const y1 = from.y + NODE_H / 2;
                    const x2 = to.x;
                    const y2 = to.y + NODE_H / 2;
                    const mid = (x1 + x2) / 2;
                    return (
                      <path
                        key={`${fromId}-${step.id}`}
                        d={`M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`}
                        fill="none"
                        stroke="#94a3b8"
                        strokeWidth="1.5"
                        markerEnd="url(#dag-arrow)"
                      />
                    );
                  }),
                )}
              </svg>

              {steps.map((step) => {
                const pos = positions.get(step.id) || { x: 24, y: 24 };
                const state = stepStates?.[step.id] || '';
                const style = STATUS_STYLE[state];
                const active = selected === step.id;
                return (
                  <div
                    key={step.id}
                    className={cn(
                      'absolute rounded-lg border px-2.5 py-2 shadow-sm',
                      style?.box || 'border-slate-200 bg-white',
                      active && 'ring-2 ring-blue-600',
                      editable && 'cursor-grab',
                    )}
                    style={{ left: pos.x, top: pos.y, width: NODE_W, minHeight: NODE_H }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpenDropdown(null);
                      select(step.id);
                    }}
                    onMouseDown={(e) => {
                      if (!editable) return;
                      const target = e.target as HTMLElement;
                      if (
                        target.tagName === 'INPUT' ||
                        target.tagName === 'BUTTON' ||
                        target.closest('[data-stop-drag]')
                      )
                        return;
                      e.stopPropagation();
                      const rect = boardRef.current?.getBoundingClientRect();
                      if (!rect) return;
                      setDrag({ id: step.id, dx: e.clientX - rect.left - pos.x, dy: e.clientY - rect.top - pos.y });
                      select(step.id);
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[10px] text-slate-500">{step.id}</span>
                      <div className="flex items-center gap-1">
                        {style && (
                          <span
                            className={cn(
                              'rounded px-1.5 py-0.5 text-[10px]',
                              style.badge,
                            )}
                          >
                            {style.label}
                          </span>
                        )}
                        {editable && (
                          <button
                            type="button"
                            data-stop-drag
                            className="text-slate-400 hover:text-red-600"
                            title="删除步骤"
                            onClick={(e) => {
                              e.stopPropagation();
                              removeStep(step.id);
                            }}
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    </div>

                    {editable ? (
                      <div data-stop-drag>
                        <NodeNameInput
                          key={step.id}
                          value={step.name}
                          readOnly={false}
                          onCommit={(v) => updateStep(step.id, { name: v })}
                        />
                      </div>
                    ) : (
                      <p className="mt-1 truncate text-sm font-semibold">{step.name || step.id}</p>
                    )}

                    <div data-stop-drag>
                      <button
                        type="button"
                        className={cn(
                          'mt-1 flex w-full items-center justify-between rounded border px-2 py-1 text-xs',
                          openDropdown === step.id
                            ? 'border-blue-500 bg-blue-50'
                            : 'border-slate-300 bg-white',
                          !editable && 'cursor-default',
                        )}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (editable) setOpenDropdown(openDropdown === step.id ? null : step.id);
                        }}
                      >
                        <span className="truncate">
                          {step.dependsOn.length
                            ? `依赖 (${step.dependsOn.length}): ${step.dependsOn.join(', ')}`
                            : '无依赖（起始步骤）'}
                        </span>
                        {editable && <span className="ml-1 shrink-0 text-[10px]">▼</span>}
                      </button>
                      {openDropdown === step.id && editable && (
                        <>
                          <div
                            className="fixed inset-0 z-40"
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenDropdown(null);
                            }}
                          />
                          <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-44 overflow-auto rounded border border-slate-200 bg-white p-1 shadow-lg">
                            {steps.filter((s) => s.id !== step.id).length === 0 ? (
                              <p className="px-2 py-1 text-xs text-slate-500">暂无其它步骤</p>
                            ) : (
                              steps
                                .filter((s) => s.id !== step.id)
                                .map((other) => {
                                  const checked = step.dependsOn.includes(other.id);
                                  const cyclic = wouldCreateCycle(steps, step.id, other.id);
                                  return (
                                    <label
                                      key={other.id}
                                      className={cn(
                                        'flex items-center gap-2 rounded px-2 py-1 text-xs',
                                        cyclic ? 'cursor-not-allowed opacity-50' : 'hover:bg-slate-50',
                                      )}
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <input
                                        type="checkbox"
                                        className="h-3 w-3"
                                        checked={checked}
                                        disabled={cyclic}
                                        onChange={() => toggleDep(step.id, other.id)}
                                      />
                                      <span className="font-mono text-[10px] text-slate-500">{other.id}</span>
                                      <span className="truncate">{other.name || other.id}</span>
                                    </label>
                                  );
                                })
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-3">
          {!selectedStep ? (
            <p className="text-xs text-slate-500">点选步骤查看或编辑属性。</p>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">步骤属性</p>
                {editable && (
                  <button
                    type="button"
                    className="rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                    onClick={() => removeStep(selectedStep.id)}
                  >
                    删除
                  </button>
                )}
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-500">ID</label>
                <input
                  type="text"
                  className="h-8 w-full rounded border border-slate-300 bg-white px-2 font-mono text-xs"
                  defaultValue={selectedStep.id}
                  key={selectedStep.id}
                  disabled={!editable}
                  onBlur={(e) => renameId(selectedStep.id, e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-500">名称</label>
                <input
                  type="text"
                  className="h-8 w-full rounded border border-slate-300 bg-white px-2 text-xs"
                  defaultValue={selectedStep.name}
                  key={`name-${selectedStep.id}`}
                  disabled={!editable}
                  onBlur={(e) => updateStep(selectedStep.id, { name: e.target.value })}
                />
              </div>
              {editable && (
                <>
                  <div className="space-y-1">
                    <label className="text-xs text-slate-500">源数据源</label>
                    <select
                      className="h-8 w-full rounded border border-slate-300 bg-white px-2 text-xs"
                      value={selectedStep.sourceDatasourceId || ''}
                      onChange={(e) =>
                        updateStep(selectedStep.id, { sourceDatasourceId: e.target.value || undefined })
                      }
                    >
                      <option value="">沿用任务源</option>
                      {datasources.map((ds) => (
                        <option key={ds.id} value={ds.id}>
                          {ds.name || ds.id}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-slate-500">源表 / 路径</label>
                    <input
                      type="text"
                      className="h-8 w-full rounded border border-slate-300 bg-white px-2 font-mono text-xs"
                      value={tableOf(selectedStep.sourceConfig)}
                      onChange={(e) =>
                        updateStep(selectedStep.id, { sourceConfig: withTable(selectedStep.sourceConfig, e.target.value) })
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-slate-500">目标数据源</label>
                    <select
                      className="h-8 w-full rounded border border-slate-300 bg-white px-2 text-xs"
                      value={selectedStep.targetDatasourceId || ''}
                      onChange={(e) =>
                        updateStep(selectedStep.id, { targetDatasourceId: e.target.value || undefined })
                      }
                    >
                      <option value="">沿用任务目标</option>
                      {datasources.map((ds) => (
                        <option key={ds.id} value={ds.id}>
                          {ds.name || ds.id}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-slate-500">目标表 / 路径</label>
                    <input
                      type="text"
                      className="h-8 w-full rounded border border-slate-300 bg-white px-2 font-mono text-xs"
                      value={tableOf(selectedStep.targetConfig)}
                      onChange={(e) =>
                        updateStep(selectedStep.id, { targetConfig: withTable(selectedStep.targetConfig, e.target.value) })
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-slate-500">委托其它任务</label>
                    <select
                      className="h-8 w-full rounded border border-slate-300 bg-white px-2 text-xs"
                      value={selectedStep.jobId || ''}
                      onChange={(e) => updateStep(selectedStep.id, { jobId: e.target.value || undefined })}
                    >
                      <option value="">不委托</option>
                      {jobs.map((job) => (
                        <option key={job.id} value={job.id}>
                          {job.name || job.id}
                        </option>
                      ))}
                    </select>
                  </div>
                </>
              )}
              {selectedExec && onOpenExecution && (
                <button
                  type="button"
                  className="h-8 w-full rounded border border-slate-300 bg-white text-xs hover:bg-slate-50"
                  onClick={() => onOpenExecution(selectedExec.id)}
                >
                  查看该步执行
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
