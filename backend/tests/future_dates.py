"""Results dates for test events, always in the future (2026-11-24).

The tests used a fixed "2026-11-20", which stopped working once that day
passed: the default lock (the day before, 23:59 IST) was then in the past
and every quick event was refused with lock_in_past.
"""
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

_TODAY_IST = datetime.now(ZoneInfo("Asia/Kolkata")).date()
RESULTS_DATE = (_TODAY_IST + timedelta(days=60)).isoformat()
# The default lock: the day before results day, 23:59 IST.
LOCK_DAY = (date.fromisoformat(RESULTS_DATE) - timedelta(days=1)).isoformat()
