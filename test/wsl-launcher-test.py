"""Run in WSL: python3 test/wsl-launcher-test.py (no watcher windows opened)."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


LAUNCHER = Path(__file__).resolve().parents[1] / 'opencode-with-reels.sh'
INSTALLER = LAUNCHER.with_name('install-wsl.sh')


class LauncherTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='reels launcher ')
        self.addCleanup(self.temp.cleanup)
        self.work = Path(self.temp.name)
        self.record = self.work / 'interop.json'
        # GNU echo is a native ELF that exposes argument forwarding. Ubuntu's
        # Rust multicall echo cannot run under the name "opencode".
        bridge = self.work / 'powershell.exe'
        bridge.write_text('''#!/usr/bin/python3
import json, os, sys
from pathlib import Path
Path(os.environ['RECORD']).write_text(json.dumps({
    'argv': sys.argv[1:], 'cwd': os.getcwd(), 'wslenv': os.environ['WSLENV']}))
sys.stdout.write(os.environ.get('PORT_OUTPUT', '4567\\r\\n'))
sys.exit(int(os.environ.get('BRIDGE_EXIT', '0')))
''')
        bridge.chmod(0o755)
        self.opencode = self.work / 'opencode'
        self.opencode.symlink_to(shutil.which('gnuecho') or '/bin/echo')
        self.env = {**os.environ, 'PATH': f'{self.work}:/usr/bin:/bin',
                    'RECORD': str(self.record)}

    def run_launcher(self, *args):
        return subprocess.run(['bash', str(LAUNCHER), *args], cwd=self.work,
                              env=self.env, capture_output=True, text=True)

    def test_shared_port_arguments_directory_and_auth_bridge(self):
        self.env['WSLENV'] = 'EXISTING/u'
        result = self.run_launcher('--prompt', 'two  spaces', '*', '')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout,
                         '--hostname 127.0.0.1 --port 4567 --prompt two  spaces * \n')
        record = json.loads(self.record.read_text())
        self.assertEqual(record['cwd'], str(self.work))
        self.assertEqual(record['argv'][:-1],
                         ['-NoLogo', '-NoProfile', '-NonInteractive',
                          '-ExecutionPolicy', 'Bypass', '-File'])
        self.assertTrue(record['argv'][-1].endswith('src\\start-wsl-watcher.ps1'))
        self.assertEqual(record['wslenv'],
                         'EXISTING/u:OPENCODE_SERVER_PASSWORD/w:OPENCODE_SERVER_USERNAME/w')

    def test_rejects_windows_shim_before_starting_watcher(self):
        shim = self.work / 'opencode'
        shim.unlink()
        shim.write_text('#!/bin/sh\nexit 0\n')
        shim.chmod(0o755)
        result = self.run_launcher()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('native Linux ELF', result.stderr)
        self.assertFalse(self.record.exists())

    def test_missing_opencode_explains_linux_install(self):
        self.opencode.unlink()
        result = self.run_launcher()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Install OpenCode inside WSL/Linux', result.stderr)
        self.assertFalse(self.record.exists())

    def test_path_takes_precedence_over_home_install(self):
        native = self.work / '.opencode/bin/opencode'
        native.parent.mkdir(parents=True)
        native.write_text('#!/bin/sh\nexit 0\n')
        native.chmod(0o755)
        self.env['HOME'] = str(self.work)
        result = self.run_launcher('--version')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(self.record.exists())

    def test_rejects_connection_overrides(self):
        for arg in ['--port', '--port=9876', '--hostname', '--hostname=0.0.0.0']:
            with self.subTest(arg=arg):
                result = self.run_launcher(arg)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('shared port', result.stderr)
        self.assertFalse(self.record.exists())

    def test_bridge_failure_does_not_start_opencode(self):
        self.env['BRIDGE_EXIT'] = '1'
        result = self.run_launcher()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(result.stdout, '')
        self.assertIn('Could not start', result.stderr)

    def test_invalid_port_does_not_start_opencode(self):
        for port in ['', '0', '65536', '4096\nnoise']:
            with self.subTest(port=port):
                self.env['PORT_OUTPUT'] = port
                result = self.run_launcher()
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(result.stdout, '')

    def test_preserves_native_exit_status(self):
        self.opencode.unlink()
        self.opencode.symlink_to(shutil.which('gnufalse') or '/bin/false')
        self.assertEqual(self.run_launcher().returncode, 1)

    def install(self):
        # A checkout path containing spaces, apostrophes, and metacharacters
        # catches unsafe interpolation into the installed executable wrapper.
        checkout = self.work / "Reels user's $checkout"
        checkout.mkdir(exist_ok=True)
        shutil.copyfile(LAUNCHER, checkout / LAUNCHER.name)
        shutil.copyfile(INSTALLER, checkout / INSTALLER.name)
        return subprocess.run(['bash', str(checkout / INSTALLER.name)],
                              cwd=self.work, env=self.env,
                              capture_output=True, text=True)

    def test_installed_brainrot_from_arbitrary_project(self):
        self.env.update(HOME=str(self.work), SHELL='/bin/bash')
        result = self.install()
        self.assertEqual(result.returncode, 0, result.stderr)
        wrapper = self.work / '.local/bin/brainrot'
        self.assertTrue(os.access(wrapper, os.X_OK))
        # Re-running setup must not duplicate shell configuration.
        self.assertEqual(self.install().returncode, 0)
        rc = (self.work / '.bashrc').read_text()
        self.assertEqual(rc.count('# Reels While Thinking: brainrot on PATH'), 1)
        project = self.work / 'unrelated project with spaces'
        project.mkdir()
        result = subprocess.run(
            ['bash', '-c', 'source "$HOME/.bashrc"; brainrot "$@"',
             'test', '--prompt', 'two  spaces', '*', ''],
            cwd=project, env=self.env, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout,
                         '--hostname 127.0.0.1 --port 4567 --prompt two  spaces * \n')
        record = json.loads(self.record.read_text())
        self.assertEqual(record['cwd'], str(project))
        self.assertIn("Reels user's $checkout", record['argv'][-1])

    def test_setup_preserves_existing_command(self):
        self.env.update(HOME=str(self.work), SHELL='/bin/bash')
        wrapper = self.work / '.local/bin/brainrot'
        wrapper.parent.mkdir(parents=True)
        wrapper.write_text('existing command\n')
        result = self.install()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('already exists', result.stderr)
        self.assertEqual(wrapper.read_text(), 'existing command\n')

    def test_setup_with_bin_already_on_path(self):
        self.env.update(HOME=str(self.work), SHELL='/bin/bash',
                        PATH=f'{self.work}/.local/bin:{self.env["PATH"]}')
        result = self.install()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse((self.work / '.bashrc').exists())


if __name__ == '__main__':
    unittest.main(verbosity=2)
