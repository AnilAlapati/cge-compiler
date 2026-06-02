use std::collections::HashMap;

pub struct UserSession {
    pub token: String,
    pub user_id: u64,
}

pub enum UserRole {
    Admin,
    User,
}

const MAX_ATTEMPTS: u32 = 5;

pub fn validate(session: UserSession) -> bool {
    if session.token.is_empty() {
        return false;
    }
    true
}

fn internal_check() -> () {
    println!("internal");
}
