import type { ForeignKey } from '../types/index.js';

export type EdgeType =
  | 'one-to-many'
  | 'one-to-one'
  | 'many-to-many'
  | 'self-referential';

export interface RelationshipEdge {
  from: string;
  to: string;
  type: EdgeType;
  viaJunctionTable?: string;
  foreignKey: ForeignKey;
}

export interface RelationshipGraph {
  nodes: string[];
  edges: RelationshipEdge[];
  insertionOrder: string[];
  cycles: string[][];
}

export interface MongoInferredRelationship {
  fromCollection: string;
  toCollection: string;
  fromField: string;
  confidence: number;
}
