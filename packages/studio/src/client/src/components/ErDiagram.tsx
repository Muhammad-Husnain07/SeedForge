import React, { useMemo, useCallback } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  Node,
  Edge,
  useNodesState,
  useEdgesState,
  MarkerType,
  BackgroundVariant,
  NodeProps,
  Handle,
  Position,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

interface GraphData {
  nodes: string[];
  edges: {
    from: string;
    to: string;
    type: string;
    foreignKey: { columns: string[]; referencedTable: string; referencedColumns: string[] };
  }[];
  levels: string[][];
}

interface ColumnInfo {
  name: string;
  logicalType?: string;
  nativeType?: string;
  isPrimaryKey: boolean;
}

interface SchemaTable {
  name: string;
  columns: ColumnInfo[];
}

interface ChangedTable {
  name: string;
  status: 'added' | 'removed' | 'changed';
  addedCols: string[];
  removedCols: string[];
  changedCols: { name: string; detail: string }[];
}

interface DiffData {
  hasDrift: boolean;
  addedTables: string[];
  removedTables: string[];
  changedTables: ChangedTable[];
}

interface ErDiagramProps {
  graph: GraphData;
  selectedTable: string | null;
  onTableClick: (tableName: string) => void;
  schemaTables?: SchemaTable[];
  diff?: DiffData | null;
  showDrift?: boolean;
  onToggleDrift?: () => void;
}

const TABLE_NODE_WIDTH = 160;

function TableNodeComponent({ data, selected }: NodeProps) {
  const columns = data.columns as { name: string; isPrimaryKey: boolean }[] | undefined;
  const diffStatus = data.diffStatus as string | undefined;
  const addedCols = data.addedCols as string[] | undefined;
  const removedCols = data.removedCols as string[] | undefined;
  const changedCols = data.changedCols as { name: string; detail: string }[] | undefined;

  let borderColor = 'var(--node-border)';
  let badgeLabel = '';
  let badgeColor = '';
  let bgOpacity = 1;
  if (diffStatus === 'added') { borderColor = 'var(--diff-added)'; badgeLabel = '+'; badgeColor = 'var(--diff-added)'; }
  else if (diffStatus === 'removed') { borderColor = 'var(--diff-removed)'; badgeLabel = '−'; badgeColor = 'var(--diff-removed)'; bgOpacity = 0.5; }
  else if (diffStatus === 'changed') { borderColor = 'var(--diff-changed)'; badgeLabel = '~'; badgeColor = 'var(--diff-changed)'; }

  const addedSet = new Set(addedCols ?? []);
  const removedSet = new Set(removedCols ?? []);
  const changedMap = new Map((changedCols ?? []).map((c) => [c.name, c]));

  return (
    <div
      className="table-node"
      tabIndex={0}
      role="button"
      aria-label={`Table ${String(data.label)}`}
      style={{
        background: 'var(--node-bg)',
        border: `1px solid ${selected ? 'var(--node-selected-border)' : borderColor}`,
        borderRadius: '4px',
        width: TABLE_NODE_WIDTH,
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--font-size-xs)',
        cursor: 'pointer',
        outline: 'none',
        opacity: bgOpacity,
        position: 'relative',
      }}
    >
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      {badgeLabel && (
        <div style={{
          position: 'absolute', top: -6, right: -6,
          width: 16, height: 16, borderRadius: '50%',
          background: badgeColor, color: '#fff',
          fontSize: 10, lineHeight: '16px', textAlign: 'center',
          fontWeight: 700,
        }}>{badgeLabel}</div>
      )}
      <div style={{
        padding: '6px 10px',
        borderBottom: '1px solid var(--border)',
        fontWeight: 600,
        color: diffStatus === 'removed' ? 'var(--diff-removed)' : 'var(--accent)',
        fontSize: 'var(--font-size-sm)',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        textDecoration: diffStatus === 'removed' ? 'line-through' : 'none',
      }}>
        {data.label as string}
      </div>
      {columns?.map((col, i) => {
        let colColor = 'var(--text-secondary)';
        let colDecor = 'none';
        if (addedSet.has(col.name)) { colColor = 'var(--diff-added)'; }
        else if (removedSet.has(col.name)) { colColor = 'var(--diff-removed)'; colDecor = 'line-through'; }
        else if (changedMap.has(col.name)) { colColor = 'var(--diff-changed)'; }
        return (
          <div key={i} style={{
            padding: '2px 10px',
            color: colColor,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            textDecoration: colDecor,
          }}>
            <span style={{ color: 'var(--text-muted)' }}>{col.isPrimaryKey ? '#' : ''}</span>
            <span>{col.name}</span>
            {addedSet.has(col.name) && <span style={{ color: 'var(--diff-added)', fontSize: 'var(--font-size-xs)' }}>+</span>}
            {changedMap.has(col.name) && <span style={{ color: 'var(--diff-changed)', fontSize: 'var(--font-size-xs)' }}>~</span>}
          </div>
        );
      })}
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
    </div>
  );
}

const nodeTypes = { tableNode: TableNodeComponent };

export function ErDiagram({ graph, selectedTable, onTableClick, schemaTables, diff, showDrift, onToggleDrift }: ErDiagramProps) {
  const schemaMap = useMemo(() => {
    const m = new Map<string, ColumnInfo[]>();
    if (schemaTables) {
      for (const t of schemaTables) {
        m.set(t.name, t.columns.map((c) => ({ name: c.name, isPrimaryKey: c.isPrimaryKey })));
      }
    }
    return m;
  }, [schemaTables]);

  const diffTableMap = useMemo(() => {
    const m = new Map<string, ChangedTable>();
    if (diff && showDrift) {
      for (const t of diff.changedTables) m.set(t.name, t);
      for (const t of diff.addedTables) m.set(t, { name: t, status: 'added', addedCols: [], removedCols: [], changedCols: [] });
      for (const t of diff.removedTables) m.set(t, { name: t, status: 'removed', addedCols: [], removedCols: [], changedCols: [] });
    }
    return m;
  }, [diff, showDrift]);

  const rfNodes: Node[] = useMemo(() => {
    const nodes: Node[] = [];
    const yOffset = 20;
    graph.levels.forEach((level, levelIdx) => {
      const y = yOffset + levelIdx * 140;
      const totalWidth = level.length * (TABLE_NODE_WIDTH + 60) - 60;
      const startX = Math.max(0, (800 - totalWidth) / 2);
      level.forEach((tableName, nodeIdx) => {
        const x = startX + nodeIdx * (TABLE_NODE_WIDTH + 60);
        const cols = schemaMap.get(tableName) ?? [{ name: '...', isPrimaryKey: false }];
        const dt = diffTableMap.get(tableName);

        const nodeDiffStatus = dt?.status;
        const addedCols = (dt?.status === 'changed' ? dt?.addedCols : undefined) ?? [];
        const removedCols = (dt?.status === 'changed' ? dt?.removedCols : undefined) ?? [];
        const changedCols = (dt?.status === 'changed' ? dt?.changedCols : undefined) ?? [];
        if (dt?.status === 'added') cols.push(...cols); // keep original columns

        nodes.push({
          id: tableName,
          type: 'tableNode',
          position: { x, y },
          data: {
            label: tableName,
            columns: cols,
            diffStatus: nodeDiffStatus,
            addedCols,
            removedCols,
            changedCols,
          },
          selected: selectedTable === tableName,
        });
      });
    });
    return nodes;
  }, [graph, selectedTable, schemaMap, diffTableMap]);

  const rfEdges: Edge[] = useMemo(() => {
    const removedSet = diff && showDrift ? new Set(diff.removedTables ?? []) : new Set();
    return graph.edges.map((edge, idx) => {
      const isRemoved = removedSet.has(edge.from) || removedSet.has(edge.to);
      return {
        id: `e-${idx}`,
        source: edge.from,
        target: edge.to,
        label: edge.type === 'one-to-one' ? '1:1' : edge.type === 'many-to-many' ? 'M:N' : '1:N',
        style: {
          stroke: isRemoved ? 'var(--diff-removed)' : 'var(--edge-stroke)',
          strokeWidth: isRemoved ? 1 : 1.5,
          strokeDasharray: isRemoved ? '4 2' : 'none',
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: isRemoved ? 'var(--diff-removed)' : 'var(--edge-stroke)',
        },
        labelStyle: {
          fontFamily: 'var(--font-mono)',
          fontSize: '10px',
          fill: 'var(--text-muted)',
          background: 'var(--edge-label-bg)',
        },
        labelBgStyle: { fill: 'var(--edge-label-bg)', fillOpacity: 0.9 },
        labelBgPadding: [4, 2] as [number, number],
        labelBgBorderRadius: 2,
      };
    });
  }, [graph, diff, showDrift]);

  const [nodes, setNodes, onNodesChange] = useNodesState(rfNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(rfEdges);

  React.useEffect(() => {
    setNodes(rfNodes);
    setEdges(rfEdges);
  }, [rfNodes, rfEdges, setNodes, setEdges]);

  const onNodeClick = useCallback((_event: React.MouseEvent, node: Node) => {
    onTableClick(node.id);
  }, [onTableClick]);

  const hasDrift = diff?.hasDrift ?? false;

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeClick={onNodeClick}
      nodeTypes={nodeTypes}
      fitView
      fitViewOptions={{ padding: 0.2 }}
      minZoom={0.3}
      maxZoom={2}
      proOptions={{ hideAttribution: true }}
      style={{ background: 'var(--graph-bg)' }}
    >
      <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--border)" />
      <Controls showInteractive={false} style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '4px' }}>
        {onToggleDrift && (
          <div style={{ padding: '4px 8px', borderTop: '1px solid var(--border)' }}>
            <button
              onClick={onToggleDrift}
              title={showDrift ? 'Hide schema drift' : 'Show schema drift'}
              style={{
                width: '100%',
                padding: '4px 8px',
                background: showDrift ? 'var(--accent)' : 'transparent',
                border: `1px solid ${hasDrift ? 'var(--confidence-low)' : 'var(--border)'}`,
                borderRadius: '3px',
                color: showDrift ? 'var(--bg-base)' : 'var(--text-secondary)',
                cursor: 'pointer',
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--font-size-xs)',
                whiteSpace: 'nowrap',
              }}
            >
              {showDrift ? 'Hide drift' : hasDrift ? 'Drift detected' : 'Check drift'}
            </button>
          </div>
        )}
      </Controls>
      {showDrift && hasDrift && (
        <div style={{
          position: 'absolute', bottom: 8, left: 8,
          background: 'var(--bg-surface)', border: '1px solid var(--border)',
          borderRadius: '4px', padding: '6px 10px',
          fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-xs)',
          display: 'flex', gap: 12,
        }}>
          {diff!.addedTables.length > 0 && <span style={{ color: 'var(--diff-added)' }}>+{diff!.addedTables.length}</span>}
          {diff!.removedTables.length > 0 && <span style={{ color: 'var(--diff-removed)' }}>−{diff!.removedTables.length}</span>}
          {diff!.changedTables.length > 0 && <span style={{ color: 'var(--diff-changed)' }}>~{diff!.changedTables.length}</span>}
          <span style={{ color: 'var(--text-muted)' }}>| drift</span>
        </div>
      )}
    </ReactFlow>
  );
}
