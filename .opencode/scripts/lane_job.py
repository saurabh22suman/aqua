#!/usr/bin/env python3
"""Queue this redesign's resource-heavy jobs without bypassing Aqua's guard."""
import fcntl
import importlib.util
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('aqua_harness', ROOT / '.opencode/scripts/harness.py')
harness = importlib.util.module_from_spec(spec)
spec.loader.exec_module(harness)

def main():
    args = sys.argv[1:]
    if not args or args[0] not in ('harness', 'exec') or len(args) < 2:
        raise SystemExit('Usage: lane_job.py harness MODE [ARGS] | exec COMMAND [ARGS]')
    queue = Path.home() / '.local/state/aqua-harness/owner-redesign-20261027.queue.lock'
    queue.parent.mkdir(parents=True, exist_ok=True)
    with queue.open('a') as handle:
        print('Waiting for the shared redesign job slot…', flush=True)
        fcntl.flock(handle, fcntl.LOCK_EX)
        if args[0] == 'harness':
            result = subprocess.run([sys.executable, str(ROOT / '.opencode/scripts/harness.py'), *args[1:]], cwd=ROOT)
        else:
            with harness.heavy_job('redesign:' + Path(args[1]).name):
                result = subprocess.run(args[1:], cwd=ROOT)
        raise SystemExit(result.returncode)

if __name__ == '__main__':
    main()
