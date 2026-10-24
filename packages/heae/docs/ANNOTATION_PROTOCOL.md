# HEAE Ground-Truth Annotation Protocol

**Project:** Self-Optimizing LLM Agent for Software Engineering Workflows  
**Component:** Hierarchical Evaluation and Attribution Engine (HEAE)  
**Document version:** 1.0  
**Purpose:** Independent annotation and evaluation of software engineering execution traces.

## 1. Purpose and Scope

This protocol defines a consistent method for assigning ground-truth failure labels and assessing causal explanations in HEAE evaluation datasets.

HEAE processes execution traces, identifies observable failures through deterministic rules and generates hypotheses about potential causes. An optional LLM-as-Judge evaluates those hypotheses using available evidence.

This protocol separates three evaluation objectives:

1. **Failure classification:** Identify which failure categories are supported by the execution trace.
2. **Evidence grounding:** Determine whether the cited trace spans support the recorded observation.
3. **Causal attribution:** Assess whether evidence supports a claim that an observed issue contributed to the task outcome.

A failure observation must not automatically be treated as proof of its underlying root cause.

## 2. Dataset Provenance

Every evaluation dataset must identify its origin.

| Dataset type          | Definition                                                                             | Permitted interpretation                                 |
| --------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Synthetic development | Traces constructed to exercise known HEAE rules                                        | Regression verification                                  |
| Synthetic independent | Traces constructed separately from rule development and withheld during implementation | Controlled generalisation testing                        |
| Real execution        | Traces recorded during actual software engineering task execution                      | System-level evaluation, subject to ground-truth quality |

Dataset metadata should include the dataset name, version, source, collection or creation method, annotation date and annotation status.

Synthetic development fixtures must not be reported as independent empirical validation.

## 3. Supported Trace Structure

The annotation procedure follows the shared execution-trace contract, schema version `1.0`.

Supported span types are:

- `task`
- `prompt`
- `plan`
- `tool_call`
- `retrieval`
- `route`
- `output`

Each trace span contains an identifier, trace identifier, parent reference, timestamps, execution status, attributes and optional causal links.

Annotators must inspect the available span attributes and relationships. They must not assume that all potentially relevant execution details are recorded.

## 4. Failure Classification Categories

HEAE supports five failure categories.

### 4.1 Prompt

Use `prompt` when available evidence supports an observable prompt-related failure.

Relevant evidence may include malformed instructions, prompt-template errors, unsuitable configuration or explicitly recorded prompt validation failures.

Do not assign this category solely because a generated answer is incorrect. An incorrect result may have several possible causes.

### 4.2 Tool

Use `tool` when the trace records a failed or erroneous tool operation.

Relevant evidence may include:

- A `tool_call` span reporting an error.
- A tool execution status of `error`.
- An explicit failure message, such as a patch application failure.
- Failed retries or related execution records.

A tool failure can be observed directly even when the reason for the tool failure remains uncertain.

### 4.3 Retrieval

Use `retrieval` when the trace contains evidence of an unsuccessful or inadequate retrieval operation.

Relevant evidence may include empty result sets, failed retrieval operations, documented relevance problems or missing information required for the task.

An empty retrieval result must be interpreted in context. Some queries may legitimately have no matching results.

### 4.4 Planning

Use `planning` when execution records support a planning-related failure.

Relevant evidence may include invalid step sequences, failed planning operations, inconsistent dependencies or unsuccessful replanning.

A task's final failure alone is insufficient to establish a planning failure.

### 4.5 Workflow

Use `workflow` when execution evidence supports a workflow-level problem, such as missing verification, incomplete required processing or failure to complete mandatory execution stages.

A failed final result is not, by itself, sufficient evidence that the workflow category must apply.

### 4.6 Multiple Categories

A trace may receive multiple failure labels when independent evidence supports them.

For example, a trace could contain both a retrieval failure and a separate tool execution failure.

Do not assign additional categories simply because a failed operation occurs before another failure.

## 5. Annotation Procedure

### Step 1: Review the Trace

Inspect the full JSONL execution trace.

Verify the presence and consistency of the available span identifiers, names, statuses, timestamps, attributes and relationships.

Record incomplete or inconsistent trace data as an annotation limitation.

### Step 2: Record the Task Outcome

Determine the final recorded task outcome using the relevant `output` span.

Use one of:

- `pass`
- `fail`
- `error`
- `unknown`

Use `unknown` when the available trace does not establish the outcome.

### Step 3: Identify Observable Failures

Review each span for directly observable failures.

Record the failed operation, relevant attributes and exact supporting span identifiers.

### Step 4: Assign Failure Categories

Assign any of the five supported categories that have adequate supporting evidence.

An empty category list is valid when no category-level failure is established.

Do not infer a specific category merely because the task failed.

### Step 5: Record Evidence References

For each positive failure label, record the relevant span IDs.

The referenced evidence should directly support the observation associated with the label.

If the trace does not provide sufficient evidence, document the limitation instead of inventing a supporting reference.

### Step 6: Evaluate Causal Hypotheses Separately

For each proposed causal hypothesis, determine whether the available evidence:

- Supports the hypothesis.
- Contradicts the hypothesis.
- Is insufficient to determine whether the hypothesis is correct.

A recorded error can support an observation without establishing the deeper root cause.

### Step 7: Document Uncertainty

Describe information that is missing or ambiguous.

Examples include missing patch content, unavailable repository state, absent verification logs, incomplete retrieval results and unclear relationships between operations.

### Step 8: Finalise the Annotation

Check that every assigned failure category has a documented justification and that causal assessments do not exceed the available evidence.

## 6. Suggested Ground-Truth Annotation Fields

Each annotated case should contain:

| Field                | Description                                                    |
| -------------------- | -------------------------------------------------------------- |
| `caseId`             | Unique evaluation-case identifier                              |
| `traceFile`          | Relative path to the trace                                     |
| `observedOutcome`    | Recorded task outcome                                          |
| `expectedCategories` | Independently assigned failure categories                      |
| `categoryEvidence`   | Supporting span IDs for each positive category                 |
| `causalAssessments`  | Evaluations of causal hypotheses                               |
| `limitations`        | Missing or ambiguous evidence                                  |
| `annotationStatus`   | Draft, reviewed or adjudicated                                 |
| `datasetProvenance`  | Synthetic development, synthetic independent or real execution |

These are proposed research annotation fields, not an existing HEAE runtime contract.

The current research runner requires only a case ID, trace filename and expected categories. Additional annotation metadata will require a separately validated schema before being consumed programmatically.

## 7. Worked Example: Patch Application Failure

**Fixture:** `packages/heae/fixtures/tool-error.jsonl`

**Task outcome:** `fail`

**Observed failure category:** `tool`

**Primary evidence span:** `1000000000000006`

**Related output span:** `1000000000000007`

The tool-call span records an `apply_patch` operation with an error status and the message:

`PATCH_APPLY_FAILED: context mismatch`

The output span records an unsuccessful task result and links to the tool-call span.

**Observation:** The patch application operation failed.

**Causal assessment:** The trace supports a relationship between the failed tool operation and the unsuccessful execution outcome.

**Underlying root cause:** Insufficient evidence to establish why the patch context did not match.

**Limitations:** The trace does not contain enough patch-content or repository-state evidence to independently verify the origin of the mismatch.

This example is a synthetic development fixture, not independent experimental evidence.

## 8. Independent Annotation and Review

For an independent evaluation dataset:

1. Annotators should not view HEAE predictions before assigning ground-truth labels.
2. Where practical, at least two reviewers should independently annotate each trace.
3. Disagreements should be documented and resolved through a defined adjudication procedure.
4. The final dataset should preserve its annotation version and provenance.
5. Ground-truth labels should be finalised before running benchmark evaluations.
6. Evaluation-set labels should not be used to tune HEAE rules and then reported as untouched test performance.

Agreement between reviewers may be evaluated separately from HEAE prediction accuracy.

## 9. Evaluation Metrics

For multi-label failure classification, HEAE currently supports:

- Exact-match accuracy.
- Micro-precision, micro-recall and micro-F1.
- Macro-F1.
- Per-category precision, recall, F1 and support.
- False-positive and false-negative counts.

The evaluator uses a zero value when a precision or recall denominator is zero. Consequently, macro-F1 on a small dataset can be reduced by categories that have no positive examples.

Metric interpretation must account for dataset size, class support, provenance and annotation reliability.

Causal attribution quality and evidence grounding should be evaluated separately from category-classification metrics.

## 10. Reporting Requirements

Research reports should identify:

- Dataset name, version and origin.
- Number of annotated execution traces.
- Distribution of failure categories.
- Annotation procedure and reviewer information.
- Classification metrics and case-level errors.
- Evidence-grounding evaluation results, when available.
- Causal-attribution assessment results, when available.
- Important limitations and potential sources of bias.

Results from synthetic development fixtures and independently annotated evaluation datasets must be presented separately.

## 11. Current HEAE Evaluation Status

At the time this protocol was prepared:

- Seven populated synthetic development fixtures are available for HEAE regression evaluation.
- The synthetic baseline report records seven exact label-set matches, with micro-F1 and macro-F1 of 1.00.
- The automated research evaluation runner and multi-label metrics are implemented.
- Independent real-execution validation and systematic causal-attribution benchmarking remain pending.

The synthetic baseline demonstrates expected behaviour on existing development examples. It does not establish real-world detection accuracy.

## 12. Scope and Change Control

This protocol applies to research evaluation and annotation activities owned by HEAE.

Changes to the shared trace contract, Execution Core, Memory Agent, Orchestrator or other team-owned components are outside its scope and require team coordination.

Future revisions to this document should record changes to category definitions, annotation criteria, uncertainty handling or dataset evaluation procedures.
