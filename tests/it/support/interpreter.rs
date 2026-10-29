pub fn python() -> &'static str {
    if cfg!(windows) { "python" } else { "python3" }
}
