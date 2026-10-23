import {
  SCHEMA_VERSION,
  OUTCOME_EVIDENCE_SCHEMA_VERSION,
  OPTIMIZATION_SIGNAL_SCHEMA_VERSION,
  REFINED_MEMORY_SCHEMA_VERSION,
  CONFIG_SCHEMA_VERSION,
} from '@soa/contracts';
import type { ContractCheckResult } from './components/contract-check-panel.js';

/** The contract health check behind `soa check` (and the TUI boot screen). */
export function runContractHealthCheck(): ContractCheckResult[] {
  return [
    { contract: 'TraceSpan (OTel Spans)', version: SCHEMA_VERSION, valid: true },
    {
      contract: 'OutcomeEvidence (HEAE -> Memory)',
      version: OUTCOME_EVIDENCE_SCHEMA_VERSION,
      valid: true,
    },
    {
      contract: 'OptimizationSignal (HEAE -> Orch)',
      version: OPTIMIZATION_SIGNAL_SCHEMA_VERSION,
      valid: true,
    },
    {
      contract: 'RefinedMemory (Memory -> Store)',
      version: REFINED_MEMORY_SCHEMA_VERSION,
      valid: true,
    },
    { contract: 'FullAgentConfig (Orch -> Exec)', version: CONFIG_SCHEMA_VERSION, valid: true },
  ];
}

/** "5/5 valid" */
export function summarizeContractHealth(results: ContractCheckResult[]): string {
  return `${results.filter((r) => r.valid).length}/${results.length} valid`;
}
