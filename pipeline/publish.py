"""Écriture locale atomique et publication R2 (spec §4, §6). R2 parle S3 : boto3
sur l'endpoint Cloudflare, aucun SDK spécifique."""

from __future__ import annotations

import json
import logging
import os
import re
import shutil
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from pipeline import config

log = logging.getLogger(__name__)


class PublishError(Exception):
    """Échec d'upload : exit 4. R2 reste sur l'ancien couple ou PNG neuf + JSON ancien."""


@dataclass(frozen=True)
class Object:
    key: str
    body: bytes
    content_type: str
    cache_control: str = config.CACHE_CONTROL


@dataclass(frozen=True)
class R2Config:
    account_id: str
    access_key_id: str
    secret_access_key: str
    bucket: str

    ENV_KEYS = ("R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET")

    @classmethod
    def from_env(cls, env: Mapping[str, str] = os.environ) -> R2Config | None:
        """None dès qu'un secret manque ou est vide → dry-run implicite."""
        values = [env.get(k, "") for k in cls.ENV_KEYS]
        if not all(values):
            return None
        return cls(*values)

    @property
    def endpoint_url(self) -> str:
        return f"https://{self.account_id}.r2.cloudflarestorage.com"


def write_atomic(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_bytes(data)
    os.replace(tmp, path)


def _client(cfg: R2Config):
    import boto3  # import local : inutile en dry-run

    return boto3.client(
        "s3",
        endpoint_url=cfg.endpoint_url,
        aws_access_key_id=cfg.access_key_id,
        aws_secret_access_key=cfg.secret_access_key,
        region_name="auto",
    )


ClientFactory = Callable[[R2Config], object]


RUN_DIR = re.compile(r"^\d{8}T\d{2}Z$")


def _missing(exc: Exception) -> bool:
    """Objet absent (botocore ClientError NoSuchKey/404) : cas normal, pas un avertissement."""
    code = ((getattr(exc, "response", None) or {}).get("Error") or {}).get("Code")
    return code in ("NoSuchKey", "404")


def _check_run_dir(name: str) -> None:
    if not RUN_DIR.match(name):
        raise ValueError(f"dossier de run invalide : {name!r}")


class Store(Protocol):
    """Stockage du pipeline (spec lot E §3.2, §4) : R2 en production, dossier local en dry-run."""

    def get_json(self, key: str) -> dict | None: ...
    def put(self, objects: Sequence[Object]) -> None: ...
    def list_run_dirs(self) -> list[str]: ...
    def delete_run_dirs(self, names: Sequence[str]) -> int: ...


class R2Store:
    def __init__(self, cfg: R2Config, client_factory: ClientFactory = _client):
        self.cfg = cfg
        self._factory = client_factory
        self._client = None

    @property
    def client(self):
        if self._client is None:
            self._client = self._factory(self.cfg)
        return self._client

    def get_json(self, key: str) -> dict | None:
        """None si absent ou illisible : la reprise et le report chem sont un confort, pas une garde."""
        try:
            obj = self.client.get_object(Bucket=self.cfg.bucket, Key=key)
            data = json.loads(obj["Body"].read())
        except Exception as exc:
            if not _missing(exc):
                log.warning("%s non lu sur R2 (%s) : on continue", key, exc)
            return None
        return data if isinstance(data, dict) else None

    def put(self, objects: Sequence[Object]) -> None:
        """Dans l'ordre reçu ; s'arrête au premier échec."""
        for o in objects:
            try:
                self.client.put_object(
                    Bucket=self.cfg.bucket, Key=o.key, Body=o.body,
                    ContentType=o.content_type, CacheControl=o.cache_control,
                )
            except Exception as exc:
                raise PublishError(f"{o.key} : {exc}") from exc

    def _pages(self, **kw):
        token = None
        while True:
            args = {"Bucket": self.cfg.bucket, **kw}
            if token:
                args["ContinuationToken"] = token
            page = self.client.list_objects_v2(**args)
            yield page
            if not page.get("IsTruncated"):
                return
            token = page.get("NextContinuationToken")

    def list_run_dirs(self) -> list[str]:
        prefix = f"{config.LAYERS_PREFIX}/"
        names: list[str] = []
        for page in self._pages(Prefix=prefix, Delimiter="/"):
            for p in page.get("CommonPrefixes") or []:
                name = p["Prefix"][len(prefix):].rstrip("/")
                if RUN_DIR.match(name):
                    names.append(name)
        return sorted(names)

    def delete_run_dirs(self, names: Sequence[str]) -> int:
        """Tous les noms validés avant toute suppression. Par dossier, les fichiers de progression
        (`<source>.json` directement sous le dossier) partent d'abord, dans leur propre appel : une
        suppression interrompue ne laisse jamais une progression citant des PNG déjà supprimés."""
        for name in names:
            _check_run_dir(name)
        deleted = 0
        for name in names:
            prefix = f"{config.LAYERS_PREFIX}/{name}/"
            keys = [o["Key"] for page in self._pages(Prefix=prefix) for o in page.get("Contents") or []]
            is_progress = [k.endswith(".json") and "/" not in k[len(prefix):] for k in keys]
            progress = [k for k, p in zip(keys, is_progress) if p]
            rest = [k for k, p in zip(keys, is_progress) if not p]
            for group in (progress, rest):
                for i in range(0, len(group), 1000):  # limite de DeleteObjects
                    deleted += self._delete_batch(name, group[i:i + 1000])
        return deleted

    def _delete_batch(self, name: str, batch: Sequence[str]) -> int:
        """DeleteObjects répond 200 même quand des clés restent : elles sont listées dans `Errors`."""
        try:
            resp = self.client.delete_objects(
                Bucket=self.cfg.bucket, Delete={"Objects": [{"Key": k} for k in batch], "Quiet": True},
            )
        except Exception as exc:
            raise PublishError(f"suppression de {name} : {exc}") from exc
        errors = (resp or {}).get("Errors") or []
        if errors:
            first = errors[0]
            raise PublishError(
                f"suppression de {name} : {len(errors)} objet(s) non supprimé(s), "
                f"ex. {first.get('Key')} ({first.get('Code')} {first.get('Message')})"
            )
        return len(batch)


class LocalStore:
    """Store du dry-run : même contrat que R2Store, dans un dossier local (`out/`)."""

    def __init__(self, root: Path):
        self.root = root

    def get_json(self, key: str) -> dict | None:
        try:
            data = json.loads((self.root / key).read_text("utf-8"))
        except (OSError, ValueError):
            return None
        return data if isinstance(data, dict) else None

    def put(self, objects: Sequence[Object]) -> None:
        for o in objects:
            write_atomic(self.root / o.key, o.body)

    def list_run_dirs(self) -> list[str]:
        base = self.root / config.LAYERS_PREFIX
        if not base.is_dir():
            return []
        return sorted(p.name for p in base.iterdir() if p.is_dir() and RUN_DIR.match(p.name))

    def delete_run_dirs(self, names: Sequence[str]) -> int:
        """Même ordre que R2Store : noms validés d'abord, progression supprimée avant le reste."""
        for name in names:
            _check_run_dir(name)
        deleted = 0
        for name in names:
            d = self.root / config.LAYERS_PREFIX / name
            if d.is_dir():
                deleted += sum(1 for p in d.rglob("*") if p.is_file())
                for p in d.glob("*.json"):
                    if p.is_file():
                        p.unlink()
                shutil.rmtree(d)
        return deleted
