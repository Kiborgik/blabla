from domain import VaultDomain
from protocol import Protocol
from store import VaultStore


def main():
    store = VaultStore()
    domain = VaultDomain(store.load())

    def commit():
        store.save(domain.snapshot())

    def reset():
        store.clear()
        domain.reset()
        commit()

    Protocol(domain, commit, reset).serve()


if __name__ == "__main__":
    main()
