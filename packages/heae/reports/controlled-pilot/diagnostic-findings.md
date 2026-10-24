# HEAE Controlled Pilot — Development Diagnostic

## Dataset

- Dataset: controlled-v1
- Cases: 5
- Provenance: synthetic_development
- Annotation status: draft
- Purpose: Development diagnostics, not independent research validation

## Classification Results

| Metric               |  Value |
| -------------------- | -----: |
| Total cases          |      5 |
| Exact-match accuracy |   0.80 |
| Micro-precision      |   0.75 |
| Micro-recall         |   1.00 |
| Micro-F1             | 0.8571 |
| Macro-F1             |   0.60 |

## Case-Level Findings

| Case      | Expected  | Predicted | Result       |
| --------- | --------- | --------- | ------------ |
| pilot-001 | None      | None      | Match        |
| pilot-002 | Tool      | Tool      | Match        |
| pilot-003 | Retrieval | Retrieval | Match        |
| pilot-004 | Planning  | Planning  | Match        |
| pilot-005 | None      | Workflow  | Disagreement |

## Pilot 005 — WORKFLOW-01

The rule detected:

1. A successful apply_patch operation.
2. An unsuccessful final task outcome.
3. Zero recorded test executions.

The draft annotation does not assign a workflow-failure
category because the trace does not establish whether
verification was mandatory.

### Interpretation

WORKFLOW-01 correctly detects the pattern defined by its
implementation. However, the pattern alone may not establish
a confirmed workflow defect.

The disagreement is retained for later annotation review.

### Decision

- Do not modify WORKFLOW-01 based on this case.
- Do not change the draft annotation to match HEAE.
- Preserve the original dataset snapshot.
- Review verification requirements when real execution
  traces and task specifications become available.

## Limitations

These results come from five synthetic development cases.
The annotations have not been independently reviewed.
They must not be presented as real-world HEAE accuracy.
