"""Constantes du pipeline. Source de vérité côté Python de l'encodage ; le front
ne recopie rien, il lit `encoding` et `grid` dans latest.json (spec §4)."""

from datetime import timedelta

# Encodage température (spec §4) : pixel = round((T_c - MIN_C) / (MAX_C - MIN_C) * 255)
MIN_C = -90
MAX_C = 60

# Grille GFS 0,25° (spec §4)
WIDTH = 1440
HEIGHT = 721

# Plage Kelvin plausible pour la validation (spec §6)
MIN_K = 180.0
MAX_K = 340.0

# Sélection du run (spec §3)
RUN_AVAILABILITY_DELAY = timedelta(hours=3, minutes=30)
MAX_CANDIDATES = 4
MAX_FORECAST_HOUR = 48

# NOMADS (spec §3)
NOMADS_FILTER_URL = "https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p25_1hr.pl"
HTTP_TIMEOUT_S = 60
RETRY_DELAY_S = 30

# R2 (spec §4)
PNG_KEY = "gfs/latest.png"
JSON_KEY = "gfs/latest.json"
CACHE_CONTROL = "public, max-age=300"

SCHEMA_VERSION = 1
