export interface GeneratorSpec {
  kind: string;
  params: Record<string, unknown>;
}

export interface FieldSemanticMatch {
  table: string;
  column: string;
  semanticType: string;
  confidence: number;
  suggestedGenerator: GeneratorSpec;
  source: 'rule' | 'unresolved';
}

export interface AnalyzeSchemaOptions {
  confidenceThreshold?: number;
  booleanSkew?: number;
}
