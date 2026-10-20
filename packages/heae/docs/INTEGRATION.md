# HEAE — Integration Guide

## 1. Overview

The Hierarchical Evaluation and Attribution Engine (HEAE) evaluates execution traces produced by the Execution Core and identifies evidence-supported failures in software engineering agent workflows.

HEAE performs rule-based failure classification, evidence attribution and optional LLM-as-Judge assessment. It stores evaluation results and produces structured evidence for downstream components.

HEAE is responsible for diagnosing failures. It does not modify source code, generate optimization configuration changes or execute optimization actions.

## 2. Component Integration

The intended component workflow is:

```text
Execution Core
    |
    | JSONL execution traces
    v
HEAE
    |
    | Trace validation
    | Graph construction
    | Rule-based classification
    | Evidence attribution
    | Optional LLM-as-Judge
    v
Saved Evaluation
    |
    | Verified outcome inputs
    v
Event Publication
    |
    +--> OutcomeEvidence --> Memory Agent
    |
    +--> OptimizationSignal --> Optimization Orchestrator
```

The Memory Agent and Optimization Orchestrator integrations are pending implementation and verification against the corresponding components.

## 3. Public HEAE APIs

### 3.1 `evaluateExecutionTrace()`

```typescript
import { evaluateExecutionTrace } from '@soa/heae';

const result = await evaluateExecutionTrace(
  runId,
  taskId,
  {
    tracesDirectory: 'store/traces',
    store,
  },
);
```

This function:

1. Locates the execution trace.
2. Validates the trace and execution identity.
3. Builds the interaction graph.
4. Applies rule-based failure detection.
5. Performs optional LLM assessment when a compatible provider and model are supplied and judgment is required.
6. Saves the evaluation when storage is configured.

The default trace location is:

```text
store/traces/<run_id>/<task_id>.jsonl
```

The function reads the existing execution trace without modifying it.

### 3.2 `evaluateTrace()`

```typescript
import { evaluateTrace } from '@soa/heae';

const result = await evaluateTrace(jsonlContent, {
  store,
});
```

This API accepts trace content directly and is suitable for isolated tests or integrations that already have the JSONL data available.

### 3.3 `publishEvaluationEvents()`

```typescript
import { publishEvaluationEvents } from '@soa/heae';

const publication = await publishEvaluationEvents(
  traceId,
  {
    store,
    outcomeInput,
  },
);
```

This function loads a previously saved evaluation and publishes requested downstream events.

It does not rerun the failure classification or LLM judge.

The evaluation and event publisher must use storage that accesses the same saved evaluation history.

## 4. Execution Trace Contract

Execution traces follow the shared `@soa/contracts` trace schema, version `1.0`.

Supported span types are:

| Span | Purpose |
|---|---|
| `task` | Identifies the execution run, task and configuration |
| `prompt` | Records prompt and model information |
| `plan` | Records planning steps and replanning information |
| `tool_call` | Records tool execution, latency and failures |
| `retrieval` | Records code or memory retrieval activity |
| `route` | Records model routing decisions |
| `output` | Records patch and test results |

Each trace span contains identifiers, timestamps, a status, typed attributes and optional causal links.

Execution Core owns the original trace. HEAE validates and reads it.

Task span `run_id` and `task_id` values must match the requested execution identity.

## 5. Failure Classification

HEAE supports the following failure categories:

- Prompt
- Tool
- Retrieval
- Planning
- Workflow

A trace may receive multiple labels where the evidence supports multiple failure categories.

For example, a failed `apply_patch` operation with a context mismatch can trigger rule `TOOL-02`.

Rules generate observations and attribution hypotheses supported by trace span identifiers.

These observations establish what the trace records. They do not independently prove the underlying root cause.

## 6. LLM-as-Judge

HEAE supports optional LLM assessment through its existing provider interface.

The project's selected model is Qwen2.5-Coder-3B-Instruct, intended to run locally.

When a provider or model is unavailable, HEAE can still perform rule-based evaluation.

The judgment status can therefore indicate that model assessment was unavailable or not performed.

A completed, evidence-supported judgment is required for eligible optimization signal generation.

Automated tests using simulated judgments do not establish real-world LLM accuracy.

## 7. Evaluation Persistence

HEAE uses the shared `Store` abstraction for evaluation history.

Saved evaluations can include a SHA-256 trace fingerprint to support trace integrity checks.

HEAE also supports optional Kuzu interaction graph persistence.

Storage behavior depends on the configured implementations. An isolated `MemoryStore` test does not persist files to disk.

Existing evaluation records are protected against accidental duplicate creation.

## 8. OutcomeEvidence Publication

OutcomeEvidence uses shared contract schema version `2.0`.

The event destination relative to the Store root is:

```text
events/outcome_evidence.jsonl
```

With a `FileStore` rooted at `store`, the path becomes:

```text
store/events/outcome_evidence.jsonl
```

OutcomeEvidence includes execution identity, externally supplied outcome information, cost information and supporting fields defined by the shared contract.

Publishing requires verified execution facts from the responsible execution component.

HEAE must not invent test results, patch status or task-resolution outcomes.

The existing publisher performs schema validation, sequential duplicate detection and conflict checks.

## 9. OptimizationSignal Publication

The OptimizationSignal destination relative to the Store root is:

```text
events/optimization_signals.jsonl
```

Publication requires:

- A saved HEAE evaluation.
- A reviewed optimization proposal.
- A completed LLM judgment.
- A supported failure hypothesis.
- Evidence references consistent with that judgment.

If these conditions are not met, signal generation can be skipped.

HEAE emits diagnostic optimization signals. It does not apply optimization changes.

## 10. Event Delivery Architecture

HEAE currently publishes events directly through the shared Store abstraction.

Stored JSONL events are available for subsequent reading and replay.

The project's `StoreBus` supports historical replay and live notifications for records published through the corresponding bus instance.

Direct Store writes do not automatically emit live `StoreBus` notifications.

The team must decide whether downstream components will:

1. Consume persisted JSONL records, or
2. Use a coordinated live event-delivery mechanism.

No live event-bus integration is currently claimed for HEAE.

## 11. Reliability and Limitations

The existing event publisher supports sequential duplicate detection and publication conflict checks.

It currently assumes a single-writer HEAE process.

Concurrent publishers are not protected by an atomic compare-and-append operation.

Separate event publications can partially succeed; retries can recover using the existing duplicate-handling behavior.

Consumers should track processed event identities when replaying stored records.

All components must agree on the storage root, event paths and shared contract schemas.

## 12. Verified Testing

The following testing has been completed:

- Trace intake and graph validation.
- Rule-based failure classification.
- Attribution and evidence references.
- Evaluation persistence and fingerprint verification.
- Kuzu persistence tests.
- Event schema validation.
- Duplicate and conflicting publication tests.
- Synthetic Execution Core trace integration.
- End-to-end trace-to-OutcomeEvidence publication using MemoryStore.

At the documented verification point:

**287 tests passed across 40 test files**, with lint, typecheck and build completing successfully.

These tests confirm software behavior against the implemented fixtures and contracts. They do not establish failure-classification accuracy on unseen real-world execution traces.

## 13. Remaining Integration Work

The remaining integration milestones are:

1. Validate HEAE using actual Execution Core traces.
2. Confirm real outcome and cost fields supplied by Execution Core.
3. Agree on event consumption with the Memory Agent and Optimization Orchestrator.
4. Integrate and evaluate Qwen2.5-Coder-3B-Instruct using a local inference runtime.
5. Measure diagnostic classification and attribution performance using appropriately reviewed evaluation data.

The HEAE implementation should remain independent of teammate-owned components until their integration contracts are confirmed.

### 6.1 Local Qwen2.5-Coder-3B Integration

HEAE supports local LLM-as-Judge inference using Qwen2.5-Coder-3B-Instruct through Ollama. The implementation uses the existing `LlmProvider` interface and does not require an external inference service or Hugging Face API token.

The Ollama adapter is implemented in `src/providers/ollama-provider.ts` and is exported from `@soa/heae`.

**Local setup**

Start the Ollama server:

```bash
ollama serve
```

Download the selected model once:

```bash
ollama pull qwen2.5-coder:3b
```

**Using the provider**

```typescript
import {
  evaluateTrace,
  OllamaProvider,
} from '@soa/heae';

const provider = new OllamaProvider({
  timeoutMs: 300000,
});

const result = await evaluateTrace(jsonlContent, {
  provider,
  model: 'qwen2.5-coder:3b',
  store,
});
```

The adapter communicates with Ollama through its local HTTP endpoint, normally `http://127.0.0.1:11434/api/chat`.

It requests structured JSON output, forwards model-generation settings, and returns model responses through the shared LLM interface.

HEAE independently validates the judgment schema, allowed failure categories and supporting evidence span identifiers.

**Evaluation observations**

A live evaluation using the synthetic tool-error trace successfully returned `judgeStatus: completed` with no warnings.

The model identified the recorded `PATCH_APPLY_FAILED: context mismatch` message and selected `insufficient_evidence` for its causal assessment.

This demonstrates successful local model integration and structured output validation. It does not establish the correctness of all model-generated causal assessments.

**Operational limitations**

The adapter currently supports chat-based judgment only and does not provide embeddings.

Inference runs locally on available hardware. On the tested WSL environment, the model operated using CPU inference with a 4096-token context.

The model may produce uncertain or inaccurate explanations even when its JSON response passes schema validation.

Automated tests use mocked Ollama responses and therefore do not require a model download or running inference server.