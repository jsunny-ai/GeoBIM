"""개발 환경 시드 데이터.

사용법:
    cd backend
    uv run python -m seeds.dev_seed

생성 데이터:
    - 사용자: dev@geobim.local / dev  (role=admin)
"""

import asyncio

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from app.core.config import settings
from app.core.security import hash_password
from app.models import User, UserRole


async def main() -> None:
    engine = create_async_engine(settings.database_url, echo=False)

    async with AsyncSession(engine) as session:
        # 중복 체크
        result = await session.execute(
            select(User).where(User.email == "dev@geobim.local")
        )
        existing = result.scalar_one_or_none()

        if existing is not None:
            print(f"[seed] 사용자 이미 존재: {existing.email} (id={existing.id})")
        else:
            user = User(
                email="dev@geobim.local",
                hashed_password=hash_password("dev"),
                role=UserRole.ADMIN,
                full_name="Dev User",
                is_active=True,
            )
            session.add(user)
            await session.commit()
            await session.refresh(user)
            print(f"[seed] 사용자 생성 완료: {user.email} (id={user.id})")

    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
