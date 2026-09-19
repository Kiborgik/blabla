use serde::{Deserialize, Serialize};

pub const VOICES: [&str; 2] = ["neutral", "blunt"];

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Voice {
    #[default]
    Neutral,
    Blunt,
}

impl Voice {
    pub fn parse(word: &str) -> Option<Voice> {
        match word {
            "neutral" => Some(Voice::Neutral),
            "blunt" => Some(Voice::Blunt),
            _ => None,
        }
    }

    pub fn word(self) -> &'static str {
        match self {
            Voice::Neutral => VOICES[0],
            Voice::Blunt => VOICES[1],
        }
    }
}

pub const BLUNT: [(&str, &str); 13] = [
    (
        "declared-check-failed",
        "This is not fucking ready. Fix the check or record the actual blocker.",
    ),
    (
        "unresolved-finding",
        "Findings do not settle themselves. Resolve it or say what blocks it.",
    ),
    (
        "deliverable-unchanged",
        "You owe a deliverable that has not moved. Do the work or drop the claim.",
    ),
    (
        "scope-breach",
        "That path is outside the scope this task took. Widen it on the record or put it back.",
    ),
    (
        "vacuous-rule",
        "That rule is standing on nothing. It proves fuck all until it can fail.",
    ),
    (
        "verification-not-current",
        "The recorded run does not describe this tree. Run it again.",
    ),
    (
        "work-without-acceptance",
        "Nobody took this assignment. Accept it or stop calling this work.",
    ),
    (
        "model-outside-role-policy",
        "That model is outside the role's policy. Propose it properly or use one the role permits.",
    ),
    (
        "exception-unresolved",
        "The owner has not ruled. Stop treating the exception as settled.",
    ),
    (
        "lens-unassessed",
        "A declared lens was never assessed. Assess it or take it off the role.",
    ),
    (
        "readiness-without-evidence",
        "Readiness with no evidence is a fucking guess. Run the declared check and record it.",
    ),
    (
        "evidence-superseded",
        "That evidence describes a tree that has moved. Run the declared check again.",
    ),
    (
        "attribution-unknown",
        "A change appeared that nobody claimed. Attribute it before handing back.",
    ),
];

pub fn contradiction(voice: Voice, class: &str, neutral: &str) -> String {
    match voice {
        Voice::Neutral => neutral.to_owned(),
        Voice::Blunt => match BLUNT.iter().find(|(name, _)| *name == class) {
            Some((_, blunt)) => format!("{neutral} {blunt}"),
            None => neutral.to_owned(),
        },
    }
}

pub fn keeps_the_neutral_statement(neutral: &str, rendered: &str) -> bool {
    rendered.starts_with(neutral)
}

pub fn speaks_bluntly(rendered: &str) -> bool {
    BLUNT.iter().any(|(_, blunt)| rendered.contains(blunt))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::skeptic::CLASSES;

    #[test]
    fn every_challenge_class_has_exactly_one_blunt_rendering() {
        let mut named: Vec<&str> = BLUNT.iter().map(|(name, _)| *name).collect();
        named.sort();
        let mut classes: Vec<&str> = CLASSES.to_vec();
        classes.sort();
        assert_eq!(named, classes);
    }

    #[test]
    fn the_neutral_voice_never_speaks_bluntly() {
        for class in CLASSES {
            let rendered = contradiction(Voice::Neutral, class, "the declared check failed");
            assert_eq!(rendered, "the declared check failed");
            assert!(!speaks_bluntly(&rendered));
        }
    }

    #[test]
    fn a_blunt_rendering_carries_the_whole_neutral_statement() {
        for class in CLASSES {
            let neutral = format!("the evidence for {class} is what it is");
            let rendered = contradiction(Voice::Blunt, class, &neutral);
            assert!(keeps_the_neutral_statement(&neutral, &rendered));
            assert!(rendered.len() > neutral.len());
            assert!(speaks_bluntly(&rendered));
        }
    }

    #[test]
    fn a_message_that_is_not_a_contradiction_has_no_blunt_rendering() {
        let neutral = "structure is GREEN and behavior was never run";
        assert_eq!(
            contradiction(Voice::Blunt, "no-such-class", neutral),
            neutral
        );
    }

    #[test]
    fn every_declared_voice_word_parses_back_to_itself() {
        for word in VOICES {
            assert_eq!(Voice::parse(word).map(Voice::word), Some(word));
        }
        assert_eq!(Voice::parse("shouty"), None);
        assert_eq!(Voice::default(), Voice::Neutral);
    }
}
