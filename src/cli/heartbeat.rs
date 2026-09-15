use blabla::verify::Progress;
use std::io::Write;
use std::time::{Duration, Instant};

pub const INTERVAL: Duration = Duration::from_secs(2);

pub struct Heartbeat<W: Write> {
    output: W,
    interval: Duration,
    last: Option<Instant>,
    latest: Option<Progress>,
    shrinking_announced: bool,
}

impl<W: Write> Heartbeat<W> {
    pub fn new(output: W, interval: Duration) -> Self {
        Self {
            output,
            interval,
            last: None,
            latest: None,
            shrinking_announced: false,
        }
    }

    pub fn header(&mut self, structure: &str, behavior: &str) {
        let _ = writeln!(
            self.output,
            "BlaBla finish\n\nCOMPLETION GATE: VERIFYING\n\nStructure:\n  {structure}\n\nBehavior:\n  {behavior}"
        );
        let _ = self.output.flush();
    }

    pub fn observe(&mut self, progress: &Progress, now: Instant) {
        self.latest = Some(*progress);
        if progress.shrinking {
            if !self.shrinking_announced {
                self.shrinking_announced = true;
                self.line(&format!(
                    "violation found after {} actions; confirming and reducing the counterexample",
                    progress.actions_executed
                ));
            }
            return;
        }
        let due = match self.last {
            None => true,
            Some(last) => now.duration_since(last) >= self.interval,
        };
        if due {
            self.last = Some(now);
            self.line(&Self::progress_line(progress));
        }
    }

    pub fn finish(&mut self) {
        if let Some(progress) = self.latest {
            let line = Self::progress_line(&progress);
            self.line(&line);
        }
        let _ = writeln!(self.output);
        let _ = self.output.flush();
    }

    fn progress_line(progress: &Progress) -> String {
        format!(
            "{}/{} obligations   {}/{} actions",
            progress.verified, progress.total, progress.actions_executed, progress.action_budget
        )
    }

    fn line(&mut self, text: &str) {
        let _ = writeln!(self.output, "  {text}");
        let _ = self.output.flush();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn progress(actions: usize, verified: usize, shrinking: bool) -> Progress {
        Progress {
            case_index: 0,
            cases: 1,
            actions_executed: actions,
            action_budget: 4096,
            verified,
            total: 355,
            shrinking,
        }
    }

    #[test]
    fn progress_lines_are_throttled_by_the_interval_and_always_close() {
        let mut heartbeat = Heartbeat::new(Vec::new(), Duration::from_secs(2));
        let start = Instant::now();
        heartbeat.header("none declared", "starting");
        heartbeat.observe(&progress(1, 3, false), start);
        heartbeat.observe(&progress(2, 4, false), start + Duration::from_millis(1000));
        heartbeat.observe(&progress(3, 5, false), start + Duration::from_millis(1999));
        heartbeat.observe(&progress(4, 6, false), start + Duration::from_millis(2100));
        heartbeat.observe(&progress(5, 7, false), start + Duration::from_millis(2500));
        heartbeat.observe(&progress(6, 8, true), start + Duration::from_millis(2600));
        heartbeat.observe(&progress(7, 8, true), start + Duration::from_millis(9000));
        heartbeat.observe(
            &progress(4096, 355, false),
            start + Duration::from_millis(9100),
        );
        heartbeat.finish();
        let text = String::from_utf8(heartbeat.output).unwrap();
        assert_eq!(
            text.lines()
                .filter(|line| line.contains("obligations") || line.contains("violation found"))
                .count(),
            5,
            "{text}"
        );
        assert!(
            text.starts_with("BlaBla finish\n\nCOMPLETION GATE: VERIFYING\n"),
            "{text}"
        );
        assert!(
            text.contains("  3/355 obligations   1/4096 actions\n"),
            "{text}"
        );
        assert!(!text.contains("4/355 obligations"), "{text}");
        assert!(
            text.contains("  6/355 obligations   4/4096 actions\n"),
            "{text}"
        );
        assert!(text.contains("violation found after 6 actions"), "{text}");
        assert!(
            text.ends_with("  355/355 obligations   4096/4096 actions\n\n"),
            "{text}"
        );
    }
}
