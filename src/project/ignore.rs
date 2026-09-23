use crate::diagnostic::Span;
use std::collections::BTreeSet;
use std::path::{Component, Path, PathBuf};

#[derive(Clone, Debug)]
pub enum IgnoreDeclaration {
    Pattern {
        written: String,
        span: Span,
    },
    List {
        written: String,
        path: PathBuf,
        span: Span,
    },
}

impl IgnoreDeclaration {
    pub fn written(&self) -> &str {
        match self {
            IgnoreDeclaration::Pattern { written, .. }
            | IgnoreDeclaration::List { written, .. } => written,
        }
    }

    pub fn span(&self) -> Span {
        match self {
            IgnoreDeclaration::Pattern { span, .. } | IgnoreDeclaration::List { span, .. } => *span,
        }
    }

    pub fn is_list(&self) -> bool {
        matches!(self, IgnoreDeclaration::List { .. })
    }
}

#[derive(Debug)]
pub struct IgnoreError {
    pub span: Span,
    pub code: &'static str,
    pub message: String,
}

#[derive(Clone, Debug, Default)]
pub struct Ignore {
    rules: Vec<Rule>,
    protected: BTreeSet<String>,
}

#[derive(Clone, Debug)]
struct Rule {
    origin: String,
    base: String,
    tokens: Vec<Token>,
    negated: bool,
    directory_only: bool,
    anchored: bool,
}

#[derive(Clone, Debug)]
enum Token {
    Literal(char),
    Any,
    Star,
    Directories,
    Everything,
    Class {
        members: Vec<(char, char)>,
        negated: bool,
    },
}

impl Ignore {
    pub fn new(
        root: &Path,
        declarations: &[IgnoreDeclaration],
        mut protected: BTreeSet<String>,
    ) -> Result<Ignore, IgnoreError> {
        let mut rules = Vec::new();
        for declaration in declarations {
            match declaration {
                IgnoreDeclaration::Pattern { written, .. } => {
                    rules.extend(rule(written, "", format!("ignore \"{written}\"")));
                }
                IgnoreDeclaration::List {
                    written,
                    path,
                    span,
                } => {
                    let relative = inside(written).ok_or_else(|| IgnoreError {
                        span: *span,
                        code: "E_IGNORE_LIST_OUTSIDE",
                        message: format!(
                            "ignore list '{written}' lies outside the project; name a file inside {}",
                            root.display()
                        ),
                    })?;
                    let text = std::fs::read_to_string(path).map_err(|failure| IgnoreError {
                        span: *span,
                        code: "E_IGNORE_LIST_MISSING",
                        message: format!(
                            "cannot read ignore list '{written}' ({}): {failure}",
                            path.display()
                        ),
                    })?;
                    let base = relative
                        .rsplit_once('/')
                        .map(|(parent, _)| parent.to_owned())
                        .unwrap_or_default();
                    for (number, line) in text.lines().enumerate() {
                        let origin = format!("{relative}:{}: {}", number + 1, line.trim_end());
                        rules.extend(rule(line, &base, origin));
                    }
                    protected.insert(relative);
                }
            }
        }
        Ok(Ignore { rules, protected })
    }

    pub fn rule_for(&self, relative: &str, is_dir: bool) -> Option<&str> {
        if self.protected.contains(relative) {
            return None;
        }
        let parts: Vec<&str> = relative.split('/').collect();
        for depth in 1..parts.len() {
            if let Some(rule) = self.decided(&parts[..depth].join("/"), true) {
                return Some(&rule.origin);
            }
        }
        self.decided(relative, is_dir)
            .map(|rule| rule.origin.as_str())
    }

    pub fn skips_directory(&self, relative: &str) -> bool {
        let prefix = format!("{relative}/");
        self.rule_for(relative, true).is_some()
            && !self.protected.iter().any(|path| path.starts_with(&prefix))
    }

    pub fn skips_file(&self, relative: &str) -> bool {
        self.rule_for(relative, false).is_some()
    }

    fn decided(&self, relative: &str, is_dir: bool) -> Option<&Rule> {
        self.rules
            .iter()
            .rev()
            .find(|rule| rule.applies(relative, is_dir))
            .filter(|rule| !rule.negated)
    }
}

impl Rule {
    fn applies(&self, relative: &str, is_dir: bool) -> bool {
        if self.directory_only && !is_dir {
            return false;
        }
        let local = if self.base.is_empty() {
            relative
        } else {
            match relative
                .strip_prefix(self.base.as_str())
                .and_then(|rest| rest.strip_prefix('/'))
            {
                Some(rest) => rest,
                None => return false,
            }
        };
        let subject = if self.anchored {
            local
        } else {
            local.rsplit('/').next().unwrap_or(local)
        };
        let text: Vec<char> = subject.chars().collect();
        matches(&self.tokens, &text)
    }
}

fn inside(written: &str) -> Option<String> {
    let mut parts = Vec::new();
    for component in Path::new(written).components() {
        match component {
            Component::Normal(part) => parts.push(part.to_string_lossy().into_owned()),
            Component::CurDir => {}
            _ => return None,
        }
    }
    (!parts.is_empty()).then(|| parts.join("/"))
}

fn trim_trailing_spaces(line: &str) -> &str {
    let bytes = line.as_bytes();
    let mut end = bytes.len();
    while end > 0 && bytes[end - 1] == b' ' && !(end >= 2 && bytes[end - 2] == b'\\') {
        end -= 1;
    }
    &line[..end]
}

fn rule(line: &str, base: &str, origin: String) -> Option<Rule> {
    let line = trim_trailing_spaces(line.strip_suffix('\r').unwrap_or(line));
    if line.is_empty() || line.starts_with('#') {
        return None;
    }
    let (negated, line) = match line.strip_prefix('!') {
        Some(rest) => (true, rest),
        None => (false, line),
    };
    let (directory_only, line) = match line.strip_suffix('/') {
        Some(rest) if !rest.is_empty() => (true, rest),
        _ => (false, line),
    };
    let anchored = line.contains('/');
    let line = line.strip_prefix('/').unwrap_or(line);
    if line.is_empty() {
        return None;
    }
    Some(Rule {
        origin,
        base: base.to_owned(),
        tokens: tokens(line),
        negated,
        directory_only,
        anchored,
    })
}

fn tokens(pattern: &str) -> Vec<Token> {
    let chars: Vec<char> = pattern.chars().collect();
    let mut out = Vec::new();
    let mut index = 0;
    while index < chars.len() {
        let at_component_start = index == 0 || chars[index - 1] == '/';
        match chars[index] {
            '\\' if index + 1 < chars.len() => {
                out.push(Token::Literal(chars[index + 1]));
                index += 2;
            }
            '*' => {
                let mut end = index;
                while end < chars.len() && chars[end] == '*' {
                    end += 1;
                }
                let double = end - index >= 2 && at_component_start;
                if double && end == chars.len() {
                    out.push(Token::Everything);
                    index = end;
                } else if double && chars[end] == '/' {
                    out.push(Token::Directories);
                    index = end + 1;
                } else {
                    out.push(Token::Star);
                    index = end;
                }
            }
            '?' => {
                out.push(Token::Any);
                index += 1;
            }
            '[' => match class(&chars, index) {
                Some((token, next)) => {
                    out.push(token);
                    index = next;
                }
                None => {
                    out.push(Token::Literal('['));
                    index += 1;
                }
            },
            other => {
                out.push(Token::Literal(other));
                index += 1;
            }
        }
    }
    out
}

fn class(chars: &[char], start: usize) -> Option<(Token, usize)> {
    let mut index = start + 1;
    let negated = matches!(chars.get(index), Some('!' | '^'));
    if negated {
        index += 1;
    }
    let mut members = Vec::new();
    let mut first = true;
    while index < chars.len() {
        if chars[index] == ']' && !first {
            return Some((Token::Class { members, negated }, index + 1));
        }
        first = false;
        if chars[index] == '\\' && index + 1 < chars.len() {
            index += 1;
        }
        let low = chars[index];
        if index + 2 < chars.len() && chars[index + 1] == '-' && chars[index + 2] != ']' {
            members.push((low, chars[index + 2]));
            index += 3;
        } else {
            members.push((low, low));
            index += 1;
        }
    }
    None
}

fn matches(tokens: &[Token], text: &[char]) -> bool {
    let Some((token, rest)) = tokens.split_first() else {
        return text.is_empty();
    };
    match token {
        Token::Everything => true,
        Token::Directories => {
            let mut index = 0;
            loop {
                if matches(rest, &text[index..]) {
                    return true;
                }
                match text[index..].iter().position(|c| *c == '/') {
                    Some(offset) => index += offset + 1,
                    None => return false,
                }
            }
        }
        Token::Star => {
            let mut index = 0;
            loop {
                if matches(rest, &text[index..]) {
                    return true;
                }
                if index >= text.len() || text[index] == '/' {
                    return false;
                }
                index += 1;
            }
        }
        Token::Any => text.first().is_some_and(|c| *c != '/') && matches(rest, &text[1..]),
        Token::Class { members, negated } => {
            text.first().is_some_and(|c| {
                *c != '/'
                    && members.iter().any(|(low, high)| (*low..=*high).contains(c)) != *negated
            }) && matches(rest, &text[1..])
        }
        Token::Literal(expected) => text.first() == Some(expected) && matches(rest, &text[1..]),
    }
}

#[cfg(test)]
mod tests {
    use super::{Ignore, IgnoreDeclaration};
    use crate::diagnostic::Span;
    use std::collections::BTreeSet;
    use std::path::Path;

    fn span() -> Span {
        Span {
            start: 0,
            end: 0,
            line: 1,
            column: 1,
        }
    }

    fn listed(lines: &str) -> Ignore {
        let directory = tempfile::TempDir::new().unwrap();
        std::fs::create_dir_all(directory.path().join("sub")).unwrap();
        std::fs::write(directory.path().join("sub/.gitignore"), lines).unwrap();
        Ignore::new(
            directory.path(),
            &[IgnoreDeclaration::List {
                written: "sub/.gitignore".to_owned(),
                path: directory.path().join("sub/.gitignore"),
                span: span(),
            }],
            BTreeSet::new(),
        )
        .unwrap()
    }

    fn patterns(written: &[&str], protected: &[&str]) -> Ignore {
        let declarations: Vec<IgnoreDeclaration> = written
            .iter()
            .map(|pattern| IgnoreDeclaration::Pattern {
                written: (*pattern).to_owned(),
                span: span(),
            })
            .collect();
        Ignore::new(
            Path::new("."),
            &declarations,
            protected.iter().map(|path| (*path).to_owned()).collect(),
        )
        .unwrap()
    }

    #[test]
    fn a_name_pattern_matches_at_any_depth_and_a_slash_anchors_it() {
        let ignore = patterns(&["*.log", "/build", "docs/out"], &[]);
        assert!(ignore.skips_file("app.log"));
        assert!(ignore.skips_file("deep/nested/app.log"));
        assert!(ignore.skips_directory("build"));
        assert!(!ignore.skips_directory("src/build"));
        assert!(ignore.skips_file("docs/out"));
        assert!(!ignore.skips_file("more/docs/out"));
    }

    #[test]
    fn a_trailing_slash_matches_directories_and_everything_under_them() {
        let ignore = patterns(&["cache/"], &[]);
        assert!(ignore.skips_directory("cache"));
        assert!(ignore.skips_directory("src/cache"));
        assert!(!ignore.skips_file("cache"));
        assert!(ignore.skips_file("cache/entry.bin"));
    }

    #[test]
    fn double_stars_span_directories() {
        let ignore = patterns(&["**/generated", "logs/**", "a/**/z.txt"], &[]);
        assert!(ignore.skips_file("generated"));
        assert!(ignore.skips_file("x/y/generated"));
        assert!(ignore.skips_file("logs/day/one.txt"));
        assert!(!ignore.skips_directory("logs"));
        assert!(ignore.skips_file("a/z.txt"));
        assert!(ignore.skips_file("a/b/c/z.txt"));
        assert!(!ignore.skips_file("b/z.txt"));
    }

    #[test]
    fn the_last_matching_pattern_decides_and_a_negation_reincludes() {
        let ignore = patterns(&[".env.*", "!.env.example"], &[]);
        assert!(ignore.skips_file(".env.local"));
        assert!(!ignore.skips_file(".env.example"));
    }

    #[test]
    fn a_file_under_an_ignored_directory_cannot_be_reincluded() {
        let ignore = patterns(&["out/", "!out/keep.txt"], &[]);
        assert!(ignore.skips_file("out/keep.txt"));
    }

    #[test]
    fn classes_single_characters_and_escapes_follow_gitignore() {
        let ignore = patterns(
            &["file[0-9].txt", "?.tmp", "\\#literal", "\\!bang", "[!a]b"],
            &[],
        );
        assert!(ignore.skips_file("file7.txt"));
        assert!(!ignore.skips_file("filex.txt"));
        assert!(ignore.skips_file("q.tmp"));
        assert!(!ignore.skips_file("qq.tmp"));
        assert!(ignore.skips_file("#literal"));
        assert!(ignore.skips_file("!bang"));
        assert!(ignore.skips_file("xb"));
        assert!(!ignore.skips_file("ab"));
    }

    #[test]
    fn a_list_file_anchors_its_patterns_to_its_own_directory_and_skips_comments() {
        let ignore = listed("# comment\n\n/local\ntemp/\n");
        assert!(ignore.skips_file("sub/local"));
        assert!(!ignore.skips_file("local"));
        assert!(ignore.skips_directory("sub/deep/temp"));
        assert!(!ignore.skips_directory("temp"));
        assert_eq!(
            ignore.rule_for("sub/local", false),
            Some("sub/.gitignore:3: /local")
        );
    }

    #[test]
    fn protected_paths_stay_tracked_whatever_the_patterns_say() {
        let ignore = patterns(&["*", "contracts/"], &["project.bla", "contracts/app.bla"]);
        assert!(!ignore.skips_file("project.bla"));
        assert!(!ignore.skips_file("contracts/app.bla"));
        assert!(!ignore.skips_directory("contracts"));
        assert!(ignore.skips_file("contracts/other.bla"));
        assert!(ignore.skips_file("notes.md"));
    }

    #[test]
    fn a_missing_list_file_and_one_outside_the_project_are_refused() {
        let directory = tempfile::TempDir::new().unwrap();
        for (written, code) in [
            ("absent.txt", "E_IGNORE_LIST_MISSING"),
            ("../outside", "E_IGNORE_LIST_OUTSIDE"),
        ] {
            let failure = Ignore::new(
                directory.path(),
                &[IgnoreDeclaration::List {
                    written: written.to_owned(),
                    path: directory.path().join(written),
                    span: span(),
                }],
                BTreeSet::new(),
            )
            .unwrap_err();
            assert_eq!(failure.code, code);
        }
    }
}
