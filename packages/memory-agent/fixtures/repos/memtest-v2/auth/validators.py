ALLOWED_SYMBOLS = set('.@+-_')


class UsernameValidator:
    message = 'Enter a valid username.'

    def __call__(self, value):
        if not value or any(not (ch.isalnum() or ch in ALLOWED_SYMBOLS) for ch in value):
            raise ValueError(self.message)
