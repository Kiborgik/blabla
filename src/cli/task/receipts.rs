use super::*;

fn read_last_lines(path: &std::path::Path, count: usize) -> io::Result<Vec<String>> {
    let contents = std::fs::read_to_string(path)?;
    Ok(contents
        .lines()
        .filter(|line| !line.trim().is_empty())
        .rev()
        .take(count)
        .map(|s| s.to_owned())
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect())
}

fn write_failing_evidence(
    output: &mut impl Write,
    root: &std::path::Path,
    evidence: &task::Evidence,
) -> io::Result<()> {
    if evidence.tool != "run" || evidence.exit == 0 {
        return Ok(());
    }

    if let Some(log_path_str) = &evidence.log {
        let log_path = root.join(log_path_str);
        match read_last_lines(&log_path, 20) {
            Ok(lines) if !lines.is_empty() => {
                writeln!(output, "  Last {} non-empty lines:", lines.len())?;
                for line in lines {
                    writeln!(output, "    {}", line)?;
                }
            }
            Ok(_) => {
                writeln!(output, "  (log file is empty or contains only whitespace)")?;
            }
            Err(_) => {
                writeln!(output, "  (could not read log file)")?;
            }
        }
    }
    Ok(())
}

pub(super) fn write_evidence_receipt(
    output: &mut impl Write,
    evidence: &task::Evidence,
) -> io::Result<()> {
    writeln!(
        output,
        "\nLatest evidence:\n  tool {}   {}   acceptance epoch {}   exit {}",
        evidence.tool,
        task::evidence_kind(evidence),
        epoch_label(evidence.acceptance_epoch),
        evidence.exit
    )?;
    if let Some(reuse) = &evidence.reuse {
        writeln!(
            output,
            "  original execution {}   explicitly reused {} by {}",
            evidence.unix, reuse.unix, reuse.model
        )?;
        writeln!(
            output,
            "  original evidence {} epoch {}: {}",
            reuse.original_index, reuse.original_epoch, reuse.reason
        )?;
    }
    if let Some(log) = &evidence.log {
        writeln!(output, "  log {log}")?;
    }
    Ok(())
}

pub(super) fn epoch_label(epoch: Option<u64>) -> String {
    epoch.map_or_else(|| "none".to_owned(), |epoch| epoch.to_string())
}

pub(super) fn write_evidence(
    output: &mut impl Write,
    root: &std::path::Path,
    task: &Task,
) -> io::Result<()> {
    if let Some(latest) = task.evidence.last() {
        write_evidence_receipt(output, latest)?;
        write_failing_evidence(output, root, latest)?;
    }
    if !task.assessments.is_empty() {
        writeln!(output, "\nLens assessments:")?;
        for assessment in &task.assessments {
            writeln!(
                output,
                "  {} by {} at acceptance epoch {}: {}",
                assessment.ruling,
                assessment.model.as_deref().unwrap_or("none"),
                epoch_label(assessment.acceptance_epoch),
                assessment.statement
            )?;
        }
    }
    Ok(())
}
