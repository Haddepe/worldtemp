"""Constantes du pipeline. Les plages d'encodage vivent dans layers.py ; le front
ne recopie rien, il lit `encoding` et `grid` dans le manifeste (spec couches §7)."""

# Grille GFS / GEFS 0,25°
WIDTH = 1440
HEIGHT = 721

# Frise des prévisions (spec lot E §3.1) : f003 → f060 au pas de 3 h, soit 20 échéances.
# f060 garantit 48 h devant « maintenant » pendant toute la vie d'un run (jusqu'à ~12 h d'âge).
FRAME_FIRST = 3
FRAME_LAST = 60
FRAME_STEP_HOURS = 3
FRAME_HOURS: tuple[int, ...] = tuple(range(FRAME_FIRST, FRAME_LAST + 1, FRAME_STEP_HOURS))

# HTTP
HTTP_TIMEOUT_S = 60
RETRY_DELAY_S = 30

# R2 (spec couches §7 ; legacy gfs/latest.* retiré par la spec vent §5)
LAYERS_PREFIX = "layers"
CACHE_CONTROL = "public, max-age=300"
CACHE_IMMUTABLE = "public, max-age=31536000, immutable"  # PNG d'échéance : son URL n'est jamais réécrite

# Manifeste v3 (spec lot E §4)
FORECAST_KEY = "layers/forecast.json"
FORECAST_SCHEMA_VERSION = 3
