#!/usr/bin/env python3
"""Vérification mécanique de HISTORY.md contre le dépôt réel.

    python tools/history_check.py

Pourquoi ce contrôle existe : §3 (« Structure du dépôt ») est la SEULE section de
type « état courant » d'un document par ailleurs append-only — elle se périme donc
à chaque commit, en silence, alors que les autres sections gardent un passé qui
reste vrai. Même famille de dérive pour §7 (tableau des plans livrés) et pour le
pied de page « Dernière mise à jour ». Ce qui ne se compare à rien se périme sans
protester, quelle que soit la discipline de qui l'écrit.

Ce que ça attrape :
  - un fichier documenté en §3 puis supprimé ou déplacé ;
  - un dossier de code créé mais jamais décrit en §3 ;
  - une branche mergée sans ligne au tableau §7 ;
  - un pied de page resté en arrière du dernier commit du document.

Ce que ça n'attrape pas : §2, §5, §6, §8, §9 — elles relèvent du jugement, pas de
la comparaison. C'est la procédure du skill `updating-history` qui les couvre.

Zéro dépendance : stdlib seule. Les fonctions du haut sont pures et testées par
tests/test_history_check.py ; l'IO (git, disque) vit dans la seconde moitié.
"""

from __future__ import annotations

import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DOC_NAME = "HISTORY.md"

# Racines de code dont §3 doit nommer les sous-dossiers. Elles suivent la
# structure du plan (docs/PLAN.md) ; une racine encore inexistante est ignorée
# sans bruit, ce qui laisse le contrôle vert sur un dépôt qui démarre.
CODE_ROOTS = ("pipeline", "tiler", "web/src", "tools", "tests")

# Extensions du projet : Python côté pipeline, JS/GLSL côté web, plus les formats
# de données et de configuration. Une extension absente d'ici est simplement
# ignorée par le contrôle des fichiers fantômes.
FILE_TOKEN = re.compile(
    r"[\w@\[\]./-]+\."
    r"(?:py|js|mjs|ts|glsl|vert|frag|json|md|html|css|yml|yaml|toml|cfg|txt|png|ico)\b"
)

PLAN_ROW = re.compile(r"^\|\s*(\d{4})-(\d{2})-(\d{2})(?:→(\d{2}))?", re.MULTILINE)

FOOTER_DATE = re.compile(r"\*\*Dernière mise à jour\s*:\*\*\s*(\d{4}-\d{2}-\d{2})")


# --------------------------------------------------------------------------- #
# Logique pure                                                                 #
# --------------------------------------------------------------------------- #


@dataclass(frozen=True)
class StaleFooter:
    """Pied de page en retard. `footer_date` est None s'il n'y en avait aucun."""

    footer_date: str | None
    last_commit_date: str


@dataclass(frozen=True)
class HistoryReport:
    phantom_files: list[str]
    missing_dirs: list[str]
    missing_plan_dates: list[str]
    stale_footer: StaleFooter | None

    @property
    def ok(self) -> bool:
        return (
            not self.phantom_files
            and not self.missing_dirs
            and not self.missing_plan_dates
            and self.stale_footer is None
        )


def extract_section(doc: str, heading: str) -> str:
    """Corps d'une section, du titre donné jusqu'au prochain `## `. Vide si absente."""
    lines = doc.splitlines()
    start = next((i for i, line in enumerate(lines) if line.startswith(heading)), None)
    if start is None:
        return ""
    rest = lines[start + 1 :]
    end = next((i for i, line in enumerate(rest) if line.startswith("## ")), None)
    return "\n".join(rest if end is None else rest[:end])


def files_mentioned_in(section: str) -> list[str]:
    """Tokens de fichier cités dans une section, dédupliqués, ordre d'apparition.

    Les globs sont exclus : invérifiables. Une expansion d'accolades
    (`shaders/{globe,atmos}.frag`) est d'abord réduite à un glob — sans ça,
    l'accolade coupe le token et on remonterait un fantôme `,atmos}.frag` qui
    n'existe que dans notre propre découpage.
    """
    flattened = re.sub(r"\{[^}]*\}", "*", section)
    seen: dict[str, None] = {}
    for token in FILE_TOKEN.findall(flattened):
        if "*" not in token and not token.startswith("/"):
            seen.setdefault(token, None)
    return list(seen)


def find_phantom_files(mentioned: list[str], repo_files: list[str]) -> list[str]:
    """Tokens qu'aucun chemin du dépôt ne satisfait.

    Un token est satisfait si un chemin lui est égal ou se termine par
    `/<token>` — la borne sur le séparateur évite qu'un `lobe.js` soit couvert
    par `globe.js`.
    """
    paths = [p.replace("\\", "/") for p in repo_files]
    return [
        token
        for token in mentioned
        if not any(p == token or p.endswith("/" + token) for p in paths)
    ]


def find_missing_dirs(dirs: list[str], section: str) -> list[str]:
    """Dossiers que la section ne nomme jamais (on cherche `nom/`, comme dans l'arbre)."""
    return [d for d in dirs if (d + "/") not in section]


def plan_dates_in(section: str) -> list[str]:
    """Dates ouvrant une ligne de tableau (`| 2026-09-01 | …`).

    Une plage écrite `2026-09-01→03` couvre les trois jours : sans cette
    expansion, le merge du 3 serait signalé manquant alors que sa ligne existe.
    """
    dates: dict[str, None] = {}
    for year, month, day_from, day_to in PLAN_ROW.findall(section):
        last = int(day_to) if day_to else int(day_from)
        for day in range(int(day_from), last + 1):
            dates.setdefault(f"{year}-{month}-{day:02d}", None)
    return list(dates)


def find_missing_plan_dates(merge_dates: list[str], plan_dates: list[str]) -> list[str]:
    """Merges sans ligne correspondante.

    La comparaison porte sur la DATE, pas sur le commit : deux merges le même
    jour se rangent légitimement sous une seule ligne, sinon le contrôle
    resterait rouge en permanence et finirait ignoré.
    """
    known = set(plan_dates)
    missing: dict[str, None] = {}
    for date in merge_dates:
        if date not in known:
            missing.setdefault(date, None)
    return list(missing)


def footer_date_in(doc: str) -> str | None:
    """Date ouvrant « **Dernière mise à jour :** », ou None.

    L'ancre sur le libellé est obligatoire : le pied de page enchaîne cette
    mention et des « **Entrée précédente :** » datées, donc chercher la première
    date du document rendrait n'importe quoi.
    """
    match = FOOTER_DATE.search(doc)
    return match.group(1) if match else None


def find_stale_footer(
    footer_date: str | None, last_commit_date: str | None
) -> StaleFooter | None:
    """Le pied de page est-il en retard sur le document qu'il date ?

    La comparaison porte sur le DERNIER COMMIT DU DOCUMENT, pas sur la date du
    jour : le contrôle reste déterministe (aucune horloge, aucun état de working
    tree) et ne vire pas au rouge sur une correction de coquille. Le prix est une
    latence d'un commit — une modification commitée sans toucher au pied de page
    n'est signalée qu'à l'exécution SUIVANTE. Assez pour la dérive visée, qui se
    compte en semaines. ⇒ Bumper le pied de page DANS le même commit.

    Un dépôt qui n'a jamais commité le document n'a rien à comparer : None.
    Une date en avance est acceptée — c'est le cas normal pendant qu'on édite
    avant de commiter.
    """
    if last_commit_date is None:
        return None
    # Comparaison lexicographique : valide sur de l'ISO 8601 zéro-padé, et sans
    # datetime.strptime qui n'apporterait rien ici.
    if footer_date is not None and footer_date >= last_commit_date:
        return None
    return StaleFooter(footer_date=footer_date, last_commit_date=last_commit_date)


def code_dirs_from(repo_files: list[str], roots: tuple[str, ...] = CODE_ROOTS) -> list[str]:
    """Dossiers dont §3 doit parler, dérivés de l'index git plutôt que du disque.

    Deux conséquences voulues : tout ce qui est gitignoré (`node_modules/`,
    `.venv/`, les textures générées) n'est jamais réclamé au document, et une
    racine encore vide ne produit aucun bruit.

    Rendu : la racine elle-même dès qu'elle porte un fichier, plus ses
    sous-dossiers DIRECTS, par nom court. La profondeur s'arrête là — un arbre
    §3 nomme les branches, pas chaque feuille.
    """
    paths = [p.replace("\\", "/") for p in repo_files]
    found: dict[str, None] = {}
    for root in roots:
        prefix = root + "/"
        for path in paths:
            if not path.startswith(prefix):
                continue
            found.setdefault(root, None)
            rest = path[len(prefix) :]
            if "/" in rest:
                found.setdefault(rest.split("/", 1)[0], None)
    return sorted(found)


def check_history(
    doc: str,
    repo_files: list[str],
    dirs: list[str],
    merge_dates: list[str],
    last_history_commit_date: str | None = None,
) -> HistoryReport:
    section3 = extract_section(doc, "## 3.")
    section7 = extract_section(doc, "## 7.")

    return HistoryReport(
        phantom_files=find_phantom_files(files_mentioned_in(section3), repo_files),
        missing_dirs=find_missing_dirs(dirs, section3),
        missing_plan_dates=find_missing_plan_dates(merge_dates, plan_dates_in(section7)),
        stale_footer=find_stale_footer(footer_date_in(doc), last_history_commit_date),
    )


def format_report(report: HistoryReport) -> str:
    if report.ok:
        return "✓ HISTORY.md est à jour (§3, §7 et le pied de page concordent avec le dépôt)."

    lines: list[str] = []
    if report.phantom_files:
        lines.append("✗ §3 : fichiers cités mais introuvables dans le dépôt")
        lines.extend(f"    {f}" for f in report.phantom_files)
    if report.missing_dirs:
        lines.append("✗ §3 : dossiers du dépôt absents du document")
        lines.append("    " + ", ".join(report.missing_dirs))
    if report.missing_plan_dates:
        lines.append("✗ §7 : merges de branche sans ligne au tableau")
        lines.append("    " + ", ".join(report.missing_plan_dates))
    if report.stale_footer is not None:
        footer = report.stale_footer
        lines.append("✗ pied de page : « Dernière mise à jour » en retard sur le document")
        lines.append(
            f"    aucune date trouvée, dernier commit du document le {footer.last_commit_date}"
            if footer.footer_date is None
            else f"    annonce {footer.footer_date}, dernier commit du document le {footer.last_commit_date}"
        )
    return "\n".join(lines)


# --------------------------------------------------------------------------- #
# IO                                                                           #
# --------------------------------------------------------------------------- #


def git(*args: str) -> str:
    return subprocess.run(
        ["git", *args],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=True,
    ).stdout


def has_commits() -> bool:
    """Le dépôt a-t-il au moins un commit ?

    Un dépôt fraîchement `git init`é n'a pas de HEAD, et TOUT `git log` y sort en
    128. Le tester explicitement plutôt que d'avaler l'erreur garde `check=True`
    sur les autres appels : un vrai échec de git doit rester bruyant.
    """
    return (
        subprocess.run(
            ["git", "rev-parse", "--verify", "HEAD"],
            cwd=REPO_ROOT,
            capture_output=True,
        ).returncode
        == 0
    )


def main() -> int:
    doc_path = REPO_ROOT / DOC_NAME
    if not doc_path.exists():
        print(f"✗ {DOC_NAME} introuvable à la racine du dépôt ({REPO_ROOT}).")
        return 1

    # `git ls-files` lit l'INDEX, pas HEAD : un fichier ajouté mais pas encore
    # commité compte déjà, ce qui est le comportement voulu pendant une session.
    repo_files = [line for line in git("ls-files").splitlines() if line]

    # Sur un dépôt vierge il n'y a ni merge ni commit du document : les deux
    # contrôles correspondants n'ont simplement rien à comparer.
    if has_commits():
        # Merges sur la première ligne d'ascendance = un plan livré.
        merge_dates = [
            line
            for line in git(
                "log", "--merges", "--first-parent", "--format=%ad", "--date=short"
            ).splitlines()
            if line
        ]
        # `-1` suffit : seule la date la plus récente compte. Vide si le document
        # n'a jamais été commité — find_stale_footer traite alors le cas comme
        # « rien à comparer ».
        last_commit = git(
            "log", "-1", "--format=%ad", "--date=short", "--", DOC_NAME
        ).strip()
    else:
        merge_dates = []
        last_commit = ""

    report = check_history(
        doc=doc_path.read_text(encoding="utf-8"),
        repo_files=repo_files,
        dirs=code_dirs_from(repo_files),
        merge_dates=merge_dates,
        last_history_commit_date=last_commit or None,
    )

    print(format_report(report))
    if not report.ok:
        print(
            "\nMettre à jour HISTORY.md (voir sa §10), "
            "puis relancer `python tools/history_check.py`."
        )
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
