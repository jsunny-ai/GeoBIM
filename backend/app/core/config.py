"""애플리케이션 설정 — pydantic-settings 기반.

`.env` 파일에서 환경변수를 로드한다.
"""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """전역 설정 객체.

    필드 추가 시 backend/.env.example 도 함께 갱신할 것.
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ----- 데이터베이스 -----
    database_url: str = "postgresql+asyncpg://geobim:geobim_dev_only@localhost:5432/geobim"
    database_url_sync: str = "postgresql+psycopg2://geobim:geobim_dev_only@localhost:5432/geobim"

    # ----- Redis / Celery -----
    redis_url: str = "redis://localhost:6379/0"

    # ----- 보안 -----
    secret_key: str = "change-me-in-production-min-32-chars"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60

    # ----- CORS -----
    # 콤마 구분 문자열로 받은 뒤 cors_origins_list 프로퍼티로 분해
    cors_origins: str = (
        "http://localhost:5170,"
        "http://localhost:5171,"
        "http://localhost:5172,"
        "http://localhost:5173,"
        "http://localhost:5174"
    )

    # ----- V-World 타일 -----
    vworld_api_key: str = ""
    vworld_api_base: str = "https://api.vworld.kr"

    # ----- 환경 -----
    environment: str = "development"
    debug: bool = True

    @property
    def cors_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


settings = Settings()
