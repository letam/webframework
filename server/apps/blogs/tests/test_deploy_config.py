"""Regression tests for the deploy configs that decide where production data lands.

`settings.py` requires `DATABASE_URL` and `MEDIA_ROOT` in production, so a deploy
missing them fails loudly instead of quietly writing to the container's ephemeral
filesystem. That guard checks presence, not correctness: a *wrong* value passes it
and reproduces the exact failure it was written to prevent — the app boots, answers
the health check, and loses every upload on the next restart.

Nothing in this repo can see what someone typed into `fly secrets set`. What it can
see is where those values come from: operators copy them out of `docs/deploy-fly.md`.
So pinning the runbook to the Fly configs closes most of the gap — if the volume
moves, or the avatar statics mapping changes, the documented commands stop matching
and these fail rather than shipping a runbook that silently strands data.
"""

import re
import tomllib
from pathlib import PurePosixPath

from django.conf import settings
from django.test import SimpleTestCase

REPO_ROOT = settings.BASE_DIR.parent
RUNBOOK = REPO_ROOT / 'docs' / 'deploy-fly.md'

# Every config that deploys this app. `fly.toml` is a reference snapshot rather than
# a deploy target, but it is the first file a reader opens — drift there misleads
# just as effectively, and P0-a deliberately changed all three together.
FLY_CONFIGS = (
    REPO_ROOT / 'admin' / 'configs' / 'fly-sqlite.toml',
    REPO_ROOT / 'admin' / 'configs' / 'fly-preview.toml',
    REPO_ROOT / 'fly.toml',
)

# Avatars are the one thing under MEDIA_URL that Fly serves off the volume directly;
# everything else falls through to Django's gated views. See the comment above the
# second [[statics]] block in fly-sqlite.toml.
AVATAR_URL_PREFIX = '/media/avatars/'


def documented_secret(name):
    """Return the value the runbook tells an operator to set for ``name``.

    The runbook writes these as single-quoted shell arguments in its
    ``fly secrets set`` block, which is what makes them greppable — and what makes
    them the thing to pin, since that block is where the values in Fly came from.
    """
    matches = re.findall(rf"^\s*{name}='([^']*)'", RUNBOOK.read_text(encoding='utf-8'), re.M)
    if not matches:
        raise AssertionError(f'{RUNBOOK} documents no {name}; the deploy recipe is incomplete')
    if len(set(matches)) > 1:
        raise AssertionError(f'{RUNBOOK} documents conflicting values for {name}: {matches}')
    return matches[0]


def fly_config(path):
    """Parse a Fly config into the two things that decide where data survives."""
    parsed = tomllib.loads(path.read_text(encoding='utf-8'))
    return (
        [mount['destination'] for mount in parsed.get('mounts', [])],
        {static['url_prefix']: static['guest_path'] for static in parsed.get('statics', [])},
    )


class DeployConfigTests(SimpleTestCase):
    """The checked-in files that have to agree about where the volume is."""

    def test_the_runbook_media_root_is_where_the_configs_serve_avatars(self):
        """A mismatch here 404s every avatar and nothing else, which reads as a UI bug.

        Fly serves ``/media/avatars/`` straight off the volume at a hardcoded
        ``guest_path``, while Django writes avatars to ``MEDIA_ROOT/avatars`` — a
        path it only learns from a secret. The two are joined by nothing but this
        assertion, so either side can move without the other noticing.
        """
        media_root = PurePosixPath(documented_secret('MEDIA_ROOT'))
        checked = 0
        for path in FLY_CONFIGS:
            _, statics = fly_config(path)
            guest_path = statics.get(AVATAR_URL_PREFIX)
            if guest_path is None:
                continue
            with self.subTest(config=path.name):
                self.assertEqual(
                    PurePosixPath(guest_path),
                    media_root / 'avatars',
                    f'{path.name} serves {AVATAR_URL_PREFIX} from {guest_path}, but the runbook '
                    f'sets MEDIA_ROOT={media_root}, so Django writes to {media_root}/avatars',
                )
            checked += 1

        self.assertTrue(checked, f'No config maps {AVATAR_URL_PREFIX}; this test checked nothing')

    def test_statically_served_media_is_inside_a_mounted_volume(self):
        """Serving uploads off the container filesystem loses them on every restart.

        The url_prefix makes this look like it works: avatars upload, display, and
        keep displaying until the machine next stops. Requiring the guest_path to sit
        inside a declared mount is what makes "there is no volume here" a failure at
        review time instead of a data-loss report later.
        """
        for path in FLY_CONFIGS:
            mounts, statics = fly_config(path)
            guest_path = statics.get(AVATAR_URL_PREFIX)
            if guest_path is None:
                continue
            with self.subTest(config=path.name):
                self.assertTrue(
                    any(PurePosixPath(guest_path).is_relative_to(mount) for mount in mounts),
                    f'{path.name} serves {AVATAR_URL_PREFIX} from {guest_path}, which is on the '
                    f"container's ephemeral filesystem — declared mounts are {mounts or 'none'}",
                )

    def test_the_runbook_puts_the_database_on_the_mounted_volume(self):
        """The failure `settings.py`'s DATABASE_URL guard exists to prevent, mistyped.

        A SQLite file off the volume boots, migrates, passes the health check and
        serves an empty site that forgets every write on restart. The guard cannot
        catch it because the variable *is* set — only the path is wrong.
        """
        database_url = documented_secret('DATABASE_URL')
        self.assertTrue(
            database_url.startswith('sqlite:///'),
            f'{RUNBOOK.name} documents a non-SQLite DATABASE_URL ({database_url}); this test '
            'pins the file path onto the volume and needs updating for another backend',
        )
        db_path = PurePosixPath(database_url.removeprefix('sqlite:///'))

        for path in FLY_CONFIGS:
            mounts, _ = fly_config(path)
            if not mounts:
                continue
            with self.subTest(config=path.name):
                self.assertTrue(
                    any(db_path.is_relative_to(mount) for mount in mounts),
                    f'{path.name} mounts {mounts}, but the runbook puts the database at '
                    f'{db_path} — outside the volume, so it is wiped on every restart',
                )
