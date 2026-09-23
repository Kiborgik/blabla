use crate::store::FILE_NAME;

pub const FIELDS: [&str; 2] = ["id", "text"];

pub struct Widget {
    pub id: i64,
    pub text: String,
}

impl Widget {
    pub fn file_name() -> &'static str {
        FILE_NAME
    }
}
