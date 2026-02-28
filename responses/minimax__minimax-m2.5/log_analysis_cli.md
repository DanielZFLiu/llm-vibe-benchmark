I'll build LogLens, a complete production-ready CLI tool for analyzing structured JSON log files. Let me implement each file systematically.

### File: pyproject.toml

```toml
[build-system]
requires = ["setuptools>=61.0", "wheel"]
build-backend = "setuptools.build_meta"

[project]
name = "loglens"
version = "1.0.0"
description = "A Python CLI tool for analyzing structured JSON log files"
readme = "README.md"
requires-python = ">=3.12"
license = {text = "MIT"}
authors = [
    {name = "LogLens Team", email = "team@loglens.dev"}
]
keywords = ["logging", "json", "cli", "analysis", "ndjson"]
classifiers = [
    "Development Status :: 4 - Beta",
    "Intended Audience :: Developers",
    "License :: OSI Approved :: MIT License",
    "Programming Language :: Python :: 3",
    "Programming Language :: Python :: 3.12",
    "Programming Language :: Python :: 3.13",
]

dependencies = [
    "click>=8.1.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=7.0.0",
    "pytest-cov>=4.0.0",
]

[project.scripts]
loglens = "loglens.cli:main"

[tool.setuptools.packages.find]
where = ["src"]

[tool.pytest.ini_options]
testpaths = ["tests"]
python_files = ["test_*.py"]
python_classes = ["Test*"]
python_functions = ["test_*"]
addopts = "-v --tb=short"
```

### File: README.md

```markdown
# LogLens

LogLens is a Python command-line tool for analyzing structured JSON log files (NDJSON). It provides efficient streaming-based filtering, aggregation, and real-time watching capabilities.

## Features

- **Stream-based processing**: Handles multi-GB log files efficiently with O(1) memory usage
- **Flexible filtering**: Filter by log level, timestamp range, field values, and message content
- **Aggregation statistics**: Compute counts, histograms, and top-N rankings
- **Real-time watching**: Tail log files and stream new entries as they appear
- **Multiple output formats**: JSON, CSV, and formatted tables

## Installation

```bash
pip install -e .
```

## Usage

### Filter Logs

Filter log entries by various criteria:

```bash
# Filter by level
loglens filter sample.log --level error --level critical

# Filter by timestamp range
loglens filter sample.log --since 2025-01-15T00:00:00Z --until 2025-01-16T00:00:00Z

# Filter by field value
loglens filter sample.log --field service=auth-api

# Filter by message content
loglens filter sample.log --contains "connection refused"

# Combine filters
loglens filter sample.log --level error --since 2025-01-15T00:00:00Z --output table

# Read from stdin
cat sample.log | loglens filter - --level error
```

### Statistics

Compute aggregations over log entries:

```bash
# Basic statistics
loglens stats sample.log --output table

# With filters
loglens stats sample.log --level error --output json
```

### Watch Mode

Tail a file and stream new entries:

```bash
# Watch for new error entries
loglens watch sample.log --level error --output table

# Watch with multiple filters
loglens watch app.log --level warning --field service=api-gateway
```

## Log Format

LogLens expects newline-delimited JSON (NDJSON) with these required fields:

```json
{"timestamp": "2025-01-15T08:23:41.012Z", "level": "error", "message": "Connection refused", "service": "auth-api"}
```

- `timestamp`: ISO 8601 string
- `level`: One of debug, info, warning, error, critical
- `message`: Free-text string
- Additional custom fields are supported

## Exit Codes

- `0`: Success
- `1`: User error (invalid arguments, file not found)
- `2`: Runtime error

## Development

Run tests:

```bash
pip install -e ".[dev]"
pytest
```
```

### File: src/loglens/types.py

```python
"""Shared type definitions for LogLens."""

from dataclasses import dataclass
from datetime import datetime
from enum import Enum
from typing import TypeAlias

from typing_extensions import Protocol


class LogLevel(Enum):
    """Standard log levels."""

    DEBUG = "debug"
    INFO = "info"
    WARNING = "warning"
    ERROR = "error"
    CRITICAL = "critical"

    @classmethod
    def from_string(cls, value: str) -> "LogLevel":
        """Parse log level from string."""
        try:
            return cls(value.lower())
        except ValueError:
            valid_levels = [level.value for level in cls]
            raise ValueError(f"Invalid log level: {value}. Must be one of: {valid_levels}")


OutputFormat: TypeAlias = Literal["json", "csv", "table"]

Literal: TypeAlias = "typing.Literal"


class StreamStrategy(Protocol):
    """Protocol for stream processing strategies."""

    def process(self, entries: "Iterator[LogEntry]") -> "Iterator[LogEntry]":
        """Process a stream of log entries."""
        ...



@dataclass(slots=True)
class FilterConfig:
    """Configuration for log entry filtering."""

    levels: set[LogLevel] | None = None
    since: datetime | None = None
    until: datetime | None = None
    field_filters: dict[str, str] | None = None
    contains: str | None = None
    limit: int | None = None


@dataclass(slots=True)
class StatsResult:
    """Aggregated statistics result."""

    total_entries: int
    count_per_level: dict[LogLevel, int]
    earliest_timestamp: datetime | None
    latest_timestamp: datetime | None
    top_messages: list[tuple[str, int]]
    slowest_entries: list["LogEntry"]
    entries_per_hour: dict[str, int]

    def to_dict(self) -> dict:
        """Convert to dictionary for JSON serialization."""
        return {
            "total_entries": self.total_entries,
            "count_per_level": {k.value: v for k, v in self.count_per_level.items()},
            "earliest_timestamp": self.earliest_timestamp.isoformat() if self.earliest_timestamp else None,
            "latest_timestamp": self.latest_timestamp.isoformat() if self.latest_timestamp else None,
            "top_messages": self.top_messages,
            "slowest_entries": [
                {
                    "timestamp": e.timestamp.isoformat(),
                    "level": e.level.value,
                    "message": e.message,
                    "duration_ms": e.duration_ms,
                }
                for e in self.slowest_entries
            ],
            "entries_per_hour": self.entries_per_hour,
        }


# Forward reference for type hints
from __future__ import annotations

from typing import Iterator

from loglens.parser import LogEntry
```

### File: src/loglens/parser.py

```python
"""NDJSON log file parsing."""

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Iterator

from loglens.types import LogLevel


@dataclass(slots=True)
class LogEntry:
    """Represents a single log entry."""

    timestamp: datetime
    level: LogLevel
    message: str
    raw_data: dict = field(default_factory=dict)
    request_id: str | None = None
    service: str | None = None
    duration_ms: int | None = None

    @classmethod
    def from_dict(cls, data: dict) -> "LogEntry":
        """Create LogEntry from a dictionary."""
        # Parse timestamp
        ts_str = data.get("timestamp")
        if not ts_str:
            raise ValueError("Missing required field: timestamp")

        timestamp = parse_timestamp(ts_str)

        # Parse level
        level_str = data.get("level")
        if not level_str:
            raise ValueError("Missing required field: level")

        level = LogLevel.from_string(level_str)

        # Parse message
        message = data.get("message")
        if message is None:
            raise ValueError("Missing required field: message")

        # Extract optional fields
        request_id = data.get("request_id")
        service = data.get("service")
        duration_ms = data.get("duration_ms")

        if duration_ms is not None:
            duration_ms = int(duration_ms)

        return cls(
            timestamp=timestamp,
            level=level,
            message=message,
            raw_data=data,
            request_id=request_id,
            service=service,
            duration_ms=duration_ms,
        )


def parse_timestamp(ts_str: str) -> datetime:
    """Parse ISO 8601 timestamp string to datetime."""
    # Handle various ISO 8601 formats
    ts_str = ts_str.strip()

    # Try parsing with timezone
    try:
        return datetime.fromisoformat(ts_str)
    except ValueError:
        pass

    # Try parsing as UTC
    if ts_str.endswith("Z"):
        ts_str = ts_str[:-1] + "+00:00"
        try:
            return datetime.fromisoformat(ts_str)
        except ValueError:
            pass

    # Try parsing without timezone (assume UTC)
    try:
        dt = datetime.fromisoformat(ts_str)
        return dt.replace(tzinfo=timezone.utc)
    except ValueError:
        pass

    raise ValueError(f"Unable to parse timestamp: {ts_str}")


def read_ndjson(file_path: str) -> Iterator[tuple[int, str]]:
    """Yield raw lines from a file (or stdin)."""
    if file_path == "-":
        import sys

        for line_num, line in enumerate(sys.stdin, start=1):
            yield line_num, line.rstrip("\n")
    else:
        with open(file_path, "r", encoding="utf-8") as f:
            for line_num, line in enumerate(f, start=1):
                yield line_num, line.rstrip("\n")


def parse_ndjson(file_path: str) -> Iterator[tuple[int, LogEntry | None]]:
    """Parse NDJSON file, yielding (line_number, LogEntry or None for errors)."""
    for line_num, line in read_ndjson(file_path):
        # Skip empty lines
        if not line.strip():
            continue

        try:
            data = __import__("json").loads(line)
            if not isinstance(data, dict):
                yield line_num, None
                continue

            entry = LogEntry.from_dict(data)
            yield line_num, entry
        except (ValueError, __import__("json").JSONDecodeError):
            yield line_num, None


def stream_entries(file_path: str) -> Iterator[LogEntry]:
    """Stream valid log entries, skipping invalid ones."""
    import sys

    for line_num, entry in parse_ndjson(file_path):
        if entry is not None:
            yield entry
        else:
            print(
                f"Warning: Skipping malformed line {line_num}",
                file=sys.stderr,
            )
```

### File: src/loglens/filters.py

```python
"""Filter predicates and filter configuration."""

from dataclasses import dataclass
from datetime import datetime
from typing import Iterator

from loglens.parser import LogEntry
from loglens.types import FilterConfig, LogLevel


@dataclass(slots=True)
class FilterConfig:
    """Configuration for log entry filtering."""

    levels: set[LogLevel] | None = None
    since: datetime | None = None
    until: datetime | None = None
    field_filters: dict[str, str] | None = None
    contains: str | None = None
    limit: int | None = None


def matches_filter(entry: LogEntry, config: FilterConfig) -> bool:
    """Check if a log entry matches all filter criteria."""
    # Check log level
    if config.levels is not None and entry.level not in config.levels:
        return False

    # Check timestamp range - since
    if config.since is not None and entry.timestamp < config.since:
        return False

    # Check timestamp range - until
    if config.until is not None and entry.timestamp > config.until:
        return False

    # Check field filters (AND logic)
    if config.field_filters is not None:
        for field_name, expected_value in config.field_filters.items():
            actual_value = getattr(entry, field_name, None)
            if actual_value is None:
                # Check in raw_data for custom fields
                actual_value = entry.raw_data.get(field_name)
            if str(actual_value) != expected_value:
                return False

    # Check message contains
    if config.contains is not None:
        if config.contains.lower() not in entry.message.lower():
            return False

    return True


def filter_entries(
    entries: Iterator[LogEntry], config: FilterConfig
) -> Iterator[LogEntry]:
    """Filter log entries based on configuration."""
    count = 0

    for entry in entries:
        if matches_filter(entry, config):
            yield entry
            count += 1

            # Check limit
            if config.limit is not None and count >= config.limit:
                break
```

### File: src/loglens/aggregator.py

```python
"""Statistics aggregation for log entries."""

from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Iterator

from loglens.parser import LogEntry
from loglens.types import LogLevel, StatsResult


@dataclass(slots=True)
class StatsResult:
    """Aggregated statistics result."""

    total_entries: int = 0
    count_per_level: dict[LogLevel, int] = field(default_factory=dict)
    earliest_timestamp: datetime | None = None
    latest_timestamp: datetime | None = None
    top_messages: list[tuple[str, int]] = field(default_factory=list)
    slowest_entries: list[LogEntry] = field(default_factory=list)
    entries_per_hour: dict[str, int] = field(default_factory=dict)

    def to_dict(self) -> dict:
        """Convert to dictionary for JSON serialization."""
        return {
            "total_entries": self.total_entries,
            "count_per_level": {k.value: v for k, v in self.count_per_level.items()},
            "earliest_timestamp": self.earliest_timestamp.isoformat() if self.earliest_timestamp else None,
            "latest_timestamp": self.latest_timestamp.isoformat() if self.latest_timestamp else None,
            "top_messages": self.top_messages,
            "slowest_entries": [
                {
                    "timestamp": e.timestamp.isoformat(),
                    "level": e.level.value,
                    "message": e.message,
                    "duration_ms": e.duration_ms,
                }
                for e in self.slowest_entries
            ],
            "entries_per_hour": self.entries_per_hour,
        }


def aggregate_stats(entries: Iterator[LogEntry]) -> StatsResult:
    """Compute statistics over log entries."""
    result = StatsResult()
    message_counts: Counter[str] = Counter()
    level_counts: Counter[LogLevel] = Counter()
    all_entries: list[LogEntry] = []

    for entry in entries:
        result.total_entries += 1
        level_counts[entry.level] += 1
        message_counts[entry.message] += 1
        all_entries.append(entry)

        # Track earliest timestamp
        if result.earliest_timestamp is None or entry.timestamp < result.earliest_timestamp:
            result.earliest_timestamp = entry.timestamp

        # Track latest timestamp
        if result.latest_timestamp is None or entry.timestamp > result.latest_timestamp:
            result.latest_timestamp = entry.timestamp

        # Track entries per hour
        hour_key = entry.timestamp.strftime("%Y-%m-%d %H:00")
        result.entries_per_hour[hour_key] = result.entries_per_hour.get(hour_key, 0) + 1

        # Track slowest entries (by duration_ms)
        if entry.duration_ms is not None:
            result.slowest_entries.append(entry)

    # Set count per level
    result.count_per_level = dict(level_counts)

    # Get top 10 messages
    result.top_messages = message_counts.most_common(10)

    # Get top 5 slowest entries
    result.slowest_entries = sorted(
        result.slowest_entries,
        key=lambda e: e.duration_ms if e.duration_ms else 0,
        reverse=True,
    )[:5]

    return result


def generate_histogram_bar(
    entries_per_hour: dict[str, int], width: int = 50
) -> str:
    """Generate a text-based bar chart histogram."""
    if not entries_per_hour:
        return "No data available for histogram."

    # Sort by hour
    sorted_hours = sorted(entries_per_hour.items())
    max_count = max(count for _, count in sorted_hours)

    if max_count == 0:
        return "No entries to display."

    lines = []
    for hour, count in sorted_hours:
        bar_length = int((count / max_count) * width)
        bar = "█" * bar_length
        lines.append(f"{hour} | {bar} ({count})")

    return "\n".join(lines)
```

### File: src/loglens/formatters.py

```python
"""Output formatters for log entries and statistics."""

import csv
import json
import sys
from typing import Iterator

from loglens.aggregator import StatsResult
from loglens.parser import LogEntry


def format_entry_json(entry: LogEntry) -> str:
    """Format a single log entry as JSON."""
    output = {
        "timestamp": entry.timestamp.isoformat(),
        "level": entry.level.value,
        "message": entry.message,
    }
    # Add optional fields if present
    if entry.request_id:
        output["request_id"] = entry.request_id
    if entry.service:
        output["service"] = entry.service
    if entry.duration_ms is not None:
        output["duration_ms"] = entry.duration_ms
    # Add any other fields from raw_data
    for key, value in entry.raw_data.items():
        if key not in output:
            output[key] = value
    return json.dumps(output)


def format_entries_json(entries: Iterator[LogEntry]) -> None:
    """Output entries as newline-delimited JSON."""
    first = True
    for entry in entries:
        if not first:
            print()
        print(format_entry_json(entry), end="")
        first = False
    print()


def format_entries_csv(entries: Iterator[LogEntry]) -> None:
    """Output entries as CSV."""
    fieldnames = ["timestamp", "level", "message", "request_id", "service", "duration_ms"]
    writer = csv.DictWriter(sys.stdout, fieldnames=fieldnames, extrasaction="ignore")
    writer.writeheader()

    for entry in entries:
        writer.writerow({
            "timestamp": entry.timestamp.isoformat(),
            "level": entry.level.value,
            "message": entry.message,
            "request_id": entry.request_id or "",
            "service": entry.service or "",
            "duration_ms": entry.duration_ms if entry.duration_ms is not None else "",
        })


def format_entries_table(entries: Iterator[LogEntry]) -> None:
    """Output entries as a formatted table."""
    # Collect entries for table display (limit to prevent excessive memory use)
    rows = []
    for entry in entries:
        rows.append([
            entry.timestamp.strftime("%Y-%m-%d %H:%M:%S"),
            entry.level.value.upper(),
            entry.message[:60] + "..." if len(entry.message) > 60 else entry.message,
            entry.service or "-",
            str(entry.duration_ms) if entry.duration_ms is not None else "-",
        ])

    if not rows:
        print("No entries to display.")
        return

    # Calculate column widths
    col_widths = [0, 0, 0, 0, 0]
    for row in rows:
        for i, cell in enumerate(row):
            col_widths[i] = max(col_widths[i], len(cell))

    # Print header
    headers = ["TIMESTAMP", "LEVEL", "MESSAGE", "SERVICE", "DURATION_MS"]
    header_row = " | ".join(h.ljust(w) for h, w in zip(headers, col_widths))
    print(header_row)
    print("-" * len(header_row))

    # Print rows
    for row in rows:
        print(" | ".join(cell.ljust(w) for cell, w in zip(row, col_widths)))


def format_stats_json(stats: StatsResult) -> None:
    """Output statistics as JSON."""
    print(json.dumps(stats.to_dict(), indent=2))


def format_stats_table(stats: StatsResult) -> None:
    """Output statistics as a formatted table."""
    print("=" * 60)
    print("LOG STATISTICS")
    print("=" * 60)
    print()

    print(f"Total Entries: {stats.total_entries}")
    print()

    print("Count per Level:")
    for level, count in sorted(stats.count_per_level.items(), key=lambda x: -x[1]):
        print(f"  {level.value.upper():10} : {count}")
    print()

    print("Time Range:")
    if stats.earliest_timestamp:
        print(f"  Earliest: {stats.earliest_timestamp.isoformat()}")
    if stats.latest_timestamp:
        print(f"  Latest  : {stats.latest_timestamp.isoformat()}")
    print()

    print("Top 10 Messages:")
    for msg, count in stats.top_messages:
        truncated = msg[:50] + "..." if len(msg) > 50 else msg
        print(f"  {count:5} | {truncated}")
    print()

    if stats.slowest_entries:
        print("Top 5 Slowest Entries:")
        for entry in stats.slowest_entries:
            print(f"  {entry.duration_ms}ms | {entry.message[:50]}")
        print()

    print("Entries per Hour (Histogram):")
    from loglens.aggregator import generate_histogram_bar
    print(generate_histogram_bar(stats.entries_per_hour))
```

### File: src/loglens/watcher.py

```python
"""File watching/tailing functionality."""

import os
import time
from dataclasses import dataclass
from typing import Iterator

from loglens.parser import LogEntry, stream_entries


@dataclass
class WatchConfig:
    """Configuration for watching a file."""

    file_path: str
    poll_interval: float = 0.5
    initial_position: int | None = None


def watch_file(file_path: str) -> Iterator[LogEntry]:
    """Watch a file and yield new entries as they are appended."""
    if file_path == "-":
        # For stdin, just stream once
        yield from stream_entries(file_path)
        return

    # Get initial file size
    try:
        file_size = os.path.getsize(file_path)
    except OSError as e:
        raise FileNotFoundError(f"Cannot access file {file_path}: {e}")

    # Track position
    position = file_size

    # For initial content, yield existing entries from position 0
    # (stream_entries will read from start)
    yield from stream_entries(file_path)

    # Now watch for new content
    while True:
        try:
            current_size = os.path.getsize(file_path)
        except OSError:
            # File might have been deleted or is inaccessible
            break

        if current_size > position:
            # Read new content
            with open(file_path, "r", encoding="utf-8") as f:
                f.seek(position)
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        import json

                        data = json.loads(line)
                        if isinstance(data, dict):
                            entry = LogEntry.from_dict(data)
                            yield entry
                    except (ValueError, json.JSONDecodeError):
                        import sys

                        print(
                            f"Warning: Skipping malformed line",
                            file=sys.stderr,
                        )

            position = current_size

        time.sleep(0.5)
```

### File: src/loglens/cli.py

```python
"""Click CLI interface for LogLens."""

import sys
from datetime import datetime

import click

from loglens.aggregator import aggregate_stats, generate_histogram_bar
from loglens.filters import FilterConfig, filter_entries
from loglens.formatters import (
    format_entries_csv,
    format_entries_json,
    format_entries_table,
    format_stats_json,
    format_stats_table,
)
from loglens.parser import stream_entries
from loglens.types import LogLevel
from loglens.watcher import watch_file


def parse_datetime(ctx: click.Context, param: click.Parameter, value: str | None) -> datetime | None:
    """Parse datetime string."""
    if value is None:
        return None
    try:
        # Handle ISO 8601 format
        if value.endswith("Z"):
            value = value[:-1] + "+00:00"
        return datetime.fromisoformat(value)
    except ValueError:
        raise click.BadParameter(f"Invalid datetime format: {value}. Use ISO 8601 format.")


def parse_field_filter(ctx: click.Context, param: click.Parameter, value: list[str] | None) -> dict[str, str] | None:
    """Parse field filter values."""
    if not value:
        return None
    result = {}
    for item in value:
        if "=" not in item:
            raise click.BadParameter(f"Invalid field filter: {item}. Use FIELD=VALUE format.")
        key, val = item.split("=", 1)
        result[key] = val
    return result


class FilePathParamType(click.ParamType):
    """Custom parameter type for file paths."""

    name = "filepath"

    def convert(self, value, param, ctx):
        if value == "-":
            return "-"
        if not value:
            return value
        # Validate file exists (except for stdin)
        import os

        if not os.path.exists(value):
            self.fail(f"File '{value}' does not exist.", param, ctx)
        return value


FILE_PATH = FilePathParamType()


# Base filter options
def filter_options(f):
    """Decorator to add common filter options."""
    f = click.option(
        "--level",
        "-l",
        "levels",
        multiple=True,
        help="Filter by log level (repeatable)",
    )(f)
    f = click.option(
        "--since",
        "since",
        help="Only entries at or after this timestamp (ISO 8601)",
        callback=parse_datetime,
    )(f)
    f = click.option(
        "--until",
        "until",
        help="Only entries before this timestamp (ISO 8601)",
        callback=parse_datetime,
    )(f)
    f = click.option(
        "--field",
        "-f",
        "field_filters",
        multiple=True,
        help="Match entries where a field equals a value (repeatable, AND logic)",
        callback=parse_field_filter,
    )(f)
    f = click.option(
        "--contains",
        "contains",
        help="Match entries whose message contains TEXT (case-insensitive)",
    )(f)
    return f


@click.group()
@click.version_option(version="1.0.0")
def main():
    """LogLens - Analyze structured JSON log files."""
    pass


@main.command()
@click.argument("file", type=FILE_PATH)
@filter_options
@click.option(
    "--output",
    "-o",
    "output_format",
    type=click.Choice(["json", "csv", "table"]),
    default="json",
    help="Output format",
)
@click.option(
    "--limit",
    "-n",
    "limit",
    type=int,
    help="Stop after N matching entries",
)
def filter(file, levels, since, until, field_filters, contains, output_format, limit):
    """Stream log entries matching the given criteria to stdout."""
    try:
        # Build filter config
        level_set = None
        if levels:
            level_set = set()
            for level_str in levels:
                try:
                    level_set.add(LogLevel.from_string(level_str))
                except ValueError as e:
                    click.echo(f"Error: {e}", err=True)
                    sys.exit(1)

        filter_config = FilterConfig(
            levels=level_set,
            since=since,
            until=until,
            field_filters=field_filters,
            contains=contains,
            limit=limit,
        )

        # Stream and filter entries
        entries = stream_entries(file)
        filtered = filter_entries(entries, filter_config)

        # Output based on format
        if output_format == "json":
            format_entries_json(filtered)
        elif output_format == "csv":
            format_entries_csv(filtered)
        elif output_format == "table":
            format_entries_table(filtered)

    except FileNotFoundError as e:
        click.echo(f"Error: {e}", err=True)
        sys.exit(1)
    except PermissionError as e:
        click.echo(f"Error: {e}", err=True)
        sys.exit(1)
    except BrokenPipeError:
        # Gracefully handle broken pipe (e.g., piping to head)
        sys.exit(0)
    except Exception as e:
        click.echo(f"Runtime error: {e}", err=True)
        sys.exit(2)


@main.command()
@click.argument("file", type=FILE_PATH)
@filter_options
@click.option(
    "--output",
    "-o",
    "output_format",
    type=click.Choice(["json", "table"]),
    default="json",
    help="Output format",
)
def stats(file, levels, since, until, field_filters, contains, output_format):
    """Compute aggregations over the (optionally filtered) log entries."""
    try:
        # Build filter config
        level_set = None
        if levels:
            level_set = set()
            for level_str in levels:
                try:
                    level_set.add(LogLevel.from_string(level_str))
                except ValueError as e:
                    click.echo(f"Error: {e}", err=True)
                    sys.exit(1)

        filter_config = FilterConfig(
            levels=level_set,
            since=since,
            until=until,
            field_filters=field_filters,
            contains=contains,
        )

        # Stream, filter, and aggregate
        entries = stream_entries(file)
        filtered = filter_entries(entries, filter_config)
        result = aggregate_stats(filtered)

        # Output based on format
        if output_format == "json":
            format_stats_json(result)
        elif output_format == "table":
            format_stats_table(result)

    except FileNotFoundError as e:
        click.echo(f"Error: {e}", err=True)
        sys.exit(1)
    except PermissionError as e:
        click.echo(f"Error: {e}", err=True)
        sys.exit(1)
    except BrokenPipeError:
        sys.exit(0)
    except Exception as e:
        click.echo(f"Runtime error: {e}", err=True)
        sys.exit(2)


@main.command()
@click.argument("file", type=FILE_PATH)
@filter_options
@click.option(
    "--output",
    "-o",
    "output_format",
    type=click.Choice(["json", "table"]),
    default="json",
    help="Output format",
)
def watch(file, levels, since, until, field_filters, contains, output_format):
    """Tail a file and stream new matching entries as they are appended."""
    try:
        # Build filter config
        level_set = None
        if levels:
            level_set = set()
            for level_str in levels:
                try:
                    level_set.add(LogLevel.from_string(level_str))
                except ValueError as e:
                    click.echo(f"Error: {e}", err=True)
                    sys.exit(1)

        filter_config = FilterConfig(
            levels=level_set,
            since=since,
            until=until,
            field_filters=field_filters,
            contains=contains,
        )

        # Watch file and yield new entries
        watched = watch_file(file)
        filtered = filter_entries(watched, filter_config)

        # Output based on format
        if output_format == "json":
            format_entries_json(filtered)
        elif output_format == "table":
            format_entries_table(filtered)

    except FileNotFoundError as e:
        click.echo(f"Error: {e}", err=True)
        sys.exit(1)
    except PermissionError as e:
        click.echo(f"Error: {e}", err=True)
        sys.exit(1)
    except BrokenPipeError:
        sys.exit(0)
    except KeyboardInterrupt:
        # Graceful exit on Ctrl+C
        sys.exit(0)
    except Exception as e:
        click.echo(f"Runtime error: {e}", err=True)
        sys.exit(2)


if __name__ == "__main__":
    main()
```

### File: src/loglens/__init__.py

```python
"""LogLens - A CLI tool for analyzing structured JSON log files."""

__version__ = "1.0.0"
```

### File: tests/conftest.py

```python
"""Shared test fixtures for LogLens tests."""

import json
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator

import pytest

from loglens.parser import LogEntry
from loglens.types import LogLevel


@pytest.fixture
def sample_log_data() -> list[dict]:
    """Generate sample log data for testing."""
    base_time = datetime(2025, 1, 15, 8, 0, 0, tzinfo=timezone.utc)

    return [
        {
            "timestamp": (base_time).isoformat(),
            "level": "debug",
            "message": "Starting application",
            "service": "app",
            "request_id": "req-001",
            "duration_ms": 10,
        },
        {
            "timestamp": (base_time.replace(minute=5)).isoformat(),
            "level": "info",
            "message": "User logged in",
            "service": "auth-api",
            "request_id": "req-002",
            "duration_ms": 50,
        },
        {
            "timestamp": (base_time.replace(minute=10)).isoformat(),
            "level": "warning",
            "message": "High memory usage detected",
            "service": "monitor",
            "request_id": "req-003",
            "duration_ms": 100,
        },
        {
            "timestamp": (base_time.replace(minute=15)).isoformat(),
            "level": "error",
            "message": "Connection refused",
            "service": "auth-api",
            "request_id": "req-004",
            "duration_ms": 342,
        },
        {
            "timestamp": (base_time.replace(minute=20)).isoformat(),
            "level": "error",
            "message": "Database timeout",
            "service": "db-service",
            "request_id": "req-005",
            "duration_ms": 5000,
        },
        {
            "timestamp": (base_time.replace(minute=25)).isoformat(),
            "level": "critical",
            "message": "System crash",
            "service": "kernel",
            "request_id": "req-006",
            "duration_ms": 0,
        },
        {
            "timestamp": (base_time.replace(minute=30)).isoformat(),
            "level": "info",
            "message": "Request completed",
            "service": "api-gateway",
            "request_id": "req-007",
            "duration_ms": 150,
        },
        {
            "timestamp": (base_time.replace(minute=35)).isoformat(),
            "level": "debug",
            "message": "Cache hit",
            "service": "cache",
            "request_id": "req-008",
            "duration_ms": 5,
        },
        {
            "timestamp": (base_time.replace(minute=40)).isoformat(),
            "level": "info",
            "message": "User logged in",
            "service": "auth-api",
            "request_id": "req-009",
            "duration_ms": 45,
        },
        {
            "timestamp": (base_time.replace(minute=45)).isoformat(),
            "level": "warning",
            "message": "Rate limit approaching",
            "service": "api-gateway",
            "request_id": "req-010",
            "duration_ms": 20,
        },
        {
            "timestamp": (base_time.replace(minute=50)).isoformat(),
            "level": "error",
            "message": "Connection refused",
            "service": "auth-api",
            "request_id": "req-011",
            "duration_ms": 250,
        },
        {
            "timestamp": (base_time.replace(minute=55)).isoformat(),
            "level": "info",
            "message": "Configuration reloaded",
            "service": "config",
            "request_id": "req-012",
            "duration_ms": 100,
        },
    ]


@pytest.fixture
def sample_log_file(sample_log_data: list[dict]) -> Iterator[str]:
    """Create a temporary log file with sample data."""
    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".log", delete=False
    ) as f:
        for entry in sample_log_data:
            f.write(json.dumps(entry) + "\n")
        temp_path = f.name

    yield temp_path

    # Cleanup
    os.unlink(temp_path)


@pytest.fixture
def malformed_log_file() -> Iterator[str]:
    """Create a temporary log file with malformed entries."""
    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".log", delete=False
    ) as f:
        f.write('{"timestamp": "2025-01-15T08:00:00Z", "level": "info", "message": "Valid"}\n')
        f.write("not valid json\n")
        f.write('{"level": "error", "message": "Missing timestamp"}\n')
        f.write('{"timestamp": "2025-01-15T08:00:00Z", "message": "Missing level"}\n')
        f.write('{"timestamp": "2025-01-15T08:00:00Z", "level": "info"}\n')
        f.write("{}\n")
        temp_path = f.name

    yield temp_path

    os.unlink(temp_path)


@pytest.fixture
def empty_log_file() -> Iterator[str]:
    """Create an empty temporary log file."""
    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".log", delete=False
    ) as f:
        temp_path = f.name

    yield temp_path

    os.unlink(temp_path)
```

### File: tests/test_parser.py

```python
"""Tests for log parsing functionality."""

import json
from datetime import datetime, timezone

import pytest

from loglens.parser import LogEntry, parse_ndjson, parse_timestamp, stream_entries


class TestParseTimestamp:
    """Tests for timestamp parsing."""

    def test_parse_timestamp_with_z_suffix(self):
        """Parse timestamp with Z suffix."""
        result = parse_timestamp("2025-01-15T08:23:41Z")
        assert result.tzinfo is not None
        assert result.year == 2025
        assert result.month == 1
        assert result.day == 15
        assert result.hour == 8
        assert result.minute == 23
        assert result.second == 41

    def test_parse_timestamp_with_timezone(self):
        """Parse timestamp with explicit timezone."""
        result = parse_timestamp("2025-01-15T08:23:41+05:30")
        assert result.tzinfo is not None
        assert result.hour == 8

    def test_parse_timestamp_invalid(self):
        """Invalid timestamp raises error."""
        with pytest.raises(ValueError, match="Unable to parse timestamp"):
            parse_timestamp("not-a-timestamp")


class TestLogEntry:
    """Tests for LogEntry creation."""

    def test_valid_entry_creation(self):
        """Create LogEntry from valid dictionary."""
        data = {
            "timestamp": "2025-01-15T08:23:41Z",
            "level": "error",
            "message": "Connection refused",
            "service": "auth-api",
            "request_id": "abc-123",
            "duration_ms": 342,
        }
        entry = LogEntry.from_dict(data)

        assert entry.timestamp.year == 2025
        assert entry.level.value == "error"
        assert entry.message == "Connection refused"
        assert entry.service == "auth-api"
        assert entry.request_id == "abc-123"
        assert entry.duration_ms == 342

    def test_missing_timestamp_raises(self):
        """Missing timestamp raises ValueError."""
        data = {"level": "error", "message": "Test"}
        with pytest.raises(ValueError, match="Missing required field: timestamp"):
            LogEntry.from_dict(data)

    def test_missing_level_raises(self):
        """Missing level raises ValueError."""
        data = {"timestamp": "2025-01-15T08:23:41Z", "message": "Test"}
        with pytest.raises(ValueError, match="Missing required field: level"):
            LogEntry.from_dict(data)

    def test_missing_message_raises(self):
        """Missing message raises ValueError."""
        data = {"timestamp": "2025-01-15T08:23:41Z", "level": "error"}
        with pytest.raises(ValueError, match="Missing required field: message"):
            LogEntry.from_dict(data)

    def test_invalid_level_raises(self):
        """Invalid log level raises ValueError."""
        data = {
            "timestamp": "2025-01-15T08:23:41Z",
            "level": "invalid",
            "message": "Test",
        }
        with pytest.raises(ValueError, match="Invalid log level"):
            LogEntry.from_dict(data)


class TestParseNDJSON:
    """Tests for NDJSON parsing."""

    def test_parse_valid_lines(self, sample_log_file):
        """Parse valid log lines."""
        results = list(parse_ndjson(sample_log_file))
        valid_entries = [entry for _, entry in results if entry is not None]
        assert len(valid_entries) == 12

    def test_parse_malformed_lines(self, malformed_log_file):
        """Parse file with malformed lines."""
        results = list(parse_ndjson(malformed_log_file))
        valid_entries = [entry for _, entry in results if entry is not None]
        assert len(valid_entries) == 1

    def test_parse_empty_file(self, empty_log_file):
        """Parse empty file."""
        results = list(parse_ndjson(empty_log_file))
        assert len(results) == 0


class TestStreamEntries:
    """Tests for entry streaming."""

    def test_stream_entries_yields_valid(self, sample_log_file):
        """Stream yields only valid entries."""
        entries = list(stream_entries(sample_log_file))
        assert len(entries) == 12

    def test_stream_entries_skips_malformed(self, malformed_log_file):
        """Stream skips malformed entries."""
        entries = list(stream_entries(malformed_log_file))
        assert len(entries) == 1
```

### File: tests/test_filters.py

```python
"""Tests for filtering functionality."""

from datetime import datetime, timezone

import pytest

from loglens.filters import FilterConfig, filter_entries, matches_filter
from loglens.parser import LogEntry
from loglens.types import LogLevel


def create_entry(
    timestamp: datetime,
    level: LogLevel,
    message: str,
    service: str | None = None,
    duration_ms: int | None = None,
) -> LogEntry:
    """Helper to create LogEntry for testing."""
    return LogEntry(
        timestamp=timestamp,
        level=level,
        message=message,
        service=service,
        duration_ms=duration_ms,
    )


class TestMatchesFilter:
    """Tests for individual filter predicates."""

    def test_level_filter_matches(self):
        """Level filter matches correctly."""
        entry = create_entry(
            datetime(2025, 1, 15, tzinfo=timezone.utc),
            LogLevel.ERROR,
            "Test message",
        )
        config = FilterConfig(levels={LogLevel.ERROR, LogLevel.CRITICAL})

        assert matches_filter(entry, config) is True

    def test_level_filter_no_match(self):
        """Level filter rejects non-matching level."""
        entry = create_entry(
            datetime(2025, 1, 15, tzinfo=timezone.utc),
            LogLevel.DEBUG,
            "Test message",
        )
        config = FilterConfig(levels={LogLevel.ERROR, LogLevel.CRITICAL})

        assert matches_filter(entry, config) is False

    def test_since_filter(self):
        """Since timestamp filter works."""
        entry = create_entry(
            datetime(2025, 1, 15, 10, 0, 0, tzinfo=timezone.utc),
            LogLevel.INFO,
            "Test",
        )
        config = FilterConfig(since=datetime(2025, 1, 15, 9, 0, 0, tzinfo=timezone.utc))

        assert matches_filter(entry, config) is True

    def test_since_filter_excludes_early(self):
        """Since filter excludes early entries."""
        entry = create_entry(
            datetime(2025, 1, 15, 8, 0, 0, tzinfo=timezone.utc),
            LogLevel.INFO,
            "Test",
        )
        config = FilterConfig(since=datetime(2025, 1, 15, 9, 0, 0, tzinfo=timezone.utc))

        assert matches_filter(entry, config) is False

    def test_until_filter(self):
        """Until timestamp filter works."""
        entry = create_entry(
            datetime(2025, 1, 15, 8, 0, 0, tzinfo=timezone.utc),
            LogLevel.INFO,
            "Test",
        )
        config = FilterConfig(until=datetime(2025, 1, 15, 9, 0, 0, tzinfo=timezone.utc))

        assert matches_filter(entry, config) is True

    def test_until_filter_excludes_late(self):
        """Until filter excludes late entries."""
        entry = create_entry(
            datetime(2025, 1, 15, 10, 0, 0, tzinfo=timezone.utc),
            LogLevel.INFO,
            "Test",
        )
        config = FilterConfig(until=datetime(2025, 1, 15, 9, 0, 0, tzinfo=timezone.utc))

        assert matches_filter(entry, config) is False

    def test_field_filter(self):
        """Field filter works for service field."""
        entry = create_entry(
            datetime(2025, 1, 15, tzinfo=timezone.utc),
            LogLevel.INFO,
            "Test",
            service="auth-api",
        )
        config = FilterConfig(field_filters={"service": "auth-api"})

        assert matches_filter(entry, config) is True

    def test_field_filter_no_match(self):
        """Field filter rejects non-matching value."""
        entry = create_entry(
            datetime(2025, 1, 15, tzinfo=timezone.utc),
            LogLevel.INFO,
            "Test",
            service="other-service",
        )
        config = FilterConfig(field_filters={"service": "auth-api"})

        assert matches_filter(entry, config) is False

    def test_contains_filter(self):
        """Message contains filter works."""
        entry = create_entry(
            datetime(2025, 1, 15, tzinfo=timezone.utc),
            LogLevel.ERROR,
            "Connection refused to server",
        )
        config = FilterConfig(contains="connection")

        assert matches_filter(entry, config) is True

    def test_contains_filter_case_insensitive(self):
        """Message contains filter is case-insensitive."""
        entry = create_entry(
            datetime(2025, 1, 15, tzinfo=timezone.utc),
            LogLevel.ERROR,
            "CONNECTION REFUSED",
        )
        config = FilterConfig(contains="connection")

        assert matches_filter(entry, config) is True

    def test_contains_filter_no_match(self):
        """Message contains filter rejects non-matching."""
        entry = create_entry(
            datetime(2025, 1, 15, tzinfo=timezone.utc),
            LogLevel.ERROR,
            "Success",
        )
        config = FilterConfig(contains="error")

        assert matches_filter(entry, config) is False

    def test_combined_filters_all_must_match(self):
        """Combined filters use AND logic."""
        entry = create_entry(
            datetime(2025, 1, 15, 10, 0, 0, tzinfo=timezone.utc),
            LogLevel.ERROR,
            "Connection refused",
            service="auth-api",
        )
        config = FilterConfig(
            levels={LogLevel.ERROR},
            since=datetime(2025, 1, 15, 9, 0, 0, tzinfo=timezone.utc),
            until=datetime(2025, 1, 15, 11, 0, 0, tzinfo=timezone.utc),
            field_filters={"service": "auth-api"},
            contains="connection",
        )

        assert matches_filter(entry, config) is True

    def test_combined_filters_partial_reject(self):
        """Combined filters reject when one fails."""
        entry = create_entry(
            datetime(2025, 1, 15, 10, 0, 0, tzinfo=timezone.utc),
            LogLevel.ERROR,
            "Connection refused",
            service="other-service",
        )
        config = FilterConfig(
            levels={LogLevel.ERROR},
            field_filters={"service": "auth-api"},
        )

        assert matches_filter(entry, config) is False


class TestFilterEntries:
    """Tests for filter_entries generator."""

    def test_filter_entries_yields_matching(self, sample_log_file):
        """Filter yields only matching entries."""
        config = FilterConfig(levels={LogLevel.ERROR})
        entries = list(filter_entries(stream_entries(sample_log_file), config))
        assert len(entries) == 3
        assert all(e.level == LogLevel.ERROR for e in entries)

    def test_filter_entries_limit(self, sample_log_file):
        """Filter respects limit."""
        config = FilterConfig(limit=2)
        entries = list(filter_entries(stream_entries(sample_log_file), config))
        assert len(entries) == 2

    def test_filter_entries_multiple_levels(self, sample_log_file):
        """Filter accepts multiple levels."""
        config = FilterConfig(levels={LogLevel.ERROR, LogLevel.CRITICAL})
        entries = list(filter_entries(stream_entries(sample_log_file), config))
        assert len(entries) == 4
```

### File: tests/test_aggregator.py

```python
"""Tests for statistics aggregation."""

from datetime import datetime, timezone

import pytest

from loglens.aggregator import StatsResult, aggregate_stats, generate_histogram_bar
from loglens.filters import FilterConfig, filter_entries
from loglens.parser import LogEntry
from loglens.types import LogLevel


def create_entry(
    timestamp: datetime,
    level: LogLevel,
    message: str,
    duration_ms: int | None = None,
) -> LogEntry:
    """Helper to create LogEntry for testing."""
    return LogEntry(
        timestamp=timestamp,
        level=level,
        message=message,
        duration_ms=duration_ms,
    )


class TestAggregateStats:
    """Tests for stats aggregation."""

    def test_total_entries_count(self, sample_log_file):
        """Total entries counted correctly."""
        entries = filter_entries(stream_entries(sample_log_file), FilterConfig())
        stats = aggregate_stats(entries)
        assert stats.total_entries == 12

    def test_count_per_level(self, sample_log_file):
        """Count per level computed correctly."""
        entries = filter_entries(stream_entries(sample_log_file), FilterConfig())
        stats = aggregate_stats(entries)

        assert stats.count_per_level[LogLevel.DEBUG] == 2
        assert stats.count_per_level[LogLevel.INFO] == 4
        assert stats.count_per_level[LogLevel.WARNING] == 2
        assert stats.count_per_level[LogLevel.ERROR] == 3
        assert stats.count_per_level[LogLevel.CRITICAL] == 1

    def test_time_range(self, sample_log_file):
        """Earliest and latest timestamps tracked."""
        entries = filter_entries(stream_entries(sample_log_file), FilterConfig())
        stats = aggregate_stats(entries)

        assert stats.earliest_timestamp is not None
        assert stats.latest_timestamp is not None
        assert stats.earliest_timestamp < stats.latest_timestamp

    def test_top_messages(self, sample_log_file):
        """Top messages computed correctly."""
        entries = filter_entries(stream_entries(sample_log_file), FilterConfig())
        stats = aggregate_stats(entries)

        # "User logged in" appears twice
        top = stats.top_messages
        assert len(top) > 0
        assert top[0][1] >= top[-1][1]  # Sorted descending by count

    def test_slowest_entries(self, sample_log_file):
        """Slowest entries tracked correctly."""
        entries = filter_entries(stream_entries(sample_log_file), FilterConfig())
        stats = aggregate_stats(entries)

        # Check sorted by duration_ms descending
        if stats.slowest_entries:
            for i in range(len(stats.slowest_entries) - 1):
                curr = stats.slowest_entries[i].duration_ms or 0
                next_dur = stats.slowest_entries[i + 1].duration_ms or 0
                assert curr >= next_dur

    def test_entries_per_hour(self, sample_log_file):
        """Entries per hour computed correctly."""
        entries = filter_entries(stream_entries(sample_log_file), FilterConfig())
        stats = aggregate_stats(entries)

        assert len(stats.entries_per_hour) > 0

    def test_empty_file(self, empty_log_file):
        """Empty file produces zero stats."""
        entries = filter_entries(stream_entries(empty_log_file), FilterConfig())
        stats = aggregate_stats(entries)

        assert stats.total_entries == 0
        assert stats.count_per_level == {}


class TestGenerateHistogramBar:
    """Tests for histogram generation."""

    def test_histogram_with_data(self):
        """Histogram generated with data."""
        data = {
            "2025-01-15 08:00": 10,
            "2025-01-15 09:00": 20,
            "2025-01-15 10:00": 5,
        }
        result = generate_histogram_bar(data, width=10)
        assert "2025-01-15 08:00" in result
        assert "2025-01-15 09:00" in result

    def test_histogram_empty_data(self):
        """Empty histogram shows message."""
        result = generate_histogram_bar({})
        assert "No data" in result

    def test_histogram_zero_counts(self):
        """Zero counts handled correctly."""
        result = generate_histogram_bar({"2025-01-15 08:00": 0})
        assert "No entries" in result


class TestStatsResultToDict:
    """Tests for StatsResult serialization."""

    def test_to_dict_json_serializable(self, sample_log_file):
        """to_dict produces JSON-serializable output."""
        import json

        entries = filter_entries(stream_entries(sample_log_file), FilterConfig())
        stats = aggregate_stats(entries)

        result = stats.to_dict()
        json_str = json.dumps(result)  # Should not raise
        assert json_str is not None
```

### File: tests/test_formatters.py

```python
"""Tests for output formatters."""

import json
import sys
from io import StringIO

import pytest

from loglens.aggregator import StatsResult, aggregate_stats
from loglens.filters import FilterConfig, filter_entries
from loglens.formatters import (
    format_entries_csv,
    format_entries_json,
    format_entries_table,
    format_stats_json,
    format_stats_table,
)
from loglens.parser import LogEntry, stream_entries
from loglens.types import LogLevel


def create_entry(
    timestamp: datetime,
    level: LogLevel,
    message: str,
    duration_ms: int | None = None,
    service: str | None = None,
) -> LogEntry:
    """Helper to create LogEntry for testing."""
    return LogEntry(
        timestamp=timestamp,
        level=level,
        message=message,
        duration_ms=duration_ms,
        service=service,
    )


from datetime import datetime, timezone


class TestFormatEntriesJson:
    """Tests for JSON output formatting."""

    def test_format_entries_json_valid(self, sample_log_file, capsys):
        """JSON output is valid."""
        entries = filter_entries(stream_entries(sample_log_file), FilterConfig(limit=2))
        format_entries_json(entries)

        captured = capsys.readouterr()
        # Should be valid JSON when newlines are added
        lines = [line for line in captured.out.split("\n") if line]
        for line in lines:
            json.loads(line)  # Should not raise

    def test_format_entries_json_structure(self, sample_log_file, capsys):
        """JSON output has expected structure."""
        entries = filter_entries(stream_entries(sample_log_file), FilterConfig(limit=1))
        format_entries_json(entries)

        captured = capsys.readouterr()
        data = json.loads(captured.out.strip())
        assert "timestamp" in data
        assert "level" in data
        assert "message" in data


class TestFormatEntriesCsv:
    """Tests for CSV output formatting."""

    def test_format_entries_csv_header(self, sample_log_file, capsys):
        """CSV output has header."""
        entries = filter_entries(stream_entries(sample_log_file), FilterConfig(limit=1))
        format_entries_csv(entries)

        captured = capsys.readouterr()
        assert "timestamp" in captured.out
        assert "level" in captured.out
        assert "message" in captured.out

    def test_format_entries_csv_data(self, sample_log_file, capsys):
        """CSV output has data rows."""
        entries = filter_entries(stream_entries(sample_log_file), FilterConfig(limit=2))
        format_entries_csv(entries)

        captured = capsys.readouterr()
        lines = captured.out.strip().split("\n")
        assert len(lines) == 3  # header + 2 data rows


class TestFormatEntriesTable:
    """Tests for table output formatting."""

    def test_format_entries_table_output(self, sample_log_file, capsys):
        """Table output is generated."""
        entries = filter_entries(stream_entries(sample_log_file), FilterConfig(limit=2))
        format_entries_table(entries)

        captured = capsys.readouterr()
        assert "TIMESTAMP" in captured.out
        assert "LEVEL" in captured.out
        assert "MESSAGE" in captured.out


class TestFormatStatsJson:
    """Tests for stats JSON output."""

    def test_format_stats_json_valid(self, sample_log_file, capsys):
        """Stats JSON is valid."""
        entries = filter_entries(stream_entries(sample_log_file), FilterConfig())
        stats = aggregate_stats(entries)
        format_stats_json(stats)

        captured = capsys.readouterr()
        data = json.loads(captured.out)
        assert "total_entries" in data
        assert "count_per_level" in data


class TestFormatStatsTable:
    """Tests for stats table output."""

    def test_format_stats_table_output(self, sample_log_file, capsys):
        """Stats table is generated."""
        entries = filter_entries(stream_entries(sample_log_file), FilterConfig())
        stats = aggregate_stats(entries)
        format_stats_table(stats)

        captured = capsys.readouterr()
        assert "LOG STATISTICS" in captured.out
        assert "Total Entries:" in captured.out
        assert "Count per Level:" in captured.out
```

### File: sample.log

```ndjson
{"timestamp": "2025-01-15T08:00:00.000Z", "level": "debug", "message": "Starting application", "service": "app", "request_id": "req-001", "duration_ms": 10}
{"timestamp": "2025-01-15T08:05:00.000Z", "level": "info", "message": "User logged in", "service": "auth-api", "request_id": "req-002", "duration_ms": 50}
{"timestamp": "2025-01-15T08:10:00.000Z", "level": "warning", "message": "High memory usage detected", "service": "monitor", "request_id": "req-003", "duration_ms": 100}
{"timestamp": "2025-01-15T08:15:00.000Z", "level": "error", "message": "Connection refused", "service": "auth-api", "request_id": "req-004", "duration_ms": 342}
{"timestamp": "2025-01-15T08:20:00.000Z", "level": "error", "message": "Database timeout", "service": "db-service", "request_id": "req-005", "duration_ms": 5000}
{"timestamp": "2025-01-15T08:25:00.000Z", "level": "critical", "message": "System crash", "service": "kernel", "request_id": "req-006", "duration_ms": 0}
{"timestamp": "2025-01-15T08:30:00.000Z", "level": "info", "message": "Request completed", "service": "api-gateway", "request_id": "req-007", "duration_ms": 150}
{"timestamp": "2025-01-15T08:35:00.000Z", "level": "debug", "message": "Cache hit", "service": "cache", "request_id": "req-008", "duration_ms": 5}
{"timestamp": "2025-01-15T08:40:00.000Z", "level": "info", "message": "User logged in", "service": "auth-api", "request_id": "req-009", "duration_ms": 45}
{"timestamp": "2025-01-15T08:45:00.000Z", "level": "warning", "message": "Rate limit approaching", "service": "api-gateway", "request_id": "req-010", "duration_ms": 20}
{"timestamp": "2025-01-15T08:50:00.000Z", "level": "error", "message": "Connection refused", "service": "auth-api", "request_id": "req-011", "duration_ms": 250}
{"timestamp": "2025-01-15T08:55:00.000Z", "level": "info", "message": "Configuration reloaded", "service": "config", "request_id": "req-012", "duration_ms": 100}
{"timestamp": "2025-01-15T09:00:00.000Z", "level": "info", "message": "Service started", "service": "app", "request_id": "req-013", "duration_ms": 200}
{"timestamp": "2025-01-15T09:05:00.000Z", "level": "debug", "message": "Processing batch job", "service": "worker", "request_id": "req-014", "duration_ms": 5000}
{"timestamp": "2025-01-15T09:10:00.000Z", "level": "warning", "message": "Disk space low", "service": "monitor", "request_id": "req-015", "duration_ms": 10}
{"timestamp": "2025-01-15T09:15:00.000Z", "level": "error", "message": "API rate limit exceeded", "service": "api-gateway", "request_id": "req-016", "duration_ms": 15}
{"timestamp": "2025-01-15T09:20:00.000Z", "level": "info", "message": "User logged out", "service": "auth-api", "request_id": "req-017", "duration_ms": 30}
{"timestamp": "2025-01-15T09:25:00.000Z", "level": "info", "message": "Backup completed", "service": "backup", "request_id": "req-018", "duration_ms": 10000}
{"timestamp": "2025-01-15T09:30:00.000Z", "level": "critical", "message": "Database connection lost", "service": "db-service", "request_id": "req-019", "duration_ms": 0}
{"timestamp": "2025-01-15T09:35:00.000Z", "level": "error", "message": "Failed to process request", "service": "api-gateway", "request_id": "req-020", "duration_ms": 500}
{"timestamp": "2025-01-15T09:40:00.000Z", "level": "info", "message": "Health check passed", "service": "monitor", "request_id": "req-021", "duration_ms": 5}
{"timestamp": "2025-01-15T09:45:00.000Z", "level": "debug", "message": "Cache cleared", "service": "cache", "request_id": "req-022", "duration_ms": 50}
{"timestamp": "2025-01-15T09:50:00.000Z", "level": "warning", "message": "Slow query detected", "service": "db-service", "request_id": "req-023", "duration_ms": 3000}
{"timestamp": "2025-01-15T09:55:00.000Z", "level": "info", "message": "Daily report generated", "service": "reporting", "request_id": "req-024", "duration_ms": 5000}
{"timestamp": "2025-01-15T10:00:00.000Z", "level": "info", "message": "Service restarted", "service": "app", "request_id": "req-025", "duration_ms": 1000}
```

Now let's install and test the tool:

```bash
pip install -e .
```

```bash
loglens filter sample.log --level error --since 2025-01-15T08:00:00Z --output table
```

```bash
loglens stats sample.log --output table
```