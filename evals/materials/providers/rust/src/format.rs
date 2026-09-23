use crate::model::Widget;

pub fn encode(widgets: &[Widget]) -> String {
    let rows: Vec<String> = widgets
        .iter()
        .map(|widget| format!("{{\"id\":{},\"text\":{:?}}}", widget.id, widget.text))
        .collect();
    format!("[{}]", rows.join(","))
}

pub fn decode(text: &str) -> Vec<Widget> {
    let mut widgets = Vec::new();
    for row in text.trim_matches(|c| c == '[' || c == ']').split("},") {
        let id = row
            .split("\"id\":")
            .nth(1)
            .and_then(|rest| rest.split(',').next())
            .and_then(|value| value.trim().parse::<i64>().ok());
        let text = row.split("\"text\":\"").nth(1).map(|rest| rest.trim_end_matches(|c| c == '"' || c == '}').to_string());
        if let (Some(id), Some(text)) = (id, text) {
            widgets.push(Widget { id, text });
        }
    }
    widgets
}
