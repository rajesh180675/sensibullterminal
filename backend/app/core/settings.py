import os
from dataclasses import dataclass, field


@dataclass(frozen=True)
class Settings:
    app_name: str = "Sensibull Terminal Backend"
    environment: str = "development"
    sqlite_path: str = field(
        default_factory=lambda: os.environ.get(
            "SENSIBULL_SQLITE_PATH",
            os.path.join(os.getcwd(), "logs", "sensibull_terminal.db"),
        )
    )


settings = Settings()
