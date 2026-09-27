import json
from pathlib import Path

import pytest

from pipeline.publish import Object, PublishError, R2Config, read_current, upload_r2, write_atomic

ENV = {
    "R2_ACCOUNT_ID": "acc", "R2_ACCESS_KEY_ID": "key",
    "R2_SECRET_ACCESS_KEY": "secret", "R2_BUCKET": "worldtemp",
}


class FakeClient:
    """Enregistre les put_object ; peut échouer sur une clé donnée."""

    def __init__(self, fail_on: str | None = None, current: bytes | None = None):
        self.calls: list[dict] = []
        self.gets: list[str] = []
        self.fail_on = fail_on
        self.current = current

    def put_object(self, **kwargs):
        self.calls.append(kwargs)
        if kwargs["Key"] == self.fail_on:
            raise RuntimeError("boom")

    def get_object(self, **kwargs):
        self.gets.append(kwargs["Key"])
        if self.current is None:
            raise RuntimeError("NoSuchKey")
        return {"Body": _Body(self.current)}


class _Body:
    def __init__(self, data):
        self._data = data

    def read(self):
        return self._data


# --- write_atomic ---------------------------------------------------------

def test_write_atomic_creates_parents_and_leaves_no_temp(tmp_path: Path):
    target = tmp_path / "out" / "latest.png"
    write_atomic(target, b"abc")
    assert target.read_bytes() == b"abc"
    assert list((tmp_path / "out").iterdir()) == [target]


def test_write_atomic_overwrites(tmp_path: Path):
    target = tmp_path / "f"
    write_atomic(target, b"1")
    write_atomic(target, b"22")
    assert target.read_bytes() == b"22"


# --- R2Config -------------------------------------------------------------

def test_from_env_complete():
    cfg = R2Config.from_env(ENV)
    assert cfg == R2Config("acc", "key", "secret", "worldtemp")
    assert cfg.endpoint_url == "https://acc.r2.cloudflarestorage.com"


@pytest.mark.parametrize("missing", list(ENV))
def test_from_env_missing_any_secret_is_dry_run(missing):
    env = {k: v for k, v in ENV.items() if k != missing}
    assert R2Config.from_env(env) is None


def test_from_env_empty_value_is_dry_run():
    assert R2Config.from_env({**ENV, "R2_BUCKET": ""}) is None


# --- upload_r2 ------------------------------------------------------------

PNG = Object("layers/temp.png", b"png", "image/png")
JS = Object("layers/latest.json", b"{}", "application/json")


def test_upload_objects_in_order_with_headers():
    client = FakeClient()
    upload_r2(R2Config.from_env(ENV), [PNG, JS], client_factory=lambda cfg: client)
    assert [c["Key"] for c in client.calls] == ["layers/temp.png", "layers/latest.json"]
    png, js = client.calls
    assert png["Bucket"] == "worldtemp" and png["Body"] == b"png"
    assert png["ContentType"] == "image/png" and js["ContentType"] == "application/json"
    assert png["CacheControl"] == js["CacheControl"] == "public, max-age=300"


def test_upload_stops_at_first_failure():
    client = FakeClient(fail_on="layers/temp.png")
    with pytest.raises(PublishError):
        upload_r2(R2Config.from_env(ENV), [PNG, JS], client_factory=lambda cfg: client)
    assert [c["Key"] for c in client.calls] == ["layers/temp.png"]


def test_upload_last_failure_raises_publish_error():
    client = FakeClient(fail_on="layers/latest.json")
    with pytest.raises(PublishError):
        upload_r2(R2Config.from_env(ENV), [PNG, JS], client_factory=lambda cfg: client)


# --- read_current ---------------------------------------------------------

def test_read_current_reads_manifest_key_by_default():
    client = FakeClient(current=json.dumps({"schema_version": 2, "layers": {}}).encode())
    got = read_current(R2Config.from_env(ENV), client_factory=lambda cfg: client)
    assert got == {"schema_version": 2, "layers": {}}
    assert client.gets == ["layers/latest.json"]


def test_read_current_absent_or_broken_is_none():
    assert read_current(R2Config.from_env(ENV), client_factory=lambda cfg: FakeClient()) is None
    assert read_current(R2Config.from_env(ENV), client_factory=lambda cfg: FakeClient(current=b"{not json")) is None


import logging

from pipeline import config
from pipeline.publish import RUN_DIR, LocalStore, R2Store


class _NoSuchKey(Exception):
    response = {"Error": {"Code": "NoSuchKey"}}


class FakeS3:
    """S3 minimal en mémoire : get/put/list (pagination, délimiteur)/delete."""

    def __init__(self, keys=(), page_size=1000, fail_put: str | None = None, fail_delete=False):
        self.objects: dict[str, bytes] = {k: b"x" for k in keys}
        self.page_size = page_size
        self.fail_put = fail_put
        self.fail_delete = fail_delete
        self.puts: list[dict] = []
        self.deletes: list[list[str]] = []

    def get_object(self, Bucket, Key):
        if Key not in self.objects:
            raise _NoSuchKey(Key)
        return {"Body": _Body(self.objects[Key])}

    def put_object(self, **kw):
        self.puts.append(kw)
        if kw["Key"] == self.fail_put:
            raise RuntimeError("boom")
        self.objects[kw["Key"]] = kw["Body"]

    def list_objects_v2(self, Bucket, Prefix="", Delimiter=None, ContinuationToken=None):
        keys = sorted(k for k in self.objects if k.startswith(Prefix))
        if Delimiter:
            rests = [k[len(Prefix):] for k in keys]
            entries = [{"Prefix": p} for p in sorted({Prefix + r.split(Delimiter)[0] + Delimiter for r in rests if Delimiter in r})]
            kind = "CommonPrefixes"
        else:
            entries = [{"Key": k} for k in keys]
            kind = "Contents"
        start = int(ContinuationToken or 0)
        out = {kind: entries[start:start + self.page_size], "IsTruncated": start + self.page_size < len(entries)}
        if out["IsTruncated"]:
            out["NextContinuationToken"] = str(start + self.page_size)
        return out

    def delete_objects(self, Bucket, Delete):
        if self.fail_delete:
            raise RuntimeError("boom")
        keys = [o["Key"] for o in Delete["Objects"]]
        self.deletes.append(keys)
        for k in keys:
            self.objects.pop(k, None)


def r2(s3: FakeS3) -> R2Store:
    return R2Store(R2Config.from_env(ENV), client_factory=lambda cfg: s3)


# --- R2Store ------------------------------------------------------------------

def test_r2_get_json_absent_is_none_without_warning(caplog):
    with caplog.at_level(logging.WARNING):
        assert r2(FakeS3()).get_json("layers/forecast.json") is None
    assert caplog.records == []


def test_r2_get_json_broken_is_none_with_warning(caplog):
    s3 = FakeS3()
    s3.objects["layers/forecast.json"] = b"{pas du json"
    with caplog.at_level(logging.WARNING):
        assert r2(s3).get_json("layers/forecast.json") is None
    assert any("forecast.json" in r.getMessage() for r in caplog.records)


def test_r2_get_json_reads_a_dict():
    s3 = FakeS3()
    s3.objects["k.json"] = b'{"a": 1}'
    assert r2(s3).get_json("k.json") == {"a": 1}


def test_r2_put_uses_cache_control_of_each_object():
    s3 = FakeS3()
    r2(s3).put([Object("layers/20260912T06Z/temp_f003.png", b"png", "image/png", config.CACHE_IMMUTABLE),
                Object("layers/forecast.json", b"{}", "application/json")])
    assert [p["CacheControl"] for p in s3.puts] == [config.CACHE_IMMUTABLE, config.CACHE_CONTROL]
    assert s3.puts[0]["ContentType"] == "image/png" and s3.puts[0]["Bucket"] == "worldtemp"


def test_r2_put_failure_is_publish_error():
    with pytest.raises(PublishError):
        r2(FakeS3(fail_put="b")).put([Object("a", b"", "x"), Object("b", b"", "x"), Object("c", b"", "x")])


def test_r2_list_run_dirs_paginates_and_keeps_run_dirs_only():
    s3 = FakeS3(["layers/20260912T06Z/temp_f003.png", "layers/20260912T00Z/gfs.json", "layers/latest.json",
                 "layers/temp.png", "layers/tmp/x.png", "tiles/v1/manifest.json"], page_size=1)
    assert r2(s3).list_run_dirs() == ["20260912T00Z", "20260912T06Z"]


def test_r2_delete_run_dirs_deletes_that_prefix_only_in_batches():
    keys = [f"layers/20260911T12Z/l{i}.png" for i in range(1500)] + ["layers/20260912T06Z/temp_f003.png", "layers/latest.json"]
    s3 = FakeS3(keys, page_size=400)
    assert r2(s3).delete_run_dirs(["20260911T12Z"]) == 1500
    assert [len(d) for d in s3.deletes] == [1000, 500]
    assert set(s3.objects) == {"layers/20260912T06Z/temp_f003.png", "layers/latest.json"}


def test_r2_delete_run_dirs_rejects_other_names():
    with pytest.raises(ValueError):
        r2(FakeS3()).delete_run_dirs(["tmp"])


def test_r2_delete_failure_is_publish_error():
    with pytest.raises(PublishError):
        r2(FakeS3(["layers/20260911T12Z/a.png"], fail_delete=True)).delete_run_dirs(["20260911T12Z"])


def test_run_dir_pattern():
    assert RUN_DIR.match("20260912T06Z") and not RUN_DIR.match("20260912T6Z") and not RUN_DIR.match("latest.json")


# --- LocalStore ---------------------------------------------------------------

def test_local_store_round_trip(tmp_path: Path):
    s = LocalStore(tmp_path)
    assert s.get_json("layers/forecast.json") is None and s.list_run_dirs() == []
    s.put([Object("layers/20260912T06Z/temp_f003.png", b"png", "image/png"),
           Object("layers/20260912T06Z/gfs.json", b'{"run": "x"}', "application/json"),
           Object("layers/forecast.json", b'{"schema_version": 3}', "application/json")])
    assert s.get_json("layers/20260912T06Z/gfs.json") == {"run": "x"}
    assert s.list_run_dirs() == ["20260912T06Z"]
    assert s.delete_run_dirs(["20260912T06Z"]) == 2
    assert s.list_run_dirs() == [] and (tmp_path / "layers/forecast.json").exists()


def test_local_store_broken_json_is_none(tmp_path: Path):
    (tmp_path / "k.json").write_text("{", "utf-8")
    assert LocalStore(tmp_path).get_json("k.json") is None
