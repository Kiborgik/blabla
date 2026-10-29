use super::*;

pub(crate) fn provenance_builds() -> u64 {
    PROVENANCE_BUILDS.load(Ordering::Relaxed)
}

#[derive(Debug)]
pub(crate) struct DiagnosticPublication {
    pub attempted: u64,
    pub dropped: u64,
    pub written: u64,
    pub writers_started: u64,
    pub queue_capacity: usize,
}

pub(crate) fn diagnostic_publication() -> DiagnosticPublication {
    DiagnosticPublication {
        attempted: DIAGNOSTIC_ATTEMPTED.load(Ordering::Relaxed),
        dropped: DIAGNOSTIC_DROPPED.load(Ordering::Relaxed),
        written: DIAGNOSTIC_WRITTEN.load(Ordering::Relaxed),
        writers_started: DIAGNOSTIC_WRITERS_STARTED.load(Ordering::Relaxed),
        queue_capacity: DIAGNOSTIC_QUEUE_CAPACITY,
    }
}

pub(crate) fn artifact_identity(
    path: &Path,
    deadline: Instant,
) -> Result<ArtifactIdentity, String> {
    read_artifact_identity(path, deadline).map_err(ArtifactCheckError::message)
}

pub(crate) fn owned_artifact(
    path: &Path,
    deadline: Instant,
) -> Result<(TempDir, PathBuf, ArtifactIdentity), String> {
    owned_artifact_in(path, deadline, None)
}

impl ImageScope {
    pub(crate) fn new() -> Self {
        Self::from_source(PathBuf::from(env!("CARGO_MANIFEST_DIR")))
    }

    pub(crate) fn from_source(source: PathBuf) -> Self {
        Self::with_storage(source, false)
    }

    pub(crate) fn with_artifact_parent(source: PathBuf, artifact_parent: PathBuf) -> Self {
        Self(Rc::new(ImageSource {
            source,
            cached: false,
            artifact_parent: Some(artifact_parent),
            image: RefCell::new(None),
        }))
    }
}

impl Campaign {
    pub(crate) fn new() -> Self {
        ImageScope::new().campaign()
    }

    pub(crate) fn from_source(source: PathBuf) -> Self {
        ImageScope::from_source(source).campaign()
    }

    pub(crate) fn with_executable(executable: PathBuf) -> Self {
        Campaign(Rc::new(Source {
            scope: ImageScope::new(),
            transport: RefCell::new(Some(Transport::Cargo { inputs: None })),
            failure: RefCell::new(None),
            executable: Some(executable),
        }))
    }
}

impl Request {
    #[track_caller]
    pub(crate) fn new(deadline: Instant) -> Self {
        Campaign::new().request(deadline)
    }

    #[track_caller]
    pub(crate) fn from_source(source: PathBuf, deadline: Instant) -> Self {
        Campaign::from_source(source).request(deadline)
    }

    pub(crate) fn artifact_path(&self) -> Option<PathBuf> {
        match self.campaign.0.transport.borrow().as_ref() {
            Some(Transport::Artifact(image)) => Some(image.executable.clone()),
            _ => None,
        }
    }
}
