"""Écriture locale atomique et publication R2 (spec §4, §6). R2 parle S3 : boto3
sur l'endpoint Cloudflare, aucun SDK spécifique."""

from __future__ import annotations

import json
import logging
import os
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path

from pipeline import config

log = logging.getLogger(__name__)


class PublishError(Exception):
    """Échec d'upload : exit 4. R2 reste sur l'ancien couple ou PNG neuf + JSON ancien."""


@dataclass(frozen=True)
class Object:
    key: str
    body: bytes
    content_type: str


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


def read_current(cfg: R2Config, key: str = config.MANIFEST_KEY, client_factory: ClientFactory = _client) -> dict | None:
    """Manifeste actuellement publié, ou None s'il est absent ou illisible.
    L'idempotence et le report chem sont un confort, pas une garde : toute erreur → None."""
    try:
        obj = client_factory(cfg).get_object(Bucket=cfg.bucket, Key=key)
        return json.loads(obj["Body"].read())
    except Exception as exc:  # NoSuchKey, réseau, droits, JSON cassé
        log.warning("%s non lu sur R2 (%s) : on continue", key, exc)
        return None


def upload_r2(cfg: R2Config, objects: Sequence[Object], client_factory: ClientFactory = _client) -> None:
    """Dans l'ordre reçu ; main.py met le manifeste en dernier (spec §8) : la seule
    incohérence possible est « PNG neuf + manifeste ancien », invisible côté front."""
    client = client_factory(cfg)
    for o in objects:
        try:
            client.put_object(
                Bucket=cfg.bucket, Key=o.key, Body=o.body,
                ContentType=o.content_type, CacheControl=config.CACHE_CONTROL,
            )
        except Exception as exc:
            raise PublishError(f"{o.key} : {exc}") from exc
