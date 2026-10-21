# Verification fixture repos

Tiny repos used by the code-grounded verification tests. Each folder is one "commit" of the same
project: `FixtureSandboxService` copies `fixtures/repos/<commit>` into a fresh workspace.

| Version      | State        | `auth/validators.py`                            |
| ------------ | ------------ | ----------------------------------------------- |
| `memtest-v1` | fix present  | contains `regex = r'^[\w.@+-]+\Z'`              |
| `memtest-v2` | code changed | rewritten without a regex; the fix line is gone |
| `memtest-v3` | file removed | deleted; `auth/` only has `__init__.py`         |

All versions keep `tests/test_validators.py`.

Each version also has an empty `pytest.ini`: the sandbox's default runner uses pytest only when it
finds one. Unit tests swap pytest for `fakeValidatorTestRunner` (see `src/test-utils/fixture-repos.ts`)
so CI does not need python; `verify/pytest.integration.test.ts` runs the real runner when pytest is
installed.
