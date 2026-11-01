"""Generate a VAPID key pair. Run once: python generate_vapid.py"""
import base64
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

def b64url(data):
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")

private_key = ec.generate_private_key(ec.SECP256R1())
private_pem = private_key.private_bytes(
    encoding=serialization.Encoding.PEM,
    format=serialization.PrivateFormat.PKCS8,
    encryption_algorithm=serialization.NoEncryption(),
)
public_bytes = private_key.public_key().public_bytes(
    encoding=serialization.Encoding.X962,
    format=serialization.PublicFormat.UncompressedPoint,
)

with open("vapid_private.pem", "wb") as f:
    f.write(private_pem)

print("VAPID_PUBLIC_KEY=" + b64url(public_bytes))
print("Private key saved to vapid_private.pem. Keep it secret; do not commit it.")
