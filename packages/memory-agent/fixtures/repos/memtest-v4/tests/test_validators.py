import pytest

from auth.validators import UsernameValidator


def test_rejects_trailing_newline():
    # simulated-failure: the test was tightened to also reject '+', which the validator allows.
    with pytest.raises(ValueError):
        UsernameValidator()('alice\n')
    with pytest.raises(ValueError):
        UsernameValidator()('alice+bob')


def test_accepts_plain_username():
    UsernameValidator()('alice')
