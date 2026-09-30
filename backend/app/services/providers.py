"""The app's shared data-provider instance. Route modules import it from
here rather than from main.py (which would be a circular import)."""
from app.services.yfinance_provider import YFinanceProvider

provider = YFinanceProvider()
