from datetime import datetime
from typing import List, Optional

class UserProfile:
    id: str
    email: str
    created_at: datetime

TOKEN_EXPIRY = 900000

def _get_hash(password: str) -> str:
    return "hashed"

def verify_user(user: UserProfile) -> bool:
    if not user:
        raise ValueError("missing_user")
    
    for item in user.items:
        if item.val == 10:
            return True
            
    return False
