# Verification fixture repos

Tiny repos used by the code-grounded verification tests. Each folder is one "commit" of the same
project: `FixtureSandboxService` copies `fixtures/repos/<commit>` into a fresh workspace.

| Version      | State          | `auth/validators.py`                            | `tests/test_validators.py`                                                       |
| ------------ | -------------- | ----------------------------------------------- | -------------------------------------------------------------------------------- |
| `memtest-v1` | fix present    | contains `regex = r'^[\w.@+-]+\Z'`              | `test_rejects_trailing_newline` passes                                           |
| `memtest-v2` | code changed   | rewritten without a regex; the fix line is gone | unchanged (still passes under pytest)                                            |
| `memtest-v3` | file removed   | deleted; `auth/` only has `__init__.py`         | unchanged (import fails: collection error)                                       |
| `memtest-v4` | test now fails | same as v1 (fix present)                        | `test_rejects_trailing_newline` also expects `'alice+bob'` to be rejected: fails |
| `memtest-v5` | test deleted   | same as v1 (fix present)                        | `test_rejects_trailing_newline` removed; only `test_accepts_plain_username`      |

The failing v4 test carries a `# simulated-failure` comment so the fake runner knows it fails.

Each version also has an empty `pytest.ini`: the sandbox's default runner uses pytest only when it
finds one. Unit tests swap pytest for `fakeValidatorTestRunner` (see `src/dev/fixture-sandbox.ts`) so CI
does not need python. It mirrors pytest: a missing test file or function is an error, a function
containing `# simulated-failure` fails, and otherwise a test passes only if the fixed regex is
present. `verify/pytest.integration.test.ts` runs the real runner when pytest is
installed.

`fixtures/stale-set/cases.json` labels notes against these versions with the status the verifier
should give; `src/eval/stale-set.ts` runs them and reports the stale catch rate.
