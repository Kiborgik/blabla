use crate::model::Widget;

pub const FILE_NAME: &str = "widget.json";

pub struct Store {
    pub path: String,
}

impl Store {
    pub fn load(&self) -> Vec<Widget> {
        Vec::new()
    }
}
