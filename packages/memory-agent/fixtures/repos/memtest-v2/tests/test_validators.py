import pytest

from auth.validators import UsernameValidator


def test_rejects_trailing_newline():
    with pytest.raises(ValueError):
        UsernameValidator()('alice\n')
