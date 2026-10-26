"""Safety behavior tests; no Docker, database writes or application changes."""
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('aqua_harness', Path(__file__).with_name('harness.py'))
harness = importlib.util.module_from_spec(spec)
spec.loader.exec_module(harness)


class HarnessSafety(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.root_patch = patch.object(harness, 'ROOT', self.root)
        self.root_patch.start()
        self.data = {
            'AQUA_HARNESS_TEST_DATABASE': 'disposable', 'NODE_ENV': 'test',
            'AQUA_NO_DOTENV': '1', 'DEMO_MODE': 'false',
            'DATABASE_URL': 'postgresql://app_login:test@127.0.0.1:55433/aqua_test_fixture',
            'MIGRATION_DATABASE_URL': 'postgresql://aqua:test@127.0.0.1:55433/aqua_test_fixture',
        }

    def tearDown(self):
        self.root_patch.stop()
        self.temp.cleanup()

    def write(self):
        target = self.root / 'test.local'
        target.write_text('\n'.join(k + '=' + v for k, v in self.data.items()))
        return target

    def test_explicit_disposable_marker_is_required(self):
        self.data.pop('AQUA_HARNESS_TEST_DATABASE')
        with self.assertRaisesRegex(ValueError, 'explicit disposable'):
            harness.checked_test_env(self.write())

    def test_relabeling_development_database_cannot_bypass_guard(self):
        (self.root / '.env').write_text('DATABASE_URL=' + self.data['DATABASE_URL'])
        with self.assertRaisesRegex(ValueError, 'matches a development'):
            harness.checked_test_env(self.write())

    def test_runtime_and_migration_must_use_same_target(self):
        self.data['MIGRATION_DATABASE_URL'] += '_other'
        with self.assertRaisesRegex(ValueError, 'targets differ'):
            harness.checked_test_env(self.write())

    def test_remote_database_is_refused(self):
        for key in ('DATABASE_URL', 'MIGRATION_DATABASE_URL'):
            self.data[key] = self.data[key].replace('127.0.0.1', 'db.example.invalid')
        with self.assertRaisesRegex(ValueError, 'explicit local'):
            harness.checked_test_env(self.write())

    def test_inherited_provider_and_seed_exports_do_not_leak(self):
        with patch.dict(os.environ, {'WHATSAPP_PROVIDER': 'cloud', 'SEED_SPLASH_CLUB': 'true', 'SEED_SPLASH_CLUB_PIN': 'dummy'}):
            env = harness.checked_test_env(self.write())
        self.assertNotIn('WHATSAPP_PROVIDER', env)
        self.assertNotIn('SEED_SPLASH_CLUB_PIN', env)
        self.assertEqual(env['SEED_SPLASH_CLUB'], 'false')
        self.assertEqual(env['NODE_ENV'], 'test')

    def test_release_does_not_execute_checks_when_next_owns_checkout(self):
        with patch.object(harness, 'STATE', self.root / 'state'), \
             patch.object(harness, 'checked_test_env', return_value={}), \
             patch.object(harness, 'db_identity', return_value={'db': 'aqua_test_fixture', 'role': 'app_login'}), \
             patch.object(harness, 'next_processes', return_value=[123]), \
             patch.object(harness, 'call') as command, \
             patch('sys.argv', ['harness.py', 'release']):
            with self.assertRaisesRegex(ValueError, 'Refusing build'):
                harness.main()
            command.assert_not_called()


if __name__ == '__main__':
    unittest.main()
