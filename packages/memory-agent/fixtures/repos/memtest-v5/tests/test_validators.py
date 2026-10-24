from auth.validators import UsernameValidator


def test_accepts_plain_username():
    UsernameValidator()('alice')
