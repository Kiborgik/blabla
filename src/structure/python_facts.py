import ast
import json
import sys

LITERAL_TYPES = (str, int, bool)


def literal_collection(value):
    if isinstance(value, (ast.Tuple, ast.List, ast.Set)):
        elements = value.elts
    elif isinstance(value, ast.Dict):
        elements = value.keys
    else:
        return None
    values = []
    for element in elements:
        if not isinstance(element, ast.Constant) or type(element.value) not in LITERAL_TYPES:
            return None
        values.append(element.value)
    return values


def render_payload(payload):
    if isinstance(payload, ast.Constant) and type(payload.value) in LITERAL_TYPES:
        return [payload.value]
    if isinstance(payload, (ast.Tuple, ast.List, ast.Set)):
        values = []
        for element in payload.elts:
            if not isinstance(element, ast.Constant) or type(element.value) not in LITERAL_TYPES:
                return None
            values.append(element.value)
        return values
    if isinstance(payload, ast.Dict):
        values = []
        for key in payload.keys:
            if not isinstance(key, ast.Constant) or type(key.value) not in LITERAL_TYPES:
                return None
            values.append(key.value)
        return values
    return None


def extract_entries(value):
    if isinstance(value, (ast.Tuple, ast.List, ast.Set)):
        entries = []
        for element in value.elts:
            if not isinstance(element, (ast.Tuple, ast.List)) or len(element.elts) != 2:
                return None
            key_node = element.elts[0]
            if not isinstance(key_node, ast.Constant) or type(key_node.value) not in LITERAL_TYPES:
                return None
            payload = render_payload(element.elts[1])
            entries.append((element.lineno, key_node.value, payload))
        return entries
    if isinstance(value, ast.Dict):
        entries = []
        for key_node, value_node in zip(value.keys, value.values):
            if not isinstance(key_node, ast.Constant) or type(key_node.value) not in LITERAL_TYPES:
                return None
            payload = render_payload(value_node)
            entries.append((key_node.lineno, key_node.value, payload))
        return entries
    return None


def assigned_names(node):
    if isinstance(node, ast.Assign):
        return [target.id for target in node.targets if isinstance(target, ast.Name)]
    if isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
        return [node.target.id]
    return []


def declarations(body, prefix, facts, depth):
    for node in body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            facts["symbols"].append({"path": prefix + [node.name], "line": node.lineno})
            if isinstance(node, ast.ClassDef) and depth < 2:
                declarations(node.body, prefix + [node.name], facts, depth + 1)
        for name in assigned_names(node):
            path = prefix + [name]
            facts["symbols"].append({"path": path, "line": node.lineno})
            values = literal_collection(node.value) if node.value is not None else None
            if values is None:
                facts["unsupported"].append({"path": path, "line": node.lineno})
            else:
                facts["collections"].append({"path": path, "line": node.lineno, "values": values})
            if node.value is not None:
                entries = extract_entries(node.value)
                if entries is not None:
                    for entry_line, key, payload in entries:
                        facts["entries"].append({"path": path, "key": key, "line": entry_line, "values": payload})


def imports(tree, package):
    result = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                result.append({"name": alias.name, "line": node.lineno})
        elif isinstance(node, ast.ImportFrom):
            if node.module == "__future__":
                continue
            if node.level:
                base = package[: max(len(package) - node.level + 1, 0)]
            else:
                base = []
            if node.module:
                result.append({"name": ".".join(base + [node.module]), "line": node.lineno})
            else:
                for alias in node.names:
                    result.append({"name": ".".join(base + [alias.name]), "line": node.lineno})
    return result


def inspect(module):
    facts = {"exists": False, "error": None, "symbols": [], "imports": [], "collections": [], "unsupported": [], "entries": []}
    try:
        with open(module["path"], encoding="utf-8") as handle:
            source = handle.read()
    except FileNotFoundError:
        return facts
    except OSError as failure:
        facts["error"] = str(failure)
        return facts
    facts["exists"] = True
    try:
        tree = ast.parse(source, filename=module["display"])
    except SyntaxError as failure:
        facts["error"] = "%s (line %s)" % (failure.msg, failure.lineno)
        return facts
    declarations(tree.body, [], facts, 0)
    facts["imports"] = imports(tree, module["package"])
    return facts


def main():
    request = json.loads(sys.stdin.read())
    modules = {module["key"]: inspect(module) for module in request["modules"]}
    sys.stdout.write(json.dumps({"modules": modules}, sort_keys=True))


main()
