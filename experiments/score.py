import argparse
import json
import queue
import subprocess
import sys
import threading
import uuid
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def require(condition, message):
    if not condition:
        raise AssertionError(message)


class Session:
    def __init__(self, app):
        self.app = Path(app).resolve()
        self.data = ROOT / "artifacts" / "scratch" / "scoring" / uuid.uuid4().hex
        self.data.mkdir(parents=True)
        self.start()

    def start(self):
        self.responses = queue.Queue(maxsize=2)
        self.stop = threading.Event()
        self.errors = (self.data / "stderr.log").open("ab")
        self.process = subprocess.Popen([sys.executable, str(self.app)], cwd=self.data,
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=self.errors)
        self.reader = threading.Thread(target=self.read, daemon=True)
        self.reader.start()

    def read(self):
        while not self.stop.is_set():
            line = self.process.stdout.readline(1_048_577)
            event = line if line else None
            while not self.stop.is_set():
                try:
                    self.responses.put(event, timeout=0.05)
                    break
                except queue.Full:
                    continue
            if event is None:
                break

    def ask(self, op, **values):
        token = uuid.uuid4().hex
        packet = {"id": token, "op": op, **values}
        self.process.stdin.write((json.dumps(packet) + "\n").encode("utf-8"))
        self.process.stdin.flush()
        line = self.responses.get(timeout=1)
        require(line is not None, "application ended before responding")
        require(len(line) <= 1_048_576, "response too large")
        reply = json.loads(line.decode("utf-8"))
        require(isinstance(reply, dict) and set(reply) == {"id", "result"}, "invalid response envelope")
        require(reply["id"] == token, "response id mismatch")
        return reply["result"]

    def reset(self):
        require(self.ask("reset") == {"ok": True}, "reset was rejected")

    def call(self, name, *args):
        require(self.ask("call", name=name, args=list(args)) == {"ok": True}, f"{name} was rejected")

    def observe(self):
        value = self.ask("observe")
        require(isinstance(value, dict) and isinstance(value.get("todos"), list), "missing todos observation")
        identifiers = []
        for todo in value["todos"]:
            require(isinstance(todo, dict), "todo is not an object")
            require(type(todo.get("id")) is int and abs(todo["id"]) <= 9_007_199_254_740_991, "invalid todo id")
            require(isinstance(todo.get("text"), str) and todo["text"] != "", "invalid or empty text")
            require(type(todo.get("done")) is bool, "done is not Boolean")
            identifiers.append(todo["id"])
        require(len(identifiers) == len(set(identifiers)), "duplicate ids")
        return value

    def finish(self):
        self.process.stdin.close()
        require(self.responses.get(timeout=1) is None, "trailing application output")
        require(self.process.wait(timeout=1) == 0, "unsuccessful application exit")
        self.reader.join(timeout=0.2)
        self.process.stdout.close()
        self.errors.close()

    def abort(self):
        self.stop.set()
        if self.process.poll() is None:
            self.process.kill()
        self.process.wait(timeout=1)
        self.reader.join(timeout=0.2)
        if not self.process.stdin.closed:
            self.process.stdin.close()
        self.process.stdout.close()
        self.errors.close()


def core(observation):
    return [{k: todo[k] for k in ("id", "text", "done")} for todo in observation["todos"]]


def indexed(rows):
    return {todo["id"]: todo for todo in rows}


def add(session, text):
    before = core(session.observe())
    session.call("add", text)
    after = core(session.observe())
    require(len(after) == len(before) + 1, "add did not create exactly one item")
    old = indexed(before)
    require(all(indexed(after).get(key) == value for key, value in old.items()), "add changed an existing item")
    created = [todo for todo in after if todo["id"] not in old]
    require(len(created) == 1 and created[0]["text"] == text and created[0]["done"] is False, "new item has incorrect identity/text/done")
    return created[0]["id"]


def add_preserves(session, stage):
    add(session, "milk")
    add(session, "tea")
    add(session, "é\nline")


def empty_add(session, stage):
    add(session, "milk")
    before = core(session.observe())
    session.call("add", "")
    require(core(session.observe()) == before, "empty add changed state or order")


def duplicate_text(session, stage):
    first = add(session, "same")
    second = add(session, "same")
    require(first != second, "duplicate text reused an id")


def complete_target(session, stage):
    target = add(session, "first")
    add(session, "second")
    expected = indexed(core(session.observe()))
    expected[target]["done"] = True
    session.call("complete", target)
    require(indexed(core(session.observe())) == expected, "complete changed the wrong items")
    session.call("complete", target)
    require(indexed(core(session.observe())) == expected, "repeated completion changed state")


def missing_updates(session, stage):
    add(session, "milk")
    before = core(session.observe())
    missing = max(todo["id"] for todo in before) + 100
    for action in ("complete", "remove"):
        session.call(action, missing)
        require(core(session.observe()) == before, f"missing-id {action} changed state/order")


def remove_target(session, stage):
    add(session, "first")
    target = add(session, "second")
    add(session, "third")
    expected = indexed(core(session.observe()))
    del expected[target]
    session.call("remove", target)
    after = core(session.observe())
    require(indexed(after) == expected, "remove lost or changed unrelated items")
    session.call("remove", target)
    require(core(session.observe()) == after, "repeated removal changed state/order")


def restart_preserves(session, stage):
    first = add(session, "first")
    add(session, "second")
    session.call("complete", first)
    before = core(session.observe())
    session.abort()
    require(not session.reader.is_alive(), "previous protocol reader did not stop")
    session.start()
    require(core(session.observe()) == before, "restart changed state or order")


def process_restart(session, stage):
    first = add(session, "persist")
    session.call("complete", first)
    before = core(session.observe())
    session.finish()
    session.start()
    require(core(session.observe()) == before, "fresh process lost persisted state")


def priorities(session, stage):
    first = add(session, "first")
    second = add(session, "second")
    initial = session.observe()["todos"]
    require(all(type(t.get("priority")) is int and t["priority"] == 1 for t in initial), "priority default is not integer 1")
    session.call("set_priority", first, 2)
    rows = indexed(session.observe()["todos"])
    require(rows[first]["priority"] == 2 and rows[second]["priority"] == 1, "priority update affected wrong item")
    session.call("set_priority", first, 3)
    session.call("set_priority", first, -1)
    session.call("set_priority", max(first, second) + 100, 0)
    require(indexed(session.observe()["todos"])[first]["priority"] == 2, "invalid priority changed value")
    session.call("set_priority", first, 0)
    require(indexed(session.observe()["todos"])[first]["priority"] == 0, "priority zero was rejected")
    session.call("set_priority", first, 2)
    session.call("complete", first)
    session.call("restart")
    rows = indexed(session.observe()["todos"])
    require(all(type(t.get("priority")) is int for t in rows.values()), "priority is not an integer")
    require(rows[first]["priority"] == 2 and rows[second]["priority"] == 1, "priority invalid-input/persistence regression")


def filtering(session, stage):
    first = add(session, "first")
    second = add(session, "second")
    session.call("complete", first)
    before = core(session.observe())
    session.call("filter", "active")
    value = session.observe()
    require(value.get("filter_mode") == "active", "filter mode not retained")
    require(core(value) == before, "filtering changed full todos")
    require([t["id"] for t in value.get("visible_todos", [])] == [second], "active filter incorrect")
    session.call("complete", second)
    require(session.observe().get("visible_todos") == [], "visible list did not update after completion")
    session.call("remove", first)
    require(first not in indexed(core(session.observe())), "filtered-out target could not be removed")
    session.call("filter", "completed")
    require([t["id"] for t in session.observe().get("visible_todos", [])] == [second], "completed filter incorrect")
    session.call("filter", "invalid")
    require(session.observe().get("filter_mode") == "completed", "invalid filter changed selection")
    session.call("filter", "all")
    value = session.observe()
    require(value.get("filter_mode") == "all" and value.get("visible_todos") == value["todos"], "all filter incorrect")
    session.call("filter", "active")
    session.call("restart")
    value = session.observe()
    require(value.get("filter_mode") == "all" and value.get("visible_todos") == value["todos"], "restart did not reset filter to all")


def tags(session, stage):
    first = add(session, "first")
    second = add(session, "second")
    require(all(t.get("tags") == [] for t in session.observe()["todos"]), "tags default is not empty")
    for tag in ("alpha", "beta", "alpha", ""):
        session.call("tag", first, tag)
    rows = indexed(session.observe()["todos"])
    require(rows[first]["tags"] == ["alpha", "beta"] and rows[second]["tags"] == [], "tags duplication/order/target mismatch")
    session.call("tag", max(first, second) + 100, "ignored")
    session.call("untag", first, "alpha")
    session.call("untag", first, "missing")
    session.call("set_priority", first, 2)
    session.call("complete", first)
    session.call("restart")
    rows = indexed(session.observe()["todos"])
    require(rows[first]["tags"] == ["beta"] and rows[first]["priority"] == 2 and rows[first]["done"] is True, "tags or prior features lost across restart")


def jsonl_storage(session, stage):
    add(session, "first")
    add(session, "second")
    candidates = list(session.data.rglob("todos.jsonl"))
    require(len(candidates) == 1, "expected one todos.jsonl in isolated data directory")
    lines = candidates[0].read_text(encoding="utf-8").splitlines()
    require(len(lines) == 2 and all(isinstance(json.loads(line), dict) for line in lines), "storage is not one JSON object per todo line")


CASES = [
    ("add-preserves-existing", 0, add_preserves),
    ("empty-add-noop", 0, empty_add),
    ("duplicate-text-and-identity", 0, duplicate_text),
    ("complete-only-target", 0, complete_target),
    ("missing-id-noops", 0, missing_updates),
    ("remove-only-target", 0, remove_target),
    ("restart-preserves-data", 0, restart_preserves),
    ("process-restart-persists", 0, process_restart),
    ("priorities", 1, priorities),
    ("filtering", 2, filtering),
    ("tags", 3, tags),
    ("jsonl-storage", 4, jsonl_storage),
]


def score_application(app, stage):
    checks = []
    for name, introduced, test in CASES:
        if introduced > stage:
            continue
        session = None
        try:
            session = Session(app)
            session.reset()
            test(session, stage)
            session.finish()
            checks.append({"name": name, "introduced": introduced, "passed": True})
        except Exception as error:
            checks.append({"name": name, "introduced": introduced, "passed": False,
                "detail": f"{type(error).__name__}: {error}"})
        finally:
            if session is not None:
                session.abort()
    passed = sum(check["passed"] for check in checks)
    return {"app": str(Path(app).resolve()), "stage": stage, "passed": passed,
        "failed": len(checks) - passed, "checks": checks}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("app", type=Path)
    parser.add_argument("--stage", type=int, default=0, choices=range(7))
    parser.add_argument("--output", type=Path)
    options = parser.parse_args()
    result = score_application(options.app, options.stage)
    encoded = json.dumps(result, indent=2)
    if options.output:
        options.output.write_text(encoded, encoding="utf-8")
    print(encoded)
