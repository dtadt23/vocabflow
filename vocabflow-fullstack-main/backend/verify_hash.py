#!/usr/bin/env python3
"""
verify_hash.py

Dùng để kiểm tra một hoặc nhiều mật khẩu ứng viên với hash:
- scrypt format:  scrypt:N:r:p$<salt>$<derived_key_hex>
  ví dụ: scrypt:32768:8:1$RwXW4lhuvdQyuq10$94615...
- Werkzeug PBKDF2 format (generate_password_hash): bắt đầu bằng "$pbkdf2:..."

Usage:
  python verify_hash.py --hash "<hash_string>" --candidate "password123"
  python verify_hash.py --hash "<hash_string>" --wordlist candidates.txt
"""

import argparse
import hashlib
import base64
import binascii
import sys

def parse_scrypt_hash(h):
    # expected: scrypt:N:r:p$salt$dk_hex
    try:
        header, salt_b64, dk_hex = h.split('$')
        # header like "scrypt:32768:8:1"
        parts = header.split(':')
        if parts[0] != 'scrypt' or len(parts) != 4:
            raise ValueError("Invalid scrypt header")
        N = int(parts[1])
        r = int(parts[2])
        p = int(parts[3])
        # try base64 decode salt, fallback to raw bytes
        salt = None
        try:
            # add padding if necessary
            padding = '=' * ((4 - len(salt_b64) % 4) % 4)
            salt = base64.b64decode(salt_b64 + padding)
            # if decode yields empty, fallback
            if len(salt) == 0:
                raise Exception("empty after base64")
        except Exception:
            salt = salt_b64.encode('utf-8')
        dk = binascii.unhexlify(dk_hex)
        return {'algo': 'scrypt', 'N': N, 'r': r, 'p': p, 'salt': salt, 'dk': dk}
    except Exception as e:
        raise ValueError(f"Failed to parse scrypt hash: {e}")

def verify_scrypt(candidate, params):
    # candidate: str
    # params: dict from parse_scrypt_hash
    dklen = len(params['dk'])
    try:
        dk = hashlib.scrypt(candidate.encode('utf-8'),
                           salt=params['salt'],
                           n=params['N'],
                           r=params['r'],
                           p=params['p'],
                           dklen=dklen)
        return dk == params['dk']
    except TypeError:
        # Older Python may not support r/p args in hashlib.scrypt
        raise RuntimeError("Your Python's hashlib.scrypt does not support r/p parameters. Use Python 3.8+ or a different environment.")

# Werkzeug PBKDF2 check (if needed)
def verify_werkzeug(candidate, stored_hash):
    try:
        from werkzeug.security import check_password_hash
    except Exception as e:
        raise RuntimeError("Werkzeug required for PBKDF2 verification. Install via: pip install werkzeug") from e
    return check_password_hash(stored_hash, candidate)

def detect_and_parse(hash_str):
    if hash_str.startswith("scrypt:") or hash_str.startswith("scrypt$") or hash_str.startswith("scrypt:"):
        return parse_scrypt_hash(hash_str)
    if hash_str.startswith("$pbkdf2:") or hash_str.startswith("pbkdf2:"):
        return {'algo': 'werkzeug_pbkdf2', 'raw': hash_str}
    # Could add more formats here
    raise ValueError("Unrecognized hash format. Supported: scrypt, Werkzeug PBKDF2.")

def load_wordlist(path):
    with open(path, 'r', encoding='utf-8', errors='ignore') as f:
        for line in f:
            pw = line.strip()
            if pw:
                yield pw

def main():
    p = argparse.ArgumentParser(description="Verify candidate password(s) against a stored hash (scrypt or Werkzeug PBKDF2).")
    p.add_argument('--hash', '-H', required=True, help='Stored hash string to test against (put it in quotes)')
    group = p.add_mutually_exclusive_group(required=True)
    group.add_argument('--candidate', '-c', help='Single candidate password to test')
    group.add_argument('--wordlist', '-w', help='File path to a wordlist (one password per line)')
    p.add_argument('--stop-on-first', action='store_true', help='When using wordlist, stop on first match')
    args = p.parse_args()

    try:
        parsed = detect_and_parse(args.hash)
    except Exception as e:
        print("Error parsing hash:", e, file=sys.stderr)
        sys.exit(2)

    def test_pw(pw):
        try:
            if parsed['algo'] == 'scrypt':
                return verify_scrypt(pw, parsed)
            elif parsed['algo'] == 'werkzeug_pbkdf2':
                return verify_werkzeug(pw, parsed['raw'])
            else:
                return False
        except Exception as e:
            print("Verification error:", e, file=sys.stderr)
            return False

    if args.candidate:
        ok = test_pw(args.candidate)
        if ok:
            print("[MATCH] candidate matches the hash.")
        else:
            print("[NO MATCH] candidate does NOT match the hash.")
        return

    # wordlist mode
    found = False
    count = 0
    try:
        for pw in load_wordlist(args.wordlist):
            count += 1
            if test_pw(pw):
                print(f"[MATCH] Found matching password after {count} tries: {pw}")
                found = True
                if args.stop_on_first:
                    break
            # Optional: show progress every N tries
            if count % 10000 == 0:
                print(f"... tried {count} candidates ...", flush=True)
    except FileNotFoundError:
        print("Wordlist file not found:", args.wordlist, file=sys.stderr)
        sys.exit(2)

    if not found:
        print("No match found in wordlist.")


if __name__ == "__main__":
    main()
