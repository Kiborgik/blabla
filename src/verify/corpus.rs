#[cfg(test)]
mod tests;

use crate::report::Call;
use serde_json::Value;

pub(super) const MAX_ENTRIES: usize = 128;

pub(super) struct Entry {
    pub(super) key: String,
    pub(super) state: Value,
    pub(super) sequence: Vec<Call>,
    pub(super) serial: usize,
    important: bool,
}

pub(super) struct Corpus {
    pub(super) entries: Vec<Entry>,
    pub(super) peak: usize,
    serial: usize,
}

impl Corpus {
    pub(super) fn new() -> Self {
        Self {
            entries: Vec::new(),
            peak: 0,
            serial: 0,
        }
    }

    pub(super) fn retain(&mut self, key: String, state: Value, sequence: &[Call], important: bool) {
        if let Some(entry) = self.entries.iter_mut().find(|entry| entry.key == key) {
            entry.important |= important;
            if sequence.len() < entry.sequence.len() {
                entry.state = state;
                entry.sequence = sequence.to_vec();
            }
            return;
        }
        self.serial += 1;
        let entry = Entry {
            key,
            state,
            sequence: sequence.to_vec(),
            serial: self.serial,
            important,
        };
        if self.entries.len() < MAX_ENTRIES {
            self.entries.push(entry);
        } else {
            let index = self
                .entries
                .iter()
                .enumerate()
                .max_by_key(|(_, entry)| (!entry.important, entry.sequence.len(), entry.serial))
                .map(|(i, _)| i)
                .unwrap();
            if important || sequence.len() <= self.entries[index].sequence.len() {
                self.entries[index] = entry;
            }
        }
        self.peak = self.peak.max(self.entries.len());
    }
}
