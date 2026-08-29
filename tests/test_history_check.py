"""Tests de la logique pure de tools/history_check.py.

    python -m unittest discover -s tests

Stdlib seule (`unittest`), donc exécutables sur un poste nu ; `pytest` les ramasse
aussi tels quels s'il est installé un jour.

Règle suivie ici : **tout attendu est écrit en dur**. Un test qui recalcule son
attendu avec la fonction testée ne teste rien, et un test qui compte des éléments
ne dit rien de leur contenu — d'où des assertions sur des listes complètes.
Chaque contrôle a un cas qui passe ET un cas qui échoue : sans le second, la
suite reste verte même si la fonction ne regarde plus rien.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))

from history_check import (  # noqa: E402
    check_history,
    code_dirs_from,
    extract_section,
    files_mentioned_in,
    find_missing_dirs,
    find_missing_plan_dates,
    find_phantom_files,
    find_stale_footer,
    footer_date_in,
    format_report,
    plan_dates_in,
)

DOC = """# HISTORY

## 2. Stack technique

Python 3.11, Three.js.

## 3. Structure du dépôt

```
pipeline/
  fetch_gfs.py
web/src/
  main.js
  shaders/globe.frag
```

## 4. Architecture

Prose.

## 7. Historique par plan

| Date | Plan | Merge |
|---|---|---|
| 2026-09-01 | phase-1-pipeline | `abc1234` |
| 2026-09-04→06 | phase-2-globe | `def5678` |

## 9. État actuel

Rien.

---

**Dernière mise à jour :** 2026-09-06 (**phase 2 livrée**)
**Entrée précédente :** 2026-09-01 (**phase 1 livrée**)
"""


class ExtractSection(unittest.TestCase):
    def test_stops_at_next_heading(self) -> None:
        self.assertEqual(extract_section(DOC, "## 2.").strip(), "Python 3.11, Three.js.")

    def test_absent_section_is_empty(self) -> None:
        self.assertEqual(extract_section(DOC, "## 8."), "")

    def test_survives_crlf(self) -> None:
        """Le document peut arriver en CRLF (édition Windows, `core.autocrlf`).

        `splitlines()` coupe sur les deux ; un `split("\\n")` naïf laisserait un
        `\\r` traînant qui ferait échouer les `startswith("## ")` suivants.
        """
        self.assertEqual(
            extract_section(DOC.replace("\n", "\r\n"), "## 2.").strip(),
            "Python 3.11, Three.js.",
        )


class FilesMentioned(unittest.TestCase):
    def test_reads_the_tree_of_section_3(self) -> None:
        self.assertEqual(
            files_mentioned_in(extract_section(DOC, "## 3.")),
            ["fetch_gfs.py", "main.js", "shaders/globe.frag"],
        )

    def test_globs_are_excluded(self) -> None:
        self.assertEqual(files_mentioned_in("web/public/data/*.png et un.js"), ["un.js"])

    def test_brace_expansion_does_not_leak_a_phantom(self) -> None:
        """`{a,b}` est réduit à un glob AVANT le découpage.

        Sans cette réduction, l'accolade coupe le token et le contrôle
        remonterait un fantôme `,atmos}.frag` qui n'existe que dans son propre
        découpage.
        """
        self.assertEqual(files_mentioned_in("shaders/{globe,atmos}.frag"), [])

    def test_deduplicates_in_order_of_appearance(self) -> None:
        self.assertEqual(files_mentioned_in("a.py puis b.js puis a.py"), ["a.py", "b.js"])


class PhantomFiles(unittest.TestCase):
    REPO = ["pipeline/fetch_gfs.py", "web/src/main.js"]

    def test_present_files_are_silent(self) -> None:
        self.assertEqual(find_phantom_files(["fetch_gfs.py", "main.js"], self.REPO), [])

    def test_absent_file_is_reported(self) -> None:
        self.assertEqual(find_phantom_files(["globe.js"], self.REPO), ["globe.js"])

    def test_suffix_match_is_bounded_by_the_separator(self) -> None:
        """`ain.js` ne doit PAS être couvert par `web/src/main.js`."""
        self.assertEqual(find_phantom_files(["ain.js"], self.REPO), ["ain.js"])

    def test_backslash_paths_are_normalised(self) -> None:
        self.assertEqual(find_phantom_files(["main.js"], ["web\\src\\main.js"]), [])


class MissingDirs(unittest.TestCase):
    SECTION = extract_section(DOC, "## 3.")

    def test_named_dir_is_silent(self) -> None:
        self.assertEqual(find_missing_dirs(["shaders"], self.SECTION), [])

    def test_unnamed_dir_is_reported(self) -> None:
        self.assertEqual(find_missing_dirs(["colormap"], self.SECTION), ["colormap"])

    def test_trailing_slash_is_required(self) -> None:
        """« pipeline » en prose ne vaut pas la mention d'un dossier `pipeline/`."""
        self.assertEqual(find_missing_dirs(["pipeline"], "le pipeline tourne"), ["pipeline"])


class CodeDirs(unittest.TestCase):
    def test_root_and_direct_children_only(self) -> None:
        self.assertEqual(
            code_dirs_from(
                [
                    "web/src/main.js",
                    "web/src/shaders/globe.frag",
                    "web/src/shaders/deep/nested.frag",
                    "pipeline/fetch_gfs.py",
                    "README.md",
                ]
            ),
            ["pipeline", "shaders", "web/src"],
        )

    def test_gitignored_paths_never_appear(self) -> None:
        """Rien n'est lu sur le disque : ce qui n'est pas dans l'index n'existe pas."""
        self.assertEqual(code_dirs_from(["pipeline/fetch_gfs.py"]), ["pipeline"])

    def test_empty_root_is_silent(self) -> None:
        self.assertEqual(code_dirs_from(["docs/PLAN.md"]), [])


class PlanDates(unittest.TestCase):
    def test_reads_rows_and_expands_ranges(self) -> None:
        self.assertEqual(
            plan_dates_in(extract_section(DOC, "## 7.")),
            ["2026-09-01", "2026-09-04", "2026-09-05", "2026-09-06"],
        )

    def test_a_date_outside_a_row_is_ignored(self) -> None:
        self.assertEqual(plan_dates_in("mergé le 2026-09-01, sans ligne"), [])

    def test_missing_merge_is_reported(self) -> None:
        self.assertEqual(
            find_missing_plan_dates(["2026-09-01", "2026-09-30"], ["2026-09-01"]),
            ["2026-09-30"],
        )

    def test_two_merges_the_same_day_need_only_one_row(self) -> None:
        self.assertEqual(
            find_missing_plan_dates(["2026-09-01", "2026-09-01"], ["2026-09-01"]), []
        )


class Footer(unittest.TestCase):
    def test_reads_the_first_labelled_date(self) -> None:
        self.assertEqual(footer_date_in(DOC), "2026-09-06")

    def test_anchors_on_the_label_not_on_any_date(self) -> None:
        """Le corps du document est truffé de dates ; seule celle du libellé compte."""
        self.assertIsNone(footer_date_in("Livré le 2026-09-01.\n**Entrée précédente :** 2026-08-01"))

    def test_stale_footer_is_reported(self) -> None:
        stale = find_stale_footer("2026-09-01", "2026-09-06")
        self.assertIsNotNone(stale)
        assert stale is not None
        self.assertEqual((stale.footer_date, stale.last_commit_date), ("2026-09-01", "2026-09-06"))

    def test_up_to_date_footer_is_silent(self) -> None:
        self.assertIsNone(find_stale_footer("2026-09-06", "2026-09-06"))

    def test_footer_ahead_is_accepted(self) -> None:
        """Cas normal pendant qu'on édite le document avant de le commiter."""
        self.assertIsNone(find_stale_footer("2026-09-07", "2026-09-06"))

    def test_never_committed_document_has_nothing_to_compare(self) -> None:
        self.assertIsNone(find_stale_footer(None, None))

    def test_missing_footer_on_a_committed_document_is_reported(self) -> None:
        stale = find_stale_footer(None, "2026-09-06")
        self.assertIsNotNone(stale)
        assert stale is not None
        self.assertIsNone(stale.footer_date)


class EndToEnd(unittest.TestCase):
    REPO = ["pipeline/fetch_gfs.py", "web/src/main.js", "web/src/shaders/globe.frag"]

    def test_consistent_document_is_ok(self) -> None:
        report = check_history(
            doc=DOC,
            repo_files=self.REPO,
            dirs=["pipeline", "shaders", "web/src"],
            merge_dates=["2026-09-01", "2026-09-05"],
            last_history_commit_date="2026-09-06",
        )
        self.assertTrue(report.ok)
        self.assertEqual(
            format_report(report),
            "✓ HISTORY.md est à jour (§3, §7 et le pied de page concordent avec le dépôt).",
        )

    def test_every_drift_surfaces_at_once(self) -> None:
        report = check_history(
            doc=DOC,
            repo_files=["pipeline/fetch_gfs.py"],  # main.js et globe.frag supprimés
            dirs=["pipeline", "colormap"],  # colormap/ jamais décrit
            merge_dates=["2026-09-30"],  # merge sans ligne §7
            last_history_commit_date="2026-09-20",  # pied de page en retard
        )
        self.assertFalse(report.ok)
        self.assertEqual(report.phantom_files, ["main.js", "shaders/globe.frag"])
        self.assertEqual(report.missing_dirs, ["colormap"])
        self.assertEqual(report.missing_plan_dates, ["2026-09-30"])
        assert report.stale_footer is not None
        self.assertEqual(report.stale_footer.footer_date, "2026-09-06")

        rendered = format_report(report)
        for expected in ("main.js", "colormap", "2026-09-30", "annonce 2026-09-06"):
            self.assertIn(expected, rendered)


if __name__ == "__main__":
    unittest.main()
