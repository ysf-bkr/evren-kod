/**
 * Bağımlılık grafında döngü tespiti — Moduller ve görev planları aynı
 * algoritmayı kullanır.
 *
 * Düğümler modelden gelir ve sayısı önceden bilinmez; özyinelemeli DFS uzun
 * bir bağımlılık zincirinde "Maximum call stack size exceeded" verirdi.
 * Açık yığın sürümünde derinlik sınırı yoktur.
 */

interface CycleNode {
  id: string;
  dependsOn?: readonly string[];
}

interface Frame {
  id: string;
  deps: readonly string[];
  index: number;
}

/** Döngü bulunursa döngü yolu (ör. [a, b, a]); yoksa undefined. */
export function detectDependencyCycle(nodes: readonly CycleNode[]): string[] | undefined {
  const state = new Map<string, 'visiting' | 'visited'>();
  const byId = new Map(nodes.map((node) => [node.id, node]));

  for (const node of nodes) {
    if (state.get(node.id) === 'visited') continue;

    const stack: Frame[] = [{ id: node.id, deps: byId.get(node.id)?.dependsOn ?? [], index: 0 }];
    state.set(node.id, 'visiting');

    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      if (!frame) break;

      if (frame.index >= frame.deps.length) {
        state.set(frame.id, 'visited');
        stack.pop();
        continue;
      }

      const dependency = frame.deps[frame.index];
      frame.index++;
      if (!dependency) continue;

      const dependencyState = state.get(dependency);
      if (dependencyState === 'visiting') {
        return [...stack.map((item) => item.id), dependency];
      }
      if (dependencyState === 'visited') continue;

      state.set(dependency, 'visiting');
      stack.push({ id: dependency, deps: byId.get(dependency)?.dependsOn ?? [], index: 0 });
    }
  }
  return undefined;
}
