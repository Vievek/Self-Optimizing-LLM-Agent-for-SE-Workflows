# Main Application Script

from auth import authenticate

def login():
    username = input('Enter username: ')
    password = input('Enter password: ')
    if authenticate(username, password):
        print('Login successful!')
    else:
        print('Invalid credentials!')

if __name__ == '__main__':
    login()