use serde_json::Value;

pub(crate) trait Component {
    fn call(&mut self, name: &str, args: &Value) -> Option<Result<(), String>>;
    fn observe(&self, observed: &Value) -> Value;
}
