### File: pyproject.toml

```toml
[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[project]
name = "loglens"
version = "0.1.0"
description = "A CLI tool for analyzing structured JSON log files"
readme = "README.md"
requires-python = ">=3.12"
license = {text = "MIT"}
authors = [
    {name = "LogLens Team"}
]
classifiers = [
    "Development Status :: 4 - Beta",
    "Environment :: Console",
    "Intended Audience :: Developers",
    "License :: OSI Approved :: MIT License",
    "Programming Language :: Python :: 3.12",
    "Topic :: System :: Logging",
    "Topic :: Utilities",
]
dependencies = [
    "click>=8.0.0",
    "tabulate>=0.9.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=7.0.0",
    "pytest-cov>=4.0.0",
]

[project.scripts]
loglens = "loglens.cli:main"

[tool.hatch.build.targets.wheel]
packages = ["src/loglens"]

[tool.pytest.ini_options]
testpaths = ["tests"]
pythonpath = ["src"]
```

### File: README.md

```markdown
# LogLens

A Python command-line tool for analyzing structured JSON log files.

## Features

- **Streaming Architecture**: Handles multi-GB log files efficiently without loading entire file into memory
- **Flexible Filtering**: Filter by level, time range, field values, and message content
- **Rich Statistics**: Aggregations including level counts, time ranges, top messages, and slowest entries
- **Live Watching**: Tail files and stream new entries as they're appended
- **Multiple Output Formats**: JSON, CSV, and human-readable table formats

## Installation

```bash
pip install -e .
```

## Usage

### Filter Log Entries

```bash
# Filter by level
loglens filter sample.log --level error

# Filter by multiple levels
loglens filter sample.log --level error --level critical

# Filter by time range
loglens filter sample.log --since 2025-01-15T08:00:00Z --until 2025-01-15T12:00:00Z

# Filter by field value
loglens filter sample.log --field service=auth-api

# Filter by message content (case-insensitive)
loglens filter sample.log --contains "connection"

# Combine filters
loglens filter sample.log --level error --field service=auth-api --since 2025-01-15T00:00:00Z

# Limit results
loglens filter sample.log --level error --limit 10

# Output as table
loglens filter sample.log --level error --output table

# Output as CSV
loglens filter sample.log --level error --output csv

# Read from stdin
cat sample.log | loglens filter - --level error
```

### Compute Statistics

```bash
# All stats
loglens stats sample.log

# Stats with filters
loglens stats sample.log --level error --since 2025-01-15T00:00:00Z

# Output as table
loglens stats sample.log --output table
```

### Watch Log File

```bash
# Watch for new entries
loglens watch sample.log --level error

# Watch with filters
loglens watch sample.log --level error --field service=auth-api
```

## Log Format

LogLens expects newline-delimited JSON (NDJSON) with the following required fields:

```json
{"timestamp": "2025-01-15T08:23:41.012Z", "level": "error", "message": "Connection refused"}
```

- `timestamp`: ISO 8601 formatted timestamp
- `level`: One of `debug`, `info`, `warning`, `error`, `critical`
- `message`: Free-text log message

Additional fields are preserved and queryable via `--field` filters.

## Development

### Running Tests

```bash
pytest tests/ -v
```

### Type Checking

```bash
mypy src/loglens
```

## License

MIT
```

### File: src/loglens/__init__.py

```python
"""LogLens - A CLI tool for analyzing structured JSON log files."""

__version__ = "0.1.0"

from loglens.parser import LogEntry, parse_line, stream_entries
from loglens.filters import FilterConfig, filter_entries
from loglens.aggregator import StatsResult, compute_stats
from loglens.formatters import OutputFormatter
from loglens.types import LogLevel, OutputFormat

__all__ = [
    "LogEntry",
    "parse_line",
    "stream_entries",
    "FilterConfig",
    "filter_entries",
    "StatsResult",
    "compute_stats",
    "OutputFormatter",
    "LogLevel",
    "OutputFormat",
]
```

### File: src/loglens/types.py

```python
"""Shared type definitions for LogLens."""

from typing import Literal

type LogLevel = Literal["debug", "info", "warning", "error", "critical"]
type OutputFormat = Literal["json", "csv", "table"]

VALID_LEVELS: set[LogLevel] = {"debug", "info", "warning", "error", "critical"}
```

### File: src/loglens/parser.py

```python
"""NDJSON log file parsing with streaming support."""

from __future__ import annotations

import json
import sys
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Iterator, TextIO

from loglens.types import LogLevel, VALID_LEVELS


@dataclass(slots=True)
class LogEntry:
    """Represents a parsed log entry."""
    timestamp: datetime
    level: LogLevel
    message: str
    raw: dict[str, Any] = field(default_factory=dict)
    line_number: int = 0

    def get_field(self, name: str) -> Any:
        """Get a field value from the raw log entry."""
        return self.raw.get(name)

    @property
    def service(self) -> str | None:
        """Get the service field if present."""
        return self.raw.get("service")

    @property
    def request_id(self) -> str | None:
        """Get the request_id field if present."""
        return self.raw.get("request_id")

    @property
    def duration_ms(self) -> int | float | None:
        """Get the duration_ms field if present."""
        return self.raw.get("duration_ms")


def parse_iso_timestamp(value: str) -> datetime:
    """Parse an ISO 8601 timestamp string.
    
    Supports formats:
    - 2025-01-15T08:23:41.012Z
    - 2025-01-15T08:23:41+00:00
    - 2025-01-15T08:23:41
    """
    original_value = value
    
    # Handle various ISO 8601 formats
    # Remove trailing Z and replace with +00:00 for UTC
    if value.endswith("Z"):
        value = value[:-1] + "+00:00"

    try:
        return datetime.fromisoformat(value)
    except ValueError:
        # Try without timezone info
        try:
            # Strip any timezone suffix
            for suffix in ["+00:00", "-00:00"]:
                if suffix in value:
                    value = value.replace(suffix, "")
            return datetime.fromisoformat(value)
        except ValueError:
            raise ValueError(f"Cannot parse timestamp: {original_value}")


def parse_line(line: str, line_number: int) -> LogEntry | None:
    """Parse a single JSON log line into a LogEntry.

    Returns None if the line is malformed or missing required fields.
    Logs warnings to stderr for skipped entries.

    Args:
        line: The raw log line to parse
        line_number: The 1-based line number for error reporting

    Returns:
        LogEntry if parsing succeeds, None otherwise
    """
    line = line.strip()
    if not line:
        return None

    try:
        data = json.loads(line)
    except json.JSONDecodeError as e:
        print(
            f"Warning: Skipping malformed JSON at line {line_number}: {e}",
            file=sys.stderr
        )
        return None

    if not isinstance(data, dict):
        print(
            f"Warning: Skipping non-object at line {line_number}",
            file=sys.stderr
        )
        return None

    # Check required fields
    if "timestamp" not in data:
        print(
            f"Warning: Missing 'timestamp' field at line {line_number}",
            file=sys.stderr
        )
        return None

    if "level" not in data:
        print(
            f"Warning: Missing 'level' field at line {line_number}",
            file=sys.stderr
        )
        return None

    if "message" not in data:
        print(
            f"Warning: Missing 'message' field at line {line_number}",
            file=sys.stderr
        )
        return None

    # Parse timestamp
    try:
        timestamp = parse_iso_timestamp(data["timestamp"])
    except ValueError as e:
        print(
            f"Warning: Invalid timestamp at line {line_number}: {e}",
            file=sys.stderr
        )
        return None

    # Validate level
    level_str = str(data["level"]).lower()
    if level_str not in VALID_LEVELS:
        print(
            f"Warning: Invalid log level '{data['level']}' at line {line_number}",
            file=sys.stderr
        )
        return None

    return LogEntry(
        timestamp=timestamp,
        level=level_str,
        message=str(data["message"]),
        raw=data,
        line_number=line_number
    )


def stream_entries(file_handle: TextIO) -> Iterator[LogEntry]:
    """Stream log entries from a file handle, yielding one at a time.

    This is a generator-based streaming function that maintains O(1)
    memory relative to file size.

    Args:
        file_handle: A file-like object to read lines from

    Yields:
        LogEntry objects for each valid log line
    """
    line_number = 0
    for line in file_handle:
        line_number += 1
        entry = parse_line(line, line_number)
        if entry is not None:
            yield entry


def read_file_or_stdin(filepath: str) -> Iterator[LogEntry]:
    """Read log entries from a file or stdin (if filepath is '-').

    Args:
        filepath: Path to the log file, or "-" for stdin

    Yields:
        LogEntry objects for each valid log line

    Raises:
        SystemExit: On file not found (code 1), permission error (code 1),
                   or I/O error (code 2)
    """
    if filepath == "-":
        yield from stream_entries(sys.stdin)
    else:
        try:
            with open(filepath, "r", encoding="utf-8") as f:
                yield from stream_entries(f)
        except FileNotFoundError:
            print(f"Error: File not found: {filepath}", file=sys.stderr)
            sys.exit(1)
        except PermissionError:
            print(f"Error: Permission denied: {filepath}", file=sys.stderr)
            sys.exit(1)
        except OSError as e:
            print(f"Error: Could not read file {filepath}: {e}", file=sys.stderr)
            sys.exit(2)
```

### File: src/loglens/filters.py

```python
"""Filter predicates and configuration for log entries."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Callable, Iterator

from loglens.parser import LogEntry


@dataclass(slots=True)
class FilterConfig:
    """Configuration for filtering log entries."""
    levels: set[str] = field(default_factory=set)
    since: datetime | None = None
    until: datetime | None = None
    field_matches: dict[str, str] = field(default_factory=dict)
    contains_text: str | None = None

    def has_filters(self) -> bool:
        """Check if any filters are configured."""
        return bool(
            self.levels
            or self.since is not None
            or self.until is not None
            or self.field_matches
            or self.contains_text
        )


def create_filter_predicate(config: FilterConfig) -> Callable[[LogEntry], bool]:
    """Create a filter predicate function from a FilterConfig.

    The returned predicate implements AND logic for all configured filters.

    Args:
        config: The filter configuration

    Returns:
        A function that returns True if an entry matches all filters
    """

    def matches_level(entry: LogEntry) -> bool:
        if not config.levels:
            return True
        return entry.level in config.levels

    def matches_time_range(entry: LogEntry) -> bool:
        if config.since is not None and entry.timestamp < config.since:
            return False
        if config.until is not None and entry.timestamp >= config.until:
            return False
        return True

    def matches_fields(entry: LogEntry) -> bool:
        for field_name, expected_value in config.field_matches.items():
            actual_value = entry.get_field(field_name)
            if actual_value is None:
                return False
            if str(actual_value) != expected_value:
                return False
        return True

    def matches_contains(entry: LogEntry) -> bool:
        if config.contains_text is None:
            return True
        return config.contains_text.lower() in entry.message.lower()

    def predicate(entry: LogEntry) -> bool:
        return (
            matches_level(entry)
            and matches_time_range(entry)
            and matches_fields(entry)
            and matches_contains(entry)
        )

    return predicate


def filter_entries(
    entries: Iterator[LogEntry],
    config: FilterConfig,
    limit: int | None = None
) -> Iterator[LogEntry]:
    """Filter log entries based on configuration, with optional limit.

    This is a generator-based streaming filter that maintains O(1)
    memory relative to the number of input entries.

    Args:
        entries: Iterator of log entries to filter
        config: Filter configuration
        limit: Maximum number of entries to yield (None for unlimited)

    Yields:
        LogEntry objects that match all configured filters
    """
    if not config.has_filters() and limit is None:
        yield from entries
        return

    predicate = create_filter_predicate(config)
    count = 0

    for entry in entries:
        if predicate(entry):
            yield entry
            count += 1
            if limit is not None and count >= limit:
                break
```

### File: src/loglens/aggregator.py

```python
"""Statistics computation for log entries."""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime
from typing import Iterator

from loglens.parser import LogEntry


@dataclass(slots=True)
class HourBucket:
    """Represents an hour bucket for the histogram."""
    hour: datetime
    count: int = 0

    @property
    def label(self) -> str:
        """Get a formatted label for the hour bucket."""
        return self.hour.strftime("%Y-%m-%d %H:00")


@dataclass
class StatsResult:
    """Aggregated statistics from log entries."""
    total_entries: int = 0
    count_by_level: dict[str, int] = field(default_factory=dict)
    earliest_timestamp: datetime | None = None
    latest_timestamp: datetime | None = None
    message_counts: Counter = field(default_factory=Counter)
    slowest_entries: list[LogEntry] = field(default_factory=list)
    hourly_buckets: dict[str, HourBucket] = field(default_factory=dict)
    has_duration_field: bool = False


def compute_stats(entries: Iterator[LogEntry], top_slowest: int = 5) -> StatsResult:
    """Compute statistics from a stream of log entries.

    This function processes entries in a single pass, maintaining O(1)
    memory for most statistics (O(n) for top slowest entries where n
    is top_slowest).

    Args:
        entries: Iterator of log entries to analyze
        top_slowest: Number of slowest entries to track (default 5)

    Returns:
        StatsResult containing all computed statistics
    """
    result = StatsResult()
    result.count_by_level = {
        "debug": 0,
        "info": 0,
        "warning": 0,
        "error": 0,
        "critical": 0
    }

    for entry in entries:
        result.total_entries += 1

        # Count by level
        if entry.level in result.count_by_level:
            result.count_by_level[entry.level] += 1

        # Track time range
        if result.earliest_timestamp is None or entry.timestamp < result.earliest_timestamp:
            result.earliest_timestamp = entry.timestamp
        if result.latest_timestamp is None or entry.timestamp > result.latest_timestamp:
            result.latest_timestamp = entry.timestamp

        # Count messages
        result.message_counts[entry.message] += 1

        # Track slowest entries
        duration = entry.duration_ms
        if duration is not None:
            result.has_duration_field = True
            # Insert into sorted list of slowest entries
            result.slowest_entries.append(entry)
            result.slowest_entries.sort(
                key=lambda e: e.duration_ms if e.duration_ms is not None else 0,
                reverse=True
            )
            result.slowest_entries = result.slowest_entries[:top_slowest]

        # Hourly histogram
        hour_key = entry.timestamp.strftime("%Y-%m-%d %H:00")
        if hour_key not in result.hourly_buckets:
            hour_dt = entry.timestamp.replace(minute=0, second=0, microsecond=0)
            result.hourly_buckets[hour_key] = HourBucket(hour=hour_dt)
        result.hourly_buckets[hour_key].count += 1

    return result
```

### File: src/loglens/formatters.py

```python
"""Output formatting for log entries and statistics."""

from __future__ import annotations

import csv
import io
import json
import sys
from typing import Iterator, TextIO

from tabulate import tabulate

from loglens.aggregator import StatsResult
from loglens.parser import LogEntry
from loglens.types import OutputFormat


def format_entry_json(entry: LogEntry) -> str:
    """Format a log entry as a JSON line."""
    return json.dumps(entry.raw)


def format_entry_csv(entry: LogEntry, fieldnames: list[str] | None = None) -> str:
    """Format a log entry as a CSV line."""
    if fieldnames is None:
        fieldnames = ["timestamp", "level", "message"]

    row = {k: entry.raw.get(k, "") for k in fieldnames}
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=fieldnames)
    writer.writerow(row)
    return output.getvalue().rstrip("\n")


def format_entry_table(entry: LogEntry) -> str:
    """Format a log entry as a table row."""
    data = [
        ["Timestamp", entry.timestamp.isoformat()],
        ["Level", entry.level],
        ["Message", _truncate(entry.message, 80)],
    ]
    if entry.service:
        data.append(["Service", entry.service])
    if entry.request_id:
        data.append(["Request ID", entry.request_id])
    if entry.duration_ms is not None:
        data.append(["Duration (ms)", str(entry.duration_ms)])

    return tabulate(data, tablefmt="simple")


def _truncate(text: str, max_len: int) -> str:
    """Truncate text to max_len characters, adding ellipsis if needed."""
    if len(text) <= max_len:
        return text
    return text[:max_len] + "..."


class OutputFormatter:
    """Handles formatting and output of log entries and stats."""

    def __init__(
        self,
        format: OutputFormat = "json",
        output_stream: TextIO | None = None,
        csv_fields: list[str] | None = None
    ):
        self.format = format
        self.output_stream = output_stream or sys.stdout
        self.csv_fields = csv_fields
        self._csv_header_written = False
        self._entries_count = 0

    def format_entry(self, entry: LogEntry) -> str:
        """Format a single entry based on the configured format."""
        match self.format:
            case "json":
                return format_entry_json(entry)
            case "csv":
                return format_entry_csv(entry, self.csv_fields)
            case "table":
                return format_entry_table(entry)
            case _:
                return format_entry_json(entry)

    def write_entry(self, entry: LogEntry) -> None:
        """Write a formatted entry to the output stream."""
        try:
            if self.format == "csv" and not self._csv_header_written:
                fields = self.csv_fields or ["timestamp", "level", "message"]
                print(",".join(fields), file=self.output_stream)
                self._csv_header_written = True

            formatted = self.format_entry(entry)
            print(formatted, file=self.output_stream)

            if self.format == "table" and self._entries_count > 0:
                print(file=self.output_stream)  # Blank line between entries

            self._entries_count += 1
        except BrokenPipeError:
            # Handle piping to head, etc.
            pass

    def write_entries(self, entries: Iterator[LogEntry]) -> int:
        """Write all entries to the output stream.

        Returns:
            Number of entries written
        """
        count = 0
        try:
            for entry in entries:
                self.write_entry(entry)
                count += 1
        except BrokenPipeError:
            pass
        return count

    def format_stats(self, stats: StatsResult) -> str:
        """Format statistics based on the configured format."""
        match self.format:
            case "json":
                return self._format_stats_json(stats)
            case "table":
                return self._format_stats_table(stats)
            case _:
                return self._format_stats_json(stats)

    def _format_stats_json(self, stats: StatsResult) -> str:
        """Format stats as JSON."""
        data: dict = {
            "total_entries": stats.total_entries,
            "count_by_level": stats.count_by_level,
            "earliest_timestamp": (
                stats.earliest_timestamp.isoformat()
                if stats.earliest_timestamp else None
            ),
            "latest_timestamp": (
                stats.latest_timestamp.isoformat()
                if stats.latest_timestamp else None
            ),
            "top_messages": [
                {"message": msg, "count": count}
                for msg, count in stats.message_counts.most_common(10)
            ],
        }

        if stats.has_duration_field:
            data["slowest_entries"] = [
                {
                    "timestamp": e.timestamp.isoformat(),
                    "level": e.level,
                    "message": e.message,
                    "duration_ms": e.duration_ms
                }
                for e in stats.slowest_entries
            ]

        # Hourly histogram
        sorted_buckets = sorted(stats.hourly_buckets.values(), key=lambda b: b.hour)
        data["entries_per_hour"] = [
            {"hour": b.label, "count": b.count}
            for b in sorted_buckets
        ]

        return json.dumps(data, indent=2)

    def _format_stats_table(self, stats: StatsResult) -> str:
        """Format stats as a table."""
        lines: list[str] = []

        # Summary
        lines.append("=" * 60)
        lines.append("LOG STATISTICS SUMMARY")
        lines.append("=" * 60)
        lines.append("")

        # Total entries
        lines.append(f"Total Entries: {stats.total_entries}")
        lines.append("")

        # Time range
        if stats.earliest_timestamp and stats.latest_timestamp:
            lines.append("Time Range:")
            lines.append(f"  Earliest: {stats.earliest_timestamp.isoformat()}")
            lines.append(f"  Latest:   {stats.latest_timestamp.isoformat()}")
            lines.append("")

        # Count by level
        lines.append("Entries by Level:")
        level_data = [
            [level.upper(), str(count)]
            for level, count in stats.count_by_level.items()
            if count > 0
        ]
        if level_data:
            lines.append(tabulate(level_data, headers=["Level", "Count"], tablefmt="simple"))
        else:
            lines.append("  (no entries)")
        lines.append("")

        # Top messages
        lines.append("Top 10 Messages:")
        msg_data = [
            [_truncate(msg, 60), count]
            for msg, count in stats.message_counts.most_common(10)
        ]
        if msg_data:
            lines.append(tabulate(msg_data, headers=["Message", "Count"], tablefmt="simple"))
        else:
            lines.append("  (no messages)")
        lines.append("")

        # Slowest entries
        if stats.has_duration_field and stats.slowest_entries:
            lines.append("Top 5 Slowest Entries (by duration_ms):")
            slow_data = [
                [e.timestamp.isoformat(), e.level, str(e.duration_ms), _truncate(e.message, 40)]
                for e in stats.slowest_entries
            ]
            lines.append(tabulate(
                slow_data,
                headers=["Timestamp", "Level", "Duration (ms)", "Message"],
                tablefmt="simple"
            ))
            lines.append("")

        # Hourly histogram
        if stats.hourly_buckets:
            lines.append("Entries per Hour:")
            sorted_buckets = sorted(stats.hourly_buckets.values(), key=lambda b: b.hour)
            max_count = max((b.count for b in sorted_buckets), default=1)
            bar_width = 40

            for bucket in sorted_buckets:
                if max_count > 0:
                    bar_len = int((bucket.count / max_count) * bar_width)
                else:
                    bar_len = 0
                bar = "█" * bar_len
                lines.append(f"  {bucket.label} | {bar} {bucket.count}")
            lines.append("")

        lines.append("=" * 60)

        return "\n".join(lines)

    def write_stats(self, stats: StatsResult) -> None:
        """Write formatted stats to the output stream."""
        try:
            print(self.format_stats(stats), file=self.output_stream)
        except BrokenPipeError:
            pass
```

### File: src/loglens/watcher.py

```python
"""File watching and tailing functionality."""

from __future__ import annotations

import os
import sys
import time
from typing import Iterator

from loglens.parser import LogEntry, parse_line


class FileWatcher:
    """Watches a file for new content and yields new log entries."""

    def __init__(
        self,
        filepath: str,
        poll_interval: float = 0.1
    ):
        self.filepath = filepath
        self.poll_interval = poll_interval
        self._position = 0
        self._line_number = 0
        self._running = True

    def _verify_file(self) -> None:
        """Verify file exists and is readable."""
        if not os.path.exists(self.filepath):
            print(f"Error: File not found: {self.filepath}", file=sys.stderr)
            sys.exit(1)

        if not os.access(self.filepath, os.R_OK):
            print(f"Error: Permission denied: {self.filepath}", file=sys.stderr)
            sys.exit(1)

    def _seek_to_end(self) -> None:
        """Move to the end of the file for initial watch."""
        try:
            with open(self.filepath, "r", encoding="utf-8") as f:
                # Count existing lines
                for _ in f:
                    self._line_number += 1
                self._position = f.tell()
        except OSError as e:
            print(
                f"Error: Could not read file {self.filepath}: {e}",
                file=sys.stderr
            )
            sys.exit(2)

    def _read_new_lines(self) -> Iterator[LogEntry]:
        """Read new lines appended to the file."""
        try:
            with open(self.filepath, "r", encoding="utf-8") as f:
                f.seek(self._position)

                for line in f:
                    self._line_number += 1
                    entry = parse_line(line, self._line_number)
                    if entry is not None:
                        yield entry

                self._position = f.tell()
        except OSError as e:
            print(f"Warning: Error reading file: {e}", file=sys.stderr)

    def watch(self) -> Iterator[LogEntry]:
        """Watch the file and yield new entries as they're added.

        This generator runs indefinitely until stopped via stop()
        or interrupted by the user.

        Yields:
            LogEntry objects for each new valid log line
        """
        self._verify_file()
        self._seek_to_end()

        try:
            while self._running:
                # Try to read new content
                found_any = False
                for entry in self._read_new_lines():
                    found_any = True
                    yield entry

                # If no new content, wait a bit
                if not found_any:
                    time.sleep(self.poll_interval)

        except KeyboardInterrupt:
            # Graceful exit on Ctrl+C
            pass
        except BrokenPipeError:
            # Handle piping to head, etc.
            pass

    def stop(self) -> None:
        """Stop watching."""
        self._running = False
```

### File: src/loglens/cli.py

```python
"""Click CLI command definitions for LogLens."""

from __future__ import annotations

from datetime import datetime
from typing import Any

import click

from loglens.aggregator import compute_stats
from loglens.filters import FilterConfig, filter_entries
from loglens.formatters import OutputFormatter
from loglens.parser import parse_iso_timestamp, read_file_or_stdin
from loglens.types import OutputFormat
from loglens.watcher import FileWatcher


def parse_datetime(value: str) -> datetime:
    """Parse a datetime string for CLI options."""
    try:
        return parse_iso_timestamp(value)
    except ValueError:
        raise click.BadParameter(
            f"Invalid datetime format: {value}. Use ISO 8601 format."
        )


@click.group()
@click.version_option(version="0.1.0", prog_name="loglens")
def main() -> None:
    """LogLens - Analyze structured JSON log files."""
    pass


def build_filter_config(
    level: set[str],
    since: str | None,
    until: str | None,
    field: tuple[str, ...],
    contains: str | None
) -> FilterConfig:
    """Build a FilterConfig from CLI options."""
    config = FilterConfig(
        levels=level,
        contains_text=contains
    )

    if since:
        config.since = parse_datetime(since)
    if until:
        config.until = parse_datetime(until)

    # Parse field matches
    field_matches: dict[str, str] = {}
    for f in field:
        if "=" not in f:
            raise click.BadParameter(
                f"Invalid field format: {f}. Use FIELD=VALUE."
            )
        key, value = f.split("=", 1)
        field_matches[key] = value
    config.field_matches = field_matches

    return config


@main.command("filter")
@click.argument("file", type=str)
@click.option(
    "--level", "-l",
    multiple=True,
    help="Filter by log level (repeatable)."
)
@click.option(
    "--since",
    type=str,
    default=None,
    help="Only entries at or after this timestamp (ISO 8601)."
)
@click.option(
    "--until",
    type=str,
    default=None,
    help="Only entries before this timestamp (ISO 8601)."
)
@click.option(
    "--field", "-f",
    multiple=True,
    help="Match entries where field equals value (format: FIELD=VALUE, repeatable)."
)
@click.option(
    "--contains", "-c",
    type=str,
    default=None,
    help="Match entries whose message contains TEXT (case-insensitive)."
)
@click.option(
    "--output", "-o",
    type=click.Choice(["json", "csv", "table"], case_sensitive=False),
    default="json",
    help="Output format."
)
@click.option(
    "--limit", "-n",
    type=int,
    default=None,
    help="Stop after N matching entries."
)
def filter_cmd(
    file: str,
    level: tuple[str, ...],
    since: str | None,
    until: str | None,
    field: tuple[str, ...],
    contains: str | None,
    output: str,
    limit: int | None
) -> None:
    """Filter log entries matching the given criteria."""
    config = build_filter_config(
        levels={v.lower() for v in level},
        since=since,
        until=until,
        field=field,
        contains=contains
    )

    formatter = OutputFormatter(format=output.lower() as OutputFormat)

    # Stream entries through filter and output
    entries = read_file_or_stdin(file)
    filtered = filter_entries(entries, config, limit=limit)

    try:
        formatter.write_entries(filtered)
    except KeyboardInterrupt:
        pass
    except BrokenPipeError:
        pass


@main.command("stats")
@click.argument("file", type=str)
@click.option(
    "--level", "-l",
    multiple=True,
    help="Filter by log level (repeatable)."
)
@click.option(
    "--since",
    type=str,
    default=None,
    help="Only entries at or after this timestamp (ISO 8601)."
)
@click.option(
    "--until",
    type=str,
    default=None,
    help="Only entries before this timestamp (ISO 8601)."
)
@click.option(
    "--field", "-f",
    multiple=True,
    help="Match entries where field equals value (format: FIELD=VALUE, repeatable)."
)
@click.option(
    "--contains", "-c",
    type=str,
    default=None,
    help="Match entries whose message contains TEXT (case-insensitive)."
)
@click.option(
    "--output", "-o",
    type=click.Choice(["json", "table"], case_sensitive=False),
    default="json",
    help="Output format."
)
def stats_cmd(
    file: str,
    level: tuple[str, ...],
    since: str | None,
    until: str | None,
    field: tuple[str, ...],
    contains: str | None,
    output: str
) -> None:
    """Compute aggregations over log entries."""
    config = build_filter_config(
        levels={v.lower() for v in level},
        since=since,
        until=until,
        field=field,
        contains=contains
    )

    formatter = OutputFormatter(format=output.lower() as OutputFormat)

    # Stream entries through filter and compute stats
    entries = read_file_or_stdin(file)
    filtered = filter_entries(entries, config)
    result = compute_stats(filtered)

    formatter.write_stats(result)


@main.command("watch")
@click.argument("file", type=str)
@click.option(
    "--level", "-l",
    multiple=True,
    help="Filter by log level (repeatable)."
)
@click.option(
    "--since",
    type=str,
    default=None,
    help="Only entries at or after this timestamp (ISO 8601)."
)
@click.option(
    "--until",
    type=str,
    default=None,
    help="Only entries before this timestamp (ISO 8601)."
)
@click.option(
    "--field", "-f",
    multiple=True,
    help="Match entries where field equals value (format: FIELD=VALUE, repeatable)."
)
@click.option(
    "--contains", "-c",
    type=str,
    default=None,
    help="Match entries whose message contains TEXT (case-insensitive)."
)
@click.option(
    "--output", "-o",
    type=click.Choice(["json", "table"], case_sensitive=False),
    default="json",
    help="Output format."
)
def watch_cmd(
    file: str,
    level: tuple[str, ...],
    since: str | None,
    until: str | None,
    field: tuple[str, ...],
    contains: str | None,
    output: str
) -> None:
    """Tail a file and stream new matching entries."""
    config = build_filter_config(
        levels={v.lower() for v in level},
        since=since,
        until=until,
        field=field,
        contains=contains
    )

    formatter = OutputFormatter(format=output.lower() as OutputFormat)

    # Watch file and filter entries
    watcher = FileWatcher(file)
    entries = watcher.watch()
    filtered = filter_entries(entries, config)

    try:
        formatter.write_entries(filtered)
    except KeyboardInterrupt:
        pass
    except BrokenPipeError:
        pass


if __name__ == "__main__":
    main()
```

### File: sample.log

```json
{"timestamp": "2025-01-15T08:00:00.000Z", "level": "info", "message": "Service started", "service": "auth-api", "version": "1.2.3"}
{"timestamp": "2025-01-15T08:01:00.000Z", "level": "debug", "message": "Loading configuration", "service": "auth-api"}
{"timestamp": "2025-01-15T08:02:00.000Z", "level": "debug", "message": "Configuration loaded successfully", "service": "auth-api"}
{"timestamp": "2025-01-15T08:05:00.000Z", "level": "info", "message": "Processing request", "service": "auth-api", "request_id": "req-001", "duration_ms": 45}
{"timestamp": "2025-01-15T08:05:30.000Z", "level": "debug", "message": "Cache hit for user session", "service": "auth-api", "user_id": "user-123"}
{"timestamp": "2025-01-15T08:10:00.000Z", "level": "info", "message": "User login successful", "service": "auth-api", "user_id": "user-123", "duration_ms": 120}
{"timestamp": "2025-01-15T08:15:00.000Z", "level": "warning", "message": "Rate limit approaching", "service": "auth-api", "current_rate": 95, "limit": 100}
{"timestamp": "2025-01-15T08:20:00.000Z", "level": "error", "message": "Connection refused", "service": "auth-api", "duration_ms": 342, "retry_count": 3}
{"timestamp": "2025-01-15T08:20:05.000Z", "level": "warning", "message": "Retrying connection", "service": "auth-api", "retry_attempt": 1}
{"timestamp": "2025-01-15T08:20:10.000Z", "level": "info", "message": "Connection restored", "service": "auth-api", "duration_ms": 50}
{"timestamp": "2025-01-15T08:25:00.000Z", "level": "error", "message": "Database timeout", "service": "auth-api", "duration_ms": 5000, "query": "SELECT * FROM sessions"}
{"timestamp": "2025-01-15T08:30:00.000Z", "level": "critical", "message": "Service unavailable", "service": "auth-api", "duration_ms": 10000}
{"timestamp": "2025-01-15T08:35:00.000Z", "level": "info", "message": "Cache cleared", "service": "auth-api", "cache_size": 1500}
{"timestamp": "2025-01-15T08:40:00.000Z", "level": "debug", "message": "Processing request", "service": "auth-api", "request_id": "req-002", "duration_ms": 32}
{"timestamp": "2025-01-15T09:00:00.000Z", "level": "info", "message": "Health check passed", "service": "auth-api", "checks_passed": 5}
{"timestamp": "2025-01-15T09:30:00.000Z", "level": "warning", "message": "Memory usage high", "service": "auth-api", "memory_percent": 85}
{"timestamp": "2025-01-15T10:00:00.000Z", "level": "error", "message": "Connection refused", "service": "user-api", "duration_ms": 200}
{"timestamp": "2025-01-15T10:30:00.000Z", "level": "info", "message": "Batch job completed", "service": "worker", "duration_ms": 15000, "records_processed": 5000}
{"timestamp": "2025-01-15T11:00:00.000Z", "level": "debug", "message": "Configuration reloaded", "service": "auth-api"}
{"timestamp": "2025-01-15T11:30:00.000Z", "level": "info", "message": "User logout", "service": "auth-api", "user_id": "user-123", "session_duration_ms": 1260000}
{"timestamp": "2025-01-15T12:00:00.000Z", "level": "info", "message": "Scheduled maintenance started", "service": "auth-api"}
{"timestamp": "2025-01-15T12:05:00.000Z", "level": "warning", "message": "Scheduled maintenance in progress", "service": "auth-api", "estimated_duration_min": 30}
{"timestamp": "2025-01-15T12:30:00.000Z", "level": "info", "message": "Scheduled maintenance completed", "service": "auth-api", "actual_duration_min": 30}
{"timestamp": "2025-01-15T13:00:00.000Z", "level": "error", "message": "Connection refused", "service": "payment-api", "duration_ms": 500}
{"timestamp": "2025-01-15T13:15:00.000Z", "level": "critical", "message": "Payment gateway down", "service": "payment-api", "duration_ms": 30000}
```

### File: tests/conftest.py

```python
"""Shared pytest fixtures for LogLens tests."""

from pathlib import Path
from typing import Generator

import pytest

from loglens.parser import LogEntry, parse_line


# Sample log lines for testing
SAMPLE_LOG_LINES = [
    '{"timestamp": "2025-01-15T08:00:00.000Z", "level": "info", "message": "Service started", "service": "auth-api"}',
    '{"timestamp": "2025-01-15T08:05:00.000Z", "level": "debug", "message": "Processing request", "service": "auth-api", "request_id": "req-001"}',
    '{"timestamp": "2025-01-15T08:10:00.000Z", "level": "info", "message": "User login successful", "service": "auth-api", "user_id": "user-123"}',
    '{"timestamp": "2025-01-15T08:15:00.000Z", "level": "warning", "message": "Rate limit approaching", "service": "auth-api", "current_rate": 95}',
    '{"timestamp": "2025-01-15T08:20:00.000Z", "level": "error", "message": "Connection refused", "service": "auth-api", "duration_ms": 342}',
    '{"timestamp": "2025-01-15T08:25:00.000Z", "level": "error", "message": "Database timeout", "service": "auth-api", "duration_ms": 5000}',
    '{"timestamp": "2025-01-15T08:30:00.000Z", "level": "critical", "message": "Service unavailable", "service": "auth-api", "duration_ms": 10000}',
    '{"timestamp": "2025-01-15T08:35:00.000Z", "level": "info", "message": "Cache cleared", "service": "auth-api"}',
    '{"timestamp": "2025-01-15T08:40:00.000Z", "level": "debug", "message": "Processing request", "service": "auth-api", "request_id": "req-002"}',
    '{"timestamp": "2025-01-15T09:00:00.000Z", "level": "info", "message": "Health check passed", "service": "auth-api"}',
    '{"timestamp": "2025-01-15T09:30:00.000Z", "level": "warning", "message": "Memory usage high", "service": "auth-api", "memory_percent": 85}',
    '{"timestamp": "2025-01-15T10:00:00.000Z", "level": "error", "message": "Connection refused", "service": "user-api"}',
    '{"timestamp": "2025-01-15T10:30:00.000Z", "level": "info", "message": "Batch job completed", "service": "worker", "duration_ms": 15000}',
    '{"timestamp": "2025-01-15T11:00:00.000Z", "level": "debug", "message": "Configuration reloaded", "service": "auth-api"}',
    '{"timestamp": "2025-01-15T11:30:00.000Z", "level": "info", "message": "User logout", "service": "auth-api", "user_id": "user-123"}',
]

MALFORMED_LINES = [
    "not json at all",
    '{"incomplete": ',
    '{"timestamp": "2025-01-15T08:00:00.000Z"}',
    '{"level": "info", "message": "test"}',
    '{"timestamp": "2025-01-15T08:00:00.000Z", "level": "invalid", "message": "test"}',
]


@pytest.fixture
def sample_log_file(tmp_path: Path) -> Path:
    """Create a temporary log file with sample data."""
    log_file = tmp_path / "sample.log"
    log_file.write_text("\n".join(SAMPLE_LOG_LINES))
    return log_file


@pytest.fixture
def malformed_log_file(tmp_path: Path) -> Path:
    """Create a temporary log file with malformed entries."""
    log_file = tmp_path / "malformed.log"
    log_file.write_text("\n".join(MALFORMED_LINES))
    return log_file


@pytest.fixture
def empty_log_file(tmp_path: Path) -> Path:
    """Create an empty log file."""
    log_file = tmp_path / "empty.log"
    log_file.write_text("")
    return log_file


@pytest.fixture
def mixed_log_file(tmp_path: Path) -> Path:
    """Create a log file with both valid and malformed entries."""
    lines = [
        SAMPLE_LOG_LINES[0],
        MALFORMED_LINES[0],
        SAMPLE_LOG_LINES[1],
        MALFORMED_LINES[2],
        SAMPLE_LOG_LINES[2],
    ]
    log_file = tmp_path / "mixed.log"
    log_file.write_text("\n".join(lines))
    return log_file


@pytest.fixture
def sample_entries() -> list[LogEntry]:
    """Create sample LogEntry objects for testing."""
    entries = []
    for i, line in enumerate(SAMPLE_LOG_LINES, 1):
        entry = parse_line(line, i)
        if entry:
            entries.append(entry)
    return entries


@pytest.fixture
def temp_dir(tmp_path: Path) -> Path:
    """Provide a temporary directory."""
    return tmp_path
```

### File: tests/test_parser.py

```python
"""Tests for log parsing functionality."""

import io
from datetime import datetime

import pytest

from loglens.parser import (
    LogEntry,
    parse_line,
    parse_iso_timestamp,
    stream_entries,
    read_file_or_stdin,
)


class TestParseIsoTimestamp:
    """Tests for ISO timestamp parsing."""

    def test_parse_utc_with_z(self) -> None:
        """Test parsing UTC timestamp with Z suffix."""
        result = parse_iso_timestamp("2025-01-15T08:23:41.012Z")
        assert result.year == 2025
        assert result.month == 1
        assert result.day == 15
        assert result.hour == 8
        assert result.minute == 23
        assert result.second == 41

    def test_parse_with_timezone_offset(self) -> None:
        """Test parsing timestamp with timezone offset."""
        result = parse_iso_timestamp("2025-01-15T08:23:41+00:00")
        assert result.year == 2025
        assert result.month == 1

    def test_parse_without_timezone(self) -> None:
        """Test parsing timestamp without timezone."""
        result = parse_iso_timestamp("2025-01-15T08:23:41")
        assert result.year == 2025
        assert result.month == 1

    def test_parse_with_microseconds(self) -> None:
        """Test parsing timestamp with microseconds."""
        result = parse_iso_timestamp("2025-01-15T08:23:41.123456Z")
        assert result.microsecond == 123456


class TestParseLine:
    """Tests for log line parsing."""

    def test_parse_valid_line(self) -> None:
        """Test parsing a valid JSON log line."""
        line = '{"timestamp": "2025-01-15T08:23:41.012Z", "level": "error", "message": "Connection refused"}'
        entry = parse_line(line, 1)

        assert entry is not None
        assert entry.level == "error"
        assert entry.message == "Connection refused"
        assert entry.timestamp.year == 2025
        assert entry.line_number == 1

    def test_parse_line_with_extra_fields(self) -> None:
        """Test parsing a line with additional fields."""
        line = '{"timestamp": "2025-01-15T08:23:41.012Z", "level": "info", "message": "test", "service": "api", "duration_ms": 100}'
        entry = parse_line(line, 2)

        assert entry is not None
        assert entry.service == "api"
        assert entry.duration_ms == 100
        assert entry.get_field("service") == "api"

    def test_parse_malformed_json(self, capsys: pytest.CaptureFixture) -> None:
        """Test that malformed JSON returns None and warns."""
        line = "not valid json"
        entry = parse_line(line, 3)

        assert entry is None
        captured = capsys.readouterr()
        assert "Warning" in captured.err
        assert "line 3" in captured.err

    def test_parse_missing_timestamp(self, capsys: pytest.CaptureFixture) -> None:
        """Test that missing timestamp field returns None and warns."""
        line = '{"level": "info", "message": "test"}'
        entry = parse_line(line, 4)

        assert entry is None
        captured = capsys.readouterr()
        assert "timestamp" in captured.err

    def test_parse_missing_level(self, capsys: pytest.CaptureFixture) -> None:
        """Test that missing level field returns None and warns."""
        line = '{"timestamp": "2025-01-15T08:23:41.012Z", "message": "test"}'
        entry = parse_line(line, 5)

        assert entry is None
        captured = capsys.readouterr()
        assert "level" in captured.err

    def test_parse_missing_message(self, capsys: pytest.CaptureFixture) -> None:
        """Test that missing message field returns None and warns."""
        line = '{"timestamp": "2025-01-15T08:23:41.012Z", "level": "info"}'
        entry = parse_line(line, 6)

        assert entry is None
        captured = capsys.readouterr()
        assert "message" in captured.err

    def test_parse_invalid_level(self, capsys: pytest.CaptureFixture) -> None:
        """Test that invalid log level returns None and warns."""
        line = '{"timestamp": "2025-01-15T08:23:41.012Z", "level": "unknown", "message": "test"}'
        entry = parse_line(line, 7)

        assert entry is None
        captured = capsys.readouterr()
        assert "Invalid log level" in captured.err

    def test_parse_empty_line(self) -> None:
        """Test that empty lines return None without warning."""
        entry = parse_line("", 8)
        assert entry is None

    def test_parse_whitespace_line(self) -> None:
        """Test that whitespace-only lines return None."""
        entry = parse_line("   \t  ", 9)
        assert entry is None

    def test_parse_non_object_json(self, capsys: pytest.CaptureFixture) -> None:
        """Test that non-object JSON returns None."""
        entry = parse_line('["array", "not", "object"]', 10)
        assert entry is None
        captured = capsys.readouterr()
        assert "non-object" in captured.err


class TestStreamEntries:
    """Tests for streaming entries from file handles."""

    def test_stream_valid_entries(self) -> None:
        """Test streaming multiple valid entries."""
        lines = [
            '{"timestamp": "2025-01-15T08:00:00.000Z", "level": "info", "message": "test1"}',
            '{"timestamp": "2025-01-15T08:01:00.000Z", "level": "error", "message": "test2"}',
        ]
        file_handle = io.StringIO("\n".join(lines))

        entries = list(stream_entries(file_handle))
        assert len(entries) == 2
        assert entries[0].message == "test1"
        assert entries[1].message == "test2"

    def test_stream_mixed_entries(self, capsys: pytest.CaptureFixture) -> None:
        """Test streaming with some invalid entries."""
        lines = [
            '{"timestamp": "2025-01-15T08:00:00.000Z", "level": "info", "message": "valid"}',
            "invalid json",
            '{"timestamp": "2025-01-15T08:01:00.000Z", "level": "error", "message": "also valid"}',
        ]
        file_handle = io.StringIO("\n".join(lines))

        entries = list(stream_entries(file_handle))
        assert len(entries) == 2
        captured = capsys.readouterr()
        assert "Warning" in captured.err


class TestReadFileOrStdin:
    """Tests for reading from files or stdin."""

    def test_read_from_file(self, sample_log_file: Path) -> None:
        """Test reading entries from a file."""
        entries = list(read_file_or_stdin(str(sample_log_file)))
        assert len(entries) > 0
        assert all(isinstance(e, LogEntry) for e in entries)

    def test_read_from_empty_file(self, empty_log_file: Path) -> None:
        """Test reading from an empty file."""
        entries = list(read_file_or_stdin(str(empty_log_file)))
        assert len(entries) == 0

    def test_read_from_nonexistent_file(self, capsys: pytest.CaptureFixture) -> None:
        """Test that reading nonexistent file exits with error."""
        with pytest.raises(SystemExit) as exc_info:
            list(read_file_or_stdin("/nonexistent/path/file.log"))

        assert exc_info.value.code == 1
        captured = capsys.readouterr()
        assert "File not found" in captured.err


class TestLogEntry:
    """Tests for LogEntry dataclass."""

    def test_get_field(self) -> None:
        """Test getting field values."""
        entry = LogEntry(
            timestamp=datetime(2025, 1, 15, 8, 0, 0),
            level="info",
            message="test",
            raw={"custom_field": "value", "nested": {"key": "val"}}
        )

        assert entry.get_field("custom_field") == "value"
        assert entry.get_field("nonexistent") is None

    def test_properties(self) -> None:
        """Test convenience properties."""
        entry = LogEntry(
            timestamp=datetime(2025, 1, 15, 8, 0, 0),
            level="info",
            message="test",
            raw={"service": "api", "request_id": "req-123", "duration_ms": 50}
        )

        assert entry.service == "api"
        assert entry.request_id == "req-123"
        assert entry.duration_ms == 50
```

### File: tests/test_filters.py

```python
"""Tests for log filtering functionality."""

from datetime import datetime
from pathlib import Path

import pytest

from loglens.parser import LogEntry, parse_line
from loglens.filters import FilterConfig, filter_entries, create_filter_predicate


class TestFilterConfig:
    """Tests for FilterConfig dataclass."""

    def test_empty_config_has_no_filters(self) -> None:
        """Test that empty config reports no filters."""
        config = FilterConfig()
        assert not config.has_filters()

    def test_config_with_levels_has_filters(self) -> None:
        """Test that config with levels reports having filters."""
        config = FilterConfig(levels={"error", "critical"})
        assert config.has_filters()

    def test_config_with_time_range_has_filters(self) -> None:
        """Test that config with time range reports having filters."""
        config = FilterConfig(since=datetime(2025, 1, 15))
        assert config.has_filters()

        config = FilterConfig(until=datetime(2025, 1, 16))
        assert config.has_filters()

    def test_config_with_field_matches_has_filters(self) -> None:
        """Test that config with field matches reports having filters."""
        config = FilterConfig(field_matches={"service": "api"})
        assert config.has_filters()

    def test_config_with_contains_has_filters(self) -> None:
        """Test that config with contains text reports having filters."""
        config = FilterConfig(contains_text="error")
        assert config.has_filters()


class TestFilterPredicates:
    """Tests for individual filter predicates."""

    @pytest.fixture
    def entries(self) -> list[LogEntry]:
        """Create test entries."""
        lines = [
            '{"timestamp": "2025-01-15T08:00:00.000Z", "level": "debug", "message": "Debug message"}',
            '{"timestamp": "2025-01-15T09:00:00.000Z", "level": "info", "message": "Info message"}',
            '{"timestamp": "2025-01-15T10:00:00.000Z", "level": "warning", "message": "Warning message"}',
            '{"timestamp": "2025-01-15T11:00:00.000Z", "level": "error", "message": "Error message"}',
            '{"timestamp": "2025-01-15T12:00:00.000Z", "level": "critical", "message": "Critical message"}',
            '{"timestamp": "2025-01-15T13:00:00.000Z", "level": "info", "message": "Another info message"}',
        ]
        return [parse_line(line, i) for i, line in enumerate(lines, 1) if parse_line(line, i)]

    def test_filter_by_single_level(self, entries: list[LogEntry]) -> None:
        """Test filtering by a single level."""
        config = FilterConfig(levels={"error"})
        predicate = create_filter_predicate(config)

        filtered = [e for e in entries if predicate(e)]
        assert len(filtered) == 1
        assert filtered[0].level == "error"

    def test_filter_by_multiple_levels(self, entries: list[LogEntry]) -> None:
        """Test filtering by multiple levels."""
        config = FilterConfig(levels={"error", "critical"})
        predicate = create_filter_predicate(config)

        filtered = [e for e in entries if predicate(e)]
        assert len(filtered) == 2
        assert {e.level for e in filtered} == {"error", "critical"}

    def test_filter_by_since_time(self, entries: list[LogEntry]) -> None:
        """Test filtering by start time."""
        config = FilterConfig(since=datetime(2025, 1, 15, 10, 0, 0))
        predicate = create_filter_predicate(config)

        filtered = [e for e in entries if predicate(e)]
        assert len(filtered) == 4  # 10:00, 11:00, 12:00, 13:00

    def test_filter_by_until_time(self, entries: list[LogEntry]) -> None:
        """Test filtering by end time."""
        config = FilterConfig(until=datetime(2025, 1, 15, 10, 0, 0))
        predicate = create_filter_predicate(config)

        filtered = [e for e in entries if predicate(e)]
        assert len(filtered) == 2  # 08:00, 09:00

    def test_filter_by_time_range(self, entries: list[LogEntry]) -> None:
        """Test filtering by time range."""
        config = FilterConfig(
            since=datetime(2025, 1, 15, 9, 0, 0),
            until=datetime(2025, 1, 15, 12, 0, 0)
        )
        predicate = create_filter_predicate(config)

        filtered = [e for e in entries if predicate(e)]
        assert len(filtered) == 3  # 09:00, 10:00, 11:00

    def test_filter_by_contains_text(self, entries: list[LogEntry]) -> None:
        """Test filtering by message text (case-insensitive)."""
        config = FilterConfig(contains_text="ERROR")
        predicate = create_filter_predicate(config)

        filtered = [e for e in entries if predicate(e)]
        assert len(filtered) == 1
        assert "Error" in filtered[0].message

    def test_filter_by_contains_text_case_insensitive(self, entries: list[LogEntry]) -> None:
        """Test that contains filter is case-insensitive."""
        config = FilterConfig(contains_text="MESSAGE")
        predicate = create_filter_predicate(config)

        filtered = [e for e in entries if predicate(e)]
        assert len(filtered) == 6  # All entries contain "message"

    def test_filter_by_field_match(self) -> None:
        """Test filtering by field equality."""
        lines = [
            '{"timestamp": "2025-01-15T08:00:00.000Z", "level": "info", "message": "test", "service": "api"}',
            '{"timestamp": "2025-01-15T09:00:00.000Z", "level": "info", "message": "test", "service": "worker"}',
            '{"timestamp": "2025-01-15T10:00:00.000Z", "level": "info", "message": "test", "service": "api"}',
        ]
        entries = [parse_line(line, i) for i, line in enumerate(lines, 1) if parse_line(line, i)]

        config = FilterConfig(field_matches={"service": "api"})
        predicate = create_filter_predicate(config)

        filtered = [e for e in entries if predicate(e)]
        assert len(filtered) == 2


class TestFilterEntries:
    """Tests for the filter_entries generator."""

    @pytest.fixture
    def sample_entries(self) -> list[LogEntry]:
        """Create sample entries."""
        lines = [
            '{"timestamp": "2025-01-15T08:00:00.000Z", "level": "info", "message": "test1"}',
            '{"timestamp": "2025-01-15T09:00:00.000Z", "level": "error", "message": "test2"}',
            '{"timestamp": "2025-01-15T10:00:00.000Z", "level": "info", "message": "test3"}',
            '{"timestamp": "2025-01-15T11:00:00.000Z", "level": "error", "message": "test4"}',
        ]
        return [parse_line(line, i) for i, line in enumerate(lines, 1) if parse_line(line, i)]

    def test_filter_no_config(self, sample_entries: list[LogEntry]) -> None:
        """Test that no filter config passes all entries."""
        config = FilterConfig()
        filtered = list(filter_entries(iter(sample_entries), config))
        assert len(filtered) == len(sample_entries)

    def test_filter_with_limit(self, sample_entries: list[LogEntry]) -> None:
        """Test limiting number of results."""
        config = FilterConfig()
        filtered = list(filter_entries(iter(sample_entries), config, limit=2))
        assert len(filtered) == 2

    def test_filter_with_level_and_limit(self, sample_entries: list[LogEntry]) -> None:
        """Test combining filter and limit."""
        config = FilterConfig(levels={"error"})
        filtered = list(filter_entries(iter(sample_entries), config, limit=1))
        assert len(filtered) == 1
        assert filtered[0].level == "error"

    def test_filter_empty_input(self) -> None:
        """Test filtering empty input."""
        config = FilterConfig(levels={"error"})
        filtered = list(filter_entries(iter([]), config))
        assert len(filtered) == 0


class TestCombinedFilters:
    """Tests for combined filter conditions."""

    def test_combined_level_and_time(self) -> None:
        """Test combining level and time filters."""
        lines = [
            '{"timestamp": "2025-01-15T08:00:00.000Z", "level": "error", "message": "test1"}',
            '{"timestamp": "2025-01-15T09:00:00.000Z", "level": "error", "message": "test2"}',
            '{"timestamp": "2025-01-15T10:00:00.000Z", "level": "info", "message": "test3"}',
        ]
        entries = [parse_line(line, i) for i, line in enumerate(lines, 1) if parse_line(line, i)]

        config = FilterConfig(
            levels={"error"},
            since=datetime(2025, 1, 15, 9, 0, 0)
        )
        predicate = create_filter_predicate(config)

        filtered = [e for e in entries if predicate(e)]
        assert len(filtered) == 1
        assert filtered[0].message == "test2"

    def test_combined_field_and_contains(self) -> None:
        """Test combining field match and contains filters."""
        lines = [
            '{"timestamp": "2025-01-15T08:00:00.000Z", "level": "info", "message": "Connection timeout", "service": "api"}',
            '{"timestamp": "2025-01-15T09:00:00.000Z", "level": "info", "message": "Connection failed", "service": "worker"}',
            '{"timestamp": "2025-01-15T10:00:00.000Z", "level": "info", "message": "Success", "service": "api"}',
        ]
        entries = [parse_line(line, i) for i, line in enumerate(lines, 1) if parse_line(line, i)]

        config = FilterConfig(
            field_matches={"service": "api"},
            contains_text="connection"
        )
        predicate = create_filter_predicate(config)

        filtered = [e for e in entries if predicate(e)]
        assert len(filtered) == 1
        assert "timeout" in filtered[0].message.lower()

    def test_all_filters_combined(self) -> None:
        """Test combining all filter types."""
        lines = [
            '{"timestamp": "2025-01-15T08:00:00.000Z", "level": "error", "message": "Connection error", "service": "api"}',
            '{"timestamp": "2025-01-15T09:00:00.000Z", "level": "error", "message": "Connection error", "service": "api"}',
            '{"timestamp": "2025-01-15T10:00:00.000Z", "level": "info", "message": "Connection error", "service": "api"}',
        ]
        entries = [parse_line(line, i) for i, line in enumerate(lines, 1) if parse_line(line, i)]

        config = FilterConfig(
            levels={"error"},
            since=datetime(2025, 1, 15, 8, 30, 0),
            field_matches={"service": "api"},
            contains_text="error"
        )
        predicate = create_filter_predicate(config)

        filtered = [e for e in entries if predicate(e)]
        assert len(filtered) == 1
        assert filtered[0].timestamp.hour == 9

    def test_field_missing_from_entry(self) -> None:
        """Test that missing field causes filter to fail."""
        lines = [
            '{"timestamp": "2025-01-15T08:00:00.000Z", "level": "info", "message": "test", "service": "api"}',
            '{"timestamp": "2025-01-15T09:00:00.000Z", "level": "info", "message": "test"}',
        ]
        entries = [parse_line(line, i) for i, line in enumerate(lines, 1) if parse_line(line, i)]

        config = FilterConfig(field_matches={"service": "api"})
        predicate = create_filter_predicate(config)

        filtered = [e for e in entries if predicate(e)]
        assert len(filtered) == 1
```

### File: tests/test_aggregator.py

```python
"""Tests for statistics aggregation functionality."""

from datetime import datetime

import pytest

from loglens.parser import LogEntry, parse_line
from loglens.aggregator import StatsResult, compute_stats, HourBucket


class TestHourBucket:
    """Tests for HourBucket dataclass."""

    def test_hour_bucket_label(self) -> None:
        """Test hour bucket label formatting."""
        bucket = HourBucket(hour=datetime(2025, 1, 15, 8, 30, 45))
        assert bucket.label == "2025-01-15 08:00"

    def test_hour_bucket_count(self) -> None:
        """Test hour bucket count."""
        bucket = HourBucket(hour=datetime(2025, 1, 15, 8, 0, 0), count=5)
        assert bucket.count == 5


class TestStatsResult:
    """Tests for StatsResult dataclass."""

    def test_empty_stats(self) -> None:
        """Test that empty stats have sensible defaults."""
        stats = StatsResult()
        assert stats.total_entries == 0
        assert stats.earliest_timestamp is None
        assert stats.latest_timestamp is None
        assert len(stats.message_counts) == 0


class TestComputeStats:
    """Tests for stats computation."""

    @pytest.fixture
    def sample_entries(self) -> list[LogEntry]:
        """Create sample entries for testing."""
        lines = [
            '{"timestamp": "2025-01-15T08:00:00.000Z", "level": "info", "message": "Service started"}',
            '{"timestamp": "2025-01-15T08:30:00.000Z", "level": "error", "message": "Connection refused", "duration_ms": 100}',
            '{"timestamp": "2025-01-15T09:00:00.000Z", "level": "warning", "message": "Memory high"}',
            '{"timestamp": "2025-01-15T09:30:00.000Z", "level": "error", "message": "Connection refused", "duration_ms": 500}',
            '{"timestamp": "2025-01-15T10:00:00.000Z", "level": "info", "message": "Request processed", "duration_ms": 50}',
        ]
        return [parse_line(line, i) for i, line in enumerate(lines, 1) if parse_line(line, i)]

    def test_compute_total_entries(self, sample_entries: list[LogEntry]) -> None:
        """Test total entry count."""
        stats = compute_stats(iter(sample_entries))
        assert stats.total_entries == 5

    def test_compute_count_by_level(self, sample_entries: list[LogEntry]) -> None:
        """Test count by level."""
        stats = compute_stats(iter(sample_entries))

        assert stats.count_by_level["info"] == 2
        assert stats.count_by_level["error"] == 2
        assert stats.count_by_level["warning"] == 1
        assert stats.count_by_level["debug"] == 0
        assert stats.count_by_level["critical"] == 0

    def test_compute_time_range(self, sample_entries: list[LogEntry]) -> None:
        """Test earliest and latest timestamp."""
        stats = compute_stats(iter(sample_entries))

        assert stats.earliest_timestamp == datetime(2025, 1, 15, 8, 0, 0)
        assert stats.latest_timestamp == datetime(2025, 1, 15, 10, 0, 0)

    def test_compute_message_counts(self, sample_entries: list[LogEntry]) -> None:
        """Test message frequency counting."""
        stats = compute_stats(iter(sample_entries))

        assert stats.message_counts["Connection refused"] == 2
        assert stats.message_counts["Service started"] == 1
        assert stats.message_counts["Memory high"] == 1

    def test_compute_slowest_entries(self, sample_entries: list[LogEntry]) -> None:
        """Test slowest entries by duration."""
        stats = compute_stats(iter(sample_entries))

        assert stats.has_duration_field
        assert len(stats.slowest_entries) == 3  # Only 3 have duration
        assert stats.slowest_entries[0].duration_ms == 500
        assert stats.slowest_entries[1].duration_ms == 100
        assert stats.slowest_entries[2].duration_ms == 50

    def test_compute_hourly_buckets(self, sample_entries: list[LogEntry]) -> None:
        """Test hourly histogram buckets."""
        stats = compute_stats(iter(sample_entries))

        assert "2025-01-15 08:00" in stats.hourly_buckets
        assert "2025-01-15 09:00" in stats.hourly_buckets
        assert "2025-01-15 10:00" in stats.hourly_buckets

        assert stats.hourly_buckets["2025-01-15 08:00"].count == 2
        assert stats.hourly_buckets["2025-01-15 09:00"].count == 2
        assert stats.hourly_buckets["2025-01-15 10:00"].count == 1

    def test_compute_empty_input(self) -> None:
        """Test stats on empty input."""
        stats = compute_stats(iter([]))

        assert stats.total_entries == 0
        assert stats.earliest_timestamp is None
        assert stats.latest_timestamp is None
        assert not stats.has_duration_field

    def test_compute_single_entry(self) -> None:
        """Test stats on single entry."""
        line = '{"timestamp": "2025-01-15T08:00:00.000Z", "level": "info", "message": "test"}'
        entry = parse_line(line, 1)
        assert entry is not None

        stats = compute_stats(iter([entry]))

        assert stats.total_entries == 1
        assert stats.earliest_timestamp == stats.latest_timestamp
        assert stats.message_counts["test"] == 1

    def test_top_slowest_limit(self) -> None:
        """Test that slowest entries are limited to top 5."""
        lines = [
            f'{{"timestamp": "2025-01-15T08:00:00.000Z", "level": "info", "message": "test{i}", "duration_ms": {i * 100}}}'
            for i in range(1, 11)  # 10 entries
        ]
        entries = [parse_line(line, i) for i, line in enumerate(lines, 1) if parse_line(line, i)]

        stats = compute_stats(iter(entries))

        assert len(stats.slowest_entries) == 5
        # Should be in descending order
        assert stats.slowest_entries[0].duration_ms == 1000
        assert stats.slowest_entries[4].duration_ms == 600

    def test_entries_without_duration(self) -> None:
        """Test entries without duration_ms field."""
        lines = [
            '{"timestamp": "2025-01-15T08:00:00.000Z", "level": "info", "message": "test1"}',
            '{"timestamp": "2025-01-15T09:00:00.000Z", "level": "error", "message": "test2"}',
        ]
        entries = [parse_line(line, i) for i, line in enumerate(lines, 1) if parse_line(line, i)]

        stats = compute_stats(iter(entries))

        assert not stats.has_duration_field
        assert len(stats.slowest_entries) == 0

    def test_top_messages(self, sample_entries: list[LogEntry]) -> None:
        """Test top messages calculation."""
        stats = compute_stats(iter(sample_entries))

        top = stats.message_counts.most_common(2)
        assert ("Connection refused", 2) in top


class TestStatsWithDifferentTimezones:
    """Tests for timezone handling in stats."""

    def test_mixed_timezone_entries(self) -> None:
        """Test entries with different timezone formats."""
        lines = [
            '{"timestamp": "2025-01-15T08:00:00Z", "level": "info", "message": "test1"}',
            '{"timestamp": "2025-01-15T09:00:00+00:00", "level": "info", "message": "test2"}',
        ]
        entries = [parse_line(line, i) for i, line in enumerate(lines, 1) if parse_line(line, i)]

        stats = compute_stats(iter(entries))

        assert stats.total_entries == 2
        assert stats.earliest_timestamp is not None
        assert stats.latest_timestamp is not None
```

### File: tests/test_formatters.py

```python
"""Tests for output formatting functionality."""

import io
import json

import pytest

from loglens.parser import LogEntry, parse_line
from loglens.aggregator import StatsResult, compute_stats
from loglens.formatters import (
    OutputFormatter,
    format_entry_json,
    format_entry_csv,
    format_entry_table,
)


class TestFormatEntryJson:
    """Tests for JSON entry formatting."""

    def test_format_json_basic(self) -> None:
        """Test basic JSON formatting."""
        line = '{"timestamp": "2025-01-15T08:00:00.000Z", "level": "info", "message": "test"}'
        entry = parse_line(line, 1)
        assert entry is not None

        result = format_entry_json(entry)
        data = json.loads(result)

        assert data["level"] == "info"
        assert data["message"] == "test"

    def test_format_json_preserves_extra_fields(self) -> None:
        """Test that extra fields are preserved in JSON output."""
        line = '{"timestamp": "2025-01-15T08:00:00.000Z", "level": "info", "message": "test", "custom": "value", "count": 42}'
        entry = parse_line(line, 1)
        assert entry is not None

        result = format_entry_json(entry)
        data = json.loads(result)

        assert data["custom"] == "value"
        assert data["count"] == 42


class TestFormatEntryCsv:
    """Tests for CSV entry formatting."""

    def test_format_csv_basic(self) -> None:
        """Test basic CSV formatting."""
        line = '{"timestamp": "2025-01-15T08:00:00.000Z", "level": "info", "message": "test message"}'
        entry = parse_line(line, 1)
        assert entry is not None

        result = format_entry_csv(entry)
        parts = result.split(",")

        assert "info" in result
        assert "test message" in result

    def test_format_csv_custom_fields(self) -> None:
        """Test CSV with custom field order."""
        line = '{"timestamp": "2025-01-15T08:00:00.000Z", "level": "info", "message": "test", "service": "api"}'
        entry = parse_line(line, 1)
        assert entry is not None

        result = format_entry_csv(entry, fieldnames=["service", "level", "message"])

        assert result.startswith("api,info")


class TestFormatEntryTable:
    """Tests for table entry formatting."""

    def test_format_table_basic(self) -> None:
        """Test basic table formatting."""
        line = '{"timestamp": "2025-01-15T08:00:00.000Z", "level": "error", "message": "test message"}'
        entry = parse_line(line, 1)
        assert entry is not None

        result = format_entry_table(entry)

        assert "error" in result
        assert "test message" in result

    def test_format_table_with_service(self) -> None:
        """Test table formatting with service field."""
        line = '{"timestamp": "2025-01-15T08:00:00.000Z", "level": "info", "message": "test", "service": "api-service"}'
        entry = parse_line(line, 1)
        assert entry is not None

        result = format_entry_table(entry)

        assert "api-service" in result

    def test_format_table_with_duration(self) -> None:
        """Test table formatting with duration_ms field."""
        line = '{"timestamp": "2025-01-15T08:00:00.000Z", "level": "info", "message": "test", "duration_ms": 1500}'
        entry = parse_line(line, 1)
        assert entry is not None

        result = format_entry_table(entry)

        assert "1500" in result


class TestOutputFormatter:
    """Tests for OutputFormatter class."""

    def test_format_json(self) -> None:
        """Test JSON formatting through OutputFormatter."""
        line = '{"timestamp": "2025-01-15T08:00:00.000Z", "level": "info", "message": "test"}'
        entry = parse_line(line, 1)
        assert entry is not None

        formatter = OutputFormatter(format="json")
        result = formatter.format_entry(entry)

        data = json.loads(result)
        assert data["message"] == "test"

    def test_format_csv(self) -> None:
        """Test CSV formatting through OutputFormatter."""
        line = '{"timestamp": "2025-01-15T08:00:00.000Z", "level": "info", "message": "test"}'
        entry = parse_line(line, 1)
        assert entry is not None

        output = io.StringIO()
        formatter = OutputFormatter(format="csv", output_stream=output)
        formatter.write_entry(entry)

        result = output.getvalue()
        assert "timestamp,level,message" in result
        assert "info" in result

    def test_format_table(self) -> None:
        """Test table formatting through OutputFormatter."""
        line = '{"timestamp": "2025-01-15T08:00:00.000Z", "level": "warning", "message": "test"}'
        entry = parse_line(line, 1)
        assert entry is not None

        formatter = OutputFormatter(format="table")
        result = formatter.format_entry(entry)

        assert "warning" in result.lower() or "WARNING" in result

    def test_write_multiple_entries(self) -> None:
        """Test writing multiple entries."""
        lines = [
            '{"timestamp": "2025-01-15T08:00:00.000Z", "level": "info", "message": "test1"}',
            '{"timestamp": "2025-01-15T09:00:00.000Z", "level": "error", "message": "test2"}',
        ]
        entries = [parse_line(line, i) for i, line in enumerate(lines, 1) if parse_line(line, i)]

        output = io.StringIO()
        formatter = OutputFormatter(format="json", output_stream=output)
        count = formatter.write_entries(iter(entries))

        assert count == 2
        result = output.getvalue()
        assert "test1" in result
        assert "test2" in result


class TestStatsFormatting:
    """Tests for stats formatting."""

    @pytest.fixture
    def sample_stats(self) -> StatsResult:
        """Create sample stats for testing."""
        lines = [
            '{"timestamp": "2025-01-15T08:00:00.000Z", "level": "info", "message": "test1"}',
            '{"timestamp": "2025-01-15T09:00:00.000Z", "level": "error", "message": "test2", "duration_ms": 100}',
            '{"timestamp": "2025-01-15T10:00:00.000Z", "level": "info", "message": "test1"}',
        ]
        entries = [parse_line(line, i) for i, line in enumerate(lines, 1) if parse_line(line, i)]
        return compute_stats(iter(entries))

    def test_format_stats_json(self, sample_stats: StatsResult) -> None:
        """Test JSON stats formatting."""
        formatter = OutputFormatter(format="json")
        result = formatter.format_stats(sample_stats)

        data = json.loads(result)
        assert data["total_entries"] == 3
        assert data["count_by_level"]["info"] == 2
        assert data["count_by_level"]["error"] == 1
        assert data["earliest_timestamp"] is not None
        assert data["latest_timestamp"] is not None

    def test_format_stats_table(self, sample_stats: StatsResult) -> None:
        """Test table stats formatting."""
        formatter = OutputFormatter(format="table")
        result = formatter.format_stats(sample_stats)

        assert "Total Entries" in result
        assert "3" in result
        assert "INFO" in result or "info" in result.lower()

    def test_stats_json_includes_slowest(self, sample_stats: StatsResult) -> None:
        """Test that JSON stats include slowest entries."""
        formatter = OutputFormatter(format="json")
        result = formatter.format_stats(sample_stats)

        data = json.loads(result)
        assert "slowest_entries" in data
        assert len(data["slowest_entries"]) > 0

    def test_stats_json_includes_hourly(self, sample_stats: StatsResult) -> None:
        """Test that JSON stats include hourly histogram."""
        formatter = OutputFormatter(format="json")
        result = formatter.format_stats(sample_stats)

        data = json.loads(result)
        assert "entries_per_hour" in data
        assert len(data["entries_per_hour"]) > 0

    def test_stats_json_includes_top_messages(self, sample_stats: StatsResult) -> None:
        """Test that JSON stats include top messages."""
        formatter = OutputFormatter(format="json")
        result = formatter.format_stats(sample_stats)

        data = json.loads(result)
        assert "top_messages" in data
        assert len(data["top_messages"]) > 0


class TestEmptyStatsFormatting:
    """Tests for formatting empty stats."""

    def test_empty_stats_json(self) -> None:
        """Test formatting empty stats as JSON."""
        stats = StatsResult()
        formatter = OutputFormatter(format="json")
        result = formatter.format_stats(stats)

        data = json.loads(result)
        assert data["total_entries"] == 0
        assert data["earliest_timestamp"] is None

    def test_empty_stats_table(self) -> None:
        """Test formatting empty stats as table."""
        stats = StatsResult()
        formatter = OutputFormatter(format="table")
        result = formatter.format_stats(stats)

        assert "Total Entries" in result
        assert "0" in result
```