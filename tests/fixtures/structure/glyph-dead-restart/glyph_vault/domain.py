from model import VAULT_IDS, DurableVault, Vault


class VaultDomain:
    def __init__(self, saved=()):
        self.reset()
        for item in saved:
            self.vaults[item.id] = Vault(item.id, item.keeper, item.glyph, item.charge, 0, item.sealed, item.quarantined)

    def reset(self):
        self.vaults = {key: Vault(key) for key in VAULT_IDS}

    def observe(self):
        return {"vaults": [vars(self.vaults[key]).copy() for key in VAULT_IDS]}

    def snapshot(self):
        return [DurableVault(v.id, v.keeper, v.glyph, v.charge, v.sealed, v.quarantined) for v in self.vaults.values()]

    def owned(self, key, keeper):
        vault = self.vaults.get(key)
        if vault is None or vault.keeper is None or vault.keeper != keeper:
            return None
        return vault

    def bind(self, key, keeper, glyph, charge):
        vault = self.vaults.get(key)
        if vault is None or vault.keeper is not None or not 1 <= charge <= 9:
            return
        if any(other.glyph == glyph for other in self.vaults.values() if other.keeper is not None):
            return
        vault.keeper, vault.glyph, vault.charge, vault.phase = keeper, glyph, charge, 0
        vault.sealed = False
        vault.quarantined = False
        vault.resonance = 0

    def pulse(self, key, keeper, amount):
        vault = self.owned(key, keeper)
        if vault is None or vault.sealed or vault.quarantined or not 0 <= amount <= 9:
            return
        if vault.phase == 0:
            vault.charge = amount
            vault.resonance = 0
        else:
            vault.charge = min(9, vault.charge + amount)

    def rotate(self, key, keeper):
        vault = self.owned(key, keeper)
        if vault is None or vault.sealed:
            return
        vault.phase = 1 - vault.phase
        if vault.phase == 0 and vault.charge > 5:
            vault.charge = 5
            vault.resonance = 0
        else:
            vault.resonance += 1
        if vault.quarantined and vault.charge % 2 == 0:
            vault.quarantined = False

    def attune(self, key, keeper):
        vault = self.owned(key, keeper)
        if vault is None or vault.sealed or vault.quarantined or vault.phase != 1 or vault.resonance < 2:
            return
        vault.charge = min(9, vault.charge + vault.resonance)
        vault.resonance = 0

    def echo(self, source, target, keeper):
        origin = self.owned(source, keeper)
        destination = self.vaults.get(target)
        if source == target or origin is None or destination is None or destination.keeper is None:
            return
        if origin.sealed or destination.sealed or origin.quarantined or origin.resonance < 1 or origin.phase != destination.phase:
            return
        if destination.quarantined and origin.phase != 0:
            return
        destination.resonance += origin.resonance
        origin.resonance = 0

    def recover(self, key, keeper):
        vault = self.owned(key, keeper)
        if vault is None or not vault.quarantined or vault.resonance < 3:
            return
        vault.quarantined = False
        vault.phase = 0
        vault.resonance = 0

    def restart(self):
        for vault in self.vaults.values():
            vault.resonance = 0

    def transfer(self, source, target, keeper, amount):
        origin = self.owned(source, keeper)
        destination = self.vaults.get(target)
        if source == target or origin is None or destination is None or destination.keeper is None:
            return
        if origin.sealed or destination.sealed or origin.quarantined or origin.phase == destination.phase or amount <= 0 or origin.charge < amount:
            return
        if destination.quarantined and origin.phase != 0:
            return
        if destination.charge + amount > 9:
            return
        origin.charge -= amount
        destination.charge += amount

    def release(self, key, keeper):
        vault = self.owned(key, keeper)
        if vault is None or vault.sealed or vault.quarantined or vault.charge != 0:
            return
        vault.keeper, vault.glyph, vault.charge, vault.phase = None, None, 0, 0
        vault.sealed = False
        vault.quarantined = False
        vault.resonance = 0

    def seal(self, key, keeper):
        vault = self.owned(key, keeper)
        if vault is None or vault.sealed or vault.quarantined or vault.phase != 1 or vault.charge != 5:
            return
        vault.sealed = True

    def unseal(self, key, keeper):
        vault = self.owned(key, keeper)
        if vault is not None:
            vault.sealed = False

    def quarantine(self, key, keeper):
        vault = self.owned(key, keeper)
        if vault is None or vault.sealed or vault.quarantined or vault.phase != 1 or vault.charge % 2 == 0:
            return
        vault.quarantined = True

    def clear_quarantine(self, key, keeper):
        vault = self.owned(key, keeper)
        if vault is not None:
            vault.quarantined = False
