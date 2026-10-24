export type FailureCategory = 'prompt' | 'tool' | 'retrieval' | 'planning' | 'workflow';

export interface RuleFinding {
  ruleId: string;
  category: FailureCategory;
  observation: string;
  evidenceNodeIds: string[];
  details: Record<string, unknown>;
}
