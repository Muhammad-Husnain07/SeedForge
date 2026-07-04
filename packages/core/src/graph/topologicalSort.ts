import type { RelationshipEdge } from './graph.js';

export interface KahnResult {
  order: string[];
  remaining: Set<string>;
}

export function topologicalSort(
  nodes: string[],
  edges: RelationshipEdge[],
): KahnResult {
  const nodeSet = new Set(nodes);

  const parentToChildren = new Map<string, Set<string>>();
  const inDegree = new Map<string, number>();

  for (const node of nodeSet) {
    parentToChildren.set(node, new Set());
    inDegree.set(node, 0);
  }

  for (const edge of edges) {
    if (!nodeSet.has(edge.from) || !nodeSet.has(edge.to)) continue;
    const children = parentToChildren.get(edge.to)!;
    if (!children.has(edge.from)) {
      children.add(edge.from);
      inDegree.set(edge.from, (inDegree.get(edge.from) ?? 0) + 1);
    }
  }

  const queue: string[] = [];
  for (const node of nodeSet) {
    if ((inDegree.get(node) ?? 0) === 0) {
      queue.push(node);
    }
  }

  const order: string[] = [];
  while (queue.length > 0) {
    const node = queue.shift()!;
    order.push(node);
    for (const child of parentToChildren.get(node) ?? []) {
      const newDegree = (inDegree.get(child) ?? 1) - 1;
      inDegree.set(child, newDegree);
      if (newDegree === 0) {
        queue.push(child);
      }
    }
  }

  const remaining = new Set<string>();
  for (const node of nodeSet) {
    if (!order.includes(node)) {
      remaining.add(node);
    }
  }

  return { order, remaining };
}

export function findCycles(
  remaining: Set<string>,
  edges: RelationshipEdge[],
): string[][] {
  if (remaining.size === 0) return [];

  const remainingSet = new Set(remaining);
  const adj = new Map<string, Set<string>>();

  for (const node of remainingSet) {
    adj.set(node, new Set());
  }

  for (const edge of edges) {
    if (remainingSet.has(edge.from) && remainingSet.has(edge.to)) {
      adj.get(edge.from)?.add(edge.to);
    }
  }

  const visited = new Map<string, number>();
  const stack: string[] = [];
  const cycles: string[][] = [];

  function dfs(node: string): void {
    const state = visited.get(node);
    if (state === 2) return;
    if (state === 1) {
      const cycleStart = stack.indexOf(node);
      if (cycleStart !== -1) {
        cycles.push(stack.slice(cycleStart));
      }
      return;
    }

    visited.set(node, 1);
    stack.push(node);

    for (const neighbor of adj.get(node) ?? []) {
      dfs(neighbor);
    }

    visited.set(node, 2);
    stack.pop();
  }

  for (const node of remainingSet) {
    if (!visited.has(node)) {
      dfs(node);
    }
  }

  return cycles;
}
