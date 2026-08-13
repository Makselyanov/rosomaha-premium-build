from __future__ import annotations

import contextlib
import errno
import io
import os
import posixpath
import stat
import types
import unittest
from pathlib import Path, PurePosixPath
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "server-release.sh"
ROLLBACK_SCRIPT = ROOT / "scripts" / "server-rollback.sh"
APP = PurePosixPath("/var/www/rosomaha")
RELEASES = APP / "_releases"
CURRENT = APP / "current"
SOURCE = APP / "dist"
RELEASE_NAME = "20260813-153103-safe"
OPERATOR_MARKER = '"$APP_ROOT/dist" <<\'PY\'\n'
CONTENT_GUARD_MARKER = (
    '/usr/bin/python3 - "$CONTENT_SOURCE" "$CONTENT_CANDIDATE" <<\'PY\'\n'
)
INHERITED_LOCK_MARKER = (
    '/usr/bin/python3 - "$RELEASE_LOCK_PATH" "$ROSOMAHA_RELEASE_LOCK_FD" <<\'PY\'\n'
)
DIRECT_LOCK_MARKER = '/usr/bin/python3 - "$0" "$@" <<\'PY\'\n'


def script_text(path: Path = SCRIPT) -> str:
    return path.read_text(encoding="utf-8")


def embedded_namespace() -> dict[str, object]:
    text = script_text()
    start = text.index(OPERATOR_MARKER) + len(OPERATOR_MARKER)
    end = text.index("\nPY\n", start)
    source = text[start:end]
    source = source.split(
        "\nraise SystemExit(release_cli(sys.argv))",
        maxsplit=1,
    )[0]
    namespace: dict[str, object] = {}
    exec(compile(source, str(SCRIPT), "exec"), namespace)
    namespace["Path"] = PurePosixPath
    namespace["FIXED_APP_ROOT"] = APP
    return namespace


def content_guard_source() -> str:
    text = script_text()
    start = text.index(CONTENT_GUARD_MARKER) + len(CONTENT_GUARD_MARKER)
    end = text.index("\nPY\n", start)
    return text[start:end]


def heredoc_source(marker: str, path: Path = SCRIPT) -> str:
    text = script_text(path)
    start = text.index(marker) + len(marker)
    end = text.index("\nPY\n", start)
    return text[start:end]


def inode_stat(
    kind: int,
    mode: int,
    *,
    uid: int = 0,
    gid: int = 33,
    dev: int = 7,
    ino: int = 11,
    nlink: int = 1,
) -> os.stat_result:
    return types.SimpleNamespace(
        st_mode=kind | mode,
        st_uid=uid,
        st_gid=gid,
        st_dev=dev,
        st_ino=ino,
        st_nlink=nlink,
    )


def directory_stat(mode: int, *, uid: int = 0, ino: int = 11) -> os.stat_result:
    return inode_stat(stat.S_IFDIR, mode, uid=uid, ino=ino)


def symlink_stat(*, uid: int = 0, ino: int = 21) -> os.stat_result:
    return inode_stat(stat.S_IFLNK, 0o777, uid=uid, ino=ino)


class FakeFlockKernel:
    """Execute lock helpers with Linux flock open-file-description semantics."""

    O_RDONLY = getattr(os, "O_RDONLY", 0)
    O_RDWR = getattr(os, "O_RDWR", 2)
    O_CREAT = getattr(os, "O_CREAT", 0x40)
    O_EXCL = getattr(os, "O_EXCL", 0x80)
    O_NOFOLLOW = getattr(os, "O_NOFOLLOW", 0x20000)

    def __init__(self, *, inherited_fd: int = 9, missing: bool = False) -> None:
        self.path_info = inode_stat(stat.S_IFREG, 0o600, uid=0, ino=501)
        self.path_exists = not missing
        self.inherited_fd = inherited_fd
        self.fd_info = {inherited_fd: self.path_info}
        self.ofd = {inherited_fd: 901}
        self.lock_owner: int | None = None
        self.lock_kind: str | None = None
        self.next_fd = 40
        self.events: list[tuple] = []

    def getuid(self) -> int:
        return 0

    def geteuid(self) -> int:
        return 0

    def open(self, path, flags: int, mode: int | None = None) -> int:
        self.events.append(("open", str(path), flags, mode))
        create = bool(flags & self.O_CREAT)
        exclusive = bool(flags & self.O_EXCL)
        if not self.path_exists:
            if not create:
                raise FileNotFoundError(str(path))
            self.path_exists = True
            self.path_info = inode_stat(
                stat.S_IFREG, mode if mode is not None else 0o600, uid=0, ino=501,
            )
        elif create and exclusive:
            raise FileExistsError(str(path))
        fd = self.next_fd
        self.next_fd += 1
        self.fd_info[fd] = self.path_info
        self.ofd[fd] = fd + 1000
        return fd

    def fstat(self, fd: int):
        self.events.append(("fstat", fd))
        if fd not in self.fd_info:
            raise OSError(errno.EBADF, "bad fd")
        return self.fd_info[fd]

    def lstat(self, path):
        self.events.append(("lstat", str(path)))
        if not self.path_exists:
            raise FileNotFoundError(str(path))
        return self.path_info

    def close(self, fd: int) -> None:
        self.events.append(("close", fd))
        owner = self.ofd.pop(fd, None)
        self.fd_info.pop(fd, None)
        if owner is not None and owner == self.lock_owner:
            self.lock_owner = None
            self.lock_kind = None

    def flock(self, fd: int, operation: int, api) -> None:
        self.events.append(("flock", fd, operation))
        if fd not in self.ofd:
            raise OSError(errno.EBADF, "bad fd")
        requested = "exclusive" if operation & api.LOCK_EX else "shared"
        owner = self.ofd[fd]
        if self.lock_owner is None:
            self.lock_owner = owner
            self.lock_kind = requested
            return
        if self.lock_owner == owner:
            self.lock_kind = requested
            return
        if self.lock_kind == "exclusive" or requested == "exclusive":
            raise BlockingIOError(errno.EAGAIN, "would block")
        # The test model needs only one shared owner; compatible shared probes
        # are represented by the first owner and released when its fd closes.


class FakeFcntl(types.ModuleType):
    LOCK_SH = 1
    LOCK_EX = 2
    LOCK_NB = 4

    def __init__(self, kernel: FakeFlockKernel) -> None:
        super().__init__("fcntl")
        self.kernel = kernel

    def flock(self, fd: int, operation: int) -> None:
        self.kernel.flock(fd, operation, self)


def lock_namespace(
    marker: str,
    stop: str,
    kernel: FakeFlockKernel,
    path: Path = SCRIPT,
) -> dict[str, object]:
    source = heredoc_source(marker, path).split(stop, maxsplit=1)[0]
    fake_fcntl = FakeFcntl(kernel)
    with mock.patch.dict(__import__("sys").modules, {"fcntl": fake_fcntl}):
        namespace: dict[str, object] = {}
        exec(compile(source, str(path), "exec"), namespace)
    namespace["os"] = kernel
    namespace["fcntl"] = fake_fcntl
    return namespace


class FakeKernel:
    """Small Linux directory-fd model used to execute the embedded operator."""

    O_RDONLY = getattr(os, "O_RDONLY", 0)
    O_DIRECTORY = getattr(os, "O_DIRECTORY", 0x10000)
    O_NOFOLLOW = getattr(os, "O_NOFOLLOW", 0x20000)
    path = posixpath

    APP_FD = 31
    RELEASES_FD = 32
    SOURCE_FD = 33
    TARGET_FD = 34

    def __init__(self) -> None:
        self.events: list[str] = []
        self.fd_stats = {
            self.APP_FD: directory_stat(0o755, ino=101),
            self.RELEASES_FD: directory_stat(0o2755, ino=102),
            self.SOURCE_FD: directory_stat(0o700, ino=103),
        }
        self.target_named: os.stat_result | None = None
        self.current_entry: os.stat_result | None = symlink_stat(ino=104)
        self.current_text = "/var/www/rosomaha/_releases/old"
        self.temporary_entry: os.stat_result | None = None
        self.temporary_text: str | None = None
        self.post_rsync_mode = 0o700
        self.rsync_calls: list[tuple[list[str], dict[str, object]]] = []
        self.collision = False
        self.target_open_is_symlink = False
        self.replace_error: OSError | None = None
        self.replace_current_text_override: str | None = None
        self.rsync_error: OSError | None = None
        self.fsync_error_fd: int | None = None
        self.releases_lstat_calls = 0
        self.swap_releases_on_lstat_call: int | None = None
        self.target_stat_calls = 0
        self.swap_target_on_stat_call: int | None = None
        self.temporary_stat_calls = 0
        self.swap_temporary_on_stat_call: int | None = None

    @staticmethod
    def _copy(info: os.stat_result) -> os.stat_result:
        return types.SimpleNamespace(**vars(info))

    def open(self, path: str, _flags: int, *, dir_fd: int | None = None) -> int:
        value = str(path)
        self.events.append(f"open:{dir_fd}:{value}")
        if value == str(APP) and dir_fd is None:
            return self.APP_FD
        if value == "_releases" and dir_fd == self.APP_FD:
            return self.RELEASES_FD
        if value == "dist" and dir_fd == self.APP_FD:
            return self.SOURCE_FD
        if value == RELEASE_NAME and dir_fd == self.RELEASES_FD:
            if self.target_open_is_symlink:
                raise OSError("O_NOFOLLOW rejected target symlink")
            if self.target_named is None:
                raise FileNotFoundError(value)
            self.fd_stats[self.TARGET_FD] = self._copy(self.target_named)
            return self.TARGET_FD
        raise AssertionError((value, dir_fd))

    def fstat(self, fd: int) -> os.stat_result:
        self.events.append(f"fstat:{fd}")
        return self._copy(self.fd_stats[fd])

    def lstat(self, path: Path) -> os.stat_result:
        value = str(path)
        self.events.append(f"lstat:{value}")
        if value == str(APP):
            return self._copy(self.fd_stats[self.APP_FD])
        if value == str(RELEASES):
            self.releases_lstat_calls += 1
            if (
                self.swap_releases_on_lstat_call is not None
                and self.releases_lstat_calls >= self.swap_releases_on_lstat_call
            ):
                return directory_stat(0o2755, ino=999)
            return self._copy(self.fd_stats[self.RELEASES_FD])
        if value == str(SOURCE):
            return self._copy(self.fd_stats[self.SOURCE_FD])
        raise AssertionError(value)

    def stat(
        self,
        path: str,
        *,
        dir_fd: int | None = None,
        follow_symlinks: bool = True,
    ) -> os.stat_result:
        value = str(path)
        self.events.append(f"stat:{dir_fd}:{follow_symlinks}:{value}")
        if value.startswith("/proc/self/fd/") and dir_fd is None:
            fd = int(value.rsplit("/", maxsplit=1)[1])
            return self._copy(self.fd_stats[fd])
        if value == "_releases" and dir_fd == self.APP_FD and not follow_symlinks:
            return self._copy(self.fd_stats[self.RELEASES_FD])
        if value == "dist" and dir_fd == self.APP_FD and not follow_symlinks:
            return self._copy(self.fd_stats[self.SOURCE_FD])
        if value == RELEASE_NAME and dir_fd == self.RELEASES_FD and not follow_symlinks:
            if self.target_named is None:
                raise FileNotFoundError(value)
            self.target_stat_calls += 1
            if (
                self.swap_target_on_stat_call is not None
                and self.target_stat_calls >= self.swap_target_on_stat_call
            ):
                return directory_stat(0o700, ino=998)
            return self._copy(self.target_named)
        if value == "current" and dir_fd == self.APP_FD and not follow_symlinks:
            if self.current_entry is None:
                raise FileNotFoundError(value)
            return self._copy(self.current_entry)
        if value.startswith(".") and dir_fd == self.APP_FD and not follow_symlinks:
            if self.temporary_entry is None:
                raise FileNotFoundError(value)
            self.temporary_stat_calls += 1
            if (
                self.swap_temporary_on_stat_call is not None
                and self.temporary_stat_calls >= self.swap_temporary_on_stat_call
            ):
                return symlink_stat(ino=999)
            return self._copy(self.temporary_entry)
        raise AssertionError((value, dir_fd, follow_symlinks))

    def mkdir(self, name: str, *, mode: int, dir_fd: int) -> None:
        self.events.append(f"mkdir:{dir_fd}:{name}:{mode:o}")
        if self.collision:
            raise FileExistsError(name)
        if dir_fd != self.RELEASES_FD or name != RELEASE_NAME or mode != 0o700:
            raise AssertionError((name, mode, dir_fd))
        self.target_named = directory_stat(0o700, ino=105)

    def fchmod(self, fd: int, mode: int) -> None:
        self.events.append(f"fchmod:{fd}:{mode:o}")
        if fd != self.TARGET_FD or mode != 0o755:
            raise AssertionError((fd, mode))
        info = self.fd_stats[fd]
        updated = directory_stat(mode, uid=info.st_uid, ino=info.st_ino)
        self.fd_stats[fd] = updated
        if self.target_named is not None and self.target_named.st_ino == info.st_ino:
            self.target_named = self._copy(updated)

    def fsync(self, fd: int) -> None:
        self.events.append(f"fsync:{fd}")
        if fd == self.fsync_error_fd:
            raise OSError("fsync blocked")

    def symlink(self, target: str, name: str, *, dir_fd: int) -> None:
        self.events.append(f"symlink:{dir_fd}:{name}:{target}")
        if dir_fd != self.APP_FD or self.temporary_entry is not None:
            raise AssertionError((target, name, dir_fd))
        self.temporary_entry = symlink_stat(ino=106)
        self.temporary_text = target

    def readlink(self, name: str, *, dir_fd: int) -> str:
        self.events.append(f"readlink:{dir_fd}:{name}")
        if dir_fd != self.APP_FD:
            raise AssertionError((name, dir_fd))
        if name == "current":
            if self.current_entry is None:
                raise FileNotFoundError(name)
            return self.current_text
        if name.startswith(".") and self.temporary_entry is not None:
            assert self.temporary_text is not None
            return self.temporary_text
        raise FileNotFoundError(name)

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
        self.current_text = (
            self.replace_current_text_override
            if self.replace_current_text_override is not None
            else self.temporary_text or ""
        )
        self.temporary_entry = None
        self.temporary_text = None

    def unlink(self, name: str, *, dir_fd: int) -> None:
        self.events.append(f"unlink:{dir_fd}:{name}")
        if dir_fd != self.APP_FD or self.temporary_entry is None or not name.startswith("."):
            raise AssertionError((name, dir_fd))
        self.temporary_entry = None
        self.temporary_text = None

    def close(self, fd: int) -> None:
        self.events.append(f"close:{fd}")

    def run_rsync(self, args: list[str], **kwargs: object) -> None:
        self.events.append("rsync")
        self.rsync_calls.append((args, kwargs))
        if self.rsync_error is not None:
            raise self.rsync_error
        info = self.fd_stats[self.TARGET_FD]
        copied = directory_stat(self.post_rsync_mode, uid=info.st_uid, ino=info.st_ino)
        self.fd_stats[self.TARGET_FD] = copied
        if self.target_named is not None and self.target_named.st_ino == info.st_ino:
            self.target_named = self._copy(copied)


def execute(kernel: FakeKernel) -> PurePosixPath:
    namespace = embedded_namespace()
    namespace["os"] = kernel
    return namespace["guarded_release"](
        APP,
        RELEASES,
        CURRENT,
        RELEASE_NAME,
        SOURCE,
        run_rsync=kernel.run_rsync,
    )


def execute_cli(kernel: FakeKernel) -> tuple[int, str, str]:
    namespace = embedded_namespace()
    namespace["os"] = kernel
    guarded_release = namespace["guarded_release"]
    namespace["guarded_release"] = lambda *args: guarded_release(
        *args,
        run_rsync=kernel.run_rsync,
    )
    stdout = io.StringIO()
    stderr = io.StringIO()
    argv = [
        "server-release.sh",
        str(APP),
        str(RELEASES),
        str(CURRENT),
        RELEASE_NAME,
        str(SOURCE),
    ]
    with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
        status = namespace["release_cli"](argv)
    return status, stdout.getvalue(), stderr.getvalue()


class SharedReleaseLockTests(unittest.TestCase):
    def inherited(
        self,
        kernel: FakeFlockKernel,
        path: Path = SCRIPT,
    ) -> dict[str, object]:
        return lock_namespace(
            INHERITED_LOCK_MARKER,
            "try:\n    lock_path = Path(sys.argv[1])",
            kernel,
            path,
        )

    def direct(
        self,
        kernel: FakeFlockKernel,
        path: Path = SCRIPT,
    ) -> dict[str, object]:
        return lock_namespace(
            DIRECT_LOCK_MARKER, "lock_fd = None\ntry:", kernel, path,
        )

    def test_help_exits_before_any_lock_path_or_lock_bootstrap(self) -> None:
        text = script_text()
        help_exit = text.index('if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]')
        lock_path = text.index('RELEASE_LOCK_PATH="/var/www/rosomaha/.rosomaha-main-price-release.lock"')
        self.assertLess(help_exit, lock_path)
        self.assertIn("usage\n  exit 0", text[help_exit:lock_path])

    def test_direct_lock_contract_is_fixed_private_nonblocking_and_inode_bound(self) -> None:
        source = heredoc_source(DIRECT_LOCK_MARKER)
        self.assertIn('LOCK_PATH = Path("/var/www/rosomaha/.rosomaha-main-price-release.lock")', source)
        self.assertIn("os.O_CREAT | os.O_EXCL", source)
        self.assertIn("fcntl.LOCK_EX | fcntl.LOCK_NB", source)
        self.assertIn("info.st_uid != 0", source)
        self.assertIn("info.st_gid not in ALLOWED_GIDS", source)
        self.assertIn("info.st_nlink != 1", source)
        self.assertIn("stat.S_IMODE(info.st_mode) != 0o600", source)
        self.assertIn("if not same_inode(opened, linked)", source)

    def test_direct_open_create_acquires_exclusive_lock(self) -> None:
        kernel = FakeFlockKernel(missing=True)
        namespace = self.direct(kernel)
        fd = namespace["open_direct_lock"]()
        self.assertTrue(kernel.path_exists)
        self.assertEqual(kernel.lock_owner, kernel.ofd[fd])
        self.assertEqual(kernel.lock_kind, "exclusive")
        self.assertIn(("open", str(namespace["LOCK_PATH"]), kernel.O_RDWR | kernel.O_NOFOLLOW | kernel.O_CREAT | kernel.O_EXCL, 0o600), kernel.events)

    def test_direct_lock_contention_fails_without_waiting_or_stealing(self) -> None:
        kernel = FakeFlockKernel()
        kernel.lock_owner = 777
        kernel.lock_kind = "exclusive"
        namespace = self.direct(kernel)
        with self.assertRaisesRegex(RuntimeError, "already holds the lock"):
            namespace["open_direct_lock"]()
        self.assertEqual(kernel.lock_owner, 777)
        self.assertEqual(kernel.lock_kind, "exclusive")

    def test_direct_release_and_direct_rollback_contend_on_one_lock(self) -> None:
        kernel = FakeFlockKernel(missing=True)
        release = self.direct(kernel)
        release_fd = release["open_direct_lock"]()
        self.assertEqual(kernel.lock_owner, kernel.ofd[release_fd])

        rollback = lock_namespace(
            DIRECT_LOCK_MARKER,
            "lock_fd = None\ntry:",
            kernel,
            ROLLBACK_SCRIPT,
        )
        with self.assertRaisesRegex(RuntimeError, "already holds the lock"):
            rollback["open_direct_lock"]()
        self.assertEqual(kernel.lock_owner, kernel.ofd[release_fd])
        self.assertEqual(kernel.lock_kind, "exclusive")

    def test_inherited_locked_fd_is_accepted_without_unlock(self) -> None:
        kernel = FakeFlockKernel()
        kernel.lock_owner = kernel.ofd[kernel.inherited_fd]
        kernel.lock_kind = "exclusive"
        namespace = self.inherited(kernel)
        namespace["require_inherited_exclusive_lock"](
            kernel.inherited_fd, namespace["LOCK_PATH"],
        )
        self.assertEqual(kernel.lock_owner, kernel.ofd[kernel.inherited_fd])
        self.assertEqual(kernel.lock_kind, "exclusive")
        inherited_flocks = [event for event in kernel.events if event[:2] == ("flock", kernel.inherited_fd)]
        self.assertEqual(len(inherited_flocks), 1)
        self.assertEqual(inherited_flocks[0][2], FakeFcntl.LOCK_EX | FakeFcntl.LOCK_NB)

    def test_inherited_unlocked_or_foreign_owned_fd_is_rejected(self) -> None:
        unlocked = FakeFlockKernel()
        namespace = self.inherited(unlocked)
        with self.assertRaisesRegex(RuntimeError, "not already exclusive"):
            namespace["require_inherited_exclusive_lock"](
                unlocked.inherited_fd, namespace["LOCK_PATH"],
            )
        self.assertIsNone(unlocked.lock_owner)

        foreign = FakeFlockKernel()
        foreign.lock_owner = 777
        foreign.lock_kind = "exclusive"
        namespace = self.inherited(foreign)
        with self.assertRaisesRegex(RuntimeError, "does not own"):
            namespace["require_inherited_exclusive_lock"](
                foreign.inherited_fd, namespace["LOCK_PATH"],
            )
        self.assertEqual(foreign.lock_owner, 777)

    def test_inherited_bad_fd_path_inode_and_metadata_are_rejected(self) -> None:
        bad_fd = FakeFlockKernel()
        namespace = self.inherited(bad_fd)
        with self.assertRaises(OSError):
            namespace["require_inherited_exclusive_lock"](
                999, namespace["LOCK_PATH"],
            )

        bad_path = FakeFlockKernel()
        namespace = self.inherited(bad_path)
        with self.assertRaisesRegex(RuntimeError, "fixed production path"):
            namespace["require_inherited_exclusive_lock"](
                bad_path.inherited_fd, Path("/tmp/not-the-release-lock"),
            )

        bad_inode = FakeFlockKernel()
        bad_inode.fd_info[bad_inode.inherited_fd] = inode_stat(
            stat.S_IFREG, 0o600, uid=0, ino=999,
        )
        namespace = self.inherited(bad_inode)
        with self.assertRaisesRegex(RuntimeError, "not bound"):
            namespace["require_inherited_exclusive_lock"](
                bad_inode.inherited_fd, namespace["LOCK_PATH"],
            )

        bad_metadata = FakeFlockKernel()
        bad_metadata.path_info = inode_stat(
            stat.S_IFREG, 0o640, uid=0, gid=99, ino=501, nlink=2,
        )
        bad_metadata.fd_info[bad_metadata.inherited_fd] = bad_metadata.path_info
        namespace = self.inherited(bad_metadata)
        with self.assertRaisesRegex(RuntimeError, "metadata is unsafe"):
            namespace["require_inherited_exclusive_lock"](
                bad_metadata.inherited_fd, namespace["LOCK_PATH"],
            )

    def test_rollback_lock_copy_has_the_same_execution_semantics(self) -> None:
        direct = FakeFlockKernel(missing=True)
        direct_namespace = self.direct(direct, ROLLBACK_SCRIPT)
        direct_fd = direct_namespace["open_direct_lock"]()
        self.assertEqual(direct.lock_owner, direct.ofd[direct_fd])
        self.assertEqual(direct.lock_kind, "exclusive")

        inherited = FakeFlockKernel()
        inherited.lock_owner = inherited.ofd[inherited.inherited_fd]
        inherited.lock_kind = "exclusive"
        inherited_namespace = self.inherited(inherited, ROLLBACK_SCRIPT)
        inherited_namespace["require_inherited_exclusive_lock"](
            inherited.inherited_fd, inherited_namespace["LOCK_PATH"],
        )
        self.assertEqual(inherited.lock_owner, inherited.ofd[inherited.inherited_fd])
        self.assertEqual(inherited.lock_kind, "exclusive")

        unlocked = FakeFlockKernel()
        unlocked_namespace = self.inherited(unlocked, ROLLBACK_SCRIPT)
        with self.assertRaisesRegex(RuntimeError, "not already exclusive"):
            unlocked_namespace["require_inherited_exclusive_lock"](
                unlocked.inherited_fd, unlocked_namespace["LOCK_PATH"],
            )

        foreign = FakeFlockKernel()
        foreign.lock_owner = 777
        foreign.lock_kind = "exclusive"
        foreign_namespace = self.inherited(foreign, ROLLBACK_SCRIPT)
        with self.assertRaisesRegex(RuntimeError, "does not own"):
            foreign_namespace["require_inherited_exclusive_lock"](
                foreign.inherited_fd, foreign_namespace["LOCK_PATH"],
            )

        bad_inode = FakeFlockKernel()
        bad_inode.fd_info[bad_inode.inherited_fd] = inode_stat(
            stat.S_IFREG, 0o600, uid=0, ino=999,
        )
        bad_inode_namespace = self.inherited(bad_inode, ROLLBACK_SCRIPT)
        with self.assertRaisesRegex(RuntimeError, "not bound"):
            bad_inode_namespace["require_inherited_exclusive_lock"](
                bad_inode.inherited_fd, bad_inode_namespace["LOCK_PATH"],
            )


class ReleaseRootOperatorTests(unittest.TestCase):
    def test_shell_has_no_pre_operator_release_write_or_path_based_rsync(self) -> None:
        text = script_text()
        operator = text.index(OPERATOR_MARKER) - len('/usr/bin/python3 - \\\n  ')
        content_guard = text.index("Content guard passed")
        self.assertLess(content_guard, operator)
        prefix = text[:operator]
        self.assertNotIn('mkdir -- "$TARGET"', prefix)
        self.assertNotIn('rsync -a', prefix)
        self.assertNotIn('ln -sfn', text)
        self.assertNotIn("chmod -R", text)
        self.assertNotIn("os.chmod", text)
        self.assertNotIn("shutil.rmtree", text)
        self.assertNotIn("rm -rf", text)
        self.assertIn('f"/proc/self/fd/{target_fd}"', text)

    def test_content_guard_uses_exact_python_and_no_pep585_annotations(self) -> None:
        text = script_text()
        source = content_guard_source()
        self.assertIn(CONTENT_GUARD_MARKER, text)
        self.assertNotIn("\n  python3 - ", text)
        self.assertNotIn("set[", source)
        self.assertNotIn("list[", source)
        compile(source, str(SCRIPT), "exec")
        self.assertIn(
            'if [[ ! -f "$CONTENT_SOURCE" ]]; then',
            text,
        )

    def test_release_paths_are_exact_and_environment_overrides_fail_closed(self) -> None:
        text = script_text()
        self.assertIn('FIXED_APP_ROOT="/var/www/rosomaha"', text)
        self.assertIn(
            'FIXED_CONTENT_SOURCE="/var/www/rosomaha/public/api/articles.json"',
            text,
        )
        self.assertIn(
            'if [[ "$REQUESTED_APP_ROOT" != "$FIXED_APP_ROOT" || '
            '"$REQUESTED_CONTENT_SOURCE" != "$FIXED_CONTENT_SOURCE" ]]; then',
            text,
        )
        direct_source = heredoc_source(DIRECT_LOCK_MARKER)
        self.assertNotIn('env[name] = os.environ[name]', direct_source)
        namespace = embedded_namespace()
        with self.assertRaisesRegex(RuntimeError, "fixed production path"):
            namespace["guarded_release"](
                PurePosixPath("/var/www/another-app"),
                PurePosixPath("/var/www/another-app/_releases"),
                PurePosixPath("/var/www/another-app/current"),
                RELEASE_NAME,
                PurePosixPath("/var/www/another-app/dist"),
            )

    def test_label_is_bounded_before_release_name_is_built(self) -> None:
        text = script_text()
        guard = text.index('[[ ! "$LABEL" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$ ]]')
        release_name = text.index('RELEASE_NAME="${STAMP}-${LABEL}"')
        self.assertLess(guard, release_name)

    def test_executes_copy_and_switch_only_through_pinned_descriptors(self) -> None:
        kernel = FakeKernel()
        target = execute(kernel)
        self.assertEqual(target, RELEASES / RELEASE_NAME)
        self.assertEqual(len(kernel.rsync_calls), 1)
        args, kwargs = kernel.rsync_calls[0]
        self.assertEqual(
            args,
            [
                "/usr/bin/rsync",
                "-a",
                "--delete",
                "--",
                f"/proc/self/fd/{kernel.SOURCE_FD}/",
                f"/proc/self/fd/{kernel.TARGET_FD}/",
            ],
        )
        self.assertEqual(kwargs["pass_fds"], (kernel.SOURCE_FD, kernel.TARGET_FD))
        self.assertIs(kwargs["check"], True)
        self.assertIs(kwargs["close_fds"], True)
        self.assertEqual(kernel.current_text, str(RELEASES / RELEASE_NAME))
        self.assertIn("fchmod:34:755", kernel.events)
        self.assertLess(kernel.events.index("rsync"), kernel.events.index("fchmod:34:755"))
        self.assertLess(kernel.events.index("fchmod:34:755"), next(
            index for index, event in enumerate(kernel.events) if event.startswith("replace:")
        ))

    def test_group_writable_sticky_application_root_is_allowed(self) -> None:
        kernel = FakeKernel()
        kernel.fd_stats[kernel.APP_FD] = directory_stat(0o3775, ino=101)
        target = execute(kernel)
        self.assertEqual(target, RELEASES / RELEASE_NAME)
        self.assertEqual(len(kernel.rsync_calls), 1)
        self.assertTrue(any(event.startswith("mkdir:") for event in kernel.events))
        self.assertTrue(any(event.startswith("replace:") for event in kernel.events))

    def test_group_writable_application_root_without_sticky_fails_before_write(self) -> None:
        kernel = FakeKernel()
        kernel.fd_stats[kernel.APP_FD] = directory_stat(0o2775, ino=101)
        with self.assertRaisesRegex(
            RuntimeError,
            "application root is group writable without sticky bit",
        ):
            execute(kernel)
        self.assertFalse(any(event.startswith("mkdir:") for event in kernel.events))
        self.assertEqual(kernel.rsync_calls, [])
        self.assertFalse(any(event.startswith("symlink:") for event in kernel.events))

    def test_world_writable_application_root_fails_before_write(self) -> None:
        kernel = FakeKernel()
        kernel.fd_stats[kernel.APP_FD] = directory_stat(0o3777, ino=101)
        with self.assertRaisesRegex(RuntimeError, "application root is world writable"):
            execute(kernel)
        self.assertFalse(any(event.startswith("mkdir:") for event in kernel.events))
        self.assertEqual(kernel.rsync_calls, [])
        self.assertFalse(any(event.startswith("symlink:") for event in kernel.events))

    def test_releases_and_source_remain_strictly_non_writable(self) -> None:
        cases = (
            (FakeKernel.RELEASES_FD, 0o2775, "releases directory"),
            (FakeKernel.SOURCE_FD, 0o770, "release source"),
        )
        for fd, mode, label in cases:
            with self.subTest(label=label, mode=oct(mode)):
                kernel = FakeKernel()
                kernel.fd_stats[fd] = directory_stat(
                    mode,
                    ino=kernel.fd_stats[fd].st_ino,
                )
                with self.assertRaisesRegex(
                    RuntimeError,
                    f"{label} is group/world writable",
                ):
                    execute(kernel)
                self.assertFalse(any(event.startswith("mkdir:") for event in kernel.events))
                self.assertEqual(kernel.rsync_calls, [])
                self.assertFalse(any(event.startswith("symlink:") for event in kernel.events))

    def test_releases_parent_is_revalidated_before_first_write(self) -> None:
        kernel = FakeKernel()
        kernel.swap_releases_on_lstat_call = 2
        with self.assertRaisesRegex(RuntimeError, "releases directory binding changed"):
            execute(kernel)
        self.assertFalse(any(event.startswith("mkdir:") for event in kernel.events))
        self.assertEqual(kernel.rsync_calls, [])
        self.assertFalse(any(event.startswith("symlink:") for event in kernel.events))

    def test_target_collision_and_symlink_fail_before_copy(self) -> None:
        collision = FakeKernel()
        collision.collision = True
        with self.assertRaises(FileExistsError):
            execute(collision)
        self.assertEqual(collision.rsync_calls, [])

        symlink = FakeKernel()
        symlink.target_open_is_symlink = True
        with self.assertRaisesRegex(
            RuntimeError,
            "release_state=not_switched.*cause=O_NOFOLLOW rejected target symlink",
        ):
            execute(symlink)
        self.assertEqual(symlink.rsync_calls, [])
        self.assertEqual(symlink.current_text, "/var/www/rosomaha/_releases/old")

    def test_pre_copy_failure_preserves_partial_target_and_forbids_retry(self) -> None:
        kernel = FakeKernel()
        kernel.swap_target_on_stat_call = 2
        with self.assertRaisesRegex(
            RuntimeError,
            "release_state=not_switched.*partial_target=preserved; "
            "automatic_retry=forbidden",
        ) as caught:
            execute(kernel)
        error = caught.exception
        self.assertEqual(error.state, "not_switched")
        self.assertEqual(error.target, RELEASES / RELEASE_NAME)
        self.assertIsNotNone(kernel.target_named)
        self.assertEqual(kernel.current_text, "/var/www/rosomaha/_releases/old")
        self.assertEqual(kernel.rsync_calls, [])
        self.assertFalse(any(event.startswith("replace:") for event in kernel.events))

    def test_rsync_failure_reports_not_switched_and_preserves_target(self) -> None:
        kernel = FakeKernel()
        kernel.rsync_error = OSError("rsync blocked")
        with self.assertRaisesRegex(
            RuntimeError,
            "release_state=not_switched.*cause=rsync blocked.*"
            "automatic_retry=forbidden",
        ) as caught:
            execute(kernel)
        error = caught.exception
        self.assertEqual(error.state, "not_switched")
        self.assertEqual(error.temporary_cleanup_status, "not_created")
        self.assertIsNotNone(kernel.target_named)
        self.assertEqual(kernel.current_text, "/var/www/rosomaha/_releases/old")
        self.assertEqual(len(kernel.rsync_calls), 1)
        self.assertFalse(any(event.startswith("replace:") for event in kernel.events))

    def test_target_inode_swap_before_copy_fails_closed(self) -> None:
        kernel = FakeKernel()
        kernel.swap_target_on_stat_call = 2
        with self.assertRaisesRegex(RuntimeError, "release root binding changed before copy"):
            execute(kernel)
        self.assertEqual(kernel.rsync_calls, [])
        self.assertFalse(any(event.startswith("fchmod:") for event in kernel.events))
        self.assertFalse(any(event.startswith("replace:") for event in kernel.events))

    def test_target_inode_swap_during_copy_cannot_redirect_and_is_not_published(self) -> None:
        kernel = FakeKernel()

        def swapping_rsync(args: list[str], **kwargs: object) -> None:
            kernel.run_rsync(args, **kwargs)
            kernel.target_named = directory_stat(0o700, ino=998)

        namespace = embedded_namespace()
        namespace["os"] = kernel
        with self.assertRaisesRegex(RuntimeError, "release root changed during pinned copy"):
            namespace["guarded_release"](
                APP, RELEASES, CURRENT, RELEASE_NAME, SOURCE, run_rsync=swapping_rsync,
            )
        self.assertEqual(len(kernel.rsync_calls), 1)
        self.assertFalse(any(event.startswith("fchmod:") for event in kernel.events))
        self.assertFalse(any(event.startswith("replace:") for event in kernel.events))

    def test_only_allowed_rsync_root_modes_become_exact_0755(self) -> None:
        for mode in (0o700, 0o755, 0o2700, 0o2755):
            with self.subTest(mode=oct(mode)):
                kernel = FakeKernel()
                kernel.post_rsync_mode = mode
                execute(kernel)
                self.assertEqual(stat.S_IMODE(kernel.fd_stats[kernel.TARGET_FD].st_mode), 0o755)
                self.assertEqual(
                    [event for event in kernel.events if event.startswith("fchmod:")],
                    ["fchmod:34:755"],
                )

    def test_unsafe_post_copy_mode_is_never_normalized_or_published(self) -> None:
        kernel = FakeKernel()
        kernel.post_rsync_mode = 0o777
        with self.assertRaisesRegex(RuntimeError, "release root changed during pinned copy"):
            execute(kernel)
        self.assertFalse(any(event.startswith("fchmod:") for event in kernel.events))
        self.assertFalse(any(event.startswith("replace:") for event in kernel.events))

    def test_temporary_link_is_cleaned_if_switch_fails(self) -> None:
        kernel = FakeKernel()
        kernel.replace_error = OSError("replace blocked")
        with self.assertRaisesRegex(
            RuntimeError,
            "release_state=not_switched.*temporary_link_cleanup=removed.*"
            "cause=replace blocked",
        ) as caught:
            execute(kernel)
        self.assertEqual(caught.exception.state, "not_switched")
        self.assertEqual(caught.exception.temporary_cleanup_status, "removed")
        self.assertTrue(any(event.startswith("symlink:") for event in kernel.events))
        self.assertIn(f"unlink:{kernel.APP_FD}:.{RELEASE_NAME}.current.tmp", kernel.events)
        self.assertIsNone(kernel.temporary_entry)
        self.assertEqual(kernel.current_text, "/var/www/rosomaha/_releases/old")

    def test_unverified_temporary_link_is_preserved_and_reported(self) -> None:
        kernel = FakeKernel()
        kernel.replace_error = OSError("replace blocked")
        kernel.swap_temporary_on_stat_call = 2
        with self.assertRaisesRegex(
            RuntimeError,
            "release_state=not_switched.*"
            "temporary_link_cleanup=preserved_unverified",
        ) as caught:
            execute(kernel)
        self.assertEqual(
            caught.exception.temporary_cleanup_status,
            "preserved_unverified",
        )
        self.assertIsNotNone(kernel.temporary_entry)
        self.assertFalse(any(event.startswith("unlink:") for event in kernel.events))
        self.assertEqual(kernel.current_text, "/var/www/rosomaha/_releases/old")

    def test_post_switch_fsync_failure_requires_live_verification_or_rollback(self) -> None:
        kernel = FakeKernel()
        kernel.fsync_error_fd = kernel.APP_FD
        with self.assertRaisesRegex(
            RuntimeError,
            "release_state=switched_to_new_release.*"
            "current_may_already_be_new=true.*recovery_required=true",
        ) as caught:
            execute(kernel)
        error = caught.exception
        self.assertEqual(error.state, "switched_to_new_release")
        self.assertEqual(error.temporary_cleanup_status, "consumed_by_switch")
        self.assertEqual(kernel.current_text, str(RELEASES / RELEASE_NAME))
        self.assertTrue(any(event.startswith("replace:") for event in kernel.events))
        self.assertNotIn("Released:", str(error))

        cli_kernel = FakeKernel()
        cli_kernel.fsync_error_fd = cli_kernel.APP_FD
        status, stdout, stderr = execute_cli(cli_kernel)
        self.assertEqual(status, 1)
        self.assertEqual(stdout, "")
        self.assertNotIn("Released:", stdout)
        self.assertIn("Release failed: release_state=switched_to_new_release", stderr)
        self.assertIn("recovery_required=true", stderr)

    def test_post_switch_verification_failure_never_returns_success(self) -> None:
        kernel = FakeKernel()
        kernel.replace_current_text_override = str(RELEASES / "unexpected")
        with self.assertRaisesRegex(
            RuntimeError,
            "release_state=switched_to_new_release.*"
            "cause=current link switch could not be verified.*"
            "required_action=verify_current_and_live_site_then_keep_or_rollback",
        ) as caught:
            execute(kernel)
        self.assertEqual(caught.exception.state, "switched_to_new_release")
        self.assertEqual(kernel.current_text, str(RELEASES / "unexpected"))
        self.assertTrue(any(event.startswith("replace:") for event in kernel.events))

    def test_invalid_paths_and_name_are_rejected_before_open(self) -> None:
        namespace = embedded_namespace()
        kernel = FakeKernel()
        namespace["os"] = kernel
        cases = [
            (PurePosixPath("relative"), RELEASES, CURRENT, RELEASE_NAME, SOURCE),
            (APP, APP / "elsewhere", CURRENT, RELEASE_NAME, SOURCE),
            (APP, RELEASES, CURRENT, "../escape", SOURCE),
            (APP, RELEASES, CURRENT, RELEASE_NAME, APP / "other"),
        ]
        for args in cases:
            with self.subTest(args=args), self.assertRaises(RuntimeError):
                namespace["guarded_release"](*args, run_rsync=kernel.run_rsync)
        self.assertEqual(kernel.events, [])


if __name__ == "__main__":
    unittest.main()
