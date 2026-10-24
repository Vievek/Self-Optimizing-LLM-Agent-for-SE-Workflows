# HEAE Workflow Contrast v1 — Development Diagnostic

## Dataset

- Cases: 5
- Trace spans: 26
- Provenance: synthetic_development
- Annotation status: draft
- Evaluation mode: deterministic rules only

## Metrics

| Metric               | Result |
| -------------------- | -----: |
| Exact matches        |    2/5 |
| Exact-match accuracy |   0.40 |
| True positives       |      2 |
| False positives      |      3 |
| False negatives      |      0 |
| Micro-precision      |   0.40 |
| Micro-recall         |   1.00 |
| Micro-F1             | 0.5714 |
| Macro-F1             | 0.2333 |

## Case Results

| Case         | Expected | Predicted | Triggered rule |
| ------------ | -------- | --------- | -------------- |
| workflow-001 | workflow | workflow  | WORKFLOW-01    |
| workflow-002 | none     | workflow  | WORKFLOW-01    |
| workflow-003 | none     | workflow  | WORKFLOW-01    |
| workflow-004 | tool     | tool      | TOOL-02        |
| workflow-005 | none     | tool      | TOOL-02        |

## Disagreements

### workflow-002

Verification was explicitly optional, but WORKFLOW-01
classified the unsuccessful untested patch as workflow.

### workflow-003

Execution was interrupted by environment shutdown before
planned verification. WORKFLOW-01 still classified the
absence of tests as a workflow failure.

### workflow-005

The test runner executed three tests and reported one
failed assertion. TOOL-02 classified this as a tool failure,
although the trace does not establish test-runner malfunction.

## Interpretation

These findings suggest two classification-boundary problems:

1. WORKFLOW-01 does not distinguish mandatory verification
   omission from optional or interrupted verification.
2. TOOL-02 may conflate failed test assertions with tool
   execution malfunction.

These are disagreements against draft annotations, not
independently established rule errors.

## Next steps

- Inspect TOOL-02 implementation and tests.
- Review category definitions in the annotation protocol.
- Preserve the original dataset and its checksums.
- Add focused regression tests before modifying rules.
- Repeat diagnostics after any changes and report both
  before-and-after results as development experiments.

## Limitations

All five traces are synthetic development scenarios.
Annotations have not undergone independent blinded review.
These metrics are not real-world HEAE accuracy.
