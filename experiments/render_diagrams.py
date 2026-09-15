import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIAGRAMS = ROOT / "docs" / "diagrams"
ASSETS = ROOT / "docs" / "assets"
MANIFEST = DIAGRAMS / "manifest.json"
MERMAID_CLI = "@mermaid-js/mermaid-cli@11.4.2"


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def sources():
    return sorted(DIAGRAMS.glob("*.mmd"))


def load_manifest():
    if not MANIFEST.is_file():
        return {}
    return json.loads(MANIFEST.read_text(encoding="utf-8"))


BROWSER_CANDIDATES = [
    Path.home() / ".cache" / "puppeteer" / "chrome",
    Path("C:/Program Files/Google/Chrome/Application/chrome.exe"),
    Path("C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"),
    Path("C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"),
    Path("C:/Program Files/Microsoft/Edge/Application/msedge.exe"),
    Path("/usr/bin/google-chrome"),
    Path("/usr/bin/chromium"),
    Path("/usr/bin/chromium-browser"),
    Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
]


def browser_executable():
    configured = os.environ.get("BLABLA_CHROME")
    if configured:
        return Path(configured)
    for candidate in BROWSER_CANDIDATES:
        if candidate.is_dir():
            executables = sorted(candidate.glob("*/chrome-*/chrome.exe")) + sorted(candidate.glob("*/chrome-*/chrome"))
            if executables:
                return executables[-1]
        elif candidate.is_file():
            return candidate
    return None


def puppeteer_config(directory):
    executable = browser_executable()
    if executable is None:
        return None
    config = directory / "puppeteer.json"
    config.write_text(json.dumps({"executablePath": str(executable), "args": ["--no-sandbox"]}), encoding="utf-8")
    return config


MARGIN = 16


def opaque(svg):
    text = svg.read_text(encoding="utf-8")
    box = re.search(r'viewBox="0 0 ([0-9.]+) ([0-9.]+)"', text)
    if box is None:
        raise SystemExit(f"{svg.name}: no viewBox to size the diagram from")
    width, height = float(box.group(1)), float(box.group(2))
    padded_width, padded_height = width + 2 * MARGIN, height + 2 * MARGIN
    text = text.replace(box.group(0), f'viewBox="{-MARGIN} {-MARGIN} {padded_width} {padded_height}"', 1)
    text = text.replace('width="100%"', f'width="{padded_width}" height="{padded_height}"', 1)
    text = re.sub(r'max-width:\s*[0-9.]+px;\s*', "", text, count=1)
    plate = f'<rect x="{-MARGIN}" y="{-MARGIN}" width="{padded_width}" height="{padded_height}" fill="#ffffff"/>'
    marker = text.index(">", text.index("<svg")) + 1
    svg.write_text(text[:marker] + plate + text[marker:], encoding="utf-8", newline="")


def render_one(source, target):
    npx = shutil.which("npx")
    if npx is None:
        raise SystemExit("npx (Node.js) is required to render Mermaid diagrams")
    command = [npx, "--yes", "-p", MERMAID_CLI, "mmdc", "-i", str(source), "-o", str(target), "-b", "white", "-q"]
    config = puppeteer_config(target.parent)
    if config is not None:
        command += ["-p", str(config)]
    completed = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if completed.returncode != 0 or not target.is_file():
        raise SystemExit(f"rendering {source.name} failed ({completed.returncode}):\n{completed.stdout}\n{completed.stderr}")


def render():
    manifest = {}
    ASSETS.mkdir(parents=True, exist_ok=True)
    for source in sources():
        target = ASSETS / (source.stem + ".svg")
        with tempfile.TemporaryDirectory() as temp:
            rendered = Path(temp) / target.name
            render_one(source, rendered)
            opaque(rendered)
            target.write_bytes(rendered.read_bytes())
        manifest[source.name] = {"source_sha256": sha256(source), "svg": target.name, "svg_sha256": sha256(target)}
        print(f"rendered {source.name} -> {target.name}", flush=True)
    MANIFEST.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def check():
    manifest = load_manifest()
    problems = []
    for source in sources():
        entry = manifest.get(source.name)
        if entry is None:
            problems.append(f"{source.name}: not rendered (missing from manifest.json)")
            continue
        target = ASSETS / entry["svg"]
        if not target.is_file():
            problems.append(f"{source.name}: {entry['svg']} is missing")
            continue
        if entry["source_sha256"] != sha256(source):
            problems.append(f"{source.name}: source changed since {entry['svg']} was rendered")
        if entry["svg_sha256"] != sha256(target):
            problems.append(f"{entry['svg']}: differs from the rendered output recorded in manifest.json")
        text = source.read_text(encoding="utf-8")
        for required in ("accTitle:", "accDescr:"):
            if required not in text:
                problems.append(f"{source.name}: missing {required}")
    for name in manifest:
        if not (DIAGRAMS / name).is_file():
            problems.append(f"{name}: recorded in manifest.json but the source is gone")
    if problems:
        print("\n".join(problems))
        return 1
    print(f"{len(manifest)} diagrams match their Mermaid sources")
    return 0


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    arguments = parser.parse_args()
    if arguments.check:
        sys.exit(check())
    render()
    sys.exit(check())


if __name__ == "__main__":
    main()
