import argparse
import posixpath
import re
import subprocess
import sys
from pathlib import Path
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parent.parent

REFERENCE_VERSION = ("Cargo.toml", r'(?ms)^\[package\]\s*$(?:(?!^\[).)*?^version = "([^"]+)"')

VERSION_MIRRORS = (
    (".claude-plugin/plugin.json", r'"version": "([^"]+)"'),
    ("CITATION.cff", r'(?m)^version: ["\']?([^"\'\s]+)'),
    (".github/ISSUE_TEMPLATE/bug.yml", r"placeholder: blabla (\S+)"),
    (".github/ISSUE_TEMPLATE/false-green.yml", r"placeholder: blabla (\S+)"),
)

EXTERNAL = re.compile(r"[A-Za-z][A-Za-z0-9+.-]*:")
FENCE_OPEN = re.compile(r"^ {0,3}(`{3,}|~{3,})")
FENCE_CLOSE = re.compile(r"^ {0,3}(`{3,}|~{3,})[ \t]*$")
INLINE_CODE = re.compile(r"(`+).+?\1")
LINK = re.compile(r'\[[^\]]*\]\((<[^>]*>|[^)\s]+)(?:\s+"[^"]*")?\)')
LINK_TEXT = re.compile(r"\[([^\]]*)\]\([^)]*\)")
HEADING = re.compile(r"^#{1,6}\s+(.*?)\s*#*\s*$")


def prose_lines(text):
    marker = None
    for line in text.splitlines():
        if marker is None:
            opening = FENCE_OPEN.match(line)
            if opening:
                marker = opening.group(1)
            else:
                yield line
            continue
        closing = FENCE_CLOSE.match(line)
        if closing and closing.group(1)[0] == marker[0] and len(closing.group(1)) >= len(marker):
            marker = None


def slug(heading):
    text = LINK_TEXT.sub(r"\1", heading).replace("`", "").strip().lower()
    return re.sub(r"[^\w\- ]", "", text).replace(" ", "-")


def anchors_of(text):
    counts = {}
    anchors = set()
    for line in prose_lines(text):
        heading = HEADING.match(line)
        if heading:
            base = slug(heading.group(1))
            index = counts.get(base, 0)
            anchors.add(base if index == 0 else f"{base}-{index}")
            counts[base] = index + 1
    return anchors


def targets_of(text):
    for line in prose_lines(text):
        for target in LINK.findall(INLINE_CODE.sub("", line)):
            yield target[1:-1] if target.startswith("<") else target


def resolve(source, path):
    if path.startswith("/"):
        return posixpath.normpath(path[1:])
    return posixpath.normpath(posixpath.join(posixpath.dirname(source), path))


def is_tracked(tracked, resolved):
    if resolved == ".." or resolved.startswith("../"):
        return False
    return resolved in tracked or any(path.startswith(resolved + "/") for path in tracked)


def link_problem(root, tracked, source, target):
    if EXTERNAL.match(target):
        return None
    address, _, anchor = target.partition("#")
    path = unquote(address.partition("?")[0])
    resolved = source
    if path:
        resolved = resolve(source, path)
        if not is_tracked(tracked, resolved):
            return "missing-target"
    if anchor and resolved in tracked and resolved.endswith(".md"):
        if unquote(anchor) not in anchors_of((root / resolved).read_text(encoding="utf-8")):
            return "missing-anchor"
    return None


def check_links(root, tracked):
    problems = []
    for source in sorted(path for path in tracked if path.endswith(".md")):
        for target in targets_of((root / source).read_text(encoding="utf-8")):
            kind = link_problem(root, tracked, source, target)
            if kind:
                problems.append((source, target, kind))
    return problems


def tracked_paths(root):
    listing = subprocess.run(
        ["git", "-C", str(root), "ls-files"],
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=True,
    )
    return set(listing.stdout.splitlines())


def versions_in(root, path, pattern):
    if not (root / path).is_file():
        return None
    return re.findall(pattern, (root / path).read_text(encoding="utf-8"))


def check_versions(root, reference=REFERENCE_VERSION, mirrors=VERSION_MIRRORS):
    reference_path, reference_pattern = reference
    found = versions_in(root, reference_path, reference_pattern)
    if found is None:
        return [(reference_path, "", "file-missing")]
    if not found:
        return [(reference_path, "", "version-missing")]
    expected = found[0]
    problems = []
    for path, pattern in mirrors:
        values = versions_in(root, path, pattern)
        if values is None:
            problems.append((path, "", "file-missing"))
            continue
        if not values:
            problems.append((path, "", "version-missing"))
        problems.extend((path, value, "version-mismatch") for value in values if value != expected)
    return problems


def main(argv=None, root=ROOT):
    parser = argparse.ArgumentParser(description="Text checks for the product gate.")
    parser.add_argument("mode", choices=("links", "versions"))
    arguments = parser.parse_args(argv)
    if arguments.mode == "links":
        problems = check_links(root, tracked_paths(root))
    else:
        problems = check_versions(root)
    for where, what, kind in problems:
        print(f"{where}: {what}: {kind}")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
