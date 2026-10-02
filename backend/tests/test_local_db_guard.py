"""Database-label safeguards in db.init_db (stub connection, no database)."""
import psycopg
import pytest

from app.config import Settings
from app.services.db import _check_database_label


class _StubConn:
    def __init__(self, labels=None):
        self._labels = labels  # None -> no stackly_env table (like production)

    def execute(self, _sql):
        if self._labels is None:
            raise psycopg.errors.UndefinedTable("relation stackly_env does not exist")
        return [(label,) for label in self._labels]

    def rollback(self):
        pass


@pytest.fixture
def local(monkeypatch):
    monkeypatch.delenv("VERCEL", raising=False)
    monkeypatch.delenv("VERCEL_ENV", raising=False)


@pytest.fixture
def vercel(monkeypatch):
    def _set(env):
        monkeypatch.setenv("VERCEL", "1")
        monkeypatch.setenv("VERCEL_ENV", env)
    return _set


@pytest.mark.parametrize("labels", [None, [], ["prod"], ["staging"]])
def test_local_server_refuses_unlabelled_database(local, labels):
    with pytest.raises(RuntimeError, match="Refusing to start"):
        _check_database_label(_StubConn(labels))


@pytest.mark.parametrize("labels,expected", [(["dev"], "dev"), (["test"], "test")])
def test_local_server_accepts_dev_and_test(local, labels, expected):
    assert _check_database_label(_StubConn(labels)) == expected


def test_production_runs_on_unlabelled_database(vercel):
    vercel("production")
    assert _check_database_label(_StubConn(None)) == "production"


@pytest.mark.parametrize("labels", [["dev"], ["test"]])
def test_production_refuses_dev_and_test(vercel, labels):
    vercel("production")
    with pytest.raises(RuntimeError, match="production deployment is connected"):
        _check_database_label(_StubConn(labels))


def test_preview_may_use_dev(vercel):
    vercel("preview")
    assert _check_database_label(_StubConn(["dev"])) == "dev"


def test_stackly_database_url_wins(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql://integration-managed")
    monkeypatch.setenv("STACKLY_DATABASE_URL", "postgresql://main-branch")
    assert Settings(_env_file=None).effective_database_url == "postgresql://main-branch"
    monkeypatch.delenv("STACKLY_DATABASE_URL")
    assert Settings(_env_file=None).effective_database_url == "postgresql://integration-managed"
