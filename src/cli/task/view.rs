use super::*;

#[derive(Serialize)]
pub(super) struct TaskView<'a> {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) model_acceptance: Option<model_acceptance::Guidance>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) evidence_progress: Option<serde_json::Value>,
    #[serde(serialize_with = "with_evidence_kind")]
    pub(super) task: &'a Task,
    pub(super) review_accepted: Option<bool>,
    pub(super) review_current: Option<bool>,
    pub(super) approval_current: Option<bool>,
    pub(super) decisions: Vec<DecisionStateView<'a>>,
    pub(super) assessment_current: Vec<bool>,
    pub(super) open: bool,
    pub(super) orchestrator_declared: bool,
    pub(super) unresolved: usize,
    pub(super) unresolved_findings: Vec<usize>,
    pub(super) possibly_incomplete: bool,
    pub(super) changed_since_open: Vec<String>,
    pub(super) changed_elsewhere: usize,
    pub(super) attributions: Vec<task::PathOwner>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) challenge_classes: Option<ChallengeClasses>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) affected_intents: Option<Vec<String>>,
    pub(super) reviewed_target_readable: Option<bool>,
    pub(super) reviewed_changed_since_open: Vec<String>,
    pub(super) reviewed_changed_elsewhere: usize,
    pub(super) swallowed_check_argv: Vec<String>,
    pub(super) on_disk: BTreeMap<String, String>,
    pub(super) routes: Vec<&'static str>,
    pub(super) authority: &'static str,
}

#[derive(Serialize)]
pub(super) struct ChallengeClasses {
    pub(super) grounded: Vec<&'static str>,
    pub(super) assignment_blockers: Vec<&'static str>,
    pub(super) project_challenges: Vec<&'static str>,
}

impl From<ChallengeReport> for ChallengeClasses {
    fn from(report: ChallengeReport) -> Self {
        Self {
            grounded: report.grounded,
            assignment_blockers: report.assignment_blockers,
            project_challenges: report.project_challenges,
        }
    }
}

fn with_evidence_kind<S: serde::Serializer>(
    record: &&Task,
    serializer: S,
) -> Result<S::Ok, S::Error> {
    let mut shown = serde_json::to_value(record).map_err(serde::ser::Error::custom)?;
    if let Some(entries) = shown
        .get_mut("evidence")
        .and_then(serde_json::Value::as_array_mut)
    {
        for (entry, evidence) in entries.iter_mut().zip(&record.evidence) {
            entry["executed"] = serde_json::Value::Bool(task::executed(evidence));
        }
    }
    shown.serialize(serializer)
}

#[derive(Serialize, PartialEq, Eq, PartialOrd, Ord)]
pub(super) struct FingerprintChange {
    pub(super) change: &'static str,
    pub(super) recorded: Option<String>,
    pub(super) current: Option<String>,
}

pub(super) fn fingerprint_change(
    recorded: Option<Option<&str>>,
    current: Option<Option<&str>>,
) -> Option<FingerprintChange> {
    if recorded == current {
        return None;
    }
    Some(FingerprintChange {
        change: blabla::project::status::change_label(recorded, current),
        recorded: recorded.flatten().map(str::to_owned),
        current: current.flatten().map(str::to_owned),
    })
}

#[derive(Serialize)]
pub(super) struct DecisionStateView<'a> {
    pub(super) id: usize,
    pub(super) status: &'static str,
    pub(super) current_pick: &'a str,
}

pub(super) fn view_tree(project: &Project) -> BTreeMap<String, String> {
    blabla::project::snapshot(&project.manifest.root, &project.ignore)
}

pub(super) type ViewTaskRead = Result<Option<Rc<Task>>, String>;
pub(super) type ViewReviewGraph = Rc<Vec<ReviewEdge<Rc<Task>>>>;

pub(super) struct ViewObservation<'a> {
    pub(super) project: &'a Project,
    pub(super) tree: BTreeMap<String, String>,
    pub(super) selected: Rc<Task>,
    pub(super) supplied: usize,
    pub(super) records: RefCell<BTreeMap<String, ViewTaskRead>>,
    pub(super) graphs: RefCell<BTreeMap<usize, ViewReviewGraph>>,
    pub(super) tracking: RefCell<BTreeMap<usize, Option<String>>>,
    pub(super) identities: RefCell<BTreeMap<usize, BTreeMap<String, String>>>,
    pub(super) freshness: RefCell<BTreeMap<usize, Option<bool>>>,
    pub(super) current: RefCell<BTreeMap<(usize, usize), bool>>,
    pub(super) revisions: RefCell<BTreeMap<(usize, usize), task::RelevantRevision>>,
    pub(super) challenges: RefCell<BTreeMap<usize, bool>>,
    pub(super) readiness: RefCell<BTreeMap<usize, bool>>,
}

fn memoized<K: Ord, V: Clone>(
    cache: &RefCell<BTreeMap<K, V>>,
    key: K,
    compute: impl FnOnce() -> V,
) -> V {
    if let Some(value) = cache.borrow().get(&key) {
        return value.clone();
    }
    let value = compute();
    cache.borrow_mut().insert(key, value.clone());
    value
}

impl<'a> ViewObservation<'a> {
    pub(super) fn new(project: &'a Project, selected: &Task) -> Self {
        let supplied = selected as *const Task as usize;
        let selected = Rc::new(selected.clone());
        Self {
            project,
            tree: view_tree(project),
            selected,
            supplied,
            records: RefCell::new(BTreeMap::new()),
            graphs: RefCell::new(BTreeMap::new()),
            tracking: RefCell::new(BTreeMap::new()),
            identities: RefCell::new(BTreeMap::new()),
            freshness: RefCell::new(BTreeMap::new()),
            current: RefCell::new(BTreeMap::new()),
            revisions: RefCell::new(BTreeMap::new()),
            challenges: RefCell::new(BTreeMap::new()),
            readiness: RefCell::new(BTreeMap::new()),
        }
    }

    pub(super) fn key(&self, task: &Task) -> usize {
        let key = task as *const Task as usize;
        if key == self.supplied {
            Rc::as_ptr(&self.selected) as usize
        } else {
            key
        }
    }

    pub(super) fn read(&self, name: &str) -> ViewTaskRead {
        memoized(&self.records, name.to_owned(), || {
            read_view_task(self.project, name).map(|record| record.map(Rc::new))
        })
    }

    pub(super) fn retained(&self, task: &Task) -> Rc<Task> {
        let key = self.key(task);
        if key == Rc::as_ptr(&self.selected) as usize {
            return self.selected.clone();
        }
        self.records
            .borrow()
            .values()
            .filter_map(|record| record.as_ref().ok().and_then(Option::as_ref))
            .find(|record| Rc::as_ptr(record) as usize == key)
            .cloned()
            .expect("view task belongs to its observation")
    }

    pub(super) fn edges(&self, review: &Task) -> ViewReviewGraph {
        memoized(&self.graphs, self.key(review), || {
            Rc::new(review_edges_with(self.retained(review), |name| {
                self.read(name)
            }))
        })
    }

    pub(super) fn tracking_error(&self, task: &Task) -> Option<String> {
        memoized(&self.tracking, self.key(task), || {
            task::tracking_error(task, &self.project.manifest.root, &self.project.ignore)
        })
    }

    pub(super) fn identities(&self, task: &Task) -> BTreeMap<String, String> {
        memoized(&self.identities, self.key(task), || {
            review_identities(self.project, task)
        })
    }

    pub(super) fn dependencies(&self, reviewer: &Task, source: &Task) -> BTreeMap<String, String> {
        let mut identities = self.identities(source);
        identities.extend(self.identities(reviewer));
        identities
    }

    pub(super) fn review_revision(&self, reviewer: &Task, source: &Task) -> task::RelevantRevision {
        memoized(
            &self.revisions,
            (self.key(reviewer), self.key(source)),
            || {
                task::review_revision(
                    reviewer,
                    source,
                    &self.tree,
                    self.dependencies(reviewer, source),
                )
            },
        )
    }

    pub(super) fn review_current(&self, reviewer: &Task, source: &Task) -> bool {
        memoized(
            &self.current,
            (self.key(reviewer), self.key(source)),
            || {
                task::review_current(
                    reviewer,
                    source,
                    &self.tree,
                    self.dependencies(reviewer, source),
                )
            },
        )
    }

    pub(super) fn review_freshness(&self, review: &Task) -> Option<bool> {
        memoized(&self.freshness, self.key(review), || {
            review.review_of.as_ref().map(|_| {
                self.edges(review).iter().all(|edge| {
                    edge.failure.is_none()
                        && edge.reviewed.as_ref().is_some_and(|source| {
                            self.tracking_error(&edge.reviewer).is_none()
                                && self.tracking_error(source).is_none()
                                && self.review_current(&edge.reviewer, source)
                        })
                })
            })
        })
    }

    pub(super) fn supported(&self, task: &Task) -> bool {
        memoized(&self.readiness, self.key(task), || {
            task::tracked_readiness(
                task,
                &self.project.manifest.root,
                &self.project.ignore,
                &self.tree,
            )
            .supported
        })
    }

    pub(super) fn challenge_current(&self, task: &Task) -> bool {
        memoized(&self.challenges, self.key(task), || {
            task::challenge_current(task, &self.tree)
        })
    }
}

pub(super) fn view<'a>(project: &Project, task: &'a Task) -> TaskView<'a> {
    view_among(project, task, &task::read_all(&project.manifest.root))
}

pub(super) fn view_among<'a>(project: &Project, task: &'a Task, tasks: &[Task]) -> TaskView<'a> {
    let observation = ViewObservation::new(project, task);
    view_with_observation(project, task, Some(&observation), tasks)
}

pub(super) fn view_with_observation<'a>(
    project: &Project,
    task: &'a Task,
    observation: Option<&ViewObservation<'_>>,
    tasks: &[Task],
) -> TaskView<'a> {
    let review_current = observation.map_or_else(
        || review_freshness(project, task),
        |observed| observed.review_freshness(task),
    );
    let fingerprints = knowledge_fingerprints(project);
    let tree = observation.map_or_else(|| view_tree(project), |observed| observed.tree.clone());
    let on_disk = task
        .scope
        .iter()
        .chain(
            task.deliverables
                .iter()
                .map(|deliverable| &deliverable.path),
        )
        .chain(task.check_inputs.iter())
        .chain(task.falsify.iter())
        .map(|path| (path.clone(), task::on_disk_spelling(path, &tree)))
        .collect();
    let (changed_since_open, changed_elsewhere) =
        covered_changes(task, task::changed(task, &tree, &project.ignore));
    let attributions = task::attributions(task, &tree, tasks, &project.ignore);
    let reviewed = task.review_of.as_ref().map(|target| {
        observation.map_or_else(
            || read_view_task(project, &target.task).map(|record| record.map(Rc::new)),
            |observed| observed.read(&target.task),
        )
    });
    let reviewed_target_readable = reviewed.as_ref().map(|read| matches!(read, Ok(Some(_))));
    let (reviewed_changed_since_open, reviewed_changed_elsewhere) = match reviewed {
        Some(Ok(Some(reviewed))) => {
            let changed = task::changed(&reviewed, &tree, &project.ignore);
            covered_changes(&reviewed, changed)
        }
        _ => (Vec::new(), 0),
    };
    TaskView {
        model_acceptance: None,
        evidence_progress: None,
        review_accepted: task.review_of.as_ref().map(|_| task.accepted.is_some()),
        review_current,
        approval_current: review_current.map(|current| {
            current
                && task.accepted_product_result()
                && observation.map_or_else(
                    || {
                        task::tracked_readiness(
                            task,
                            &project.manifest.root,
                            &project.ignore,
                            &tree,
                        )
                        .supported
                    },
                    |observed| observed.supported(task),
                )
                && observation.map_or_else(
                    || task::challenge_current(task, &tree),
                    |observed| observed.challenge_current(task),
                )
        }),
        decisions: task
            .decisions
            .iter()
            .map(|decision| DecisionStateView {
                id: decision.id,
                status: decision.current_status(),
                current_pick: decision.current_pick(),
            })
            .collect(),
        assessment_current: task
            .assessments
            .iter()
            .map(|assessment| {
                fingerprints
                    .get(&assessment.ruling)
                    .is_some_and(|fingerprint| {
                        task::assessment_current(task, assessment, fingerprint)
                    })
            })
            .collect(),
        open: task.open(),
        orchestrator_declared: orchestrator_declared(project),
        unresolved: task.unresolved().count(),
        unresolved_findings: task.unresolved().map(|finding| finding.id).collect(),
        possibly_incomplete: recovery::foreign(recovery::running(), task.build.as_deref()),
        changed_since_open,
        changed_elsewhere,
        attributions,
        challenge_classes: None,
        affected_intents: None,
        reviewed_target_readable,
        reviewed_changed_since_open,
        reviewed_changed_elsewhere,
        swallowed_check_argv: Vec::new(),
        on_disk,
        routes: offered_routes(task),
        authority: task::AUTHORITY,
        task,
    }
}

pub(super) fn covered_changes(task: &Task, changed: Vec<&str>) -> (Vec<String>, usize) {
    let (covered, elsewhere): (Vec<&str>, Vec<&str>) = changed
        .into_iter()
        .partition(|path| task::covered(task, path));
    (
        covered.into_iter().map(str::to_owned).collect(),
        elsewhere.len(),
    )
}

pub(super) fn write_changed(
    output: &mut impl Write,
    heading: &str,
    paths: &[String],
    elsewhere: usize,
) -> io::Result<()> {
    if paths.is_empty() {
        writeln!(output, "\n{heading}\n  none")?;
    } else {
        writeln!(output, "\n{heading}")?;
        for path in paths {
            writeln!(output, "  {path}")?;
        }
    }
    if elsewhere > 0 {
        writeln!(output, "  {elsewhere} more outside this task's paths")?;
    }
    Ok(())
}
