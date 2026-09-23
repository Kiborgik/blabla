mod format;
mod model;
mod store;

fn main() {
    let store = store::Store { path: store::FILE_NAME.to_string() };
    println!("{} widgets", store.load().len());
}
