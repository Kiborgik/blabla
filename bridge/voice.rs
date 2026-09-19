use blabla::skeptic::ChallengeReport;
use blabla::voice::{Voice, contradiction, keeps_the_neutral_statement, speaks_bluntly};
use serde_json::{Value, json};

pub struct Tone {
    voice: Voice,
}

impl Tone {
    pub fn new() -> Tone {
        Tone {
            voice: Voice::default(),
        }
    }

    pub fn call(&mut self, name: &str) -> bool {
        match name {
            "select_the_neutral_voice" => {
                self.voice = Voice::Neutral;
                true
            }
            "select_the_blunt_voice" => {
                self.voice = Voice::Blunt;
                true
            }
            _ => false,
        }
    }

    pub fn observe(&self, report: &ChallengeReport) -> Value {
        let standing: Vec<Value> = report
            .grounded
            .iter()
            .map(|class| json!({ "class": class }))
            .collect();
        let rendered = report.challenge.as_ref().map(|challenge| {
            (
                challenge.statement.clone(),
                contradiction(self.voice, challenge.class.word(), &challenge.statement),
            )
        });
        let keeps = match &rendered {
            Some((neutral, shown)) => keeps_the_neutral_statement(neutral, shown),
            None => true,
        };
        let blunt = match &rendered {
            Some((_, shown)) => speaks_bluntly(shown),
            None => false,
        };
        let adds = match &rendered {
            Some((neutral, shown)) => shown.len() > neutral.len(),
            None => false,
        };
        json!({
            "voice": self.voice.word(),
            "voiced_standing": standing,
            "voiced_exit": report.exit_code(),
            "voiced_record": serde_json::to_string(report).unwrap_or_default(),
            "voiced_keeps_the_statement": keeps,
            "voiced_speaks_bluntly": blunt,
            "voiced_adds_wording": adds,
        })
    }
}
