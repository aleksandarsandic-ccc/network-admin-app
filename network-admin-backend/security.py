import os
from cryptography.fernet import Fernet
from dotenv import load_dotenv

load_dotenv()

ENCRYPTION_KEY = os.getenv("ENCRYPTION_KEY")
if not ENCRYPTION_KEY:
    raise ValueError("ENCRYPTION_KEY nije postavljen u .env fajlu!")

fernet = Fernet(ENCRYPTION_KEY.encode())

def encrypt_password(plain_password: str) -> str:
    encrypted = fernet.encrypt(plain_password.encode())
    return encrypted.decode()

def decrypt_password(encrypted_password: str) -> str:
    decrypted = fernet.decrypt(encrypted_password.encode())
    return decrypted.decode()