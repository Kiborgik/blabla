import sys
import unittest
from fnmatch import fnmatch
from pathlib import Path

from gate import ROOT, STEPS


def gate_patterns(steps):
    patterns = []
    for name, command in steps:
        if command[:4] != ("@python", "-m", "unittest", "discover"):
            continue
        directory = command[command.index("-s") + 1] if "-s" in command else "."
        if Path(directory) == Path("experiments"):
            pattern = command[command.index("-p") + 1] if "-p" in command else "test*.py"
            patterns.append((name, pattern))
    return patterns


def iter_tests(suite):
    if isinstance(suite, unittest.TestSuite):
        for test in suite:
            yield from iter_tests(test)
    else:
        yield suite


def split_suite(suite, ownership):
    owners = {ownership[test.__class__.__module__] for test in iter_tests(suite)}
    if not owners:
        return None, None
    if owners == {False}:
        return suite, None
    if owners == {True}:
        return None, suite
    if type(suite) is not unittest.TestSuite:
        raise ValueError("custom suite crosses gate ownership")
    historical, owned = [], []
    for test in suite:
        historical_part, owned_part = split_suite(test, ownership)
        if historical_part is not None:
            historical.append(historical_part)
        if owned_part is not None:
            owned.append(owned_part)
    return unittest.TestSuite(historical), unittest.TestSuite(owned)


def partition_tests(directory=ROOT / "experiments", steps=STEPS):
    directory = Path(directory).resolve()
    paths = sorted(directory.rglob("test_*.py"))
    patterns = gate_patterns(steps)
    for name, pattern in patterns:
        if not any(fnmatch(path.name, pattern) for path in paths):
            raise ValueError(f"unknown gate pattern: {name}: {pattern}")
    ownership = {}
    for path in paths:
        owners = [name for name, pattern in patterns if fnmatch(path.name, pattern)]
        if len(owners) > 1:
            raise ValueError(f"multiple gate stages own {path.name}: {owners}")
        module = ".".join(path.relative_to(directory).with_suffix("").parts)
        ownership[module] = bool(owners)

    loader = unittest.TestLoader()
    suite = loader.discover(str(directory), pattern="test_*.py")
    if loader.errors:
        raise RuntimeError("\n".join(loader.errors))
    identifiers, modules = set(), set()
    for test in iter_tests(suite):
        identifier = test.id()
        if identifier in identifiers:
            raise ValueError(f"duplicate test: {identifier}")
        identifiers.add(identifier)
        module = test.__class__.__module__
        if module not in ownership:
            raise ValueError(f"unknown test module: {module}: {identifier}")
        modules.add(module)
    missing = ownership.keys() - modules
    if missing:
        raise ValueError(f"undiscovered test modules: {sorted(missing)}")
    historical, owned = split_suite(suite, ownership)
    return historical or unittest.TestSuite(), owned or unittest.TestSuite()


def main():
    try:
        historical, _ = partition_tests()
    except (RuntimeError, ValueError) as error:
        print(error, file=sys.stderr)
        return 1
    result = unittest.TextTestRunner(verbosity=2).run(historical)
    return 0 if result.wasSuccessful() else 1


if __name__ == "__main__":
    sys.exit(main())
