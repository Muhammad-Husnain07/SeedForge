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

interface ErDiagramProps {
  graph: GraphData;
  selectedTable: string | null;
  onTableClick: (tableName: string) => void;
}

const LEVEL_VERTICAL_GAP = 120;
const NODE_HORIZONTAL_GAP = 60;
const TABLE_NODE_WIDTH = 160;

function TableNodeComponent({ data, selected }: NodeProps) {
  const columns = data.columns as { name: string; isPrimaryKey: boolean }[] | undefined;
  return (
    <div
      className="table-node"
      tabIndex={0}
      role="button"
      aria-label={`Table ${String(data.label)}`}
      style={{
        background: 'var(--node-bg)',
        border: `1px solid ${selected ? 'var(--node-selected-border)' : 'var(--node-border)'}`,
        borderRadius: '4px',
        width: TABLE_NODE_WIDTH,
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--font-size-xs)',
        cursor: 'pointer',
        outline: 'none',
      }}
    >
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <div style={{
        padding: '6px 10px',
        borderBottom: '1px solid var(--border)',
        fontWeight: 600,
        color: 'var(--accent)',
        fontSize: 'var(--font-size-sm)',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}>
        {data.label as string}
      </div>
      {columns?.map((col, i) => (
        <div key={i} style={{
          padding: '2px 10px',
          color: 'var(--text-secondary)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          display: 'flex',
          alignItems: 'center',
          gap: 4,
        }}>
          <span style={{ color: 'var(--text-muted)' }}>{col.isPrimaryKey ? '#' : ''}</span>
          <span>{col.name}</span>
        </div>
      ))}
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
    </div>
  );
}

const nodeTypes = { tableNode: TableNodeComponent };

export function ErDiagram({ graph, selectedTable, onTableClick }: ErDiagramProps) {
  const rfNodes: Node[] = useMemo(() => {
    const nodes: Node[] = [];
    const levelHeights: number[] = [];

    graph.levels.forEach((level) => {
      let maxCols = 0;
      level.forEach(() => { maxCols = Math.max(maxCols, 3); });
      levelHeights.push(LEVEL_VERTICAL_GAP);
    });

    const yOffset = 20;
    graph.levels.forEach((level, levelIdx) => {
      const y = yOffset + levelIdx * 140;
      const totalWidth = level.length * (TABLE_NODE_WIDTH + NODE_HORIZONTAL_GAP) - NODE_HORIZONTAL_GAP;
      const startX = Math.max(0, (800 - totalWidth) / 2);

      level.forEach((tableName, nodeIdx) => {
        const x = startX + nodeIdx * (TABLE_NODE_WIDTH + NODE_HORIZONTAL_GAP);
        // Find column count from schema data (simplified: show 0-3 sample columns)
        const sampleCols = [{ name: '...', isPrimaryKey: false }];

        nodes.push({
          id: tableName,
          type: 'tableNode',
          position: { x, y },
          data: {
            label: tableName,
            columns: sampleCols,
          },
          selected: selectedTable === tableName,
        });
      });
    });
    return nodes;
  }, [graph, selectedTable]);

  const rfEdges: Edge[] = useMemo(() => {
    return graph.edges.map((edge, idx) => ({
      id: `e-${idx}`,
      source: edge.from,
      target: edge.to,
      label: edge.type === 'one-to-one' ? '1:1' : edge.type === 'many-to-many' ? 'M:N' : '1:N',
      style: { stroke: 'var(--edge-stroke)', strokeWidth: 1.5 },
      markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--edge-stroke)' },
      labelStyle: {
        fontFamily: 'var(--font-mono)',
        fontSize: '10px',
        fill: 'var(--text-muted)',
        background: 'var(--edge-label-bg)',
      },
      labelBgStyle: { fill: 'var(--edge-label-bg)', fillOpacity: 0.9 },
      labelBgPadding: [4, 2] as [number, number],
      labelBgBorderRadius: 2,
    }));
  }, [graph]);

  const [nodes, setNodes, onNodesChange] = useNodesState(rfNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(rfEdges);

  // Sync nodes when props change
  React.useEffect(() => {
    setNodes(rfNodes);
    setEdges(rfEdges);
  }, [rfNodes, rfEdges, setNodes, setEdges]);

  const onNodeClick = useCallback((_event: React.MouseEvent, node: Node) => {
    onTableClick(node.id);
  }, [onTableClick]);

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
      <Controls showInteractive={false} style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '4px' }} />
    </ReactFlow>
  );
}
