import json
import os
import sys
from pathlib import Path

sys.stdin.reconfigure(encoding="utf-8", errors="strict")
sys.stdout.reconfigure(encoding="utf-8", errors="strict")


class LeaseApplication:
    def __init__(self):
        self.path = Path("leases.json")
        self.leases = json.loads(self.path.read_text(encoding="utf-8")) if self.path.exists() else []

    def save(self):
        temporary = self.path.with_suffix(".tmp")
        temporary.write_text(json.dumps(self.leases, ensure_ascii=False), encoding="utf-8")
        os.replace(temporary, self.path)

    def reset(self):
        self.leases = []
        self.path.unlink(missing_ok=True)

    def claim(self, resource, holder, ttl):
        if not resource or not holder or not 1 <= ttl <= 8:
            return
        if not any(lease["resource"] == resource for lease in self.leases):
            self.leases.append({"resource": resource, "holder": holder, "ticks": ttl})

    def renew(self, resource, holder, ttl):
        if not 1 <= ttl <= 8:
            return
        for lease in self.leases:
            if lease["resource"] == resource and lease["holder"] == holder:
                lease["ticks"] = ttl

    def release(self, resource, holder):
        self.leases = [lease for lease in self.leases if not (lease["resource"] == resource and lease["holder"] == holder)]

    def tick(self, delta):
        if not 1 <= delta <= 8:
            return
        self.leases = [dict(lease, ticks=lease["ticks"] - delta) for lease in self.leases if lease["ticks"] > delta]

    def call(self, name, args):
        actions = {"claim": self.claim, "renew": self.renew, "release": self.release, "tick": self.tick}
        if name not in actions:
            raise ValueError("unknown action")
        actions[name](*args)
        self.save()


application = LeaseApplication()
for line in sys.stdin:
    request = json.loads(line)
    try:
        operation = request["op"]
        if operation == "reset":
            application.reset()
            result = {"ok": True}
        elif operation == "observe":
            result = {"leases": application.leases}
        elif operation == "call":
            application.call(request["name"], request["args"])
            result = {"ok": True}
        else:
            raise ValueError("unknown operation")
    except (KeyError, TypeError, ValueError, OSError) as error:
        result = {"ok": False, "error": str(error)}
    print(json.dumps({"id": request["id"], "result": result}, ensure_ascii=False), flush=True)
