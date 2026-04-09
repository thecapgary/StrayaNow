#!/usr/bin/env python3
"""
StrayaNow flight collector — polls OpenSky Network for Australian flights.

Usage:
  python3 collect.py                  # collect once
  python3 collect.py --watch 60       # poll every 60 seconds
  python3 collect.py --bbox tas       # Tasmania (default)
  python3 collect.py --bbox aus       # All of Australia
"""

import argparse
import json
import os
import sys
import time
import urllib.request
import urllib.error
from datetime import datetime, timezone

BOUNDING_BOXES = {
    'tas': {'lamin': -43.6, 'lomin': 143.8, 'lamax': -39.5, 'lomax': 148.5},
    'aus': {'lamin': -44.0, 'lomin': 112.0, 'lamax': -10.0, 'lomax': 154.0},
    'vic': {'lamin': -39.2, 'lomin': 140.9, 'lamax': -33.9, 'lomax': 150.0},
    'nsw': {'lamin': -37.5, 'lomin': 140.9, 'lamax': -28.1, 'lomax': 153.6},
}

STATE_FIELDS = [
    'icao24', 'callsign', 'origin_country', 'time_position', 'last_contact',
    'longitude', 'latitude', 'baro_altitude', 'on_ground', 'velocity',
    'true_track', 'vertical_rate', 'sensors', 'geo_altitude', 'squawk',
    'spi', 'position_source',
]

DATA_DIR = os.path.join(os.path.dirname(__file__), '..', 'data', 'flights')


def fetch_flights(bbox):
    url = (
        f"https://opensky-network.org/api/states/all"
        f"?lamin={bbox['lamin']}&lomin={bbox['lomin']}"
        f"&lamax={bbox['lamax']}&lomax={bbox['lomax']}"
    )
    req = urllib.request.Request(url, headers={'User-Agent': 'StrayaNow/1.0'})
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        print(f"HTTP {e.code}: {e.reason}", file=sys.stderr)
        return None
    except urllib.error.URLError as e:
        print(f"Network error: {e.reason}", file=sys.stderr)
        return None


def save_snapshot(data, bbox, bbox_name):
    os.makedirs(DATA_DIR, exist_ok=True)
    now = datetime.now(timezone.utc)
    timestamp = now.strftime('%Y%m%dT%H%M%SZ')
    filename = f"{bbox_name}_flights_{timestamp}.json"
    filepath = os.path.join(DATA_DIR, filename)

    states_named = []
    if data.get('states'):
        for state in data['states']:
            states_named.append(dict(zip(STATE_FIELDS, state)))

    snapshot = {
        'time': data.get('time'),
        'states': data.get('states'),
        'states_named': states_named,
        '_collected_at': now.isoformat(),
        '_bounding_box': bbox,
    }

    with open(filepath, 'w') as f:
        json.dump(snapshot, f)

    count = len(states_named)
    print(f"[{now.strftime('%H:%M:%S')}] Saved {filename} — {count} aircraft")
    return filepath


def collect_once(bbox_name):
    bbox = BOUNDING_BOXES[bbox_name]
    print(f"Fetching flights over {bbox_name.upper()} ({bbox})...")
    data = fetch_flights(bbox)
    if data is None:
        print("No data received.", file=sys.stderr)
        return False
    save_snapshot(data, bbox, bbox_name)
    return True


def main():
    parser = argparse.ArgumentParser(description='StrayaNow flight collector')
    parser.add_argument('--bbox', default='tas', choices=list(BOUNDING_BOXES.keys()),
                        help='Bounding box region (default: tas)')
    parser.add_argument('--watch', type=int, metavar='SECONDS',
                        help='Poll interval in seconds (omit for single run)')
    args = parser.parse_args()

    if args.watch:
        print(f"Polling every {args.watch}s. Ctrl+C to stop.")
        while True:
            collect_once(args.bbox)
            time.sleep(args.watch)
    else:
        collect_once(args.bbox)


if __name__ == '__main__':
    main()
