import ast
import os
from pathlib import Path

ROOT = Path(os.environ["GLYPH_APP"]).resolve().parent
STAGE = int(os.environ.get("GLYPH_STAGE", "4"))
ROLES = {"model", "domain", "store", "protocol", "main"}
STATE_FIELDS = {"keeper", "glyph", "charge", "phase", "sealed", "quarantined", "resonance"}
DURABLE = {"keeper", "glyph", "charge", "sealed", "quarantined"}
ALLOWED_LOCAL = {"model": set(), "domain": {"model"}, "store": {"model"}, "protocol": set(), "main": {"domain", "store", "protocol"}}
STAGE_OPERATIONS = {1: {"attune"}, 2: {"echo"}, 4: {"recover"}}


def durable_fields_declaration(tree):
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id == "DURABLE_FIELDS" for target in node.targets):
            if isinstance(node.value, (ast.Tuple, ast.List)) and all(isinstance(element, ast.Constant) and isinstance(element.value, str) for element in node.value.elts):
                return [element.value for element in node.value.elts]
            return []
    return None


def refactor_violations(trees):
    failures = []
    model = trees.get("model")
    store = trees.get("store")
    if model is not None:
        declared = durable_fields_declaration(model)
        if declared is None:
            failures.append("model does not declare DURABLE_FIELDS")
        elif set(declared) != DURABLE or len(declared) != len(DURABLE):
            failures.append("model DURABLE_FIELDS does not name exactly the durable vault fields")
    if store is not None:
        names = {node.id for node in ast.walk(store) if isinstance(node, ast.Name)}
        if "DURABLE_FIELDS" not in names:
            failures.append("store does not serialize through DURABLE_FIELDS")
        literals = {node.value for node in ast.walk(store) if isinstance(node, ast.Constant) and isinstance(node.value, str)}
        failures.extend(f"store names durable field '{field}' literally" for field in sorted(literals & STATE_FIELDS))
    return failures


def violations(root):
    failures = []
    trees = {}
    for role in ROLES:
        path = root / (role + ".py")
        if not path.is_file():
            failures.append(f"missing {role} module")
            continue
        try:
            trees[role] = ast.parse(path.read_text(encoding="utf-8"))
        except SyntaxError:
            failures.append(f"{role} is not valid Python")
    for role, tree in trees.items():
        imports = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imports.update(alias.name.split(".")[0] for alias in node.names)
            elif isinstance(node, ast.ImportFrom):
                imports.add((node.module or "").split(".")[0])
            if role != "store" and isinstance(node, ast.Call):
                target = node.func
                if isinstance(target, ast.Name) and target.id in {"open", "eval", "exec", "__import__"}:
                    failures.append(f"{role}:{node.lineno} bypasses a layer boundary")
                if isinstance(target, ast.Attribute) and target.attr in {"write_text", "write_bytes", "read_text", "read_bytes", "unlink", "mkdir", "rmdir", "rmtree"}:
                    failures.append(f"{role}:{node.lineno} performs file I/O outside store")
            if role in {"protocol", "main"}:
                if isinstance(node, ast.Attribute) and node.attr in STATE_FIELDS:
                    failures.append(f"{role}:{node.lineno} inspects domain state")
                if isinstance(node, ast.Subscript) and isinstance(node.slice, ast.Constant) and node.slice.value in STATE_FIELDS:
                    failures.append(f"{role}:{node.lineno} inspects domain state")
            if role == "store" and isinstance(node, (ast.Compare, ast.IfExp)):
                if any((isinstance(part, ast.Attribute) and part.attr in STATE_FIELDS) or (isinstance(part, ast.Subscript) and isinstance(part.slice, ast.Constant) and part.slice.value in STATE_FIELDS) for part in ast.walk(node)):
                    failures.append(f"store:{node.lineno} makes a domain-state decision")
        unexpected = (imports & ROLES) - ALLOWED_LOCAL[role]
        failures.extend(f"{role} imports forbidden layer {name}" for name in sorted(unexpected))
        if role in {"domain", "model"}:
            failures.extend(f"{role} imports I/O or protocol module {name}" for name in sorted(imports & {"os", "pathlib", "io", "sys", "json", "subprocess", "socket", "shutil", "multiprocessing"}))
        if role == "model" and any(isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) for node in ast.walk(tree)):
            failures.append("model contains executable methods instead of data only")
    required = {"model": {"Vault", "DurableVault"}, "domain": {"VaultDomain"}, "store": {"VaultStore"}, "protocol": {"Protocol"}}
    for role, names in required.items():
        present = {node.name for node in trees.get(role, ast.Module(body=[], type_ignores=[])).body if isinstance(node, ast.ClassDef)}
        failures.extend(f"{role} is missing public structure {name}" for name in names - present)
    domain_operations = {"bind", "pulse", "rotate", "transfer", "release", "seal", "unseal", "quarantine", "clear_quarantine", "observe", "snapshot"}
    for stage, names in STAGE_OPERATIONS.items():
        if STAGE >= stage:
            domain_operations |= names
    methods = {"domain": domain_operations, "store": {"load", "save", "clear"}, "protocol": {"dispatch", "serve"}}
    for role, names in methods.items():
        present = {node.name for node in ast.walk(trees.get(role, ast.Module(body=[], type_ignores=[]))) if isinstance(node, ast.FunctionDef)}
        failures.extend(f"{role} is missing public operation {name}" for name in names - present)
    if STAGE >= 3:
        failures.extend(refactor_violations(trees))
    return sorted(set(failures))


def test_architecture_boundaries():
    assert not violations(ROOT), "\n".join(violations(ROOT))
