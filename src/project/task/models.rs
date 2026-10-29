use crate::memory::process::{self, ProcessMemory};

pub fn permitted(memory: &ProcessMemory, role: &str) -> Vec<String> {
    let mut permitted = process::permitted_models(memory, role);
    let families: Vec<String> = permitted
        .iter()
        .filter(|entry| entry.ends_with('*'))
        .cloned()
        .collect();
    for alias in &memory.aliases {
        if process::admits(&families, &alias.model) && !permitted.contains(&alias.name) {
            permitted.push(alias.name.clone());
        }
    }
    permitted
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entries(names: &[&str]) -> Vec<String> {
        names.iter().map(|name| (*name).to_owned()).collect()
    }

    #[test]
    fn a_family_admits_every_id_it_prefixes_and_an_exact_entry_only_itself() {
        let permitted = entries(&["sonnet-*", "qwen3.5:9b"]);
        for (model, admitted) in [
            ("sonnet-5.5", true),
            ("sonnet-", true),
            ("sonnet", false),
            ("qwen3.5:9b", true),
            ("qwen3.5:9b-instruct", false),
            ("qwen3.5:4b", false),
        ] {
            assert_eq!(process::admits(&permitted, model), admitted, "{model}");
        }
    }

    #[test]
    fn a_family_admits_an_alias_whose_target_it_prefixes() {
        let mut memory = ProcessMemory::default();
        memory.roles.push(process::Role {
            name: "worker".to_owned(),
            purpose: "carry".to_owned(),
            owns: Vec::new(),
            verification: None,
            model: entries(&["fam-*", "exact"]),
            consult: Vec::new(),
            block_below: 0,
        });
        for (name, model) in [("nick", "fam-y"), ("other", "elsewhere"), ("same", "exact")] {
            memory.aliases.push(process::Alias {
                name: name.to_owned(),
                model: model.to_owned(),
            });
        }
        assert_eq!(
            permitted(&memory, "worker"),
            entries(&["fam-*", "exact", "same", "nick"])
        );
    }
}
