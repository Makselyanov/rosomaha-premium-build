from __future__ import annotations

import contextlib
import io
import os
import posixpath
import stat
import types
import unittest
from pathlib import Path, PurePosixPath


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "server-rollback.sh"
RELEASE_SCRIPT = ROOT / "scripts" / "server-release.sh"
OPERATOR_MARKER = '/usr/bin/python3 - "${1:-}" <<\'PY\'\n'

FILESYSTEM_ROOT = PurePosixPath("/")
VAR = PurePosixPath("/var")
WWW = PurePosixPath("/var/www")
APP = PurePosixPath("/var/www/rosomaha")
RELEASES = APP / "_releases"
CURRENT = APP / "current"
CURRENT_NAME = "20260813-100000-current"
TARGET_NAME = "20260812-100000-previous"
CURRENT_TARGET = RELEASES / CURRENT_NAME
TARGET = RELEASES / TARGET_NAME


def script_text() -> str:
    return SCRIPT.read_text(encoding="utf-8")


def embedded_namespace() -> dict[str, object]:
    text = script_text()
    start = text.index(OPERATOR_MARKER) + len(OPERATOR_MARKER)
    end = text.index("\nPY\n", start)
    source = text[start:end].split(
        "\nraise SystemExit(rollback_cli(sys.argv))", maxsplit=1,
    )[0]
    namespace: dict[str, object] = {}
    exec(compile(source, str(SCRIPT), "exec"), namespace)
    namespace.update(
        {
            "Path": PurePosixPath,
            "ROOT_DIR": FILESYSTEM_ROOT,
            "VAR_DIR": VAR,
            "WWW_DIR": WWW,
            "APP_ROOT": APP,
            "RELEASES_DIR": RELEASES,
            "CURRENT_LINK": CURRENT,
        }
    )
    return namespace


def inode_stat(
    kind: int,
    mode: int,
    *,
    uid: int = 0,
    gid: int = 33,
    dev: int = 7,
    ino: int = 11,
    nlink: int = 1,
):
    return types.SimpleNamespace(
        st_mode=kind | mode,
        st_uid=uid,
        st_gid=gid,
        st_dev=dev,
        st_ino=ino,
        st_nlink=nlink,
    )


def directory_stat(mode: int, *, gid: int = 33, ino: int = 11):
    return inode_stat(stat.S_IFDIR, mode, uid=0, gid=gid, ino=ino)


def symlink_stat(*, gid: int = 33, ino: int = 21):
    return inode_stat(stat.S_IFLNK, 0o777, uid=0, gid=gid, ino=ino)


class FakeRollbackKernel:
    O_RDONLY = getattr(os, "O_RDONLY", 0)
    O_DIRECTORY = getattr(os, "O_DIRECTORY", 0x10000)
    O_NOFOLLOW = getattr(os, "O_NOFOLLOW", 0x20000)
    path = posixpath

    ROOT_FD = 30
    VAR_FD = 31
    WWW_FD = 32
    APP_FD = 33
    RELEASES_FD = 34
    CURRENT_RELEASE_FD = 35
    TARGET_FD = 36

    def __init__(self) -> None:
        self.events: list[str] = []
        self.fd_stats = {
            self.ROOT_FD: directory_stat(0o755, gid=0, ino=101),
            self.VAR_FD: directory_stat(0o755, gid=0, ino=102),
            self.WWW_FD: directory_stat(0o755, gid=0, ino=103),
            self.APP_FD: directory_stat(0o3775, gid=33, ino=104),
            self.RELEASES_FD: directory_stat(0o2755, gid=33, ino=105),
            self.CURRENT_RELEASE_FD: directory_stat(0o755, gid=33, ino=106),
            self.TARGET_FD: directory_stat(0o755, gid=33, ino=107),
        }
        self.named = {
            CURRENT_NAME: self.fd_stats[self.CURRENT_RELEASE_FD],
            TARGET_NAME: self.fd_stats[self.TARGET_FD],
        }
        self.current_entry = symlink_stat(ino=108)
        self.current_text = str(CURRENT_TARGET)
        self.temporary_entry = None
        self.temporary_text: str | None = None
        self.target_is_symlink = False
        self.releases_lstat_calls = 0
        self.swap_releases_on_lstat_call: int | None = None
        self.current_stat_calls = 0
        self.swap_current_on_stat_call: int | None = None
        self.target_stat_calls = 0
        self.swap_target_on_stat_call: int | None = None
        self.replace_error: OSError | None = None
        self.fsync_error = False

    @staticmethod
    def copy(info):
        return types.SimpleNamespace(**vars(info))

    def open(self, path, _flags: int, *, dir_fd: int | None = None) -> int:
        value = str(path)
        self.events.append(f"open:{dir_fd}:{value}")
        if value == "/" and dir_fd is None:
            return self.ROOT_FD
        if value == "var" and dir_fd == self.ROOT_FD:
            return self.VAR_FD
        if value == "www" and dir_fd == self.VAR_FD:
            return self.WWW_FD
        if value == "rosomaha" and dir_fd == self.WWW_FD:
            return self.APP_FD
        if value == "_releases" and dir_fd == self.APP_FD:
            return self.RELEASES_FD
        if value == CURRENT_NAME and dir_fd == self.RELEASES_FD:
            return self.CURRENT_RELEASE_FD
        if value == TARGET_NAME and dir_fd == self.RELEASES_FD:
            if self.target_is_symlink:
                raise OSError("O_NOFOLLOW rejected rollback target symlink")
            return self.TARGET_FD
        raise AssertionError((value, dir_fd))

    def fstat(self, fd: int):
        self.events.append(f"fstat:{fd}")
        return self.copy(self.fd_stats[fd])

    def lstat(self, path):
        value = str(path)
        self.events.append(f"lstat:{value}")
        mapping = {
            "/": self.fd_stats[self.ROOT_FD],
            "/var": self.fd_stats[self.VAR_FD],
            "/var/www": self.fd_stats[self.WWW_FD],
            str(APP): self.fd_stats[self.APP_FD],
        }
        if value == str(RELEASES):
            self.releases_lstat_calls += 1
            if (
                self.swap_releases_on_lstat_call is not None
                and self.releases_lstat_calls >= self.swap_releases_on_lstat_call
            ):
                return directory_stat(0o2755, gid=33, ino=999)
            return self.copy(self.fd_stats[self.RELEASES_FD])
        if value in mapping:
            return self.copy(mapping[value])
        raise AssertionError(value)

    def stat(
        self,
        path,
        *,
        dir_fd: int | None = None,
        follow_symlinks: bool = True,
    ):
        value = str(path)
        self.events.append(f"stat:{dir_fd}:{follow_symlinks}:{value}")
        parent_entries = {
            (self.ROOT_FD, "var"): self.fd_stats[self.VAR_FD],
            (self.VAR_FD, "www"): self.fd_stats[self.WWW_FD],
            (self.WWW_FD, "rosomaha"): self.fd_stats[self.APP_FD],
            (self.APP_FD, "_releases"): self.fd_stats[self.RELEASES_FD],
        }
        if (dir_fd, value) in parent_entries and not follow_symlinks:
            return self.copy(parent_entries[(dir_fd, value)])
        if dir_fd == self.RELEASES_FD and value in self.named and not follow_symlinks:
            if value == TARGET_NAME:
                self.target_stat_calls += 1
                if self.target_is_symlink:
                    return symlink_stat(ino=107)
                if (
                    self.swap_target_on_stat_call is not None
                    and self.target_stat_calls >= self.swap_target_on_stat_call
                ):
                    return directory_stat(0o755, gid=33, ino=998)
            return self.copy(self.named[value])
        if dir_fd == self.APP_FD and value == "current" and not follow_symlinks:
            self.current_stat_calls += 1
            if (
                self.swap_current_on_stat_call is not None
                and self.current_stat_calls >= self.swap_current_on_stat_call
            ):
                return symlink_stat(ino=997)
            return self.copy(self.current_entry)
        if dir_fd == self.APP_FD and value.startswith(".") and not follow_symlinks:
            if self.temporary_entry is None:
                raise FileNotFoundError(value)
            return self.copy(self.temporary_entry)
        raise AssertionError((value, dir_fd, follow_symlinks))

    def listdir(self, fd: int) -> list[str]:
        self.events.append(f"listdir:{fd}")
        if fd != self.RELEASES_FD:
            raise AssertionError(fd)
        return [CURRENT_NAME, TARGET_NAME, "unmanaged-entry"]

    def readlink(self, name: str, *, dir_fd: int) -> str:
        self.events.append(f"readlink:{dir_fd}:{name}")
        if dir_fd != self.APP_FD:
            raise AssertionError((name, dir_fd))
        if name == "current":
            return self.current_text
        if name.startswith(".") and self.temporary_entry is not None:
            assert self.temporary_text is not None
            return self.temporary_text
        raise FileNotFoundError(name)

    def symlink(self, target: str, name: str, *, dir_fd: int) -> None:
        self.events.append(f"symlink:{dir_fd}:{name}:{target}")
        if dir_fd != self.APP_FD or self.temporary_entry is not None:
            raise AssertionError((target, name, dir_fd))
        self.temporary_entry = symlink_stat(ino=109)
        self.temporary_text = target

    def replace(
        self,
        source: str,
        destination: str,
        *,
        src_dir_fd: int,
        dst_dir_fd: int,
    ) -> None:
        self.events.append(f"replace:{source}:{destination}")
        if (
            src_dir_fd != self.APP_FD
            or dst_dir_fd != self.APP_FD
            or destination != "current"
            or self.temporary_entry is None
        ):
            raise AssertionError((source, destination, src_dir_fd, dst_dir_fd))
        if self.replace_error is not None:
            raise self.replace_error
        self.current_entry = self.temporary_entry
        self.current_text = self.temporary_text or ""
        self.temporary_entry = None
        self.temporary_text = None

    def fsync(self, fd: int) -> None:
        self.events.append(f"fsync:{fd}")
        if self.fsync_error:
            raise OSError("fsync blocked")

    def unlink(self, name: str, *, dir_fd: int) -> None:
        self.events.append(f"unlink:{dir_fd}:{name}")
        if dir_fd != self.APP_FD or self.temporary_entry is None:
            raise AssertionError((name, dir_fd))
        self.temporary_entry = None
        self.temporary_text = None

    def close(self, fd: int) -> None:
        self.events.append(f"close:{fd}")


def execute(kernel: FakeRollbackKernel, requested: str | None = TARGET_NAME):
    namespace = embedded_namespace()
    namespace["os"] = kernel
    return namespace["guarded_rollback"](
        APP, RELEASES, CURRENT, requested,
    )


def execute_cli(kernel: FakeRollbackKernel) -> tuple[int, str, str]:
    namespace = embedded_namespace()
    namespace["os"] = kernel
    stdout = io.StringIO()
    stderr = io.StringIO()
    with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
        status = namespace["rollback_cli"](["server-rollback.sh", TARGET_NAME])
    return status, stdout.getvalue(), stderr.getvalue()


class SharedPairContractTests(unittest.TestCase):
    def test_release_and_rollback_use_the_same_exact_lock_path_and_marker(self) -> None:
        expected_path = (
            'RELEASE_LOCK_PATH="/var/www/rosomaha/'
            '.rosomaha-main-price-release.lock"'
        )
        expected_marker = (
            'RELEASE_LOCK_MARKER="rosomaha-release-lock-inherited/v1"'
        )
        for path in (RELEASE_SCRIPT, SCRIPT):
            text = path.read_text(encoding="utf-8")
            self.assertEqual(text.count(expected_path), 1)
            self.assertEqual(text.count(expected_marker), 1)
            self.assertIn('"ROSOMAHA_RELEASE_LOCK_FD": str(lock_fd)', text)
            self.assertIn('pass_fds=(lock_fd,)', text)

    def test_help_exits_before_lock_bootstrap(self) -> None:
        text = script_text()
        help_branch = text.index('if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]')
        lock_path = text.index('RELEASE_LOCK_PATH="/var/www/rosomaha/.rosomaha-main-price-release.lock"')
        self.assertLess(help_branch, lock_path)
        self.assertIn("usage\n  exit 0", text[help_branch:lock_path])


class GuardedRollbackTests(unittest.TestCase):
    def test_success_uses_pinned_ancestors_and_atomic_replace_then_fsync(self) -> None:
        kernel = FakeRollbackKernel()
        target = execute(kernel)
        self.assertEqual(target, TARGET)
        self.assertEqual(kernel.current_text, str(TARGET))
        expected_opens = [
            "open:None:/",
            f"open:{kernel.ROOT_FD}:var",
            f"open:{kernel.VAR_FD}:www",
            f"open:{kernel.WWW_FD}:rosomaha",
            f"open:{kernel.APP_FD}:_releases",
        ]
        for event in expected_opens:
            self.assertIn(event, kernel.events)
        symlink_index = next(i for i, item in enumerate(kernel.events) if item.startswith("symlink:"))
        replace_index = next(i for i, item in enumerate(kernel.events) if item.startswith("replace:"))
        fsync_index = kernel.events.index(f"fsync:{kernel.APP_FD}")
        self.assertLess(symlink_index, replace_index)
        self.assertLess(replace_index, fsync_index)

    def test_traversal_and_non_guarded_names_fail_before_open(self) -> None:
        namespace = embedded_namespace()
        for value in (
            "../escape",
            "/var/www/rosomaha/_releases/escape",
            "20260813-100000-a/../../escape",
            "current",
            "20260813-100000-",
        ):
            with self.subTest(value=value), self.assertRaisesRegex(
                RuntimeError, "release name is invalid",
            ):
                namespace["require_safe_release_name"](value)

    def test_target_symlink_is_rejected_before_any_write(self) -> None:
        kernel = FakeRollbackKernel()
        kernel.target_is_symlink = True
        with self.assertRaisesRegex(RuntimeError, "rollback target|release"):
            execute(kernel)
        self.assertFalse(any(item.startswith("symlink:") for item in kernel.events))
        self.assertFalse(any(item.startswith("replace:") for item in kernel.events))

    def test_releases_parent_swap_is_rejected_before_any_write(self) -> None:
        kernel = FakeRollbackKernel()
        kernel.swap_releases_on_lstat_call = 2
        with self.assertRaisesRegex(RuntimeError, "releases directory binding changed"):
            execute(kernel)
        self.assertFalse(any(item.startswith("symlink:") for item in kernel.events))
        self.assertFalse(any(item.startswith("replace:") for item in kernel.events))

    def test_current_link_swap_is_rejected_before_any_write(self) -> None:
        kernel = FakeRollbackKernel()
        kernel.swap_current_on_stat_call = 2
        with self.assertRaisesRegex(RuntimeError, "current link binding changed"):
            execute(kernel)
        self.assertFalse(any(item.startswith("symlink:") for item in kernel.events))
        self.assertFalse(any(item.startswith("replace:") for item in kernel.events))

    def test_target_inode_swap_is_rejected_before_switch(self) -> None:
        kernel = FakeRollbackKernel()
        kernel.swap_target_on_stat_call = 3
        with self.assertRaisesRegex(RuntimeError, "rollback target binding changed"):
            execute(kernel)
        self.assertFalse(any(item.startswith("symlink:") for item in kernel.events))
        self.assertFalse(any(item.startswith("replace:") for item in kernel.events))

    def test_post_switch_failure_reports_machine_recovery_state(self) -> None:
        kernel = FakeRollbackKernel()
        kernel.fsync_error = True
        with self.assertRaisesRegex(
            RuntimeError,
            "rollback_state=switched_to_rollback_target.*recovery_required=true",
        ) as caught:
            execute(kernel)
        self.assertEqual(caught.exception.state, "switched_to_rollback_target")
        self.assertEqual(caught.exception.target, TARGET)
        self.assertEqual(kernel.current_text, str(TARGET))

        cli_kernel = FakeRollbackKernel()
        cli_kernel.fsync_error = True
        status, stdout, stderr = execute_cli(cli_kernel)
        self.assertEqual(status, 1)
        self.assertEqual(stdout, "")
        self.assertIn("Rollback failed: rollback_state=switched_to_rollback_target", stderr)
        self.assertIn("recovery_required=true", stderr)


if __name__ == "__main__":
    unittest.main()
