"""The local-server guard in db.init_db (no database needed: stub connection)."""
import psycopg
import pytest

from app.services.db import _refuse_unlabelled_database_locally


class _StubConn:
    def __init__(self, labels=None):
        self._labels = labels  # None -> no stackly_env table (like production)
        self.rolled_back = False

    def execute(self, _sql):
        if self._labels is None:
            raise psycopg.errors.UndefinedTable("relation stackly_env does not exist")
        return [(label,) for label in self._labels]

    def rollback(self):
        self.rolled_back = True


@pytest.fixture(autouse=True)
def not_on_vercel(monkeypatch):
    monkeypatch.delenv("VERCEL", raising=False)


@pytest.mark.parametrize("labels", [None, [], ["prod"], ["staging"]])
def test_local_server_refuses_unlabelled_database(labels):
    with pytest.raises(RuntimeError, match="Refusing to start"):
        _refuse_unlabelled_database_locally(_StubConn(labels))


@pytest.mark.parametrize("labels", [["dev"], ["test"]])
def test_local_server_accepts_dev_and_test(labels):
    _refuse_unlabelled_database_locally(_StubConn(labels))


def test_vercel_deployments_are_exempt(monkeypatch):
    monkeypatch.setenv("VERCEL", "1")
    _refuse_unlabelled_database_locally(_StubConn(None))
