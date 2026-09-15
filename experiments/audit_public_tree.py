import argparse
import json
import posixpath
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

PATTERNS = {
    "windows-drive-path": re.compile(r"\b[A-Za-z]:[\\/](?:Projects|Users)\b"),
    "user-profile": re.compile(r"[\\/](?:Users|home)[\\/][A-Za-z0-9_.-]+[\\/]"),
    "owner-handle": re.compile(r"petro", re.IGNORECASE),
    "anthropic-key": re.compile(r"sk-ant-[A-Za-z0-9_-]{20,}"),
    "openai-style-key": re.compile(r"\bsk-[A-Za-z0-9]{32,}\b"),
    "github-token": re.compile(r"\bgh[pousr]_[A-Za-z0-9]{30,}\b"),
    "aws-access-key": re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    "private-key": re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
    "api-key-assignment": re.compile(r"(?i)\b(api[_-]?key|secret|token)\s*[:=]\s*['\"][A-Za-z0-9_\-]{16,}['\"]"),
    "session-id": re.compile(r"\bsession[_-]?id\b.{0,20}[0-9a-f]{16,}", re.IGNORECASE),
}

ALLOWED = {
    ("LICENSE", "owner-handle"),
    ("CITATION.cff", "owner-handle"),
    ("experiments/audit_public_tree.py", "owner-handle"),
}

BINARY_SUFFIXES = {".png", ".jpg", ".jpeg", ".gif", ".ico", ".woff", ".woff2", ".zip", ".gz"}
LARGE_FILE_BYTES = 2 * 1024 * 1024
MARKDOWN_LINK = re.compile(r"\]\(([^)#\s]+)(?:#[^)]*)?\)")
EXTERNAL_PREFIXES = ("http://", "https://", "mailto:", "<")


def tracked_files():
    completed = subprocess.run(["git", "ls-files", "-z"], cwd=ROOT, capture_output=True, check=True)
    return [ROOT / name for name in completed.stdout.decode("utf-8").split("\0") if name]


def dangling_links(files):
    published = {path.relative_to(ROOT).as_posix() for path in files}
    directories = {parent.as_posix() for name in published for parent in Path(name).parents if parent.as_posix() != "."}
    findings = []
    for path in files:
        if path.suffix.lower() != ".md" or not path.is_file():
            continue
        relative = path.relative_to(ROOT).as_posix()
        base = posixpath.dirname(relative)
        for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
            for match in MARKDOWN_LINK.finditer(line):
                target = match.group(1)
                if target.startswith(EXTERNAL_PREFIXES):
                    continue
                resolved = posixpath.normpath(posixpath.join(base, target))
                if resolved not in published and resolved not in directories:
                    findings.append({"file": relative, "pattern": "dangling-link", "line": number, "excerpt": target})
    return findings


def scan(path):
    findings = []
    relative = path.relative_to(ROOT).as_posix()
    size = path.stat().st_size
    if size > LARGE_FILE_BYTES:
        findings.append({"file": relative, "pattern": "large-file", "line": 0, "excerpt": f"{size} bytes"})
    if path.suffix.lower() in BINARY_SUFFIXES:
        return findings
    try:
        text = path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return findings
    for number, line in enumerate(text.splitlines(), start=1):
        for name, pattern in PATTERNS.items():
            if (relative, name) in ALLOWED:
                continue
            if pattern.search(line):
                findings.append({"file": relative, "pattern": name, "line": number, "excerpt": line.strip()[:160]})
    return findings


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out")
    arguments = parser.parse_args()
    files = tracked_files()
    findings = []
    for path in files:
        if path.is_file():
            findings.extend(scan(path))
    findings.extend(dangling_links(files))
    report = {"files_scanned": len(files), "findings": findings}
    if arguments.out:
        Path(arguments.out).parent.mkdir(parents=True, exist_ok=True)
        Path(arguments.out).write_text(json.dumps(report, indent=2), encoding="utf-8")
    for finding in findings:
        print(f"{finding['file']}:{finding['line']} [{finding['pattern']}] {finding['excerpt']}")
    print(f"scanned {len(files)} tracked files, {len(findings)} findings", flush=True)
    sys.exit(1 if findings else 0)


if __name__ == "__main__":
    main()
