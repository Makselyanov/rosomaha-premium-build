from __future__ import annotations

import os
import posixpath
import stat
import types
import unittest
from pathlib import Path, PurePosixPath


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "server-release.sh"
APP = PurePosixPath("/var/www/rosomaha")
RELEASES = APP / "_releases"
CURRENT = APP / "current"
SOURCE = APP / "dist"
RELEASE_NAME = "20260813-153103-safe"


def script_text() -> str:
    return SCRIPT.read_text(encoding="utf-8")


def embedded_namespace() -> dict[str, object]:
    text = script_text()
    marker = '"$APP_ROOT/dist" <<\'PY\'\n'
    start = text.index(marker) + len(marker)
    end = text.index("\nPY\n", start)
    source = text[start:end]
    source = source.split("\nreleased_target = guarded_release(", maxsplit=1)[0]
    namespace: dict[str, object] = {}
    exec(compile(source, str(SCRIPT), "exec"), namespace)
    namespace["Path"] = PurePosixPath
    return namespace


def inode_stat(
    kind: int,
    mode: int,
    *,
    uid: int = 0,
    dev: int = 7,
    ino: int = 11,
) -> os.stat_result:
    return types.SimpleNamespace(
        st_mode=kind | mode,
        st_uid=uid,
        st_gid=33,
        st_dev=dev,
        st_ino=ino,
    )


def directory_stat(mode: int, *, uid: int = 0, ino: int = 11) -> os.stat_result:
    return inode_stat(stat.S_IFDIR, mode, uid=uid, ino=ino)


def symlink_stat(*, uid: int = 0, ino: int = 21) -> os.stat_result:
    return inode_stat(stat.S_IFLNK, 0o777, uid=uid, ino=ino)


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
        self.releases_lstat_calls = 0
        self.swap_releases_on_lstat_call: int | None = None
        self.target_stat_calls = 0
        self.swap_target_on_stat_call: int | None = None

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
        self.current_text = self.temporary_text or ""
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


class ReleaseRootOperatorTests(unittest.TestCase):
    def test_shell_has_no_pre_operator_release_write_or_path_based_rsync(self) -> None:
        text = script_text()
        operator = text.index('/usr/bin/python3 - ')
        content_guard = text.index("Content guard passed")
        self.assertLess(content_guard, operator)
        prefix = text[:operator]
        self.assertNotIn('mkdir -- "$TARGET"', prefix)
        self.assertNotIn('rsync -a', prefix)
        self.assertNotIn('ln -sfn', text)
        self.assertNotIn("chmod -R", text)
        self.assertNotIn("os.chmod", text)
        self.assertIn('f"/proc/self/fd/{target_fd}"', text)

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
        with self.assertRaisesRegex(OSError, "O_NOFOLLOW"):
            execute(symlink)
        self.assertEqual(symlink.rsync_calls, [])

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
        with self.assertRaisesRegex(OSError, "replace blocked"):
            execute(kernel)
        self.assertTrue(any(event.startswith("symlink:") for event in kernel.events))
        self.assertIn(f"unlink:{kernel.APP_FD}:.{RELEASE_NAME}.current.tmp", kernel.events)
        self.assertIsNone(kernel.temporary_entry)
        self.assertEqual(kernel.current_text, "/var/www/rosomaha/_releases/old")

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
