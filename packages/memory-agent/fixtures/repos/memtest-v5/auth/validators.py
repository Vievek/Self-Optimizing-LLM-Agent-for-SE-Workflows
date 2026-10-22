import re


class UsernameValidator:
    regex = r'^[\w.@+-]+\Z'
    message = 'Enter a valid username.'

    def __call__(self, value):
        if not re.match(self.regex, value):
            raise ValueError(self.message)
