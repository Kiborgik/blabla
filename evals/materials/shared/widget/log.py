import sys


def note(message):
    print(message, file=sys.stderr, flush=True)
