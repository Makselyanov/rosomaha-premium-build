from __future__ import annotations

import importlib.util
import hashlib
import json
import os
import shutil
import stat
import subprocess
import sys
import types
import unittest
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
CLIENT_PATH = ROOT / "scripts/rosomaha-release-script-installer.py"
OPERATOR_PATH = ROOT / "scripts/rosomaha-release-script-installer-operator.sh"
TARGET_COMMIT = "29f90f1ea2b5b90156fd677ca624c5bd7b2d1529"
RELEASE_NEW = "9caad8bde40e0f269ad0887c8b16c97cfc18c0495ad72068f2c812d2859c1fa2"
ROLLBACK_NEW = "8f2390ec2d6b3248b49ef8b690de5413bdcc7930180e584524de72094d676388"
RELEASE_OLD = "c25fc273a4cf88a27879207aaebf18be62f4487867a7de7674c611b400919edd"
ROLLBACK_OLD = "aeee52f314036112501a7acc0af5fa09ee7c081327fb867b91c64b983bd41acc"


def load_client():
    spec = importlib.util.spec_from_file_location("rosomaha_release_pair_installer", CLIENT_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def operator_text() -> str:
    return OPERATOR_PATH.read_text(encoding="utf-8")


def embedded_python() -> str:
    text = operator_text()
    marker = "exec /usr/bin/python3 -I -B - \"$MODE\" \"$BUNDLE\" <<'PY'\n"
    return text.split(marker, 1)[1].rsplit("\nPY", 1)[0]


def load_operator_module():
    source = embedded_python()
    source = source.rsplit("raise SystemExit(main())", 1)[0]
    module = types.ModuleType("rosomaha_pair_operator")
    fake_fcntl = types.SimpleNamespace(
        LOCK_EX=2,
        LOCK_NB=4,
        LOCK_UN=8,
        flock=lambda *_args, **_kwargs: None,
    )
    fake_pwd = types.SimpleNamespace(
        getpwuid=lambda _uid: types.SimpleNamespace(pw_name="root"),
    )
    with mock.patch.dict(sys.modules, {"fcntl": fake_fcntl, "pwd": fake_pwd}):
        exec(compile(source, str(OPERATOR_PATH), "exec"), module.__dict__)
    return module


def topo(*, uid=0, gid=33, mode="0o664", nlink=1, same_inode=True):
    return {
        "uid": uid, "gid": gid, "mode": mode, "nlink": nlink,
        "dev": 7, "ino": 11, "same_inode": same_inode,
    }


def file_stat(
    *, uid=0, gid=0, mode=0o755, nlink=1, size=4, dev=7, ino=11,
    mtime_ns=1_700_000_000_000_000_001,
    ctime_ns=1_700_000_000_000_000_002,
    file_type=stat.S_IFREG,
):
    return types.SimpleNamespace(
        st_mode=file_type | mode,
        st_uid=uid,
        st_gid=gid,
        st_nlink=nlink,
        st_size=size,
        st_dev=dev,
        st_ino=ino,
        st_mtime_ns=mtime_ns,
        st_ctime_ns=ctime_ns,
    )


def changed_file_stat(info, **changes):
    values = {
        "uid": info.st_uid,
        "gid": info.st_gid,
        "mode": stat.S_IMODE(info.st_mode),
        "nlink": info.st_nlink,
        "size": info.st_size,
        "dev": info.st_dev,
        "ino": info.st_ino,
        "mtime_ns": info.st_mtime_ns,
        "ctime_ns": info.st_ctime_ns,
        "file_type": stat.S_IFMT(info.st_mode),
    }
    values.update(changes)
    return file_stat(**values)


def fixture_public():
    pages = {
        path: {
            "status": 200, "final_url": f"https://xn--80aa8ahaki9a.site{path}",
            "bytes": 10, "raw_sha256": "a" * 64,
        }
        for path in ("/", "/catalog", "/articles", "/robots.txt", "/sitemap.xml")
    }
    return {
        "pages": pages,
        "live_articles": {
            "source": "live", "raw_sha256": "b" * 64, "bytes": 100,
            "count": 2, "slug_digest": "c" * 64, "status": 200,
            "final_url": "https://xn--80aa8ahaki9a.site/api/articles.json",
        },
    }


def fixture_seo():
    article = {
        "raw_sha256": "b" * 64, "bytes": 100, "count": 2,
        "slug_digest": "c" * 64,
    }
    public = fixture_public()
    return {
        "current": {
            "target": "/var/www/rosomaha/_releases/20260813-120000-safe",
            "realpath": "/var/www/rosomaha/_releases/20260813-120000-safe",
            "uid": 0, "gid": 33, "mode": "0o777", "nlink": 1,
            "dev": 7, "ino": 99,
        },
        "articles": {
            "canonical": {**article, "source": "canonical", "topology": topo()},
            "current": {
                **article, "source": "current",
                "topology": topo(uid=0, gid=0, mode="0o644"),
            },
        },
        "article_parity": True,
        "articles_cz": {
            "directory": topo(uid=0, gid=33, mode="0o2775"),
            "count": 1,
            "files": [{
                "name": "index.ts", "bytes": 10, "sha256": "f" * 64,
                "topology": topo(uid=0, gid=33, mode="0o664"),
            }],
            "digest": "d" * 64,
        },
        "release_labels": {
            "count": 1, "labels": ["20260813-120000-safe"], "digest": "e" * 64,
        },
    }


def member(key: str, state: str):
    hashes = {
        ("release", "old"): RELEASE_OLD,
        ("release", "new"): RELEASE_NEW,
        ("rollback", "old"): ROLLBACK_OLD,
        ("rollback", "new"): ROLLBACK_NEW,
    }
    if state == "unknown":
        return {"valid": False, "state": "unknown", "error": "unrecognized"}
    return {
        "valid": True, "state": state, "sha256": hashes[(key, state)],
        "size": 10, "uid": 0, "gid": 0, "mode": "0o755", "nlink": 1,
        "dev": 7, "ino": 10 if key == "release" else 11,
    }


def fixture_scan():
    return {
        "complete_within_bound": True, "exact_argv_path_only": True,
        "pid_limit": 32768, "pid_entries": 2, "cmdlines_scanned": 2,
        "disappeared_during_scan": 0, "matches": [],
        "absolute_protection_claimed": False,
    }


def fixture_lock():
    return {
        "path": "/var/www/rosomaha/.rosomaha-main-price-release.lock",
        "uid": 0, "gid": 33, "mode": "0o600", "nlink": 1,
        "exclusive": True, "existing": True, "created": False,
        "coverage": "migration_window_bounded_then_all_compliant_pair_installed",
        "legacy_direct_invocation_absolute_protection": False,
        "post_install_pair_uses_shared_lock": True,
    }


def fixture_backup():
    manifest = {
        "schema": "rosomaha-release-script-pair-backup/v1",
        "target_commit": TARGET_COMMIT,
        "scripts": {
            "release": {"name": "server-release.sh", "sha256": RELEASE_OLD},
            "rollback": {"name": "server-rollback.sh", "sha256": ROLLBACK_OLD},
        },
    }
    return {
        "status": "complete", "complete": True,
        "present": sorted([
            "pair-manifest.json",
            f"server-release.sh.{RELEASE_OLD}.bak",
            f"server-rollback.sh.{ROLLBACK_OLD}.bak",
        ]),
        "hashes": {"release": RELEASE_OLD, "rollback": ROLLBACK_OLD},
        "manifest_sha256": hashlib.sha256(
            json.dumps(
                manifest, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
            ).encode("utf-8") + b"\n"
        ).hexdigest(),
    }
def pair_state(release: str, rollback: str):
    if release == rollback == "old":
        return "old/old"
    if release == rollback == "new":
        return "new/new"
    if {release, rollback} == {"old", "new"}:
        return "mixed"
    return "unknown"


def fixture_sftp(release="old", rollback="old"):
    members = {}
    for key, state in (("release", release), ("rollback", rollback)):
        source = member(key, state)
        members[key] = {
            "topology_valid": source["valid"], "state": source["state"],
            "sha256": source.get("sha256", "0" * 64), "size": source.get("size", 10),
            "uid": source.get("uid", 0), "gid": source.get("gid", 0),
            "mode": source.get("mode", "0o755"), "nlink": source.get("nlink", 1),
            "nlink_proved": True,
        }
    return {"pair_state": pair_state(release, rollback), "members": members}


def fixture_pair(release="old", rollback="old"):
    members = {"release": member("release", release), "rollback": member("rollback", rollback)}
    state = pair_state(release, rollback)
    ancestor = lambda uid, gid, mode, ino: {  # noqa: E731
        "uid": uid, "gid": gid, "mode": mode, "nlink": 1,
        "dev": 1, "ino": ino, "same_inode": True,
    }
    return {
        "valid": state != "unknown", "pair_state": state, "members": members,
        "trusted_ancestors": {
            "root": ancestor(0, 0, "0o755", 1),
            "var": ancestor(0, 0, "0o755", 2),
            "var-www": ancestor(0, 0, "0o755", 3),
            "application": ancestor(0, 33, "0o3775", 4),
            "scripts": ancestor(0, 0, "0o775", 5),
        },
    }


def fixture_audit(release="old", rollback="old"):
    return {
        "schema": "rosomaha-release-script-pair-installer/v2",
        "status": "audited", "mode": "audit", "account": "deploy", "read_only": True,
        "target_commit": TARGET_COMMIT,
        "targets": {"release": RELEASE_NEW, "rollback": ROLLBACK_NEW},
        "olds": {"release": RELEASE_OLD, "rollback": ROLLBACK_OLD},
        "pair": fixture_pair(release, rollback), "seo_snapshot": fixture_seo(),
        "scope": {
            "pair_only": True, "installed_scripts_executed": False,
            "state_evidence_read_only": True,
            "coverage": "migration_window_bounded_then_all_compliant_pair_installed",
        },
    }


def fixture_root_audit(release="old", rollback="old"):
    return {
        "schema": "rosomaha-release-script-pair-installer/v2",
        "status": "root-audited", "mode": "root-audit", "account": "root",
        "read_only": True, "target_commit": TARGET_COMMIT,
        "targets": {"release": RELEASE_NEW, "rollback": ROLLBACK_NEW},
        "olds": {"release": RELEASE_OLD, "rollback": ROLLBACK_OLD},
        "pair": fixture_pair(release, rollback), "seo_snapshot": fixture_seo(),
        "process_scan": fixture_scan(), "shared_release_lock": fixture_lock(),
        "scope": {
            "pair_only": True, "installed_scripts_executed": False,
            "state_evidence_read_only": True, "lock_file_created": False,
            "backup_written": False, "staged_files_written": False,
            "script_modes_changed": False, "pair_replaced": False,
            "receipt_written": False,
            "coverage": "migration_window_bounded_then_all_compliant_pair_installed",
        },
    }


class FakeAttr:
    def __init__(self, mode, *, uid=0, gid=0, nlink=1, size=1):
        self.st_mode = mode
        self.st_uid = uid
        self.st_gid = gid
        self.st_nlink = nlink
        self.st_size = size


class FakeSftp:
    def __init__(self, names, attrs):
        self.names = names
        self.attrs = attrs
        self.removed = []
        self.rmdir_calls = []

    def lstat(self, path):
        if path not in self.attrs:
            raise FileNotFoundError(path)
        return self.attrs[path]

    def listdir(self, _path):
        return list(self.names)

    def remove(self, path):
        self.removed.append(path)

    def rmdir(self, path):
        self.rmdir_calls.append(path)


class FakeChannel:
    def __init__(self, stdout_chunks=(), stderr_chunks=(), *, eof_after_drain=True):
        self.stdout_chunks = list(stdout_chunks)
        self.stderr_chunks = list(stderr_chunks)
        self.eof_after_drain = eof_after_drain
        self.closed = False
        self.eof_received = False

    def recv_ready(self):
        return bool(self.stdout_chunks)

    def recv(self, _maximum):
        chunk = self.stdout_chunks.pop(0)
        self._update_eof()
        return chunk

    def recv_stderr_ready(self):
        return bool(self.stderr_chunks)

    def recv_stderr(self, _maximum):
        chunk = self.stderr_chunks.pop(0)
        self._update_eof()
        return chunk

    def _update_eof(self):
        if self.eof_after_drain and not self.stdout_chunks and not self.stderr_chunks:
            self.eof_received = True

    @staticmethod
    def exit_status_ready():
        return True

    @staticmethod
    def recv_exit_status():
        return 0

    def close(self):
        self.closed = True


class FreezeHarness:
    def __init__(self, operator):
        self.operator = operator
        self.scripts_fd = 100
        self.fds = {"server-rollback.sh": 201, "server-release.sh": 202}
        self.names = {value: key for key, value in self.fds.items()}
        self.modes = {201: 0o755, 202: 0o755}
        self.closed = []
        self.fail_fchmod_call = None
        self.fchmod_calls = 0

    def info(self, fd):
        return os.stat_result((stat.S_IFREG | self.modes[fd], 7, fd, 1, 0, 0, 3, 1, 1, 1))

    def open(self, name, _flags, **kwargs):
        self.assert_dirfd(kwargs)
        return self.fds[name]

    def assert_dirfd(self, kwargs):
        if kwargs.get("dir_fd") != self.scripts_fd:
            raise AssertionError("wrong dirfd")

    def fstat(self, fd):
        return self.info(fd)

    def stat(self, name, **kwargs):
        self.assert_dirfd(kwargs)
        return self.info(self.fds[name])

    def fchmod(self, fd, mode):
        self.fchmod_calls += 1
        if self.fchmod_calls == self.fail_fchmod_call:
            raise OSError("injected chmod failure")
        self.modes[fd] = mode

    def close(self, fd):
        self.closed.append(fd)

    @staticmethod
    def fsync(_fd):
        return None

    def patches(self, hashes):
        fake_os = types.SimpleNamespace(
            O_RDWR=os.O_RDWR,
            O_NOFOLLOW=getattr(os, "O_NOFOLLOW", 0),
            open=self.open,
            fstat=self.fstat,
            stat=self.stat,
            fchmod=self.fchmod,
            fsync=self.fsync,
            close=self.close,
        )
        expected = iter(hashes)
        return (
            mock.patch.object(self.operator, "open_exact_dir", return_value=self.scripts_fd),
            mock.patch.object(self.operator, "os", fake_os),
            mock.patch.object(self.operator, "require_script"),
            mock.patch.object(self.operator, "read_open_fd", return_value=b"old"),
            mock.patch.object(self.operator, "sha256_bytes", side_effect=lambda _raw: next(expected)),
        )


class PairInstallerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = load_client()
        cls.operator = load_operator_module()

    def test_exact_git_pair_commit_hashes_and_modes(self):
        blobs = self.client.target_blobs()
        self.assertEqual(self.client.TARGET_COMMIT, TARGET_COMMIT)
        self.assertEqual(self.client.sha256_bytes(blobs["release"]), RELEASE_NEW)
        self.assertEqual(self.client.sha256_bytes(blobs["rollback"]), ROLLBACK_NEW)
        for spec in self.client.PAIR_SPECS.values():
            self.assertEqual(spec["mode"], "100755")

    def test_full_operator_sha_is_pinned_before_any_ssh(self):
        self.assertEqual(
            self.client.OPERATOR_SHA256,
            self.client.sha256_bytes(OPERATOR_PATH.read_bytes()),
        )
        with mock.patch.object(self.client, "safe_local_file", return_value=b"tampered"), mock.patch.object(
            self.client, "connect"
        ) as connect:
            with self.assertRaisesRegex(self.client.InstallerError, "operator SHA-256 mismatch"):
                self.client.operator_bytes()
        connect.assert_not_called()

    def test_operator_bash_and_embedded_python_contract(self):
        compile(embedded_python(), str(OPERATOR_PATH), "exec")
        text = operator_text()
        self.assertIn("apply|recover|rollback", text)
        self.assertIn("^/tmp/rosomaha-release-pair-installer-29f90f1-[0-9a-f]{16}$", text)
        self.assertNotIn("eval ", text)
        self.assertNotIn("bash -c", text)
        source = embedded_python()
        self.assertNotIn("urllib", source)
        self.assertNotIn("http_bytes", source)
        self.assertNotIn("PUBLIC_ARTICLES_URL", source)

    def test_operator_cli_argument_arity_truth_table(self):
        prologue = operator_text().split("exec /usr/bin/python3", 1)[0]
        harness = prologue + '\nprintf "accepted:%s:%s\\n" "$MODE" "$#"\n'
        git_bash = Path(r"C:\Program Files\Git\bin\bash.exe")
        bash = str(git_bash) if git_bash.is_file() else shutil.which("bash")
        self.assertIsNotNone(bash, "bash is required for the operator CLI contract test")

        bundle = "/tmp/rosomaha-release-pair-installer-29f90f1-0123456789abcdef"
        cases = (
            ((), True, "accepted:audit:0"),
            (("audit",), True, "accepted:audit:1"),
            (("audit", "extra"), False, "audit takes no bundle"),
            (("root-audit",), True, "accepted:root-audit:1"),
            (("root-audit", ""), False, "root-audit takes no bundle"),
            (("root-audit", "extra", "ignored"), False, "root-audit takes no bundle"),
        )
        for mode in ("apply", "recover", "rollback"):
            cases += (
                ((mode,), False, "invalid fixed bundle path"),
                ((mode, bundle), True, f"accepted:{mode}:2"),
                ((mode, bundle, "extra"), False, "invalid fixed bundle path"),
            )
        for args, accepted, marker in cases:
            completed = subprocess.run(
                [bash, "-c", harness, "operator-test", *args],
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=10,
                check=False,
                text=True,
                encoding="utf-8",
                errors="replace",
            )
            with self.subTest(args=args):
                self.assertEqual(completed.returncode == 0, accepted)
                self.assertIn(marker, completed.stdout)

    def test_pair_classifier_truth_table(self):
        cases = {
            ("old", "old"): "old/old",
            ("old", "new"): "mixed",
            ("old", "unknown"): "unknown",
            ("new", "old"): "mixed",
            ("new", "new"): "new/new",
            ("new", "unknown"): "unknown",
            ("unknown", "old"): "unknown",
            ("unknown", "new"): "unknown",
            ("unknown", "unknown"): "unknown",
        }
        for (release, rollback), expected in cases.items():
            members = {
                "release": {"valid": release != "unknown", "state": release},
                "rollback": {"valid": rollback != "unknown", "state": rollback},
            }
            with self.subTest(release=release, rollback=rollback):
                self.assertEqual(self.operator.classify_pair(members), expected)

    def _call_operator_reader(self, reader, rebound=None, after=None):
        if reader == "inspect_member":
            before = file_stat(uid=0, gid=0, mode=0o755)
            path_method = "stat"
        else:
            before = file_stat(uid=0, gid=33, mode=0o664)
            path_method = "lstat" if reader == "read_regular_path" else "stat"
        after = before if after is None else after
        rebound = after if rebound is None else rebound
        with mock.patch.object(self.operator.os, "open", return_value=200), mock.patch.object(
            self.operator.os, "fstat", side_effect=(before, after),
        ), mock.patch.object(
            self.operator.os, path_method, side_effect=(before, rebound),
        ), mock.patch.object(
            self.operator.os, "close",
        ), mock.patch.object(
            self.operator, "read_fd_exact", return_value=b"old\n",
        ), mock.patch.object(
            self.operator, "sha256_bytes", return_value=RELEASE_OLD,
        ):
            if reader == "inspect_member":
                return before, self.operator.inspect_member(100, "release")
            if reader == "read_regular_path":
                return before, self.operator.read_regular_path(
                    "/fixed/articles.json", 1024, "canonical articles",
                    expected_uid=0, expected_gid=33, expected_mode=0o664,
                    forbidden_mode=0,
                )
            return before, self.operator.read_cz_member(100, "index.ts")

    def test_stable_reader_producers_emit_client_accepted_inode_evidence(self):
        _before, inspected = self._call_operator_reader("inspect_member")
        self.assertTrue(inspected["valid"])
        self.assertEqual(inspected["state"], "old")
        pair = fixture_pair("old", "old")
        pair["members"]["release"] = inspected
        self.client.validate_pair(pair)

        _before, (raw, regular_topology) = self._call_operator_reader("read_regular_path")
        self.assertEqual(raw, b"old\n")
        self.assertIs(regular_topology["same_inode"], True)
        self.client.validate_topology(
            regular_topology, uid=0, gid=33, mode="0o664", non_022=False,
            context="canonical-article",
        )

        _before, cz = self._call_operator_reader("read_cz_member")
        self.assertEqual(cz["bytes"], 4)
        self.assertIs(cz["topology"]["same_inode"], True)
        self.client.validate_topology(
            cz["topology"], uid=0, gid=33, mode="0o664", non_022=False,
            context="articles-cz-file",
        )

    def test_all_reader_producers_reject_post_read_path_rebind_and_topology_drift(self):
        mutations = {
            "inode-rebind": {"ino": 12},
            "chmod": {"mode": 0o600},
            "chown": {"uid": 1},
            "chgrp": {"gid": 1},
            "nlink": {"nlink": 2},
            "size": {"size": 5},
            "mtime": {"mtime_ns": 1_700_000_000_000_000_101},
            "ctime": {"ctime_ns": 1_700_000_000_000_000_102},
        }
        for reader in ("inspect_member", "read_regular_path", "read_cz_member"):
            if reader == "inspect_member":
                baseline = file_stat(uid=0, gid=0, mode=0o755)
            else:
                baseline = file_stat(uid=0, gid=33, mode=0o664)
            for mutation, changes in mutations.items():
                with self.subTest(reader=reader, mutation=mutation):
                    rebound = changed_file_stat(baseline, **changes)
                    if reader == "inspect_member":
                        _before, result = self._call_operator_reader(reader, rebound)
                        self.assertFalse(result["valid"])
                        self.assertEqual(result["state"], "unknown")
                        self.assertIn("changed during readback", result["error"])
                    else:
                        with self.assertRaisesRegex(
                            self.operator.InstallError, "changed during read",
                        ):
                            self._call_operator_reader(reader, rebound)

    def test_all_reader_producers_reject_open_fd_drift_and_post_read_symlink(self):
        for reader in ("inspect_member", "read_regular_path", "read_cz_member"):
            if reader == "inspect_member":
                baseline = file_stat(uid=0, gid=0, mode=0o755)
            else:
                baseline = file_stat(uid=0, gid=33, mode=0o664)
            drifted = changed_file_stat(
                baseline, ctime_ns=baseline.st_ctime_ns + 1,
            )
            rebound_symlink = changed_file_stat(
                baseline, file_type=stat.S_IFLNK, mode=0o777, ino=12,
            )
            for case, after, rebound in (
                ("fstat-after-drift", drifted, drifted),
                ("post-read-symlink", baseline, rebound_symlink),
            ):
                with self.subTest(reader=reader, case=case):
                    if reader == "inspect_member":
                        _before, result = self._call_operator_reader(
                            reader, rebound=rebound, after=after,
                        )
                        self.assertFalse(result["valid"])
                        self.assertEqual(result["state"], "unknown")
                        self.assertIn("changed during readback", result["error"])
                    else:
                        with self.assertRaisesRegex(
                            self.operator.InstallError, "changed during read",
                        ):
                            self._call_operator_reader(
                                reader, rebound=rebound, after=after,
                            )

    def test_topology_field_diagnostic_is_contextual_and_does_not_echo_unknown_data(self):
        missing = topo()
        missing.pop("same_inode")
        with self.assertRaisesRegex(
            self.client.InstallerError,
            r"context=articles-cz-file missing=same_inode unexpected_count=0$",
        ):
            self.client.validate_topology(
                missing, uid=0, gid=33, mode="0o664", non_022=False,
                context="articles-cz-file",
            )

        hostile = topo()
        hostile.pop("mode")
        hostile["secret-token-name"] = "secret-value-must-not-leak"
        try:
            self.client.validate_topology(
                hostile, uid=0, gid=33, mode="0o664", non_022=False,
                context="canonical-article",
            )
        except self.client.InstallerError as exc:
            message = str(exc)
        else:
            self.fail("hostile topology fields were accepted")
        self.assertIn(
            "context=canonical-article missing=mode unexpected_count=1",
            message,
        )
        self.assertNotIn("secret-token-name", message)
        self.assertNotIn("secret-value-must-not-leak", message)

        with self.assertRaisesRegex(
            self.client.InstallerError,
            r"^file topology diagnostic context is invalid$",
        ):
            self.client.validate_topology(
                topo(), uid=0, gid=33, mode="0o664", non_022=False,
                context="untrusted-secret-context",
            )

    def test_client_pair_validator_accepts_four_states_and_rejects_inconsistent_state(self):
        for release, rollback in (
            ("old", "old"), ("new", "new"), ("old", "new"), ("unknown", "old"),
        ):
            candidate = fixture_pair(release, rollback)
            with self.subTest(release=release, rollback=rollback):
                self.client.validate_pair(candidate)
        broken = fixture_pair("old", "new")
        broken["pair_state"] = "old/old"
        with self.assertRaises(self.client.InstallerError):
            self.client.validate_pair(broken)

    def test_exact_crm_topology_accepts_only_required_modes_and_owners(self):
        self.client.validate_seo_snapshot(fixture_seo())
        mutations = (
            ("canonical-owner", lambda item: item["articles"]["canonical"]["topology"].update(uid=33)),
            ("canonical-group", lambda item: item["articles"]["canonical"]["topology"].update(gid=0)),
            ("canonical-mode", lambda item: item["articles"]["canonical"]["topology"].update(mode="0o644")),
            ("cz-dir", lambda item: item["articles_cz"]["directory"].update(mode="0o775")),
            ("cz-file-owner", lambda item: item["articles_cz"]["files"][0]["topology"].update(uid=33)),
            ("cz-file-mode", lambda item: item["articles_cz"]["files"][0]["topology"].update(mode="0o660")),
            ("runtime-group-write", lambda item: item["articles"]["current"]["topology"].update(mode="0o664")),
            ("runtime-nlink", lambda item: item["articles"]["current"]["topology"].update(nlink=2)),
        )
        for name, mutate in mutations:
            candidate = json.loads(json.dumps(fixture_seo()))
            mutate(candidate)
            with self.subTest(name=name), self.assertRaises(self.client.InstallerError):
                self.client.validate_seo_snapshot(candidate)

    def test_audit_is_pair_read_only_and_requires_old_old_for_baseline(self):
        valid = fixture_audit()
        self.client.validate_audit(valid)
        source = CLIENT_PATH.read_text(encoding="utf-8")
        audit_body = source[source.index("def audit()") : source.index("def load_baseline")]
        self.assertIn("read_only_snapshot(operator)", audit_body)
        self.assertNotIn("connect(APPLY_LOGIN)", audit_body)
        self.assertIn('get("pair_state") != "old/old"', source)

    def test_default_audit_orders_sha_deploy_sources_then_fresh_root_and_binds_token(self):
        events = []
        deploy = fixture_audit()
        sftp = fixture_sftp()
        public = fixture_public()
        root = fixture_root_audit()

        def fixed_operator():
            events.append("operator-sha")
            return b"fixed-operator"

        def deploy_snapshot(_operator):
            events.append("deploy-operator-sftp-public")
            return deploy, sftp, public

        def root_snapshot(_operator):
            events.append("fresh-root")
            return root

        with mock.patch.object(self.client, "target_blobs"), mock.patch.object(
            self.client, "operator_bytes", side_effect=fixed_operator,
        ), mock.patch.object(
            self.client, "read_only_snapshot", side_effect=deploy_snapshot,
        ), mock.patch.object(
            self.client, "root_read_only_preflight", side_effect=root_snapshot,
        ), mock.patch.object(
            self.client, "write_receipt", return_value=Path("baseline.json"),
        ) as write_receipt:
            baseline, receipt = self.client.audit()

        self.assertEqual(
            events,
            ["operator-sha", "deploy-operator-sftp-public", "fresh-root"],
        )
        self.assertEqual(receipt, Path("baseline.json"))
        self.assertEqual(baseline["root_preflight"], root)
        unsigned = dict(baseline)
        token = unsigned.pop("baseline_token")
        self.assertEqual(token, self.client.sha256_bytes(self.client.canonical_json(unsigned)))
        write_receipt.assert_called_once()

    def test_root_preflight_uses_fresh_exact_root_connection_and_mode(self):
        events = []
        connection = types.SimpleNamespace(close=lambda: events.append("closed"))

        def connect(login):
            events.append(("connect", login))
            return connection

        def invoke(client, mode, operator, remote_dir=None):
            events.append(("invoke", client is connection, mode, operator, remote_dir))
            return fixture_root_audit()

        with mock.patch.object(self.client, "connect", side_effect=connect), mock.patch.object(
            self.client, "invoke", side_effect=invoke,
        ):
            result = self.client.root_read_only_preflight(b"fixed")
        self.assertEqual(result["status"], "root-audited")
        self.assertEqual(
            events,
            [
                ("connect", self.client.APPLY_LOGIN),
                ("invoke", True, "root-audit", b"fixed", None),
                "closed",
            ],
        )

    def test_root_audit_contract_and_three_source_agreement_fail_closed(self):
        root = fixture_root_audit()
        deploy = fixture_audit()
        sftp = fixture_sftp()
        self.client.validate_root_preflight_agreement(
            root, deploy, sftp, expected_state="old/old",
        )
        mutations = (
            ("root-deploy-member", lambda r, _d, _s: r["pair"]["members"]["release"].update(ino=999)),
            ("root-sftp-member", lambda _r, _d, s: s["members"]["release"].update(size=11)),
            ("root-deploy-seo", lambda r, _d, _s: r["seo_snapshot"]["current"].update(ino=999)),
            ("root-state", lambda r, _d, _s: r.update(pair=fixture_pair("new", "new"))),
        )
        for name, mutate in mutations:
            candidate_root = json.loads(json.dumps(root))
            candidate_deploy = json.loads(json.dumps(deploy))
            candidate_sftp = json.loads(json.dumps(sftp))
            mutate(candidate_root, candidate_deploy, candidate_sftp)
            with self.subTest(name=name), self.assertRaises(self.client.InstallerError):
                self.client.validate_root_preflight_agreement(
                    candidate_root, candidate_deploy, candidate_sftp,
                    expected_state="old/old",
                )

    def test_root_audit_rejects_process_matches_and_inexact_lock_or_mutation_claims(self):
        for name, mutate in (
            ("process-match", lambda item: item["process_scan"].update(matches=[{"pid": 7, "script": "server-release.sh"}])),
            ("lock-not-exclusive", lambda item: item["shared_release_lock"].update(exclusive=False)),
            ("lock-created", lambda item: item["shared_release_lock"].update(created=True)),
            ("receipt-claim", lambda item: item["scope"].update(receipt_written=True)),
            ("backup-claim", lambda item: item["scope"].update(backup_written=True)),
        ):
            candidate = json.loads(json.dumps(fixture_root_audit()))
            mutate(candidate)
            with self.subTest(name=name), self.assertRaises(self.client.InstallerError):
                self.client.validate_root_audit(candidate, expected_state="old/old")

    def test_load_baseline_requires_token_bound_root_proof(self):
        operator = OPERATOR_PATH.read_bytes()
        unsigned = {
            "schema": self.client.BASELINE_SCHEMA,
            "status": "audited",
            "created_at": "2026-08-13T00:00:00+00:00",
            "target_commit": TARGET_COMMIT,
            "targets": {"release": RELEASE_NEW, "rollback": ROLLBACK_NEW},
            "olds": {"release": RELEASE_OLD, "rollback": ROLLBACK_OLD},
            "operator_sha256": self.client.sha256_bytes(operator),
            "remote": fixture_audit(),
            "independent_readback": fixture_sftp(),
            "independent_public": fixture_public(),
            "root_preflight": fixture_root_audit(),
        }

        def encoded(value):
            body = dict(value)
            body["baseline_token"] = self.client.sha256_bytes(self.client.canonical_json(body))
            return self.client.canonical_json(body) + b"\n"

        raw = encoded(unsigned)
        with mock.patch.object(self.client, "safe_local_file", return_value=raw):
            baseline, canonical = self.client.load_baseline(Path("baseline.json"), operator)
        self.assertEqual(canonical, raw)
        self.assertEqual(baseline["root_preflight"]["status"], "root-audited")

        for name, mutate in (
            ("missing-root", lambda item: item.pop("root_preflight")),
            ("root-not-old", lambda item: item["root_preflight"].update(pair=fixture_pair("new", "new"))),
            ("root-process-match", lambda item: item["root_preflight"]["process_scan"].update(matches=[{"pid": 9, "script": "server-rollback.sh"}])),
        ):
            candidate = json.loads(json.dumps(unsigned))
            mutate(candidate)
            candidate_raw = encoded(candidate)
            with self.subTest(name=name), mock.patch.object(
                self.client, "safe_local_file", return_value=candidate_raw,
            ), self.assertRaises(self.client.InstallerError):
                self.client.load_baseline(Path("baseline.json"), operator)

    def test_apply_keeps_fresh_deploy_preflight_before_any_remote_mutation(self):
        source = CLIENT_PATH.read_text(encoding="utf-8")
        body = source[source.index("def apply(commit") : source.index("def recover(commit")]
        self.assertLess(body.index("load_baseline("), body.index('independent_terminal_readback("old/old"'))
        self.assertLess(body.index('independent_terminal_readback("old/old"'), body.index("connect(APPLY_LOGIN)"))
        self.assertLess(body.index("connect(APPLY_LOGIN)"), body.index("create_bundle("))
        self.assertIn('baseline["root_preflight"]["pair"]', body)

    def test_sftp_readback_names_both_exact_remote_scripts(self):
        source = CLIENT_PATH.read_text(encoding="utf-8")
        body = source[source.index("def sftp_readback") : source.index("def read_only_snapshot")]
        self.assertIn("for key, spec in PAIR_SPECS.items()", body)
        self.assertIn('spec["remote"]', body)
        self.assertIn("classify_readback(members)", body)

    def test_sftp_validator_rejects_state_only_or_tampered_member_proof(self):
        valid = fixture_sftp("new", "new")
        self.client.validate_sftp_readback(valid)
        with self.assertRaises(self.client.InstallerError):
            self.client.validate_sftp_readback({"pair_state": "new/new"})
        tampered = json.loads(json.dumps(valid))
        tampered["members"]["release"]["sha256"] = RELEASE_OLD
        with self.assertRaises(self.client.InstallerError):
            self.client.validate_sftp_readback(tampered)

    def test_remote_commands_are_closed_allowlist(self):
        class ActiveTransport:
            @staticmethod
            def is_active():
                return True

            @staticmethod
            def open_session(timeout):
                raise AssertionError(f"allowlisted command reached transport: {timeout}")

        client = types.SimpleNamespace(get_transport=lambda: ActiveTransport())
        with self.assertRaisesRegex(AssertionError, "allowlisted command"):
            self.client.run_remote(client, "/bin/bash -s -- root-audit", b"")
        with self.assertRaisesRegex(self.client.InstallerError, "non-fixed remote command"):
            self.client.run_remote(object(), "id", b"")
        with self.assertRaisesRegex(self.client.InstallerError, "non-fixed remote command"):
            self.client.run_remote(object(), "/bin/bash -s -- apply /tmp/other", b"")
        with self.assertRaisesRegex(self.client.InstallerError, "non-fixed remote command"):
            self.client.run_remote(
                object(), "/tmp/rosomaha-release-pair-installer-29f90f1-0123456789abcdef", b"",
            )

    def test_root_audit_operator_path_has_no_bundle_or_mutators(self):
        text = operator_text()
        self.assertIn("root-audit)", text)
        self.assertIn('[[ "$#" -eq 1 && -z "$BUNDLE" ]]', text)
        source = embedded_python()
        body = source[source.index("def root_audit()") : source.index("def validate_root_process_scan")]
        self.assertIn('identity("root-audit")', body)
        self.assertLess(body.index("open_release_lock()"), body.index("inspect_pair()"))
        self.assertLess(body.index("inspect_pair()"), body.index("seo_snapshot()"))
        self.assertLess(body.index("seo_snapshot()"), body.index("scan_legacy_script_processes()"))
        self.assertIn("close_release_lock(app_fd, lock_fd)", body)
        for forbidden in (
            "open_bundle", "create_exclusive", "create_backup_pair", "stage_pair(",
            "write_bundle_receipt", "os.O_CREAT", "os.O_WRONLY", "os.O_RDWR",
            "os.fchmod", "os.chmod", "os.replace", "os.unlink", "os.mkdir",
        ):
            self.assertNotIn(forbidden, body)
        lock_body = source[source.index("def open_release_lock") : source.index("def close_release_lock")]
        self.assertIn('os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)', lock_body)
        self.assertNotIn("os.O_CREAT", lock_body)
        self.assertNotIn("os.O_RDWR", lock_body)
        self.assertIn("fcntl.LOCK_EX | fcntl.LOCK_NB", lock_body)

    def test_missing_unsafe_and_busy_lock_fail_before_baseline_receipt(self):
        safe = types.SimpleNamespace(
            st_mode=stat.S_IFREG | 0o600, st_uid=0, st_gid=33,
            st_nlink=1, st_dev=7, st_ino=9,
        )
        unsafe = types.SimpleNamespace(
            st_mode=stat.S_IFREG | 0o664, st_uid=0, st_gid=33,
            st_nlink=1, st_dev=7, st_ino=9,
        )

        def exercise(*, open_effect=None, fstat_value=safe, flock_effect=None, message):
            with mock.patch.object(self.operator, "validate_install_ancestors"), mock.patch.object(
                self.operator, "open_exact_dir", return_value=100,
            ), mock.patch.object(
                self.operator.os, "open", side_effect=open_effect, return_value=200,
            ), mock.patch.object(
                self.operator.os, "fstat", return_value=fstat_value,
            ), mock.patch.object(
                self.operator.os, "stat", return_value=safe,
            ), mock.patch.object(
                self.operator.os, "close",
            ), mock.patch.object(
                self.operator.fcntl, "flock", side_effect=flock_effect,
            ):
                with self.assertRaisesRegex(self.operator.InstallError, message):
                    self.operator.open_release_lock()

        exercise(open_effect=FileNotFoundError(), message="lock is missing")
        exercise(fstat_value=unsafe, message="topology is unsafe")
        exercise(flock_effect=BlockingIOError(), message="already held")

        for error in (
            self.client.InstallerError("shared release lock is missing"),
            self.client.InstallerError("shared release lock topology is unsafe"),
            self.client.InstallerError("shared release lock is already held"),
        ):
            with mock.patch.object(self.client, "target_blobs"), mock.patch.object(
                self.client, "operator_bytes", return_value=b"fixed",
            ), mock.patch.object(
                self.client, "read_only_snapshot",
                return_value=(fixture_audit(), fixture_sftp(), fixture_public()),
            ), mock.patch.object(
                self.client, "root_read_only_preflight", side_effect=error,
            ), mock.patch.object(self.client, "write_receipt") as write_receipt:
                with self.assertRaises(self.client.InstallerError):
                    self.client.audit()
                write_receipt.assert_not_called()

    def test_remote_output_requires_eof_and_exact_single_json_object(self):
        payload = json.dumps(fixture_root_audit(), sort_keys=True).encode("utf-8")
        channel = FakeChannel((payload[:17], payload[17:]))
        result = self.client.drain_channel(channel, timeout=1)
        self.assertEqual(result["stdout"].encode("utf-8"), payload)
        self.assertTrue(channel.closed)
        parsed = self.client.parse_operator(result)
        self.assertEqual(parsed["status"], "root-audited")

        for stdout in (
            '{"schema":"rosomaha-release-script-pair-installer/v2","status":"root-audited"}\n{}',
            '{"schema":"rosomaha-release-script-pair-installer/v2","schema":"duplicate"}',
            "",
        ):
            with self.subTest(stdout=stdout), self.assertRaises(self.client.InstallerError):
                self.client.parse_operator({"exit_code": 0, "stdout": stdout, "stderr": ""})

        no_eof = FakeChannel(eof_after_drain=False)
        with mock.patch.object(self.client.time, "monotonic", side_effect=(0.0, 2.0)):
            with self.assertRaisesRegex(self.client.InstallerError, "timed out"):
                self.client.drain_channel(no_eof, timeout=1)
        self.assertTrue(no_eof.closed)

    def test_backups_are_complete_pair_manifest_and_precede_first_replace(self):
        source = embedded_python()
        backup = source[source.index("def create_backup_pair") : source.index("def inspect_backup_pair")]
        self.assertIn("os.mkdir(BACKUP_DIR_NAME", backup)
        self.assertIn("create_exclusive(backup_fd, backup_name(key), old_raw[key], 0o400)", backup)
        self.assertIn("create_exclusive(backup_fd, BACKUP_MANIFEST_NAME", backup)
        self.assertLess(
            backup.index("create_exclusive(backup_fd, backup_name(key)"),
            backup.index("create_exclusive(backup_fd, BACKUP_MANIFEST_NAME"),
        )
        self.assertIn("immutable pair backup already exists; apply retry is forbidden", backup)
        apply_body = source[source.index("def apply(bundle)") : source.index("def recover(bundle)")]
        self.assertLess(apply_body.index("create_backup_pair"), apply_body.index("install_new_pair"))

    def test_both_targets_stage_before_freeze_and_replace_order_is_rollback_then_release(self):
        source = embedded_python()
        apply_body = source[source.index("def apply(bundle)") : source.index("def recover(bundle)")]
        self.assertLess(apply_body.index("stage_pair(targets"), apply_body.index("freeze_old_executables"))
        self.assertLess(apply_body.index("freeze_old_executables"), apply_body.index("scan_legacy_script_processes()", apply_body.index("freeze_old_executables")))
        self.assertLess(apply_body.index("scan_legacy_script_processes()", apply_body.index("freeze_old_executables")), apply_body.index("install_new_pair"))
        install = source[source.index("def install_new_pair") : source.index("def close_frozen_pair")]
        self.assertIn('for key in ("rollback", "release")', install)
        self.assertIn("os.replace(", install)
        self.assertIn("os.fsync(scripts_fd)", install)

    def test_freeze_pins_both_before_first_chmod_and_disclaims_absolute_protection(self):
        source = embedded_python()
        body = source[source.index("def freeze_executables") : source.index("def verify_frozen_member")]
        pin_loop = body.index('for key in ("rollback", "release")')
        chmod_loop = body.index('for key in ("rollback", "release")', pin_loop + 1)
        self.assertLess(pin_loop, chmod_loop)
        self.assertIn("os.fchmod(fd, 0o600)", body)
        self.assertIn("os.fsync(scripts_fd)", body)
        lock = source[source.index("def open_release_lock") : source.index("def close_release_lock")]
        self.assertIn('"legacy_direct_invocation_absolute_protection": False', lock)
        self.assertIn('"post_install_pair_uses_shared_lock": True', lock)

    def test_freeze_fault_after_first_chmod_restores_old_modes(self):
        harness = FreezeHarness(self.operator)
        harness.fail_fchmod_call = 2
        patches = harness.patches([ROLLBACK_OLD, RELEASE_OLD])
        for patcher in patches:
            patcher.start()
        try:
            with self.assertRaises(OSError):
                self.operator.freeze_old_executables()
        finally:
            for patcher in reversed(patches):
                patcher.stop()
        self.assertEqual(harness.modes[201], 0o755)
        self.assertEqual(harness.modes[202], 0o755)

    def test_fault_after_both_chmods_before_replace_restores_both_modes(self):
        harness = FreezeHarness(self.operator)
        patches = harness.patches([
            ROLLBACK_OLD, RELEASE_OLD, ROLLBACK_OLD, RELEASE_OLD,
            RELEASE_OLD, ROLLBACK_OLD,
        ])
        for patcher in patches:
            patcher.start()
        try:
            frozen = self.operator.freeze_old_executables()
            evidence = self.operator.close_frozen_pair(frozen)
        finally:
            for patcher in reversed(patches):
                patcher.stop()
        self.assertEqual(harness.modes[201], 0o755)
        self.assertEqual(harness.modes[202], 0o755)
        self.assertTrue(evidence["executables_disabled_before_final_scan"])
        self.assertTrue(evidence["unreplaced_old_modes_restored"])
        self.assertTrue(evidence["residual_root_bypass_possible"])

    def test_fault_after_first_replace_restores_only_unreplaced_old_member(self):
        harness = FreezeHarness(self.operator)
        patches = harness.patches([
            ROLLBACK_OLD, RELEASE_OLD, ROLLBACK_OLD, RELEASE_OLD, RELEASE_OLD,
        ])
        for patcher in patches:
            patcher.start()
        try:
            frozen = self.operator.freeze_old_executables()
            frozen["replaced"].add("rollback")
            evidence = self.operator.close_frozen_pair(frozen)
        finally:
            for patcher in reversed(patches):
                patcher.stop()
        self.assertEqual(harness.modes[202], 0o755)
        self.assertEqual(evidence["replaced_members"], ["rollback"])
        self.assertTrue(evidence["unreplaced_old_modes_restored"])

    def test_proc_scan_is_bounded_exact_argv_and_runs_twice_under_lock(self):
        source = embedded_python()
        scan = source[source.index("def scan_legacy_script_processes") : source.index("def audit(mode)")]
        self.assertIn("MAX_PROC_PIDS", scan)
        self.assertIn("MAX_CMDLINE_BYTES", scan)
        self.assertIn("raw.split(b\"\\0\")", scan)
        self.assertIn("if exact in argv", scan)
        self.assertNotIn("if exact in raw", scan)
        self.assertIn('"absolute_protection_claimed": False', scan)
        apply_body = source[source.index("def apply(bundle)") : source.index("def recover(bundle)")]
        self.assertEqual(apply_body.count("scan_legacy_script_processes()"), 2)
        self.assertLess(apply_body.index("open_release_lock()"), apply_body.index("scan_legacy_script_processes()"))

    def test_apply_receipt_requires_freeze_process_scans_and_non_absolute_coverage(self):
        source = CLIENT_PATH.read_text(encoding="utf-8")
        body = source[
            source.index("def validate_lock_evidence") : source.index("def classify_recovery")
        ]
        for marker in (
            '"executables_disabled_before_final_scan"',
            '"residual_root_bypass_possible"',
            '"absolute_protection_claimed"',
            '"legacy_direct_invocation_absolute_protection"',
            "MIGRATION_COVERAGE",
        ):
            self.assertIn(marker, body)

    def test_recover_is_read_only_and_never_retries_apply_or_auto_rolls_back(self):
        source = embedded_python()
        body = source[source.index("def recover(bundle)") : source.index("def load_rollback_authorization")]
        self.assertIn('"read_only": True', body)
        self.assertIn('"apply_retry_allowed": False', body)
        self.assertIn('"automatic_rollback_allowed": False', body)
        self.assertNotIn("install_new_pair(", body)
        self.assertNotIn("restore_old_pair(", body)

    def test_recovery_matrix_requires_three_sources_backup_and_stable_seo(self):
        baseline = {
            "baseline_token": "1" * 64,
            "remote": fixture_audit(), "independent_public": fixture_public(),
        }
        for state, release, rollback, backup, expected in (
            ("old/old", "old", "old", False, "old/old"),
            ("new/new", "new", "new", True, "new/new"),
            ("mixed", "old", "new", True, "mixed"),
            ("new/new", "new", "new", False, "unknown"),
        ):
            root = {
                "schema": self.client.SCHEMA, "status": "recovered", "mode": "recover",
                "account": self.client.APPLY_LOGIN, "read_only": True,
                "baseline_token": baseline["baseline_token"], "attempted": True,
                "classification": state, "pair": fixture_pair(release, rollback),
                "backup": fixture_backup() if backup else {"complete": False},
                "seo_snapshot": fixture_seo(), "process_scan": fixture_scan(),
                "shared_release_lock": fixture_lock(),
                "apply_retry_allowed": False, "automatic_rollback_allowed": False,
            }
            deploy = fixture_audit(release, rollback)
            sftp = fixture_sftp(release, rollback)
            with self.subTest(state=state, backup=backup):
                self.assertEqual(
                    self.client.classify_recovery(root, deploy, sftp, fixture_public(), baseline),
                    expected,
                )
        drift = fixture_audit("new", "new")
        drift["seo_snapshot"]["current"]["ino"] += 1
        root = {
            "schema": self.client.SCHEMA, "status": "recovered", "mode": "recover",
            "account": self.client.APPLY_LOGIN, "read_only": True,
            "baseline_token": baseline["baseline_token"], "attempted": True,
            "classification": "new/new", "pair": fixture_pair("new", "new"),
            "backup": fixture_backup(), "seo_snapshot": fixture_seo(),
            "process_scan": fixture_scan(), "shared_release_lock": fixture_lock(),
            "apply_retry_allowed": False, "automatic_rollback_allowed": False,
        }
        self.assertEqual(
            self.client.classify_recovery(
                root, drift, fixture_sftp("new", "new"), fixture_public(), baseline,
            ),
            "unknown",
        )

    def test_pair_rollback_accepts_only_receipt_authorized_new_or_mixed_and_restores_release_first(self):
        source = embedded_python()
        auth = source[source.index("def load_rollback_authorization") : source.index("def rollback(bundle)")]
        self.assertIn('not in {"new/new", "mixed"}', auth)
        restore = source[source.index("def restore_old_pair") : source.index("def read_target_pair")]
        self.assertIn('for key in ("release", "rollback")', restore)
        self.assertIn("verify_frozen_member(frozen_pair, key)", restore)
        rollback = source[source.index("def rollback(bundle)") : source.index("def main()")]
        self.assertIn('pair_after.get("pair_state") != "old/old"', rollback)
        self.assertIn('freeze_executables(authorization["authorized_member_states"])', rollback)
        self.assertIn("scan_legacy_script_processes()", rollback)

    def test_rollback_receipt_requires_exact_two_scans_lock_and_freeze(self):
        baseline = {
            "baseline_token": "1" * 64,
            "remote": {"seo_snapshot": fixture_seo()},
        }
        authorization = {
            "authorized_pair_state": "new/new",
            "authorized_member_states": {"release": "new", "rollback": "new"},
        }
        receipt = {
            "schema": self.client.SCHEMA, "status": "rolled_back", "mode": "rollback",
            "account": self.client.APPLY_LOGIN, "baseline_token": baseline["baseline_token"],
            "target_commit": TARGET_COMMIT, "authorization": authorization,
            "pair_before": fixture_pair("new", "new"),
            "pair_after": fixture_pair("old", "old"),
            "backup": fixture_backup(), "process_scans": [fixture_scan(), fixture_scan()],
            "migration_freeze": {
                "executables_disabled_before_final_scan": True,
                "unreplaced_old_modes_restored": True,
                "replaced_members": ["release", "rollback"],
                "residual_root_bypass_possible": True,
                "absolute_protection_claimed": False,
            },
            "shared_release_lock": fixture_lock(),
            "before": fixture_seo(), "after": fixture_seo(), "state_unchanged": True,
            "staging_cleanup": "verified_cleanup_complete",
            "installed_scripts_executed": False,
            "current_unchanged_proved": True, "content_unchanged_proved": True,
        }
        self.client.validate_rollback_receipt(receipt, baseline, authorization)
        mutations = (
            lambda item: item.update(process_scans=[fixture_scan()]),
            lambda item: item.pop("shared_release_lock"),
            lambda item: item["migration_freeze"].update(residual_root_bypass_possible=False),
            lambda item: item.update(account="deploy"),
        )
        for mutate in mutations:
            candidate = json.loads(json.dumps(receipt))
            mutate(candidate)
            with self.assertRaises(self.client.InstallerError):
                self.client.validate_rollback_receipt(candidate, baseline, authorization)

    def test_partial_staging_registers_name_before_exclusive_create(self):
        source = embedded_python()
        body = source[source.index("def stage_pair") : source.index("def verify_named_raw")]
        self.assertLess(
            body.index('staged[key] = {"name": name, "sha256": expected}'),
            body.index("create_exclusive(scripts_fd, name, raw_pair[key], 0o755)"),
        )

    def test_operator_never_executes_installed_pair(self):
        source = embedded_python()
        for forbidden in ("subprocess", "os.system", "execv", "execve", "Popen"):
            self.assertNotIn(forbidden, source)
        self.assertNotIn("server-release.sh ", source)
        self.assertNotIn("server-rollback.sh ", source)

    def test_bundle_cleanup_refuses_unknown_and_removes_only_safe_allowlist(self):
        remote = "/tmp/rosomaha-release-pair-installer-29f90f1-0123456789abcdef"
        directory = FakeAttr(stat.S_IFDIR | 0o700)
        safe = FakeAttr(stat.S_IFREG | 0o600)
        unknown = FakeSftp(["surprise"], {remote: directory, f"{remote}/surprise": safe})
        self.assertFalse(self.client.cleanup_bundle_sftp(unknown, remote))
        self.assertEqual(unknown.removed, [])

        names = ["baseline.json", "operator.sh", "operation-receipt.json"]
        attrs = {remote: directory, **{f"{remote}/{name}": safe for name in names}}
        valid = FakeSftp(names, attrs)
        self.assertTrue(self.client.cleanup_bundle_sftp(valid, remote))
        self.assertEqual(valid.removed, [f"{remote}/{name}" for name in sorted(names)])

    def test_local_receipts_are_exclusive_and_errors_redacted(self):
        source = CLIENT_PATH.read_text(encoding="utf-8")
        body = source[source.index("def write_receipt") : source.index("def run_git")]
        self.assertIn("os.O_EXCL", body)
        self.assertIn('getattr(os, "O_NOFOLLOW", 0)', body)
        self.assertIn("os.fsync(fd)", body)
        redacted = self.client.sanitized_error("token=abcdef password: hunter2 Bearer abcdefghijklmnop")
        self.assertNotIn("abcdef", redacted)
        self.assertNotIn("hunter2", redacted)
        self.assertNotIn("abcdefghijklmnop", redacted)

    def test_default_cli_is_read_only_audit_and_mutations_require_exact_commit(self):
        source = CLIENT_PATH.read_text(encoding="utf-8")
        main = source[source.index("def main()") :]
        self.assertIn("payload, receipt = audit()", main)
        for mode in ("apply", "recover", "rollback"):
            body_start = source.index(f"def {mode}(")
            body_end = source.find("\ndef ", body_start + 5)
            body = source[body_start:body_end]
            self.assertIn("if commit != TARGET_COMMIT", body)


if __name__ == "__main__":
    unittest.main()
