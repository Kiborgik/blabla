use super::*;
use serde_json::json;

fn trace(length: usize) -> Vec<Call> {
    (0..length)
        .map(|_| Call {
            action: "step".into(),
            args: vec![],
        })
        .collect()
}

#[test]
fn new_frontier_retains_prefix_and_shorter_trace_replaces_it() {
    let mut corpus = Corpus::new();
    corpus.retain(
        "interesting".into(),
        json!({"phase":1,"charge":5}),
        &trace(4),
        false,
    );
    assert_eq!(corpus.entries.len(), 1);
    assert_eq!(corpus.entries[0].sequence.len(), 4);
    corpus.retain(
        "interesting".into(),
        json!({"phase":1,"charge":5}),
        &trace(2),
        false,
    );
    assert_eq!(corpus.entries[0].sequence.len(), 2);
}

#[test]
fn redundant_and_novel_traces_remain_bounded() {
    let mut corpus = Corpus::new();
    for i in 0..1000 {
        corpus.retain("same".into(), json!(i), &trace(1), false);
    }
    assert_eq!(corpus.entries.len(), 1);
    for i in 0..1000 {
        corpus.retain(format!("{i}"), json!(i), &trace(i % 16 + 1), false);
    }
    assert_eq!(corpus.entries.len(), MAX_ENTRIES);
    assert_eq!(corpus.peak, MAX_ENTRIES);
}
