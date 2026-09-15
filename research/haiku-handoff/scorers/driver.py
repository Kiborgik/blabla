import json
import os
import queue
import subprocess
import sys
import shutil
import threading
import uuid
from pathlib import Path


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"duplicate protocol key: {key}")
        result[key] = value
    return result


class Session:
    def __init__(self, app=None):
        self.app = Path(app or os.environ.get("GLYPH_APP", Path(__file__).resolve().parents[1] / "glyph_vault/main.py")).resolve()
        scratch = self.app.parent.parent / ".test-data"
        scratch.mkdir(exist_ok=True)
        self.directory = scratch / uuid.uuid4().hex
        self.directory.mkdir()
        self.process = None
        self.start()
        assert self.request("reset") == {"ok": True}

    def start(self):
        self.responses = queue.Queue()
        self.errors = (self.directory / "stderr.txt").open("w+b")
        self.process = subprocess.Popen([sys._base_executable, str(self.app)], cwd=self.directory,
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=self.errors,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
        output, responses = self.process.stdout, self.responses
        def read():
            for line in output:
                responses.put(line)
            responses.put(None)
        self.reader = threading.Thread(target=read, daemon=True)
        self.reader.start()

    def request(self, operation, **arguments):
        identity = "request"
        packet = {"id": identity, "op": operation, **arguments}
        self.process.stdin.write((json.dumps(packet, ensure_ascii=False) + "\n").encode("utf-8"))
        self.process.stdin.flush()
        line = self.responses.get(timeout=1)
        assert line is not None, "application exited before response"
        reply = json.loads(line, object_pairs_hook=unique_object)
        assert set(reply) == {"id", "result"} and reply["id"] == identity, "bad protocol envelope"
        return reply["result"]

    def observe(self):
        return self.request("observe")["vaults"]

    def call(self, name, *args):
        if name == "restart":
            self.stop(force=True)
            self.start()
        else:
            assert self.request("call", name=name, args=list(args)) == {"ok": True}

    def stop(self, force=False):
        process = self.process
        if process is None:
            return
        try:
            if force and process.poll() is None:
                process.kill()
            process.stdin.close()
            process.wait(timeout=1)
            self.reader.join(timeout=1)
            assert not self.reader.is_alive(), "protocol reader did not stop"
            remaining = []
            while not self.responses.empty():
                remaining.append(self.responses.get_nowait())
            assert all(item is None for item in remaining), "trailing protocol output"
            if not force:
                assert process.returncode == 0, "application exited unsuccessfully"
        finally:
            if process.poll() is None:
                process.kill()
                process.wait(timeout=1)
            process.stdout.close()
            self.errors.close()
            self.process = None

    def close(self):
        try:
            self.stop()
        finally:
            shutil.rmtree(self.directory)


def normalize(rows):
    fields = ("id", "keeper", "glyph", "charge", "phase")
    assert len(rows) == 3 and {row["id"] for row in rows} == {"A", "B", "C"}
    return {row["id"]: {field: row[field] for field in fields} for row in rows}
