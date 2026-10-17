use super::Task;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub const PHASES: [&str; 5] = [
    "development",
    "verification",
    "review",
    "integration",
    "blocked",
];

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Interval {
    pub worker: String,
    pub model: String,
    pub phase: String,
    pub started_unix: u64,
    pub ended_unix: Option<u64>,
    pub completion: Option<String>,
    pub reason: Option<String>,
}

impl Interval {
    pub fn validate(&self) -> Result<(), String> {
        if self.worker.trim().is_empty()
            || self.model.trim().is_empty()
            || !PHASES.contains(&self.phase.as_str())
        {
            return Err("invalid effort worker, model or phase".into());
        }
        match (self.ended_unix, self.completion.as_deref()) {
            (None, None) => {}
            (Some(end), Some("attested" | "unknown")) if end >= self.started_unix => {}
            _ => return Err("invalid effort endpoint or completion".into()),
        }
        if (self.phase == "blocked" || self.completion.as_deref() == Some("unknown"))
            && self.reason.as_deref().is_none_or(|r| r.trim().is_empty())
        {
            return Err("blocked or unknown effort requires a reason".into());
        }
        Ok(())
    }
}

pub fn switch(
    tasks: &mut [Task],
    name: &str,
    worker: &str,
    model: &str,
    phase: &str,
    reason: Option<&str>,
    now: u64,
) -> Result<bool, String> {
    if worker.trim().is_empty()
        || model.trim().is_empty()
        || !(PHASES.contains(&phase) || ["stop", "interrupt"].contains(&phase))
    {
        return Err(
            "phase requires a nonblank worker/model and a declared phase, stop or interrupt".into(),
        );
    }
    if ["blocked", "interrupt"].contains(&phase) && reason.is_none_or(|r| r.trim().is_empty()) {
        return Err("blocked or interrupt requires a concrete reason".into());
    }
    let target = tasks
        .iter()
        .position(|t| t.name == name)
        .ok_or("task not found")?;
    let mut open = None;
    let mut spans = Vec::new();
    for (ti, task) in tasks.iter().enumerate() {
        for (ii, interval) in task.work_intervals.iter().enumerate() {
            interval.validate()?;
            if interval.worker != worker {
                continue;
            }
            if interval.started_unix > now || interval.ended_unix.is_some_and(|end| end > now) {
                return Err(
                    "clock precedes recorded worker effort; no interval was changed".into(),
                );
            }
            spans.push((
                interval.started_unix,
                interval.ended_unix.unwrap_or(u64::MAX),
            ));
            if interval.ended_unix.is_none() && open.replace((ti, ii)).is_some() {
                return Err("worker has multiple pending intervals".into());
            }
        }
    }
    spans.sort_unstable();
    let mut latest_end = 0;
    for (start, end) in spans {
        if start < latest_end && end > start {
            return Err("worker intervals overlap".into());
        }
        latest_end = latest_end.max(end);
    }
    if let Some((ti, ii)) = open {
        let interval = &tasks[ti].work_intervals[ii];
        if ti != target {
            return Err("worker already has an active interval on another task; stop it before switching tasks".into());
        }
        if interval.model != model {
            return Err("pending interval belongs to a different attested model".into());
        }
        if interval.phase == phase && interval.reason.as_deref() == reason {
            return Ok(false);
        }
    } else if ["stop", "interrupt"].contains(&phase) {
        return Err("worker has no pending interval on this task".into());
    }
    if let Some((ti, ii)) = open {
        let interval = &mut tasks[ti].work_intervals[ii];
        interval.ended_unix = Some(now);
        interval.completion = Some(
            if phase == "interrupt" {
                "unknown"
            } else {
                "attested"
            }
            .into(),
        );
        if phase == "interrupt" {
            interval.reason = reason.map(str::to_owned);
        }
    }
    if PHASES.contains(&phase) {
        tasks[target].work_intervals.push(Interval {
            worker: worker.into(),
            model: model.into(),
            phase: phase.into(),
            started_unix: now,
            ended_unix: None,
            completion: None,
            reason: reason.map(str::to_owned),
        });
    }
    Ok(true)
}

#[derive(Clone, Debug, Serialize)]
pub struct Budget {
    pub projects: Vec<String>,
    pub since: Option<u64>,
    pub until: Option<u64>,
    pub phase_seconds: BTreeMap<String, u64>,
    pub active_seconds: u64,
    pub totals_valid: bool,
    pub overhead_seconds: u64,
    pub blocked_seconds: u64,
    pub observed_fraction: Option<f64>,
    pub target_fraction: f64,
    pub observed_target: String,
    pub coverage: String,
    pub legacy_tasks: usize,
    pub pending_intervals: usize,
    pub unknown_intervals: usize,
    pub interval_count: usize,
    pub diagnostics: Vec<String>,
    pub intervals: Vec<serde_json::Value>,
    pub omitted_intervals: usize,
    pub limit: usize,
    pub authority: &'static str,
}

pub fn budget(
    records: &[(String, Task)],
    projects: Vec<String>,
    since: Option<u64>,
    until: Option<u64>,
    mut diagnostics: Vec<String>,
) -> Budget {
    let mut totals: BTreeMap<String, u64> = PHASES.into_iter().map(|p| (p.into(), 0)).collect();
    let mut workers: BTreeMap<&str, Vec<(u64, u64, String)>> = BTreeMap::new();
    let mut rows = Vec::new();
    let mut count = 0;
    let mut pending = 0;
    let mut unknown = 0;
    let mut legacy = 0;
    if since.zip(until).is_some_and(|(a, b)| a > b) {
        diagnostics.push("window start is after its end".into());
    }
    for (project, task) in records {
        if task.work_intervals.is_empty() {
            legacy += 1;
        }
        for (index, interval) in task.work_intervals.iter().enumerate() {
            count += 1;
            if rows.len() < 50 {
                rows.push(
                    serde_json::json!({"project":project,"task":task.name,"interval":interval}),
                );
            }
            if let Err(error) = interval.validate() {
                diagnostics.push(format!("{project}/{} interval {index}: {error}", task.name));
                continue;
            }
            let start = interval.started_unix.max(since.unwrap_or(0));
            let end = interval
                .ended_unix
                .unwrap_or(u64::MAX)
                .min(until.unwrap_or(u64::MAX));
            if start < end {
                workers.entry(&interval.worker).or_default().push((
                    start,
                    end,
                    format!("{project}/{}:{index}", task.name),
                ));
            }
            if interval.ended_unix.is_none() {
                pending += 1;
                continue;
            }
            if interval.completion.as_deref() == Some("unknown") {
                unknown += 1;
                continue;
            }
            let seconds = end.saturating_sub(start);
            let value = totals.get_mut(&interval.phase).expect("validated phase");
            if let Some(next) = value.checked_add(seconds) {
                *value = next;
            } else {
                diagnostics.push("phase total exceeds supported seconds".into());
            }
        }
    }
    for (worker, spans) in &mut workers {
        spans.sort();
        let mut end = 0;
        for (start, stop, origin) in spans {
            if *start < end {
                diagnostics.push(format!("worker {worker} overlaps at {origin}"));
            }
            end = end.max(*stop);
        }
    }
    let overhead = ["verification", "review", "integration"]
        .into_iter()
        .try_fold(0u64, |sum, p| sum.checked_add(totals[p]));
    let active = overhead.and_then(|sum| sum.checked_add(totals["development"]));
    if active.is_none() {
        diagnostics.push("active total exceeds supported seconds".into());
    }
    diagnostics.sort();
    diagnostics.dedup();
    let valid = diagnostics.is_empty();
    let active = active.unwrap_or(0);
    let overhead = overhead.unwrap_or(0);
    let fraction = (valid && active > 0).then_some(overhead as f64 / active as f64);
    let target = if !valid {
        "invalid"
    } else if active == 0 {
        "no-active-time"
    } else if u128::from(overhead) * 5 <= u128::from(active) {
        "within"
    } else {
        "above"
    };
    Budget {
        projects,
        since,
        until,
        blocked_seconds: totals["blocked"],
        phase_seconds: totals,
        active_seconds: active,
        totals_valid: valid,
        overhead_seconds: overhead,
        observed_fraction: fraction,
        target_fraction: 0.2,
        observed_target: target.into(),
        coverage: if count == 0 { "unknown" } else { "partial" }.into(),
        legacy_tasks: legacy,
        pending_intervals: pending,
        unknown_intervals: unknown,
        interval_count: count,
        omitted_intervals: count.saturating_sub(rows.len()),
        intervals: rows,
        limit: 50,
        diagnostics,
        authority: "Attested active elapsed worker time only; partial coverage never establishes whole-project compliance or changes verification/closure authority.",
    }
}
