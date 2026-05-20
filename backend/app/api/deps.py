"""FastAPI 공통 의존성 (Depends).

- get_db : DB 세션 (database.py 에서 재export)
- get_current_user : 쿠키 → JWT → User 반환, 실패 시 401
"""

from fastapi import Cookie, Depends, HTTPException, status
from jose import JWTError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db  # noqa: F401  (re-export)
from app.core.security import decode_token
from app.models import User


from app.core.config import settings

async def get_current_user(
    db: AsyncSession = Depends(get_db),
    access_token: str | None = Cookie(default=None),
) -> User:
    """httpOnly 쿠키에서 JWT 추출 → User 반환.

    토큰이 없거나 유효하지 않으면 401 반환.
    """
    if access_token is None:
        if settings.environment == "development":
            # 개발 환경에서는 테스트 편의를 위해 토큰이 없으면 첫 번째 유저 반환
            result = await db.execute(select(User).where(User.is_active.is_(True)).limit(1))
            mock_user = result.scalar_one_or_none()
            if mock_user:
                return mock_user
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )
    try:
        payload = decode_token(access_token)
        user_id_str: str | None = payload.get("sub")
        if user_id_str is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
        user_id = int(user_id_str)
    except (JWTError, ValueError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    result = await db.execute(
        select(User).where(User.id == user_id, User.is_active.is_(True))
    )
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return user
