use blabla::project::digest_of;
use blabla::project::status::RECORD_DIRECTORY;
use std::path::Path;
use std::sync::OnceLock;

pub const BIN_DIRECTORY: &str = "bin";
pub const SERVED: [&str; 2] = ["task", "explain"];
pub const WITHHELD: [&str; 4] = ["finish", "status", "run", "check"];

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Identity {
    pub version: String,
    pub digest: String,
    pub recovery: bool,
}

impl Identity {
    pub fn stamp(&self) -> String {
        format!("{} {}", self.version, self.digest)
    }
}

pub fn detect(executable: &Path) -> Option<Identity> {
    let directory = executable.parent()?;
    let file = executable.file_name()?.to_str()?;
    Some(Identity {
        version: env!("CARGO_PKG_VERSION").to_owned(),
        digest: digest_of(directory, file)?,
        recovery: installed(directory),
    })
}

fn installed(directory: &Path) -> bool {
    directory
        .file_name()
        .is_some_and(|name| name == BIN_DIRECTORY)
        && directory
            .parent()
            .and_then(Path::file_name)
            .is_some_and(|name| name == RECORD_DIRECTORY)
}

pub fn running() -> Option<&'static Identity> {
    static BUILD: OnceLock<Option<Identity>> = OnceLock::new();
    BUILD
        .get_or_init(|| {
            std::env::current_exe()
                .ok()
                .and_then(|executable| detect(&executable))
        })
        .as_ref()
}

pub fn matches(identity: &Identity, recorded: Option<&str>) -> bool {
    recorded.is_some_and(|stamp| stamp == identity.stamp())
}

pub fn foreign(identity: Option<&Identity>, recorded: Option<&str>) -> bool {
    identity.is_some_and(|identity| identity.recovery && !matches(identity, recorded))
}

pub fn refuse_write(identity: &Identity, recorded: Option<&str>) -> Option<String> {
    if !foreign(Some(identity), recorded) {
        return None;
    }
    let seen = match recorded {
        Some(stamp) => format!("was last written by {stamp}"),
        None => "names no build that wrote it".to_owned(),
    };
    Some(format!(
        "this recovery build is {stamp} and the record {seen}; writing it back would silently drop whatever this build cannot represent. Read it here, write it with the build that owns it, or open a new task with this one.",
        stamp = identity.stamp()
    ))
}

pub fn withhold(identity: &Identity, verb: &str) -> Option<String> {
    if !identity.recovery || !WITHHELD.contains(&verb) {
        return None;
    }
    Some(format!(
        "this recovery build is {stamp}, installed under {RECORD_DIRECTORY}/{BIN_DIRECTORY}; it is not the candidate under verification, so its {verb} would not be evidence about this project. It withholds only {withheld}; everything else runs, and {served} are what it is installed for.",
        withheld = WITHHELD.join(", "),
        stamp = identity.stamp(),
        served = SERVED.join(" and ")
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use tempfile::TempDir;

    fn binary(root: &Path, relative: &str) -> PathBuf {
        let path = root.join(relative);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, relative.as_bytes()).unwrap();
        path
    }

    #[test]
    fn a_build_beside_the_records_is_a_recovery_build() {
        let temp = TempDir::new().unwrap();
        let installed = binary(temp.path(), ".blabla/bin/blabla");
        let candidate = binary(temp.path(), "target/debug/blabla");
        assert!(detect(&installed).unwrap().recovery);
        assert!(!detect(&candidate).unwrap().recovery);
    }

    #[test]
    fn a_candidate_build_withholds_nothing_and_writes_any_record() {
        let temp = TempDir::new().unwrap();
        let identity = detect(&binary(temp.path(), "target/debug/blabla")).unwrap();
        for verb in WITHHELD {
            assert_eq!(withhold(&identity, verb), None);
        }
        assert_eq!(refuse_write(&identity, Some("0.0.0 elsewhere")), None);
        assert_eq!(refuse_write(&identity, None), None);
    }

    #[test]
    fn a_recovery_build_withholds_every_withheld_verb_and_serves_the_rest() {
        let temp = TempDir::new().unwrap();
        let identity = detect(&binary(temp.path(), ".blabla/bin/blabla")).unwrap();
        for verb in WITHHELD {
            assert!(withhold(&identity, verb).is_some());
        }
        for verb in SERVED {
            assert_eq!(withhold(&identity, verb), None);
        }
    }

    #[test]
    fn a_recovery_build_writes_its_own_record_and_refuses_a_foreign_one() {
        let temp = TempDir::new().unwrap();
        let identity = detect(&binary(temp.path(), ".blabla/bin/blabla")).unwrap();
        assert_eq!(refuse_write(&identity, Some(&identity.stamp())), None);
        assert!(refuse_write(&identity, Some("0.0.0 elsewhere")).is_some());
        assert!(refuse_write(&identity, None).is_some());
    }

    #[test]
    fn an_unstamped_record_is_not_the_same_fact_as_a_mismatched_one() {
        let temp = TempDir::new().unwrap();
        let identity = detect(&binary(temp.path(), ".blabla/bin/blabla")).unwrap();
        let absent = refuse_write(&identity, None).unwrap();
        let mismatched = refuse_write(&identity, Some("0.0.0 elsewhere")).unwrap();
        assert_ne!(absent, mismatched);
        assert!(absent.contains("names no build"));
        assert!(mismatched.contains("0.0.0 elsewhere"));
    }

    #[test]
    fn two_builds_of_the_same_version_are_told_apart_by_their_digest() {
        let temp = TempDir::new().unwrap();
        let one = detect(&binary(temp.path(), ".blabla/bin/blabla")).unwrap();
        let other = detect(&binary(temp.path(), "target/debug/blabla")).unwrap();
        assert_eq!(one.version, other.version);
        assert_ne!(one.stamp(), other.stamp());
        assert!(!matches(&one, Some(&other.stamp())));
    }
}
