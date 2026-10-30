#!/usr/bin/env python3
"""Aqua's local harness. Never resets data or stops someone else's process."""
import argparse
from contextlib import contextmanager
import fcntl
import hashlib
import json
import os
from pathlib import Path
import secrets
import shlex
import socket
import subprocess
import sys
import tempfile
import time
from urllib.parse import quote, urlparse

ROOT = Path(__file__).resolve().parents[2]
KEY = hashlib.sha256(str(ROOT).encode()).hexdigest()[:10]
GLOBAL_STATE = Path.home() / '.local/state/aqua-harness'
STATE = GLOBAL_STATE / KEY
PROFILE = ROOT / '.env.aqua-harness-test.local'


def call(args, env=None, capture=False):
    return subprocess.run(args, cwd=ROOT, env=env, check=True, text=True,
                          stdout=subprocess.PIPE if capture else None,
                          stderr=subprocess.PIPE if capture else None)


def profile(path):
    data = {}
    for line in Path(path).read_text().splitlines():
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        if line.startswith('export '):
            line = line[7:]
        if '=' not in line:
            raise ValueError('Profile must contain KEY=value lines')
        key, value = line.split('=', 1)
        parts = shlex.split(value, comments=True)
        if len(parts) > 1:
            raise ValueError('Quote values containing spaces in the profile')
        data[key.strip()] = parts[0] if parts else ''
    return data


def checked_test_env(path):
    data = profile(path)
    if data.get('AQUA_HARNESS_TEST_DATABASE') != 'disposable':
        raise ValueError('Refusing tests: explicit disposable-test profile is required')
    runtime, migration = (urlparse(data.get(k, '')) for k in
                          ('DATABASE_URL', 'MIGRATION_DATABASE_URL'))
    if runtime.scheme not in ('postgres', 'postgresql') or migration.scheme != runtime.scheme:
        raise ValueError('Refusing tests: invalid Postgres URL')
    identity = lambda u: (u.hostname, u.port or 5432, u.path)
    if identity(runtime) != identity(migration):
        raise ValueError('Refusing tests: runtime/migration targets differ')
    if runtime.hostname not in ('127.0.0.1', 'localhost') or not runtime.path.startswith('/aqua_test_'):
        raise ValueError('Refusing tests: target must be an explicit local aqua_test_* database')
    if runtime.username != 'app_login' or migration.username != 'aqua':
        raise ValueError('Refusing tests: expected app_login runtime and aqua migration roles')
    # Reject the live development target even if someone relabels the profile.
    for existing in (ROOT / '.env', ROOT / '.env.local', ROOT / '.env.aqua-dev.local'):
        if existing.exists():
            dev = profile(existing)
            for key in ('DATABASE_URL', 'MIGRATION_DATABASE_URL'):
                if key in dev and identity(urlparse(dev[key])) == identity(runtime):
                    raise ValueError('Refusing tests: selected target matches a development profile')
    if data.get('NODE_ENV') != 'test' or data.get('AQUA_NO_DOTENV') != '1':
        raise ValueError('Refusing tests: NODE_ENV=test and AQUA_NO_DOTENV=1 required')
    if data.get('DEMO_MODE') != 'false' or data.get('WHATSAPP_PROVIDER') not in (None, '', 'mock'):
        raise ValueError('Refusing tests: use non-demo data and the non-production messaging mock')
    env = os.environ.copy()
    # A caller's dev exports must not leak into the isolated runner.
    for key in ('WHATSAPP_PROVIDER', 'SEED_SPLASH_CLUB', 'SEED_SPLASH_CLUB_PIN'):
        env.pop(key, None)
    env.update(data)
    env['SEED_SPLASH_CLUB'] = 'false'
    return env


def next_processes():
    found = []
    for p in Path('/proc').glob('[0-9]*'):
        try:
            if (p / 'cwd').resolve() != ROOT:
                continue
            argv = (p / 'cmdline').read_bytes().decode(errors='replace').split('\0')
            executable = Path(argv[0]).name
            next_cli = (len(argv) > 2 and Path(argv[1]).name == 'next'
                        and argv[2] in ('dev', 'build', 'start'))
            if executable.startswith('next-server') or next_cli:
                found.append(int(p.name))
        except (FileNotFoundError, PermissionError, ProcessLookupError):
            pass
    return found


def db_identity(env):
    # Use the existing pg dependency; never print a connection string.
    code = """import pg from 'pg';const c=new pg.Client({connectionString:process.env.DATABASE_URL});
await c.connect(); const r=await c.query('select current_database() as db,current_user as role');
console.log(JSON.stringify(r.rows[0]));await c.end();"""
    return json.loads(call(['node', '--input-type=module', '-e', code], env, True).stdout)


def prepare_test(port):
    if PROFILE.exists():
        env = checked_test_env(PROFILE)
        print('Existing disposable test profile verified:', db_identity(env))
        return
    # No root .env is changed and no existing container is reused or removed.
    name = 'aqua-harness-test-' + KEY
    existing = call(['docker', 'ps', '-a', '--filter', 'name=^/' + name + '$', '--format', '{{.Names}}'], capture=True).stdout.strip()
    if existing:
        raise ValueError('A harness container already exists without its profile; inspect it rather than reset it')
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', port))
    password = secrets.token_urlsafe(30)
    app_password = secrets.token_urlsafe(30)
    db = 'aqua_test_' + KEY
    with tempfile.NamedTemporaryFile(mode='w', prefix='aqua-test-', delete=False) as f:
        os.chmod(f.name, 0o600)
        f.write(f'POSTGRES_USER=aqua\nPOSTGRES_PASSWORD={password}\nPOSTGRES_DB={db}\n')
        envfile = f.name
    try:
        call(['docker', 'run', '--detach', '--name', name, '--label', 'aqua.harness=disposable',
              '--publish', f'127.0.0.1:{port}:5432', '--tmpfs', '/var/lib/postgresql/data',
              '--env-file', envfile, 'postgres:16'], capture=True)
    finally:
        Path(envfile).unlink()
    data = {
        'AQUA_HARNESS_TEST_DATABASE': 'disposable', 'AQUA_NO_DOTENV': '1', 'NODE_ENV': 'test',
        'DATABASE_URL': f'postgresql://app_login:{quote(app_password)}@127.0.0.1:{port}/{db}',
        'MIGRATION_DATABASE_URL': f'postgresql://aqua:{quote(password)}@127.0.0.1:{port}/{db}',
        'APP_LOGIN_PASSWORD': app_password, 'BETTER_AUTH_SECRET': secrets.token_urlsafe(32),
        'PARENT_LINK_SECRET': secrets.token_urlsafe(32), 'BETTER_AUTH_URL': 'http://localhost:3199',
        'DEMO_MODE': 'false', 'SEED_SPLASH_CLUB': 'false',
    }
    fd = os.open(PROFILE, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as f:
        f.write('# Generated disposable test environment. Never use for the running development app.\n')
        f.write('\n'.join(k + '=' + shlex.quote(v) for k, v in data.items()) + '\n')
    env = checked_test_env(PROFILE)
    for _ in range(40):
        ready = subprocess.run(['docker', 'exec', name, 'pg_isready', '-U', 'aqua', '-d', db], capture_output=True)
        if ready.returncode == 0:
            break
        time.sleep(0.5)
    else:
        raise ValueError('Test container did not become ready; profile retained for diagnosis')
    call(['pnpm', 'db:deploy'], env)
    print('Disposable test database ready:', db_identity(env))
    print('Private profile:', PROFILE.name, '(ignored by Git; mode 0600)')


@contextmanager
def heavy_job(mode):
    """Serialize harness work across Aqua worktrees; never kill or wait on an owner."""
    if mode == 'doctor':
        yield
        return
    GLOBAL_STATE.mkdir(parents=True, exist_ok=True)
    with (GLOBAL_STATE / 'heavy-job.lock').open('a+') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise ValueError('Another Aqua heavy job owns the machine-wide slot; '
                             'wait for that job to finish, do not stop its process')
        lock.seek(0)
        lock.truncate()
        lock.write(json.dumps({'pid': os.getpid(), 'worktree': str(ROOT), 'mode': mode}))
        lock.flush()
        try:
            yield
        finally:
            lock.seek(0)
            lock.truncate()
            fcntl.flock(lock, fcntl.LOCK_UN)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('mode', choices=['doctor', 'prepare-test', 'quick', 'test', 'release'])
    p.add_argument('--profile', default=str(PROFILE))
    p.add_argument('--port', type=int, default=55433)
    p.add_argument('tests', nargs='*', help='Focused Vitest test paths (test mode only)')
    a = p.parse_args()
    STATE.mkdir(parents=True, exist_ok=True)
    with (STATE / 'verification.lock').open('w') as lock, heavy_job(a.mode):
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise ValueError('Another harness operation owns this worktree; wait for it to finish')
        if a.mode == 'doctor':
            print('Worktree:', ROOT)
            print(call(['git', 'status', '--short', '--branch'], capture=True).stdout.strip())
            print('Node:', call(['node', '--version'], capture=True).stdout.strip())
            print('pnpm:', call(['pnpm', '--version'], capture=True).stdout.strip())
            print('Existing Next processes:', next_processes(), '(builds require another worktree or a stopped dev server)')
            print('Historical owner handoff (not current task status):', 'present' if (ROOT / 'docs/handoffs/owner-dashboard-composition.md').exists() else 'not present')
            if Path(a.profile).exists():
                print('Disposable test DB:', db_identity(checked_test_env(a.profile)))
            else:
                print('Disposable test DB not prepared; run prepare-test')
        elif a.mode == 'prepare-test':
            prepare_test(a.port)
        elif a.mode == 'quick':
            call(['pnpm', 'typecheck'])
            call(['pnpm', 'lint'])
        else:
            env = checked_test_env(a.profile)
            identity = db_identity(env)
            if identity['role'] != 'app_login':
                raise ValueError('Runtime connection is not app_login')
            if a.mode == 'release' and next_processes():
                raise ValueError('Refusing build: a Next process owns this worktree/.next. Use a separate verification worktree; do not kill another owner\'s server')
            print('Verified disposable target:', identity)
            if a.mode == 'test':
                call(['pnpm', 'test', *a.tests] if a.tests else ['pnpm', 'test:sharded'], env)
            else:
                for command in (['pnpm', 'typecheck'], ['pnpm', 'lint'], ['pnpm', 'test:sharded'],
                                ['pnpm', 'check:focus-contrast'], ['pnpm', 'build'],
                                ['pnpm', 'check:bundle'], ['pnpm', 'check:fonts']):
                    call(command, env)
                print('Run the change-specific CI scanners/e2es required by AGENTS.md as well.')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (ValueError, OSError, subprocess.CalledProcessError) as exc:
        # Never include subprocess environment or database URLs in failure text.
        print('HARNESS STOP:', str(exc), file=sys.stderr)
        sys.exit(1)
