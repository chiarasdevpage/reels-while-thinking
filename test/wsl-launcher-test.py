"""Run in WSL: python3 test/wsl-launcher-test.py (no watcher windows opened)."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


LAUNCHER = Path(__file__).resolve().parents[1] / 'opencode-with-reels.sh'


class LauncherTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='reels launcher ')
        self.addCleanup(self.temp.cleanup)
        self.work = Path(self.temp.name)
        self.record = self.work / 'interop.json'
        # Substitute only the Windows bridge. /bin/echo is a real native ELF
        # executable that exposes the launcher's argument forwarding.
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
        self.env = {**os.environ, 'PATH': f'{self.work}:/usr/bin:/bin',
                    'OPENCODE_BIN': '/bin/echo', 'RECORD': str(self.record)}

    def run_launcher(self, *args):
        return subprocess.run([str(LAUNCHER), *args], cwd=self.work,
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
        shim.write_text('#!/bin/sh\nexit 0\n')
        shim.chmod(0o755)
        self.env['OPENCODE_BIN'] = str(shim)
        result = self.run_launcher()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('native Linux ELF', result.stderr)
        self.assertFalse(self.record.exists())

    def test_rejects_non_native_home_install(self):
        native = self.work / '.opencode/bin/opencode'
        native.parent.mkdir(parents=True)
        native.write_text('#!/bin/sh\nexit 0\n')
        native.chmod(0o755)
        self.env.pop('OPENCODE_BIN')
        self.env['HOME'] = str(self.work)
        result = self.run_launcher('--version')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('native Linux ELF', result.stderr)
        self.assertFalse(self.record.exists())

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
        self.env['OPENCODE_BIN'] = '/bin/false'
        self.assertEqual(self.run_launcher().returncode, 1)


if __name__ == '__main__':
    unittest.main(verbosity=2)
