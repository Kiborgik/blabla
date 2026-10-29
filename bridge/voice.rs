use super::component::Component;
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
}

impl Component for Tone {
    fn call(&mut self, name: &str, _args: &Value) -> Option<Result<(), String>> {
        self.voice = match name {
            "select_the_neutral_voice" => Voice::Neutral,
            "select_the_blunt_voice" => Voice::Blunt,
            _ => return None,
        };
        Some(Ok(()))
    }

    fn observe(&self, observed: &Value) -> Value {
        let headline = &observed["headline"];
        let rendered = headline["class"]
            .as_str()
            .zip(headline["statement"].as_str())
            .map(|(class, statement)| {
                (
                    statement.to_owned(),
                    contradiction(self.voice, class, statement),
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
            "voiced_standing": observed.get("standing").cloned().unwrap_or_else(|| json!([])),
            "voiced_exit": i32::from(rendered.is_some()),
            "voiced_keeps_the_statement": keeps,
            "voiced_speaks_bluntly": blunt,
            "voiced_adds_wording": adds,
        })
    }
}
