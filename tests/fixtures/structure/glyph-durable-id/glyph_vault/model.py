from dataclasses import dataclass

VAULT_IDS = ("A", "B", "C")
DURABLE_FIELDS = ("id", "keeper", "glyph", "charge", "sealed", "quarantined")


@dataclass
class Vault:
    id: str
    keeper: str | None = None
    glyph: str | None = None
    charge: int = 0
    phase: int = 0
    sealed: bool = False
    quarantined: bool = False
    resonance: int = 0


@dataclass
class DurableVault:
    id: str
    keeper: str | None
    glyph: str | None
    charge: int
    sealed: bool
    quarantined: bool
