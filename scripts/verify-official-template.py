import hashlib
import pathlib
import sys

if len(sys.argv) != 2:
    raise SystemExit('usage: verify-official-template.py <file>')

p = pathlib.Path(sys.argv[1])
print(hashlib.sha256(p.read_bytes()).hexdigest())
