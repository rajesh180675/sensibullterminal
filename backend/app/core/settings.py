from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    app_name: str = "Sensibull Terminal Backend"
    environment: str = "development"


settings = Settings()
