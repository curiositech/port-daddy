fn derive_tenant(repo: &str) -> String {
    repo.split('/').next().unwrap_or("unknown").to_string()
}