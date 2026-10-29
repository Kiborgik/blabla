import contextlib
import io
import subprocess
import tempfile
import unittest
from pathlib import Path

from check_text import check_links, check_versions, main
from gate import STEPS, checks

VERSIONED_TREE = {
    "Cargo.toml": '[package]\nname = "blabla"\nversion = "1.2.3"\n',
    ".claude-plugin/plugin.json": '{\n  "version": "1.2.3"\n}\n',
    "CITATION.cff": "cff-version: 1.2.0\ntitle: blabla\nversion: 1.2.3\n",
    ".github/ISSUE_TEMPLATE/bug.yml": "placeholder: blabla 1.2.3\n",
    ".github/ISSUE_TEMPLATE/false-green.yml": "placeholder: blabla 1.2.3\n",
}


def write_tree(root, files):
    for path, text in files.items():
        target = root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text, encoding="utf-8")
    return set(files)


def tracked_tree(root, files):
    write_tree(root, files)
    subprocess.run(["git", "-C", str(root), "init", "-q"], check=True)
    subprocess.run(["git", "-C", str(root), "add", "-A"], check=True)


def quiet_main(argv, root):
    with contextlib.redirect_stdout(io.StringIO()):
        return main(argv, root)


class TempTree(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)


class LinkTargets(TempTree):
    def test_a_resolving_link_and_anchor_pass(self):
        tracked = write_tree(self.root, {"README.md": "See [guide](docs/guide.md#setup).\n", "docs/guide.md": "# Setup\n"})
        self.assertEqual(check_links(self.root, tracked), [])

    def test_a_missing_target_file_is_reported(self):
        tracked = write_tree(self.root, {"README.md": "See [x](docs/absent.md).\n"})
        self.assertEqual(check_links(self.root, tracked), [("README.md", "docs/absent.md", "missing-target")])

    def test_a_missing_anchor_in_a_linked_file_is_reported(self):
        tracked = write_tree(self.root, {"README.md": "[x](docs/guide.md#nowhere)\n", "docs/guide.md": "# Setup\n"})
        self.assertEqual(check_links(self.root, tracked), [("README.md", "docs/guide.md#nowhere", "missing-anchor")])

    def test_a_same_file_anchor_resolves_against_its_own_headings(self):
        tracked = write_tree(self.root, {"README.md": "# Title\n\n[up](#title) and [bad](#gone)\n"})
        self.assertEqual(check_links(self.root, tracked), [("README.md", "#gone", "missing-anchor")])

    def test_duplicate_headings_get_numbered_anchors(self):
        tracked = write_tree(self.root, {"README.md": "## Notes\n\n## Notes\n\n[second](#notes-1) [third](#notes-2)\n"})
        self.assertEqual(check_links(self.root, tracked), [("README.md", "#notes-2", "missing-anchor")])

    def test_github_slugs_drop_punctuation_and_keep_each_space_as_a_hyphen(self):
        tracked = write_tree(self.root, {"README.md": "## Exit codes: 0 & 1\n\n[x](#exit-codes-0--1)\n"})
        self.assertEqual(check_links(self.root, tracked), [])

    def test_a_root_relative_link_resolves_from_the_root(self):
        tracked = write_tree(self.root, {"docs/a.md": "[home](/README.md)\n", "README.md": "# Home\n"})
        self.assertEqual(check_links(self.root, tracked), [])

    def test_external_and_mail_links_are_not_resolved(self):
        tracked = write_tree(self.root, {"README.md": "[a](https://example.com/missing) [b](mailto:someone@example.com)\n"})
        self.assertEqual(check_links(self.root, tracked), [])

    def test_links_inside_code_fences_and_code_spans_are_ignored(self):
        tracked = write_tree(self.root, {"README.md": "`[x](nowhere.md)`\n\n```\n[y](gone.md)\n```\n"})
        self.assertEqual(check_links(self.root, tracked), [])

    def test_a_link_after_a_closed_fence_is_still_checked(self):
        tracked = write_tree(self.root, {"README.md": "```\n[y](gone.md)\n```\n\n[z](absent.md)\n"})
        self.assertEqual(check_links(self.root, tracked), [("README.md", "absent.md", "missing-target")])

    def test_a_tilde_fence_is_not_closed_by_a_backtick_fence(self):
        tracked = write_tree(self.root, {"README.md": "~~~\n```\n[y](gone.md)\n~~~\n\n[z](absent.md)\n"})
        self.assertEqual(check_links(self.root, tracked), [("README.md", "absent.md", "missing-target")])

    def test_a_shorter_fence_line_does_not_close_a_longer_fence(self):
        tracked = write_tree(self.root, {"README.md": "````\n```\n[y](gone.md)\n```\n````\n[z](absent.md)\n"})
        self.assertEqual(check_links(self.root, tracked), [("README.md", "absent.md", "missing-target")])

    def test_a_directory_target_resolves_when_a_tracked_file_lies_under_it(self):
        tracked = write_tree(self.root, {"README.md": "[docs](docs)\n", "docs/guide.md": "# G\n"})
        self.assertEqual(check_links(self.root, tracked), [])

    def test_a_case_mismatched_target_is_missing_even_when_the_disk_matches(self):
        tracked = write_tree(self.root, {"README.md": "[x](Docs/Guide.md)\n", "docs/guide.md": "# Setup\n"})
        self.assertEqual(check_links(self.root, tracked), [("README.md", "Docs/Guide.md", "missing-target")])

    def test_an_untracked_file_on_disk_is_not_a_target(self):
        tracked = write_tree(self.root, {"README.md": "[x](docs/draft.md)\n", "docs/draft.md": "# Draft\n"})
        tracked.discard("docs/draft.md")
        self.assertEqual(check_links(self.root, tracked), [("README.md", "docs/draft.md", "missing-target")])

    def test_an_angle_bracket_target_resolves_its_inner_path(self):
        tracked = write_tree(self.root, {"README.md": "[x](<a b.md>)\n", "a b.md": "# A\n"})
        self.assertEqual(check_links(self.root, tracked), [])

    def test_a_missing_angle_bracket_target_is_reported_by_its_inner_path(self):
        tracked = write_tree(self.root, {"README.md": "[x](<a b.md>)\n"})
        self.assertEqual(check_links(self.root, tracked), [("README.md", "a b.md", "missing-target")])

    def test_a_query_suffix_is_dropped_before_resolving(self):
        tracked = write_tree(self.root, {"README.md": "[x](docs/guide.md?plain=1#setup)\n", "docs/guide.md": "# Setup\n"})
        self.assertEqual(check_links(self.root, tracked), [])

    def test_a_url_encoded_path_resolves_to_the_decoded_file(self):
        tracked = write_tree(self.root, {"README.md": "[x](my%20guide.md)\n", "my guide.md": "# Guide\n"})
        self.assertEqual(check_links(self.root, tracked), [])

    def test_an_angle_bracket_external_link_is_not_resolved(self):
        tracked = write_tree(self.root, {"README.md": "[a](<https://example.com/x>)\n"})
        self.assertEqual(check_links(self.root, tracked), [])


class VersionMirrors(TempTree):
    def test_every_declared_mirror_at_the_package_version_passes(self):
        write_tree(self.root, VERSIONED_TREE)
        self.assertEqual(check_versions(self.root), [])

    def test_a_mirror_with_another_version_is_reported(self):
        write_tree(self.root, {**VERSIONED_TREE, ".claude-plugin/plugin.json": '{\n  "version": "1.2.2"\n}\n'})
        self.assertEqual(check_versions(self.root), [(".claude-plugin/plugin.json", "1.2.2", "version-mismatch")])

    def test_an_issue_template_placeholder_behind_the_package_version_is_reported(self):
        write_tree(self.root, {**VERSIONED_TREE, ".github/ISSUE_TEMPLATE/bug.yml": "placeholder: blabla 1.2.0\n"})
        self.assertEqual(check_versions(self.root), [(".github/ISSUE_TEMPLATE/bug.yml", "1.2.0", "version-mismatch")])

    def test_a_mirror_file_that_is_absent_is_reported(self):
        tree = {path: text for path, text in VERSIONED_TREE.items() if path != "CITATION.cff"}
        write_tree(self.root, tree)
        self.assertEqual(check_versions(self.root), [("CITATION.cff", "", "file-missing")])

    def test_a_mirror_without_a_version_line_is_reported(self):
        write_tree(self.root, {**VERSIONED_TREE, "CITATION.cff": "title: blabla\n"})
        self.assertEqual(check_versions(self.root), [("CITATION.cff", "", "version-missing")])

    def test_a_quoted_citation_version_matching_the_package_passes(self):
        write_tree(self.root, {**VERSIONED_TREE, "CITATION.cff": 'cff-version: 1.2.0\ntitle: blabla\nversion: "1.2.3"\n'})
        self.assertEqual(check_versions(self.root), [])

    def test_a_quoted_citation_version_that_differs_is_reported(self):
        write_tree(self.root, {**VERSIONED_TREE, "CITATION.cff": 'version: "1.2.2"\n'})
        self.assertEqual(check_versions(self.root), [("CITATION.cff", "1.2.2", "version-mismatch")])

    def test_a_package_without_a_version_is_not_read_from_a_later_table(self):
        write_tree(self.root, {**VERSIONED_TREE, "Cargo.toml": '[package]\nname = "blabla"\n\n[dependencies]\nversion = "9.9.9"\n'})
        self.assertEqual(check_versions(self.root), [("Cargo.toml", "", "version-missing")])


class ExitCodes(TempTree):
    def test_links_mode_exits_zero_on_a_clean_tracked_tree(self):
        tracked_tree(self.root, {"README.md": "[guide](docs/guide.md)\n", "docs/guide.md": "# Guide\n"})
        self.assertEqual(quiet_main(["links"], self.root), 0)

    def test_links_mode_exits_one_on_a_missing_target(self):
        tracked_tree(self.root, {"README.md": "[guide](docs/absent.md)\n"})
        self.assertEqual(quiet_main(["links"], self.root), 1)

    def test_versions_mode_exits_zero_when_every_mirror_matches(self):
        write_tree(self.root, VERSIONED_TREE)
        self.assertEqual(quiet_main(["versions"], self.root), 0)

    def test_versions_mode_exits_one_on_a_version_mismatch(self):
        write_tree(self.root, {**VERSIONED_TREE, "CITATION.cff": "version: 1.2.2\n"})
        self.assertEqual(quiet_main(["versions"], self.root), 1)

    def test_links_mode_exits_one_on_a_case_mismatched_target(self):
        tracked_tree(self.root, {"README.md": "[guide](Docs/Guide.md)\n", "docs/guide.md": "# Guide\n"})
        self.assertEqual(quiet_main(["links"], self.root), 1)

    def test_links_mode_exits_one_on_an_untracked_target_present_on_disk(self):
        write_tree(self.root, {"README.md": "[draft](docs/draft.md)\n", "docs/draft.md": "# Draft\n"})
        subprocess.run(["git", "-C", str(self.root), "init", "-q"], check=True)
        subprocess.run(["git", "-C", str(self.root), "add", "README.md"], check=True)
        self.assertEqual(quiet_main(["links"], self.root), 1)

    def test_links_mode_skips_a_tracked_file_deleted_from_the_working_tree(self):
        tracked_tree(self.root, {"README.md": "[guide](docs/guide.md)\n", "docs/guide.md": "# Guide\n", "docs/old.md": "# Old\n"})
        (self.root / "docs/old.md").unlink()
        self.assertEqual(quiet_main(["links"], self.root), 0)

    def test_links_mode_exits_one_on_a_link_to_a_tracked_file_deleted_from_the_working_tree(self):
        tracked_tree(self.root, {"README.md": "[old](docs/old.md)\n", "docs/old.md": "# Old\n"})
        (self.root / "docs/old.md").unlink()
        self.assertEqual(quiet_main(["links"], self.root), 1)


class GateWiring(unittest.TestCase):
    def test_the_gate_runs_each_text_mode_as_its_own_step(self):
        names = [name for name, _ in STEPS]
        self.assertLess(names.index("audit"), names.index("docs-links"))
        self.assertLess(names.index("docs-links"), names.index("versions"))
        schedule = dict(checks(Path("."), True))
        self.assertEqual(schedule["docs-links"][-1], "links")
        self.assertEqual(schedule["versions"][-1], "versions")
        self.assertTrue(schedule["versions"][-2].endswith("check_text.py"))


if __name__ == "__main__":
    unittest.main()
