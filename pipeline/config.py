"""Constantes du pipeline. Les plages d'encodage vivent dans layers.py ; le front
ne recopie rien, il lit `encoding` et `grid` dans le manifeste (spec couches §7)."""

from datetime import timedelta

# Grille GFS / GEFS 0,25°
WIDTH = 1440
HEIGHT = 721

# Sélection du run : défauts de la source primaire (sources.GFS les reprend)
RUN_AVAILABILITY_DELAY = timedelta(hours=3, minutes=30)
MAX_CANDIDATES = 4
MAX_FORECAST_HOUR = 48

# HTTP
HTTP_TIMEOUT_S = 60
RETRY_DELAY_S = 30

# R2 (spec couches §7)
LAYERS_PREFIX = "layers"
MANIFEST_KEY = "layers/latest.json"
LEGACY_PNG_KEY = "gfs/latest.png"
LEGACY_JSON_KEY = "gfs/latest.json"
CACHE_CONTROL = "public, max-age=300"

SCHEMA_VERSION = 2
LEGACY_SCHEMA_VERSION = 1
